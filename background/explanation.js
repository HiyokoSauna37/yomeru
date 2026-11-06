// 選択範囲の解説と、文脈を引き継ぐ追加質問。
import { MODELS, estimateCostUsd } from "../shared/models.js";
import { buildRequest, extractText, usageOf, checkStop, requireApiKey } from "../shared/api.js";
import { cacheGetMany, cacheSetMany, sha256 } from "../shared/cache.js";
import { getSettings, addUsage } from "../shared/settings.js";
import { EXPLAIN_VERSION, normalizeExplanation, buildExplanationSystem, buildExplanationMessage } from "../shared/explain.js";
import { abortError, fatalError, fetchWithRetry, withSession } from "./requests.js";

export async function explain(msg) {
  if (msg.sessionId != null && (typeof msg.sessionId !== "string" || !msg.sessionId || msg.sessionId.length > 160)) throw fatalError("解説のセッションIDが不正です");
  return withSession(msg.sessionId, async (signal) => {
    if (msg.model != null && !MODELS.some(({ id }) => id === msg.model)) throw fatalError("選択した解説モデルは使用できません");
    const input = normalizeExplanation(msg);
    const saved = await getSettings();
    if (signal.aborted) throw abortError();
    const s = msg.model == null ? saved : { ...saved, model: msg.model };
    if (s.explanationEnabled === false) throw fatalError("解説機能は設定で無効になっています");
    requireApiKey(s);
    const system = buildExplanationSystem(s, input.detail, input.question);
    const message = buildExplanationMessage(input);
    // 文脈・説明の詳しさ・プロンプトが変われば解説も変わる。
    const key = await sha256(JSON.stringify([EXPLAIN_VERSION, s.model, s.effort, system, message]));
    if (s.cacheEnabled) {
      const hits = await cacheGetMany([key]);
      if (signal.aborted) throw abortError();
      if (hits.has(key)) return { ok: true, text: hits.get(key), cached: 1, usage: null, model: s.model };
    }
    if (signal.aborted) throw abortError();
    const req = buildRequest(s, system, message, { maxTokens: input.detail === "detailed" ? 2800 : 1600 });
    const resp = await fetchWithRetry(req, signal);
    const u = usageOf(resp);
    const costUsd = estimateCostUsd(s.model, u);
    await addUsage({ input: u.input + u.cacheRead + u.cacheWrite, output: u.output, costUsd });
    if (signal.aborted) throw abortError();
    const stop = checkStop(resp);
    if (!stop.ok) throw fatalError(stop.message);
    let text = extractText(resp).trim();
    if (!text) throw new Error("解説を取得できませんでした");
    if (s.cacheEnabled && !stop.truncated) await cacheSetMany([{ k: key, t: text }]);
    if (signal.aborted) throw abortError();
    if (stop.truncated) text += "\n\n（解説が長いため、ここまで表示しています）";
    return { ok: true, text, usage: { ...u, costUsd }, cached: 0, model: s.model };
  }, { timeoutMs: 60000, timeoutMessage: "解説の取得がタイムアウトしました。もう一度お試しください。" });
}
