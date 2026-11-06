// ページ/選択範囲の翻訳と、設定画面のAPI接続テスト。
import { estimateCostUsd } from "../shared/models.js";
import { buildRequest, extractText, usageOf, checkStop, requireApiKey } from "../shared/api.js";
import { buildSystemPrompt, buildUserMessage, parseSegments } from "../shared/prompt.js";
import { cacheGetMany, cacheSetMany, sha256 } from "../shared/cache.js";
import { getSettings, addUsage } from "../shared/settings.js";
import { fatalError, fetchWithRetry, withSession } from "./requests.js";

// キャッシュ照合。戻り値: {results, pending:[{id,text,key}], cached}
async function lookupCache(s, segments, nocache) {
  const results = {};
  const pending = [];
  let cached = 0;
  if (!s.cacheEnabled) {
    for (const seg of segments) pending.push({ id: seg.id, text: seg.text, key: null });
    return { results, pending, cached };
  }
  // 設定（モデル・言語・指示・用語集）が違えば別のキャッシュ
  const keyBase = await sha256([s.model, s.targetLang, s.customInstructions, s.glossary].join("\u0001"));
  const keys = await Promise.all(segments.map((seg) => sha256(keyBase + "\u0001" + seg.text)));
  const hits = nocache ? new Map() : await cacheGetMany(keys);
  segments.forEach((seg, i) => {
    if (hits.has(keys[i])) {
      results[seg.id] = hits.get(keys[i]);
      cached++;
    } else {
      pending.push({ id: seg.id, text: seg.text, key: keys[i] });
    }
  });
  return { results, pending, cached };
}

// msg: {sessionId, segments:[{id,text}], context:{title,url}, nocache?}
export async function translate(msg) {
  const s = await getSettings();
  requireApiKey(s);
  const segments = Array.isArray(msg.segments) ? msg.segments : [];
  const { results, pending, cached } = await lookupCache(s, segments, !!msg.nocache);
  let usage = null;
  if (pending.length) {
    const req = buildRequest(s, buildSystemPrompt(s), buildUserMessage(pending, msg.context || {}));
    const resp = await withSession(msg.sessionId, (signal) => fetchWithRetry(req, signal));
    const stop = checkStop(resp);
    if (!stop.ok) throw fatalError(stop.message);
    const parsed = parseSegments(extractText(resp));
    const toCache = [];
    for (const p of pending) {
      const t = parsed[p.id];
      if (t == null) continue;
      results[p.id] = t;
      if (p.key) toCache.push({ k: p.key, t });
    }
    cacheSetMany(toCache);
    const u = usageOf(resp);
    const costUsd = estimateCostUsd(s.model, u);
    usage = { ...u, costUsd, truncated: !!stop.truncated };
    await addUsage({ input: u.input + u.cacheRead + u.cacheWrite, output: u.output, costUsd });
  }
  return { ok: true, results, usage, cached, model: s.model };
}

// 設定画面の「接続テスト」: 入力中のキー/モデルで 1 回だけ叩く
export async function testKey(msg) {
  const base = await getSettings();
  const s = { ...base, apiKey: msg.apiKey ?? base.apiKey, apiBase: msg.apiBase ?? base.apiBase,
    openaiApiKey: msg.openaiApiKey ?? base.openaiApiKey, openaiApiBase: msg.openaiApiBase ?? base.openaiApiBase,
    model: msg.model ?? base.model, effort: "low" };
  try {
    requireApiKey(s);
    const req = buildRequest(s, "Reply with exactly: OK", "ping", { maxTokens: 512 });
    const json = await fetchWithRetry(req, new AbortController().signal, 1);
    const stop = checkStop(json);
    if (!stop.ok) throw fatalError(stop.message);
    const text = extractText(json).trim();
    if (stop.truncated || !text) throw new Error("接続テストの応答を取得できませんでした。もう一度お試しください");
    return { ok: true, model: json.model, text, costUsd: estimateCostUsd(s.model, usageOf(json)) };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}
