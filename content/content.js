// Yomeru content script: ページ翻訳の進行・適用・復元、追加翻訳（MutationObserver）。
// 選択範囲の操作は selection.js、DOM の分割/復元は segmenter.js、画面表示は ui.js が担当する。
(() => {
  if (globalThis.__tfLoaded) return;
  const Seg = globalThis.TFSeg;
  const Page = globalThis.TFPage;
  const Ui = globalThis.TFUi;
  const Selection = globalThis.TFSelection;
  const Exclusions = globalThis.TFExclusions;
  const ImageTranslator = globalThis.TFImage;
  if (!Seg || !Page || !Ui || !Selection || !ImageTranslator) return;
  globalThis.__tfLoaded = true;

  const RESCAN_DELAY_MS = 700;     // DOM 変化からの追加翻訳までの待ち
  const MAX_INCREMENTAL_RUNS = 60; // ページが書き戻し続ける場合の無限ループ防止
  const KEEPALIVE_MS = 20000;      // service worker を起こしておく間隔
  const RETRY_LIMIT = 40;          // 欠落・失敗セグメントを単体で再試行する上限

  const state = {
    status: "idle", // idle | running | translated
    mode: "replace",
    sessionId: null,
    progress: { done: 0, total: 0 },
    usage: { input: 0, output: 0, costUsd: 0, cached: 0, requests: 0, model: null },
    error: null,
    settings: null,
    incrementalRuns: 0,
  };
  let cancelled = false;
  let observer = null;
  let observedRoots = new WeakSet();
  let observerTimer = null;
  let suppressed = false;
  let keepAliveTimer = null;
  let ui = null;
  let selection = null;
  let imageTranslator = null;

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
    state.settings = r.settings;
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

  function startKeepAlive() {
    stopKeepAlive();
    keepAliveTimer = setInterval(() => { send({ type: "tf:keepalive" }).catch(() => {}); }, KEEPALIVE_MS);
  }
  function stopKeepAlive() {
    if (keepAliveTimer) clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }

  // ---------- UI ----------
  function getUi() {
    if (!ui || !ui.connected) ui = Ui.create({ onStop: cancel, ...selection.handlers,
      onPanelOpen: (mode) => {
        if (mode === "image") selection.handlers.onPanelClose();
        else imageTranslator?.cancel();
      },
      onPanelClose: () => { selection.handlers.onPanelClose(); imageTranslator?.cancel(); },
    });
    return ui;
  }

  function costText(usd) {
    const rate = (state.settings && state.settings.usdJpy) || 150;
    const jpy = usd * rate;
    const usdS = usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
    const jpyS = jpy < 1 ? `¥${jpy.toFixed(2)}` : `¥${Math.round(jpy).toLocaleString("ja-JP")}`;
    return `${usdS} ≈ ${jpyS}`;
  }

  function addUsage(r) {
    if (r.usage) {
      state.usage.input += r.usage.input + (r.usage.cacheRead || 0) + (r.usage.cacheWrite || 0);
      state.usage.output += r.usage.output;
      state.usage.costUsd += r.usage.costUsd || 0;
      state.usage.requests++;
      state.usage.model = r.model || state.usage.model;
    }
    state.usage.cached += r.cached || 0;
  }

  // ---------- observer（翻訳後に増えた/書き戻された部分を追加翻訳） ----------
  function suppress(fn) {
    suppressed = true;
    try { return fn(); } finally {
      if (observer) observer.takeRecords();
      suppressed = false;
    }
  }
  const page = Page.create({ getMode: () => state.mode, mutate: suppress });
  const hasPageChanges = () => page.hasChanges() || !!Exclusions?.hasHiddenAds();
  const hideAds = (root = document.body) => suppress(() => Exclusions?.hideAds(root) || 0);
  const isOurs = (n) => !!n && n.nodeType === 1 && n.hasAttribute("data-tf");

  function isInterestingMutation(m) {
    const parent = m.target.nodeType === 1 ? m.target : m.target.parentElement;
    if (parent?.closest("[data-tf]")) return false;
    if (Exclusions?.isWithinAd(parent)) return false;
    if (location.hostname === "www.youtube.com" && parent?.closest("#movie_player, ytd-transcript-renderer, ytd-transcript-segment-list-renderer, transcript-segment-view-model")) return false;
    if (m.type === "characterData") {
      const n = m.target;
      if (!page.isDone(n)) return true;
      const t = page.translatedValue(n);
      if (t != null && n.data !== t) { page.forget(n); return true; } // ページ側が原文を書き戻した
      return false;
    }
    if (isOurs(m.target)) return false;
    if (m.type !== "childList") return true;
    for (const n of m.addedNodes) if (!page.isDone(n) && !isOurs(n)) return true;
    return false;
  }
  function startObserver() {
    if (observer) return;
    observer = new MutationObserver((muts) => {
      if (suppressed || state.status !== "translated") return;
      // 翻訳後に配信された広告も画面から外す。本文の追い翻訳回数とは独立して処理する。
      for (const mutation of muts) for (const node of mutation.addedNodes || []) observeShadowRoots(node);
      const roots = new Set(muts.filter((m) => m.type === "childList" || m.type === "attributes").map((m) => m.target));
      for (const root of roots) {
        const element = root.nodeType === 1 ? root : root.host;
        if (element && !element.closest("[data-tf]")) hideAds(root);
      }
      if (muts.some(isInterestingMutation)) scheduleRescan();
    });
    observeRoot(document.documentElement);
    observeShadowRoots(document.body);
  }
  function observeRoot(root) {
    if (!observer || observedRoots.has(root)) return;
    observer.observe(root, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ["open", "hidden", "class", "style", "id", "data-ad-slot", "data-ad-client", "data-ad-unit", "data-google-query-id", "aria-label"],
    });
    observedRoots.add(root);
  }
  function observeShadowRoots(root) {
    if (!root || root.nodeType === 3 || root.nodeType === 8) return;
    if (root.nodeType === 1 && root.hasAttribute("data-tf")) return;
    if (root.shadowRoot) { observeRoot(root.shadowRoot); observeShadowRoots(root.shadowRoot); }
    for (const child of root.children || []) observeShadowRoots(child);
  }
  function stopObserver() {
    if (observer) observer.disconnect();
    observer = null;
    observedRoots = new WeakSet();
    if (observerTimer) clearTimeout(observerTimer);
    observerTimer = null;
  }
  function scheduleRescan() {
    if (observerTimer) clearTimeout(observerTimer);
    observerTimer = setTimeout(async () => {
      observerTimer = null;
      if (state.status !== "translated" || state.incrementalRuns >= MAX_INCREMENTAL_RUNS) return;
      const s = state.settings || (await loadSettings().catch(() => null));
      if (!s) return;
      const units = collectUnits(s);
      if (!units.length) return;
      state.incrementalRuns++;
      await runUnits(units, s, { quiet: true });
    }, RESCAN_DELAY_MS);
  }

  // ---------- translate ----------
  function collectUnits(settings) {
    return page.collectUnits(document.body, { targetLang: settings.targetLang, skipNav: settings.skipNav });
  }

  async function translatePage(opts = {}) {
    if (state.status === "running") return;
    state.error = null;
    const settings = await loadSettings();
    if (!settings.hasKey) {
      const provider = settings.models?.find((model) => model.id === settings.model)?.provider;
      getUi().showBadge(`${provider === "openai" ? "OpenAI" : "Anthropic"} APIキーが未設定です。拡張の設定画面で登録してください`, "error", 5000);
      return;
    }
    const mode = opts.mode || settings.displayMode || "replace";
    if (state.status === "translated" && state.mode !== mode) restorePage();
    state.mode = mode;
    hideAds();
    const units = collectUnits(settings);
    if (!units.length) {
      if (Exclusions?.hasHiddenAds()) {
        state.status = "translated";
        startObserver();
        getUi().showBadge("広告を非表示にしました。「原文に戻す」で復元できます", "done", 3500);
        return;
      }
      if (state.status !== "translated") getUi().showBadge("翻訳する文が見つかりません", "info", 2500);
      return;
    }
    await runUnits(units, settings, {});
  }

  // 同時実行数 n のワーカープール
  function pool(items, n, worker) {
    let i = 0;
    const runners = Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async () => {
      while (i < items.length && !cancelled) await worker(items[i++]);
    });
    return Promise.all(runners);
  }

  async function runUnits(units, settings, { quiet = false } = {}) {
    cancelled = false;
    const wasTranslated = state.status === "translated";
    state.status = "running";
    state.error = null;
    const sessionId = newSessionId();
    state.sessionId = sessionId;
    Seg.sortByViewport(units);
    page.begin(units);
    const batches = Seg.makeBatches(units, settings.batchChars || 2500);
    const concurrency = settings.concurrency || 4;
    state.progress = { done: 0, total: units.length };
    startKeepAlive();
    const showProgress = () => { if (!quiet) getUi().showProgress(state.progress.done, state.progress.total); };
    showProgress();
    const retry = [];
    let fatal = null;
    const noteFailure = (r) => {
      if (r.fatal) { fatal = r.error; cancelled = true; } else state.error = r.error;
    };

    await pool(batches, concurrency, async (batch) => {
      if (cancelled || fatal || state.sessionId !== sessionId) return;
      const r = await requestTranslation(batch.map((u) => ({ id: u.id, text: u.text })), sessionId);
      if (cancelled || state.sessionId !== sessionId) return;
      if (!r.ok) {
        noteFailure(r);
        retry.push(...batch);
      } else {
        addUsage(r);
        for (const u of batch) {
          const t = r.results && r.results[u.id];
          if (t == null || !page.applyTranslation(u, t, { allowLoose: false })) retry.push(u);
        }
      }
      state.progress.done += batch.length;
      showProgress();
    });

    // 失敗・欠落したものを単体で再試行（キャッシュを避けて再生成し、復元に失敗しても緩く適用する）
    if (!cancelled && !fatal && retry.length && state.sessionId === sessionId) {
      await pool(retry.slice(0, RETRY_LIMIT), Math.min(4, concurrency), async (u) => {
        if (cancelled || state.sessionId !== sessionId) return;
        const r = await requestTranslation([{ id: u.id, text: u.text }], sessionId, true);
        if (cancelled || state.sessionId !== sessionId) return;
        if (!r.ok) { noteFailure(r); return; }
        addUsage(r);
        const t = r.results && r.results[u.id];
        if (t != null) page.applyTranslation(u, t, { allowLoose: true });
      });
    }
    if (state.sessionId !== sessionId) return;
    stopKeepAlive();
    state.sessionId = null;
    page.releasePending();
    finishRun({ fatal, wasTranslated, quiet });
  }

  function finishRun({ fatal, wasTranslated, quiet }) {
    hideAds();
    if (fatal) {
      state.error = fatal;
      state.status = hasPageChanges() ? "translated" : "idle";
      getUi().showBadge(fatal, "error", 8000);
    } else if (cancelled && !wasTranslated && !hasPageChanges()) {
      state.status = "idle";
      getUi().showBadge("中止しました", "info", 2000);
    } else {
      state.status = "translated";
      if (!quiet) {
        const cached = state.usage.cached ? ` · キャッシュ ${state.usage.cached}` : "";
        if (state.error) getUi().showBadge(`一部失敗: ${state.error}`, "error", 8000);
        else getUi().showBadge(`翻訳完了 · ${costText(state.usage.costUsd)}${cached}`, "done", 3500);
      }
    }
    if (state.status === "translated") startObserver();
  }

  // ---------- 復元 / 中止 ----------
  function cancelSession() {
    cancelled = true;
    if (state.sessionId) send({ type: "cancel", sessionId: state.sessionId }).catch(() => {});
  }

  function restorePage() {
    cancelSession();
    state.sessionId = null;
    stopObserver();
    stopKeepAlive();
    page.restore();
    Exclusions?.restoreAds();
    state.status = "idle";
    state.progress = { done: 0, total: 0 };
    state.incrementalRuns = 0;
    state.error = null;
    if (ui) ui.hideBadge();
  }

  function cancel() {
    if (state.status === "running") cancelSession();
  }

  function getState() {
    return {
      ok: true,
      status: state.status,
      mode: state.mode,
      progress: state.progress,
      usage: state.usage,
      error: state.error,
      host: location.hostname,
      title: document.title,
    };
  }

  // ---------- selection controller ----------
  selection = Selection.create({
    getUi,
    peekUi: () => ui,
    getSettings: () => state.settings,
    loadSettings,
    send,
    requestTranslation,
    addUsage,
    costText,
    newSessionId,
    errorMessage,
    keepAliveMs: KEEPALIVE_MS,
  });
  imageTranslator = ImageTranslator.create({ getUi, send, loadSettings, addUsage, costText, newSessionId, errorMessage, keepAliveMs: KEEPALIVE_MS });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.settings || !state.settings) return;
    state.settings.explanationEnabled = changes.settings.newValue?.explanationEnabled !== false;
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
        return respondWhenDone(translatePage({ mode: msg.mode }), sendResponse);
      case "tf:restore":
        restorePage();
        sendResponse(getState());
        return false;
      case "tf:cancel":
        cancel();
        sendResponse(getState());
        return false;
      case "tf:toggle":
        if (state.status === "running") cancel();
        else if (state.status === "translated") restorePage();
        else return respondWhenDone(translatePage(), sendResponse);
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
    if (s.hasKey && Array.isArray(s.autoHosts) && s.autoHosts.includes(location.hostname)) translatePage();
  }).catch(() => {});
})();
