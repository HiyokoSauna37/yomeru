// YouTube の通常動画専用。ユーザーが開始した動画だけを先読みし、再生時刻で表示する。
(() => {
  if (location.hostname !== "www.youtube.com" || globalThis.__tfYouTubeLoaded) return;
  const Timeline = globalThis.TFSubtitleTimeline;
  const YouTubeUi = globalThis.TFYouTubeUi;
  if (!Timeline || !YouTubeUi) return;
  globalThis.__tfYouTubeLoaded = true;
  const ui = YouTubeUi.create({ onStop: stop });
  const currentVideoId = () => location.pathname === "/watch" ? new URLSearchParams(location.search).get("v") || "" : "";
  const send = (msg) => chrome.runtime.sendMessage(msg);
  const newSession = () => `youtube:${crypto.randomUUID()}`;
  let run = null;
  let timer = null;
  let status = "idle";
  let error = "";
  let mode = "bilingual";
  let targetLang = "日本語";
  let lastKeepAlive = 0;

  function state() {
    return { ok: true, supported: /^[\w-]{11}$/.test(currentVideoId()), status, error, mode, targetLang, model: run?.model || "",
      sourceLabel: run?.sourceLabel || "", sourceLang: run?.sourceLang || "",
      done: run?.translated.size || 0, total: run?.cues.length || 0,
      usage: run?.usage || { costUsd: 0, requests: 0, cached: 0 } };
  }
  function player() { return document.getElementById("movie_player"); }
  function video() { return player()?.querySelector("video"); }
  function active(r) { return run === r && r.videoId === currentVideoId(); }
  function showingAd(p) { return p.classList.contains("ad-showing") || p.classList.contains("ad-interrupting"); }
  function stop() {
    const old = run;
    run = null;
    if (old) send({ type: "cancel", sessionId: old.sessionId }).catch(() => {});
    clearInterval(timer); timer = null;
    ui.destroy(); status = "idle"; error = "";
  }
  function fail(message) {
    status = "error"; error = String(message);
    ui.showError(error);
  }
  function render(r) {
    if (!active(r)) return;
    const p = player(), v = video();
    const i = Timeline.indexAt(r.cues, v?.currentTime || 0);
    const cue = r.cues[i], translated = cue && r.translated.get(cue.id);
    ui.render(p, { status, error, ad: p && showingAd(p), cue, translated, targetLang, sourceLang: r.sourceLang, mode, busy: r.busy });
  }
  async function pump(r) {
    if (!active(r) || status !== "active" || r.busy || !video()) return;
    const p = player();
    if (showingAd(p)) return;
    const time = video().currentTime || 0;
    const idx = Timeline.nextBatch(r.groups, time, r.translated);
    if (idx < 0) return;
    const cues = r.groups[idx];
    const first = cues[0].id, last = cues.at(-1).id;
    const ticket = ++r.ticket;
    r.busy = true; r.pendingIndex = idx;
    try {
      const response = await send({ type: "translateSubtitles", sessionId: r.sessionId, videoId: r.videoId,
        targetLang: r.targetLang, model: r.model, sourceLang: r.sourceLang, cues,
        context: { title: r.title, ...Timeline.context(r.cues, first, last) } });
      if (!active(r) || ticket !== r.ticket) return;
      if (!response?.ok) throw new Error(response?.error || "字幕を翻訳できませんでした。もう一度開始してください");
      for (const cue of cues) {
        const text = response.results?.[cue.id];
        if (typeof text !== "string" || !text.trim()) throw new Error("字幕の翻訳結果が不足しています。もう一度開始してください");
        r.translated.set(cue.id, text);
      }
      if (response.usage) { r.usage.costUsd += response.usage.costUsd || 0; r.usage.requests++; }
      r.usage.cached += response.cached || 0;
    } catch (e) {
      if (active(r) && ticket === r.ticket) fail(e.message || e);
    } finally {
      if (active(r) && ticket === r.ticket) { r.busy = false; r.pendingIndex = -1; render(r); }
    }
  }
  function tick() {
    const r = run;
    if (!r) return;
    if (!active(r)) { stop(); return; }
    if (!player() || !video()) { stop(); return; }
    const time = video().currentTime || 0;
    if (r.busy && r.pendingIndex >= 0 && Math.abs(time - r.lastTime) > 8) {
      const pending = r.groups[r.pendingIndex];
      if (time < pending[0].start - 40 || time > pending.at(-1).end) {
        send({ type: "cancel", sessionId: r.sessionId }).catch(() => {});
        r.sessionId = newSession(); r.ticket++; r.busy = false; r.pendingIndex = -1;
      }
    }
    r.lastTime = time;
    try { render(r); } catch (e) { fail(e.message || e); }
    if (r.busy && Date.now() - lastKeepAlive > 20000) { lastKeepAlive = Date.now(); send({ type: "tf:keepalive" }).catch(() => {}); }
    pump(r).catch((e) => { if (active(r)) fail(e.message || e); });
  }
  async function start(options = {}) {
    stop();
    const id = currentVideoId();
    if (!/^[\w-]{11}$/.test(id)) { fail("YouTube の通常動画ページで開始してください"); return; }
    if (!video()) { fail("動画の読み込みが終わってから開始してください"); return; }
    targetLang = options.targetLang === "English" ? "English" : "日本語";
    mode = options.mode === "replace" ? "replace" : "bilingual";
    const r = { videoId: id, targetLang, model: "", sessionId: newSession(), title: document.title, sourceLang: "", sourceLabel: "",
      cues: [], groups: [], translated: new Map(), usage: { costUsd: 0, requests: 0, cached: 0 }, busy: false, ticket: 0, pendingIndex: -1, lastTime: video().currentTime || 0 };
    run = r; status = "loading"; error = "";
    render(r);
    timer = setInterval(tick, 250);
    try {
      const settings = await send({ type: "getSettings" });
      if (!active(r)) return;
      const saved = settings?.settings;
      r.model = saved?.subtitleModel || "claude-haiku-5-5";
      const provider = saved?.models?.find((model) => model.id === r.model)?.provider;
      const hasKey = provider === "openai" ? saved.hasOpenAIKey : provider === "anthropic" ? saved.hasAnthropicKey : saved?.hasKey;
      if (!hasKey) throw new Error(`${provider === "openai" ? "OpenAI" : "Anthropic"} APIキーが未設定です。Yomeru の設定画面で登録してください`);
      if (options.targetLang == null) r.targetLang = targetLang = settings.settings.subtitleTargetLang === "English" ? "English" : "日本語";
      const result = await send({ type: "getYouTubeCaptions", videoId: id });
      if (!active(r)) return;
      if (!result?.ok) throw new Error(result?.error || "字幕を取得できませんでした");
      if (result.videoId !== id) throw new Error("動画が切り替わりました。もう一度開始してください");
      r.cues = Timeline.normalize(result.cues);
      if (!r.cues.length) throw new Error("字幕がありません。字幕付きの動画でお試しください");
      r.groups = Timeline.batches(r.cues); r.sourceLang = result.sourceLang || "";
      r.sourceLabel = result.sourceLabel || "元の字幕"; r.title = result.title || document.title;
      status = "active"; tick();
    } catch (e) { if (active(r)) fail(e.message || e); }
  }
  chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
    switch (msg?.type) {
      case "tf:youtubeState": respond(state()); return false;
      case "tf:youtubeStart": start(msg).catch((e) => fail(e.message || e)); respond({ ok: true }); return false;
      case "tf:youtubeStop": stop(); respond(state()); return false;
      case "tf:youtubeMode": mode = msg.mode === "replace" ? "replace" : "bilingual"; if (run) render(run); respond(state()); return false;
      default: return false;
    }
  });
  document.addEventListener("yt-navigate-start", stop);
  window.addEventListener("pagehide", stop);
})();
