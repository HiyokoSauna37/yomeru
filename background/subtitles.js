// YouTube字幕のバッチ翻訳。通常の翻訳とはモデル設定を分ける。
import { DEFAULTS, MODELS, estimateCostUsd } from "../shared/models.js";
import { buildRequest, extractText, usageOf, checkStop, requireApiKey } from "../shared/api.js";
import { cacheGetMany, cacheSetMany, sha256 } from "../shared/cache.js";
import { getSettings, addUsage } from "../shared/settings.js";
import { SUBTITLES_VERSION, normalizeSubtitles, subtitleVideoUrlAllowed, buildSubtitleSystem, buildSubtitleMessage, parseSubtitleResult } from "../shared/subtitles.js";
import { abortError, fatalError, fetchWithRetry, withSession } from "./requests.js";

export async function translateSubtitles(msg, sender) {
  const input = normalizeSubtitles(msg);
  if (typeof msg.sessionId !== "string" || !msg.sessionId || msg.sessionId.length > 160) throw fatalError("字幕のセッションIDが不正です");
  async function checkCurrentVideo() {
    const current = await chrome.tabs.get(sender.tab.id);
    if (!subtitleVideoUrlAllowed(current.url, input.videoId)) throw fatalError("動画が切り替わりました。もう一度開始してください");
  }
  // 設定/キャッシュ照合中の中止も取りこぼさないよう、最初の await より前に登録する。
  return withSession(msg.sessionId, async (signal) => {
    await checkCurrentVideo();
    const saved = await getSettings();
    const model = msg.model ?? saved.subtitleModel ?? DEFAULTS.subtitleModel;
    if (!MODELS.some((entry) => entry.id === model)) throw fatalError("選択した字幕モデルは使用できません");
    const s = { ...saved, model };
    if (signal.aborted) throw abortError();
    requireApiKey(s);
    const system = buildSubtitleSystem(s, input);
    const message = buildSubtitleMessage(input);
    // 同じ短文でも動画・周辺の発話・翻訳先が変われば訳は変わる。バッチ単位で保存する。
    const key = await sha256(JSON.stringify(["subtitles", SUBTITLES_VERSION, s.model, s.effort, system, message]));
    if (s.cacheEnabled) {
      const hits = await cacheGetMany([key]);
      if (signal.aborted) throw abortError();
      if (hits.has(key)) {
        await checkCurrentVideo();
        try {
          const results = parseSubtitleResult(hits.get(key), input.cues);
          return { ok: true, results, cached: input.cues.length, usage: null, model: s.model };
        } catch { /* 古い/壊れたキャッシュは使わず取得し直す */ }
      }
    }
    await checkCurrentVideo();
    if (signal.aborted) throw abortError();
    const req = buildRequest(s, system, message, { maxTokens: 6000 });
    const resp = await fetchWithRetry(req, signal);
    if (signal.aborted) throw abortError();
    const u = usageOf(resp);
    const costUsd = estimateCostUsd(s.model, u);
    // 出力の欠落や途中終了があっても、実際に発生したAPI使用量を記録する。
    await addUsage({ input: u.input + u.cacheRead + u.cacheWrite, output: u.output, costUsd });
    const stop = checkStop(resp);
    if (!stop.ok) throw fatalError(stop.message);
    if (stop.truncated) throw new Error("字幕の応答が途中で切れました。もう一度お試しください");
    const results = parseSubtitleResult(extractText(resp), input.cues);
    if (signal.aborted) throw abortError();
    if (s.cacheEnabled) {
      const serialized = JSON.stringify({ cues: input.cues.map((cue) => ({ id: cue.id, text: results[cue.id] })) });
      await cacheSetMany([{ k: key, t: serialized }]);
    }
    await checkCurrentVideo();
    if (signal.aborted) throw abortError();
    return { ok: true, results, usage: { ...u, costUsd }, cached: 0, model: s.model };
  }, { timeoutMs: 60000, timeoutMessage: "字幕の翻訳がタイムアウトしました。もう一度お試しください" });
}
