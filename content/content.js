// Yomeru content script の入口。各機能を初期化し、Chrome からのメッセージを振り分ける。
(() => {
  if (globalThis.__tfLoaded) return;
  const { TFPageTranslation: PageTranslation, TFUi: Ui, TFSelection: Selection, TFImage: ImageTranslator } = globalThis;
  if (!PageTranslation || !Ui || !Selection || !ImageTranslator) return;
  globalThis.__tfLoaded = true;

  const KEEPALIVE_MS = 20000;
  const usage = { input: 0, output: 0, costUsd: 0, cached: 0, requests: 0, model: null };
  let settings = null;
  let ui = null;

  const errorMessage = (e) => String((e && e.message) || e);
  const newSessionId = () => (crypto.randomUUID && crypto.randomUUID()) || String(Date.now());
  const pageContext = () => ({ title: document.title, url: location.href });

  // ---------- messaging ----------
  function send(msg) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(msg, (r) => {
          const e = chrome.runtime.lastError;
          if (e) reject(new Error(e.message));
          else resolve(r);
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  async function loadSettings() {
    const r = await send({ type: "getSettings" });
    if (!r || !r.ok) throw new Error((r && r.error) || "設定を取得できません");
    settings = r.settings;
    return r.settings;
  }

  // segments: [{id, text}] → background の translate 応答（{ok, results, usage, cached, model} か {ok:false, error, fatal}）
  async function requestTranslation(segments, sessionId, nocache = false) {
    try {
      const r = await send({ type: "translate", sessionId, nocache, context: pageContext(), segments });
      return r || { ok: false, error: "応答なし" };
    } catch (e) {
      return { ok: false, error: errorMessage(e) };
    }
  }

  // ---------- UI ----------
  function getUi() {
    if (!ui || !ui.connected) ui = Ui.create({ onStop: () => pageTranslation.cancel(), ...selection.handlers,
      onPanelOpen: (mode) => {
        if (mode === "image") selection.handlers.onPanelClose();
        else imageTranslator?.cancel();
      },
      onPanelClose: () => { selection.handlers.onPanelClose(); imageTranslator?.cancel(); },
    });
    return ui;
  }

  function costText(usd) {
    const rate = settings?.usdJpy || 150;
    const jpy = usd * rate;
    const usdS = usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
    const jpyS = jpy < 1 ? `¥${jpy.toFixed(2)}` : `¥${Math.round(jpy).toLocaleString("ja-JP")}`;
    return `${usdS} ≈ ${jpyS}`;
  }

  function addUsage(r) {
    if (r.usage) {
      usage.input += r.usage.input + (r.usage.cacheRead || 0) + (r.usage.cacheWrite || 0);
      usage.output += r.usage.output;
      usage.costUsd += r.usage.costUsd || 0;
      usage.requests++;
      usage.model = r.model || usage.model;
    }
    usage.cached += r.cached || 0;
  }

  // ---------- 機能の初期化 ----------
  const pageTranslation = PageTranslation.create({
    send, loadSettings, getSettings: () => settings, requestTranslation,
    getUi, peekUi: () => ui, usage, addUsage, costText, newSessionId, errorMessage, keepAliveMs: KEEPALIVE_MS,
  });

  function getState() {
    return { ok: true, ...pageTranslation.getState(), usage, host: location.hostname, title: document.title };
  }

  const selection = Selection.create({
    getUi,
    peekUi: () => ui,
    getSettings: () => settings,
    loadSettings,
    send,
    requestTranslation,
    addUsage,
    costText,
    newSessionId,
    errorMessage,
    keepAliveMs: KEEPALIVE_MS,
  });
  const imageTranslator = ImageTranslator.create({ getUi, send, loadSettings, addUsage, costText, newSessionId, errorMessage, keepAliveMs: KEEPALIVE_MS });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.settings || !settings) return;
    settings.explanationEnabled = changes.settings.newValue?.explanationEnabled !== false;
    selection.refreshToolbar();
  });

  // ---------- message handler ----------
  // 非同期処理の完了後に状態を返す（失敗時はエラーを添える）
  function respondWhenDone(promise, sendResponse) {
    promise.then(() => sendResponse(getState()), (e) => sendResponse({ ...getState(), error: errorMessage(e) }));
    return true;
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    switch (msg && msg.type) {
      case "tf:ping":
        sendResponse({ ok: true });
        return false;
      case "tf:state":
        sendResponse(getState());
        return false;
      case "tf:translate":
        return respondWhenDone(pageTranslation.translate({ mode: msg.mode }), sendResponse);
      case "tf:restore":
        pageTranslation.restore();
        sendResponse(getState());
        return false;
      case "tf:cancel":
        pageTranslation.cancel();
        sendResponse(getState());
        return false;
      case "tf:toggle":
        if (pageTranslation.status === "running") pageTranslation.cancel();
        else if (pageTranslation.status === "translated") pageTranslation.restore();
        else return respondWhenDone(pageTranslation.translate(), sendResponse);
        sendResponse(getState());
        return false;
      case "tf:explainSelection":
        selection.explain();
        sendResponse({ ok: true });
        return false;
      case "tf:translateSelection":
        selection.translate();
        sendResponse({ ok: true });
        return false;
      case "tf:translateImage":
        imageTranslator.translate(msg.srcUrl);
        sendResponse({ ok: true });
        return false;
      default:
        return false;
    }
  });

  // 「常に翻訳」ホストなら自動開始
  loadSettings().then((s) => {
    if (s.hasKey && Array.isArray(s.autoHosts) && s.autoHosts.includes(location.hostname)) pageTranslation.translate();
  }).catch(() => {});
})();
