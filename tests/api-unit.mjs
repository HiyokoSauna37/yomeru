// 認証情報の分離、API応答の正規化、使用量・旧設定の互換性。
import assert from "node:assert/strict";
import { DEFAULTS, MODELS, estimateCostUsd, modelProvider } from "../shared/models.js";
import { apiCredentials, buildRequest, checkStop, describeHttpError, extractText, usageOf } from "../shared/api.js";
import { imageOutputFormat } from "../shared/image.js";

const settings = { ...DEFAULTS, apiKey: "anthropic-key", openaiApiKey: "openai-key", model: "gpt-6.1-sol" };
for (const model of MODELS) {
  const request = buildRequest({ ...settings, model: model.id }, "system", "hello");
  const openai = modelProvider(model.id) === "openai";
  assert.equal(request.url, openai ? "https://api.openai.com/v1/responses" : "https://api.anthropic.com/v1/messages");
  assert.equal(request.headers.Authorization, openai ? "Bearer openai-key" : undefined);
  assert.equal(request.headers["x-api-key"], openai ? undefined : "anthropic-key");
  assert.equal(JSON.stringify(request).includes(openai ? "anthropic-key" : "openai-key"), false);
}
assert.throws(() => buildRequest({ ...settings, openaiApiKey: " " }, "s", "u"), /OpenAI/);
assert.throws(() => buildRequest({ ...settings, model: "claude-sonnet-5-5", apiKey: "" }, "s", "u"), /Anthropic/);
assert.throws(() => buildRequest({ ...settings, model: "unknown" }, "s", "u"), /モデル/);
assert.equal(buildRequest({ ...settings, openaiApiBase: "https://proxy.example/v1/" }, "s", "u").url, "https://proxy.example/v1/responses");
assert.equal(apiCredentials({ ...settings, openaiApiBase: "" }).apiBase, DEFAULTS.openaiApiBase);
console.log("✓ every model isolates provider credentials and endpoints; missing keys never fall back");

const image = { mediaType: "image/png", data: "base64-image" };
const outputFormat = imageOutputFormat();
const request = buildRequest(settings, "instructions", "read image", { image, outputFormat, maxTokens: 8000 });
assert.equal(request.body.instructions, "instructions");
assert.equal(request.body.input[0].content[0].image_url, "data:image/png;base64,base64-image");
assert.equal(request.body.input[0].content[1].text, "read image");
assert.equal(request.body.text.format.strict, true);
assert.deepEqual(request.body.text.format.schema, outputFormat.schema);
assert.equal(request.body.max_output_tokens, 8000);
assert.equal(request.body.store, false);
const anthropicImage = buildRequest({ ...settings, model: "claude-sonnet-5-5" }, "s", "u", { image, outputFormat });
assert.deepEqual(anthropicImage.body.messages[0].content[0].source, { type: "base64", media_type: image.mediaType, data: image.data });
assert.deepEqual(anthropicImage.body.output_config.format, outputFormat);
console.log("✓ images and structured output use the correct API-specific formats");

const response = { object: "response", status: "completed", model: "gpt-6.1-sol", output: [
  { type: "reasoning", summary: [{ type: "summary_text", text: "hidden" }] },
  { type: "message", content: [{ type: "output_text", text: "日本語" }, { type: "output_text", text: "の訳" }] },
], usage: { input_tokens: 12000, input_tokens_details: { cached_tokens: 4000, cache_write_tokens: 7000 }, output_tokens: 800, output_tokens_details: { reasoning_tokens: 300 } } };
assert.equal(extractText(response), "日本語の訳");
assert.deepEqual(checkStop(response), { ok: true });
const usage = usageOf(response);
assert.deepEqual(usage, { input: 1000, output: 800, cacheRead: 4000, cacheWrite: 7000, model: "gpt-6.1-sol" });
assert.equal(usage.input + usage.cacheRead + usage.cacheWrite, 12000);
assert.equal(estimateCostUsd(response.model, usage), (1000 * 2 + 4000 * 0.1 + 7000 * 2.5 + 800 * 10) / 1e6);
const anthropic = { model: "claude-sonnet-5-5", content: [{ type: "thinking", thinking: "hidden" }, { type: "text", text: "訳" }], usage: { input_tokens: 1000, cache_read_input_tokens: 4000, cache_creation_input_tokens: 7000, output_tokens: 800 } };
assert.deepEqual(usageOf(anthropic), { ...usage, model: anthropic.model });
assert.equal(extractText(anthropic), "訳");
assert.equal(estimateCostUsd(anthropic.model, usageOf(anthropic)), (1000 * 2 + 4000 * 0.2 + 7000 * 2.5 + 800 * 10) / 1e6);
console.log("✓ response text excludes reasoning; input and reasoning tokens are not charged twice");

for (const status of ["failed", "cancelled", "in_progress", "queued", "incomplete"]) {
  assert.equal(checkStop({ ...response, status }).ok, false);
}
assert.deepEqual(checkStop({ ...response, status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }), { ok: true, truncated: true });
assert.equal(checkStop({ ...response, status: "incomplete", incomplete_details: { reason: "content_filter" } }).ok, false);
assert.equal(checkStop({ ...response, output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }] }).ok, false);
assert.equal(checkStop({ stop_reason: "refusal" }).ok, false);
assert.deepEqual(checkStop({ stop_reason: "max_tokens" }), { ok: true, truncated: true });
assert.equal(describeHttpError(429, { error: { code: "insufficient_quota" } }).fatal, true);
assert.equal(describeHttpError(429, { error: { type: "rate_limit_error" } }).retry, true);
console.log("✓ failed/refused/incomplete responses and depleted API balance are distinguished");

let saved = { schema: 3, apiKey: "existing-key", apiBase: "https://existing.example", model: "claude-haiku-5-5", targetLang: "English", usage: { requests: 12, costUsd: 0.5 } };
globalThis.chrome = { storage: { local: {
  get: async () => ({ settings: structuredClone(saved) }),
  set: async ({ settings: next }) => { saved = structuredClone(next); },
} } };
const { getSettings, saveSettings } = await import("../shared/settings.js");
let read = await getSettings();
assert.equal(read.apiKey, "existing-key");
assert.equal(read.openaiApiKey, "");
assert.equal(read.openaiApiBase, DEFAULTS.openaiApiBase);
await saveSettings({ openaiApiKey: "added-key", model: "gpt-6-luna" });
read = await getSettings();
assert.equal(read.apiKey, "existing-key");
assert.equal(read.apiBase, "https://existing.example");
assert.equal(read.openaiApiKey, "added-key");
assert.equal(read.targetLang, "English");
assert.equal(read.usage.requests, 12);
await saveSettings({ model: "claude-haiku-5-5" });
assert.equal((await getSettings()).openaiApiKey, "added-key");
console.log("✓ existing settings and both keys survive provider changes without a destructive migration");
