// Anthropic Messages / OpenAI Responses の共通アダプター（DOM/chrome 非依存）
import { DEFAULTS, modelInfo, modelProvider } from "./models.js";

export const API_VERSION = "2026-10-21";
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

// 旧 apiKey/apiBase は Anthropic 専用のまま維持する。別社のキーへのフォールバックはしない。
export function apiCredentials(settings) {
  const provider = modelProvider(settings.model);
  const openai = provider === "openai";
  return {
    provider,
    apiKey: (openai ? settings.openaiApiKey : settings.apiKey)?.trim() || "",
    apiBase: (openai ? settings.openaiApiBase : settings.apiBase)?.trim() || (openai ? DEFAULTS.openaiApiBase : DEFAULTS.apiBase),
  };
}

export function requireApiKey(settings) {
  const credentials = apiCredentials(settings);
  if (!credentials.apiKey) {
    const name = credentials.provider === "openai" ? "OpenAI" : "Anthropic";
    throw Object.assign(new Error(`${name} APIキーが未設定です（拡張の設定画面で登録してください）`), { fatal: true });
  }
  return credentials;
}

export function buildRequest(settings, systemPrompt, userText, { maxTokens = 16000, image = null, outputFormat = null } = {}) {
  const { provider, apiKey, apiBase } = requireApiKey(settings);
  const base = apiBase.replace(/\/+$/, "").replace(/\/v1$/, "");
  if (provider === "openai") {
    const content = [{ type: "input_text", text: userText }];
    if (image) content.unshift({ type: "input_image", image_url: `data:${image.mediaType};base64,${image.data}`, detail: "high" });
    const body = {
      model: settings.model,
      instructions: systemPrompt,
      input: [{ role: "user", content }],
      max_output_tokens: maxTokens,
      reasoning: { effort: settings.effort || "low" },
      store: false,
    };
    if (outputFormat) body.text = { format: { ...outputFormat, name: "image_translation", strict: true } };
    return { url: `${base}/v1/responses`, headers: { "content-type": "application/json", Authorization: `Bearer ${apiKey}` }, body };
  }
  const info = modelInfo(settings.model);
  const headers = {
    "content-type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": API_VERSION,
    // 拡張のサービスワーカーからの直叩き（ブラウザ由来の Origin を持つ）に必要
    "anthropic-dangerous-direct-browser-access": "true",
  };
  const body = {
    model: settings.model,
    max_tokens: maxTokens,
    system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userText }],
    output_config: { effort: settings.effort || "low" },
  };
  // thinking は省略 = adaptive（Opus 5.5 / Sonnet 5.5 / Haiku 5.5 / Fable 5.1 共通）。temperature 系は 2026-10-21 版で送信不可。
  if (info && info.fallbacks) {
    // 安全分類器による拒否時にサーバー側で別モデルへ再実行（Haiku 5.5 は非対応なので付けない）
    body.fallbacks = "default";
    headers["anthropic-beta"] = FALLBACK_BETA;
  }
  if (outputFormat) body.output_config.format = outputFormat;
  if (image) body.messages[0].content = [
    { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data }, transformations: { oversized_image: "error" } },
    { type: "text", text: userText },
  ];
  return { url: `${base}/v1/messages`, headers, body };
}

export function extractText(resp) {
  if (Array.isArray(resp?.output)) return resp.output
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content || [])
    .filter((part) => part.type === "output_text" && typeof part.text === "string")
    .map((part) => part.text).join("");
  return (resp.content || [])
    .filter((b) => b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("");
}

export function usageOf(resp) {
  const u = (resp && resp.usage) || {};
  const openai = !!u.input_tokens_details;
  const cacheRead = openai ? (u.input_tokens_details.cached_tokens || 0) : (u.cache_read_input_tokens || 0);
  const cacheWrite = openai ? (u.input_tokens_details.cache_write_tokens || 0) : (u.cache_creation_input_tokens || 0);
  return {
    // OpenAI の input_tokens はキャッシュ分を含むため、共通形式では引いて二重計上を避ける。
    input: Math.max(0, (u.input_tokens || 0) - (openai ? cacheRead + cacheWrite : 0)),
    output: u.output_tokens || 0,
    cacheRead,
    cacheWrite,
    model: (resp && resp.model) || null,
  };
}

// HTTP エラー → 人間向けメッセージ。fatal=true は再試行しても無駄なもの
export function describeHttpError(status, json) {
  const apiMsg = json && json.error && json.error.message ? json.error.message : "";
  const type = json && json.error && json.error.type ? json.error.type : "";
  if (status === 401) return { message: "APIキーが無効です（設定画面で確認してください）", fatal: true };
  if (status === 403) return { message: `権限エラー: ${apiMsg || "forbidden"}`, fatal: true };
  if (status === 400) return { message: `リクエストエラー: ${apiMsg || type || "bad request"}`, fatal: true };
  if (status === 404) return { message: `モデルまたはエンドポイントが見つかりません: ${apiMsg || ""}`, fatal: true };
  if (status === 429 && (type === "insufficient_quota" || json?.error?.code === "insufficient_quota")) return { message: "APIの利用枠または残高が不足しています（APIの請求設定を確認してください）", fatal: true };
  if (status === 429) return { message: "レート制限に達しました（しばらく待って再試行します）", fatal: false, retry: true };
  if (status === 529) return { message: "API が混雑しています（再試行します）", fatal: false, retry: true };
  if (status >= 500) return { message: `サーバーエラー ${status}: ${apiMsg || ""}`, fatal: false, retry: true };
  return { message: `HTTP ${status}: ${apiMsg || type || ""}`, fatal: status < 500 };
}

// stop_reason の確認。refusal は内容を読まずにエラー扱い
export function checkStop(resp) {
  if (resp?.object === "response" || Array.isArray(resp?.output)) {
    const refused = resp.output?.some((item) => item.type === "message" && item.content?.some((part) => part.type === "refusal"));
    if (refused || resp.incomplete_details?.reason === "content_filter") return { ok: false, message: "安全分類器により拒否されました", fatal: true };
    if (resp.status === "incomplete" && resp.incomplete_details?.reason === "max_output_tokens") return { ok: true, truncated: true };
    if (resp.error || resp.status !== "completed") return { ok: false, message: `OpenAI APIの応答が完了しませんでした: ${resp.error?.message || resp.incomplete_details?.reason || resp.status || "unknown"}`, fatal: true };
  }
  const sr = resp && resp.stop_reason;
  if (sr === "refusal") {
    const cat = resp.stop_details && resp.stop_details.category;
    return { ok: false, message: `安全分類器により拒否されました${cat ? `（${cat}）` : ""}`, fatal: true };
  }
  if (sr === "max_tokens") return { ok: true, truncated: true };
  return { ok: true };
}
