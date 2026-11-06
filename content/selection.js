// 選択範囲の翻訳・解説・質問と、選択ツールバーの位置・リクエストを管理する。
(() => {
  if (globalThis.TFSelection) return;

  const Seg = globalThis.TFSeg;
  const Context = globalThis.TFContext;
  if (!Seg || !Context) return;

  const EMPTY_RECT = { left: 40, right: 40, top: 40, bottom: 40 };
  const normalizeSelection = (text) =>
    text.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n\n");
  // 保持する会話にも上限を設ける。background 側でも同じ上限を独立に検証する。
  function recentHistory(history) {
    let remaining = 12000;
    const recent = [];
    for (const item of history.slice(-8).reverse()) {
      const content = item.content.slice(0, Math.min(item.role === "user" ? 1000 : 4000, remaining));
      if (content) { recent.unshift({ role: item.role, content }); remaining -= content.length; }
    }
    return recent;
  }

  function create({ getUi, peekUi, getSettings, loadSettings, send, requestTranslation, addUsage, costText, newSessionId, errorMessage, keepAliveMs }) {
    let selectionSnapshot = null;
    let explanationSnapshot = null;
    let questionSnapshot = null;
    let sessionId = null;
    let requestId = 0;
    let toolbarActive = false;
    let positionFrame = 0;
    let busy = false;
    let panelModel = null;

    function visibleRect(range) {
      try {
        const rects = [...range.getClientRects()];
        for (let i = rects.length - 1; i >= 0; i--) {
          const rect = rects[i];
          if (rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth) {
            return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
          }
        }
      } catch { /* 選択範囲が DOM から外れた場合 */ }
      return null;
    }

    function snapshotSelection() {
      const selected = window.getSelection();
      const text = selected?.rangeCount ? selected.toString().trim() : "";
      if (!text || peekUi()?.ownsNode(selected.anchorNode)) return null;
      const range = selected.getRangeAt(0).cloneRange();
      return { text, range, rect: visibleRect(range) };
    }

    function refreshToolbar() {
      const ui = peekUi();
      if (!toolbarActive || !selectionSnapshot || ui?.panelOpen) return;
      const rect = visibleRect(selectionSnapshot.range);
      if (rect) getUi().showSelButton(rect, getSettings()?.explanationEnabled !== false);
      else ui?.hideSelButton();
    }

    function scheduleToolbar() {
      if (!toolbarActive || positionFrame) return;
      positionFrame = requestAnimationFrame(() => {
        positionFrame = 0;
        refreshToolbar();
      });
    }

    function checkSelection() {
      const current = snapshotSelection();
      if (!current) {
        toolbarActive = false;
        peekUi()?.hideSelButton();
        return;
      }
      const ui = peekUi();
      if (ui?.panelOpen) ui.hidePanel();
      selectionSnapshot = current;
      toolbarActive = true;
      refreshToolbar();
    }

    function cancel() {
      requestId++;
      if (sessionId) send({ type: "cancel", sessionId }).catch(() => {});
      sessionId = null;
      busy = false;
    }

    function openQuestionComposer() {
      const captured = snapshotSelection() || selectionSnapshot;
      if (!captured?.text) return;
      cancel();
      toolbarActive = false;
      explanationSnapshot = null;
      panelModel = getSettings()?.model || null;
      questionSnapshot = captured;
      const ui = getUi();
      ui.hideSelButton();
      ui.openQuestionPanel(captured.rect || EMPTY_RECT, captured.text);
      const currentRequest = requestId;
      loadSettings().then((settings) => {
        if (currentRequest !== requestId || !ui.panelOpen) return;
        panelModel = settings.model;
        ui.setPanelModels(settings.models, panelModel);
      }).catch(() => {});
    }

    function openFollowupComposer() {
      if (busy || !explanationSnapshot?.history?.length) return;
      questionSnapshot = { ...explanationSnapshot, continuation: true };
      getUi().openFollowupQuestion();
    }

    async function run(mode, { detail = "brief", reuse = false, continuation = false, question = "", captured = null } = {}) {
      const selected = reuse ? explanationSnapshot : (captured || snapshotSelection() || selectionSnapshot);
      if (!selected?.text) return;
      toolbarActive = false;
      cancel();
      busy = true;
      const currentRequest = requestId;
      const history = reuse ? (selected.requestHistory || []) : continuation ? (selected.history || []) : [];
      const ui = getUi();
      ui.hideSelButton();
      ui.openPanel(selected.rect || EMPTY_RECT, selected.text, { mode, question });

      const showError = (message) => {
        ui.setPanelMessage(message);
        // 質問の失敗は同じ文面・同じ会話から再送できるようにする。
        if (mode === "explain" && question && questionSnapshot) ui.openFollowupQuestion(question);
      };

      try {
        const settings = await loadSettings();
        if (currentRequest !== requestId || !ui.panelOpen) return;
        if (mode === "explain") {
          if (!settings.models?.some((model) => model.id === panelModel)) panelModel = settings.model;
          ui.setPanelModels(settings.models, panelModel);
        }
        const requestModel = panelModel;
        const provider = settings.models?.find((model) => model.id === (mode === "explain" ? requestModel : settings.model))?.provider;
        const hasKey = provider === "openai" ? settings.hasOpenAIKey : provider === "anthropic" ? settings.hasAnthropicKey : settings.hasKey;
        if (!hasKey) { showError(`${provider === "openai" ? "OpenAI" : "Anthropic"} APIキーが未設定です。拡張の設定画面で登録してください。`); return; }
        if (mode === "explain" && settings.explanationEnabled === false) { showError("解説機能は設定で無効になっています。"); return; }
        if (mode === "explain" && selected.text.length > 6000) { showError("選択範囲を6,000文字以内にしてください。"); return; }

        let context = null;
        if (mode === "explain") {
          context = (reuse || continuation) && selected.context ? selected.context : Context.collect(selected.text, selected.range, question);
          if (question) questionSnapshot = { ...selected, context, history, continuation: true };
          ui.setPanelSources(context);
        } else explanationSnapshot = null;

        const requestSessionId = newSessionId();
        sessionId = requestSessionId;
        const keepAlive = setInterval(() => { send({ type: "tf:keepalive" }).catch(() => {}); }, keepAliveMs);
        let response;
        try {
          response = mode === "explain"
            ? await send({ type: "explain", sessionId: requestSessionId, selection: selected.text, context, detail, question, history, model: requestModel })
            : await requestTranslation([{ id: 0, text: Seg.esc(normalizeSelection(selected.text)) }], requestSessionId);
        } finally {
          clearInterval(keepAlive);
          if (sessionId === requestSessionId) sessionId = null;
        }

        if (response?.ok) addUsage(response);
        if (currentRequest !== requestId || !ui.panelOpen) return;
        if (!response?.ok) { showError(`エラー: ${response?.error || "応答なし"}`); return; }
        const text = mode === "explain" ? response.text : response.results?.[0];
        if (mode === "explain" && typeof text === "string" && text.trim()) {
          explanationSnapshot = { ...selected, context, question, requestHistory: history,
            history: recentHistory([...history, ...(question ? [{ role: "user", content: question }] : []), { role: "assistant", content: text }]) };
          questionSnapshot = null;
        }
        const cost = response.usage ? costText(response.usage.costUsd || 0) : response.cached ? "cache" : "";
        ui.setPanelResult(text != null ? (mode === "explain" ? text : Seg.unesc(Seg.stripMarkers(text))) : "結果を取得できませんでした", cost, { canFollowup: mode === "explain" && !!text });
      } catch (error) {
        if (currentRequest === requestId && ui.panelOpen) showError(`エラー: ${errorMessage(error)}`);
      } finally {
        if (currentRequest === requestId) busy = false;
      }
    }

    const handlers = {
      onTranslateSelection: () => run("translate"),
      onExplainSelection: () => { panelModel = null; run("explain"); },
      onAskSelection: openQuestionComposer,
      onFollowupQuestion: openFollowupComposer,
      onPanelModelChange: (model) => {
        if (getSettings()?.models?.some((entry) => entry.id === model)) panelModel = model;
      },
      onAskQuestion: (question) => {
        if (busy || !question.trim() || !questionSnapshot) return;
        run("explain", { question: question.trim(), captured: questionSnapshot, continuation: !!questionSnapshot.continuation });
      },
      onExplainDetail: (detail) => run("explain", { detail, reuse: true, question: explanationSnapshot?.question || "" }),
      onPanelClose: () => { cancel(); questionSnapshot = null; explanationSnapshot = null; panelModel = null; },
    };

    const fromUi = (event) => !!peekUi()?.ownsEvent(event);
    window.addEventListener("scroll", scheduleToolbar, true);
    window.addEventListener("resize", scheduleToolbar);
    document.addEventListener("contextmenu", (event) => { if (!fromUi(event)) checkSelection(); }, true);
    document.addEventListener("mouseup", (event) => {
      if (!fromUi(event)) setTimeout(checkSelection, 10);
    }, true);
    document.addEventListener("mousedown", (event) => {
      const ui = peekUi();
      if (fromUi(event) || !ui) return;
      toolbarActive = false;
      ui.hideSelButton();
      if (ui.panelOpen) ui.hidePanel();
    }, true);
    document.addEventListener("keydown", (event) => {
      const ui = peekUi();
      if (event.key === "Escape" && ui) {
        toolbarActive = false;
        ui.hideSelButton();
        ui.hidePanel();
      }
    }, true);

    return {
      handlers,
      refreshToolbar,
      translate: handlers.onTranslateSelection,
      explain: handlers.onExplainSelection,
    };
  }

  globalThis.TFSelection = { create };
})();
