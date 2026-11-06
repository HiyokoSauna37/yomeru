// 画像の取得と、選択したモデルによる文字起こし/翻訳。
import { estimateCostUsd } from "../shared/models.js";
import { buildRequest, extractText, usageOf, checkStop, requireApiKey } from "../shared/api.js";
import { cacheGetMany, cacheSetMany, sha256 } from "../shared/cache.js";
import { getSettings, addUsage } from "../shared/settings.js";
import { IMAGE_VERSION, normalizeImageRequest, buildImageSystem, buildImageMessage, imageOutputFormat, parseImageResult, fetchRemoteImage } from "../shared/image.js";
import { abortError, fatalError, fetchWithRetry, withSession } from "./requests.js";

export async function fetchImage(msg) {
  if (msg.sessionId != null && (typeof msg.sessionId !== "string" || !msg.sessionId || msg.sessionId.length > 160)) throw fatalError("画像のセッションIDが不正です");
  return withSession(msg.sessionId, async (signal) => ({ ok: true, image: await fetchRemoteImage(msg.url, signal) }));
}

export async function translateImage(msg) {
  if (typeof msg.sessionId !== "string" || !msg.sessionId || msg.sessionId.length > 160) throw fatalError("画像のセッションIDが不正です");
  // 設定・画像ハッシュ・キャッシュの処理中でも中止を取りこぼさない。
  return withSession(msg.sessionId, async (signal) => {
    const input = normalizeImageRequest(msg);
    const s = await getSettings();
    if (signal.aborted) throw abortError();
    requireApiKey(s);
    const system = buildImageSystem(s);
    const message = buildImageMessage(input, s);
    const imageHash = await sha256(input.image.data);
    const key = await sha256(JSON.stringify(["image", IMAGE_VERSION, imageHash, input.image.mediaType, s.model, s.effort, system, message]));
    if (s.cacheEnabled) {
      const hits = await cacheGetMany([key]);
      if (signal.aborted) throw abortError();
      if (hits.has(key)) {
        try { return { ok: true, ...parseImageResult(hits.get(key), input.image), usage: null, cached: 1, model: s.model }; }
        catch { /* 壊れたキャッシュは使わず翻訳し直す。画像そのものは保存しない。 */ }
      }
    }
    if (signal.aborted) throw abortError();
    const req = buildRequest(s, system, message, { maxTokens: 8000, image: input.image, outputFormat: imageOutputFormat() });
    const response = await fetchWithRetry(req, signal);
    const u = usageOf(response);
    const costUsd = estimateCostUsd(s.model, u);
    // APIが返した使用量は、不正JSON・拒否・途中終了・直後の中止でも計上する。
    await addUsage({ input: u.input + u.cacheRead + u.cacheWrite, output: u.output, costUsd });
    if (signal.aborted) throw abortError();
    const stop = checkStop(response);
    if (!stop.ok) throw fatalError(stop.message);
    if (stop.truncated) throw new Error("画像翻訳の応答が途中で切れました。文字の少ない範囲に分けてお試しください。");
    const result = parseImageResult(extractText(response), input.image);
    if (s.cacheEnabled) await cacheSetMany([{ k: key, t: JSON.stringify({ regions: result.regions }) }]);
    if (signal.aborted) throw abortError();
    return { ok: true, ...result, usage: { ...u, costUsd }, cached: 0, model: s.model };
  }, { timeoutMs: 60000, timeoutMessage: "画像の翻訳がタイムアウトしました。もう一度お試しください。" });
}
