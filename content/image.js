// 画像翻訳のセッション管理。取得・描画・表示は各モジュールへ委譲する。
(() => {
  if (globalThis.TFImage) return;
  const { TFImageCodec, TFImageRenderer, TFImageOverlay } = globalThis;

  function create({ getUi, send, loadSettings, addUsage, newSessionId, errorMessage, keepAliveMs }) {
    let snapshot = null;
    let generation = 0;
    let active = null;
    let overlay;

    document.addEventListener("contextmenu", (event) => {
      const source = event.composedPath().find((node) => node instanceof HTMLImageElement);
      if (!source) { snapshot = null; return; }
      snapshot = { source, url: source.currentSrc || source.src };
    }, true);

    function cancel() {
      generation++;
      overlay?.close();
      if (!active) return;
      active.ctrl.abort();
      clearInterval(active.keepAlive);
      send({ type: "cancel", sessionId: active.sessionId }).catch(() => {});
      active = null;
    }

    overlay = TFImageOverlay.create(cancel);

    async function translate(srcUrl) {
      cancel();
      const url = typeof srcUrl === "string" && srcUrl ? srcUrl : snapshot?.url;
      const captured = snapshot?.url === url ? snapshot : null;
      const ui = getUi();
      ui.hideSelButton();
      ui.hidePanel();
      const current = generation;
      const isCurrent = () => current === generation && overlay.isOpen();
      const source = captured?.source || [...document.images].find((image) => (image.currentSrc || image.src) === url);
      const request = { sessionId: newSessionId(), ctrl: new AbortController(), keepAlive: null };
      active = request;
      request.keepAlive = setInterval(() => send({ type: "tf:keepalive" }).catch(() => {}), keepAliveMs);
      try {
        if (!url) throw new Error("翻訳したい画像を右クリックして「画像を翻訳」を選んでください。");
        if (!source) throw new Error("翻訳する画像をページ上で見つけられませんでした。もう一度右クリックしてください。");
        overlay.start(source);
        const settings = await loadSettings();
        if (!isCurrent()) return;
        if (!settings.hasKey) {
          const provider = settings.models?.find((model) => model.id === settings.model)?.provider;
          throw new Error(`${provider === "openai" ? "OpenAI" : "Anthropic"} APIキーが未設定です。拡張の設定画面で登録してください。`);
        }
        const image = await TFImageCodec.prepare(url, captured?.source, {
          signal: request.ctrl.signal, sessionId: request.sessionId, send,
        });
        if (!isCurrent()) return;
        const response = await send({ type: "translateImage", sessionId: request.sessionId, image,
          context: { title: document.title.slice(0, 300), url: location.href.slice(0, 2000) } });
        if (response?.ok) addUsage(response);
        if (!isCurrent()) return;
        if (!response?.ok) throw new Error(response?.error || "画像の翻訳結果を取得できませんでした。");
        if (!response.regions?.length) { overlay.message("読み取れる文字がありませんでした。"); return; }
        const rendered = await TFImageRenderer.render(image, response.regions, request.ctrl.signal);
        if (!isCurrent()) return;
        overlay.show(rendered);
      } catch (error) {
        if (isCurrent() && error.name !== "AbortError") overlay.message(`エラー: ${errorMessage(error)}`, true);
      } finally {
        clearInterval(request.keepAlive);
        if (active === request) active = null;
      }
    }
    return { translate, cancel };
  }
  globalThis.TFImage = { create };
})();
