// 実ブラウザと独立したAPIモックで、モデルごとの送信先・キー・全機能の互換性を検証する。
import assert from "node:assert/strict";
import http from "node:http";
import { launch } from "./harness.mjs";
import { DEFAULTS } from "../shared/models.js";

const requests = [];
let responseMode = "ok";
const VIDEO = "dQw4w9WgXcQ";
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6rXQAAAAASUVORK5CYII=";
const check = (text) => console.log(`✓ ${text}`);

async function mock(provider) {
  const server = http.createServer(async (req, res) => {
    if (req.method !== "POST") { res.writeHead(404); res.end(); return; }
    try {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      requests.push({ provider, url: req.url, headers: req.headers, body });
      const parts = provider === "openai" ? body.input[0].content : body.messages[0].content;
      const user = typeof parts === "string" ? parts : parts.filter((part) => ["text", "input_text"].includes(part.type)).map((part) => part.text).join("");
      let payload;
      try { payload = JSON.parse(user); } catch { /* ページ翻訳はXML風マーカー */ }
      const text = user === "ping" ? "OK"
        : payload?.task === "translate_subtitles" ? JSON.stringify({ cues: payload.cues.map(({ id }) => ({ id, text: `字幕 ${id}` })) })
        : payload?.task === "translate_image_in_place" ? '{"regions":[]}'
        : user.includes("<seg ") ? [...user.matchAll(/<seg id="(\d+)">[\s\S]*?<\/seg>/g)].map(([, id]) => `<seg id="${id}">翻訳 ${id}</seg>`).join("\n")
        : "選択範囲の解説です。";
      const result = provider === "openai" ? {
        id: "resp_mock", object: "response", status: "completed", model: body.model,
        output: [
          { type: "reasoning", summary: [{ type: "summary_text", text: "Do not show reasoning." }] },
          { type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] },
        ],
        usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 20 }, output_tokens: 40, output_tokens_details: { reasoning_tokens: 10 }, total_tokens: 140 },
      } : {
        id: "msg_mock", type: "message", role: "assistant", model: body.model,
        content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 40 },
      };
      if (provider === "openai") {
        if (responseMode === "failed") { result.status = "failed"; result.error = { code: "server_error", message: "mock failure" }; }
        if (responseMode === "incomplete") { result.status = "incomplete"; result.incomplete_details = { reason: "max_output_tokens" }; }
        if (responseMode === "refusal") result.output[1].content = [{ type: "refusal", refusal: "Cannot answer." }];
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (error) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: String(error) } }));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

const anthropic = await mock("anthropic");
const openai = await mock("openai");
let h;
try {
  h = await launch({ prefix: "yomeru-providers-" });
  const settings = { ...DEFAULTS, apiKey: "anthropic-test-key", apiBase: anthropic.base,
    openaiApiKey: "openai-test-key", openaiApiBase: openai.base, model: "claude-sonnet-5-5", cacheEnabled: false };
  await h.setSettings(settings);
  const options = await h.ctx.newPage();
  await options.goto(`chrome-extension://${h.extId}/options/options.html`);
  await options.waitForFunction(() => document.getElementById("model")?.options.length > 4);
  const ask = (msg) => options.evaluate((m) => chrome.runtime.sendMessage(m), msg);
  const save = (partial) => ask({ type: "saveSettings", partial });
  function noKeys(result) {
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(Object.hasOwn(result.settings, "apiKey"), false);
    assert.equal(Object.hasOwn(result.settings, "openaiApiKey"), false);
    assert.doesNotMatch(JSON.stringify(result), /anthropic-test-key|openai-test-key/);
  }
  assert.equal(await options.inputValue("#apiKey"), settings.apiKey);
  assert.equal(await options.inputValue("#openaiApiKey"), settings.openaiApiKey);
  assert.equal(await options.getAttribute("#openaiApiKey", "type"), "password");
  await options.fill("#openaiApiKey", "openai-updated-key");
  await options.selectOption("#model", "gpt-6.1-sol");
  await options.click("#save");
  await options.waitForFunction(async () => (await chrome.storage.local.get("settings")).settings.openaiApiKey === "openai-updated-key");
  await options.reload();
  await options.waitForFunction(() => document.getElementById("model")?.options.length > 4);
  assert.equal(await options.inputValue("#apiKey"), settings.apiKey);
  assert.equal(await options.inputValue("#openaiApiKey"), "openai-updated-key");
  assert.equal(await options.inputValue("#model"), "gpt-6.1-sol");
  noKeys(await save({ openaiApiKey: settings.openaiApiKey }));
  noKeys(await ask({ type: "getSettings" }));
  noKeys(await ask({ type: "resetUsage" }));
  check("options save both provider keys independently; public responses never disclose either key");

  // 設定画面の接続テストも現在選択したモデルの入力欄を使用する。
  await options.fill("#openaiApiKey", settings.openaiApiKey);
  await options.click("#testKey");
  await options.waitForFunction(() => document.getElementById("testResult").classList.contains("ok"));
  assert.equal(requests.at(-1).provider, "openai");
  assert.equal(requests.at(-1).body.model, "gpt-6.1-sol");
  const beforeEmptyTest = requests.length;
  await options.fill("#openaiApiKey", "");
  await options.click("#testKey");
  await options.waitForFunction(() => document.getElementById("testResult").classList.contains("err"));
  assert.equal(requests.length, beforeEmptyTest);
  check("connection test uses the selected provider and does not replace an explicitly empty field with its saved key");

  const pageRequest = { type: "translate", sessionId: "provider-page", segments: [{ id: 1, text: "Hello" }], context: {} };
  let result = await ask(pageRequest);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.results[1], "翻訳 1");
  assert.equal(result.model, "gpt-6.1-sol");
  assert.equal(result.usage.input + result.usage.cacheRead + result.usage.cacheWrite, 100);
  assert.equal(result.usage.output, 40);
  assert.equal(requests.at(-1).provider, "openai");
  await save({ model: "claude-sonnet-5-5" });
  result = await ask(pageRequest);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(requests.at(-1).provider, "anthropic");
  const override = { type: "explain", sessionId: "provider-explanation", selection: "lease", context: {}, model: "gpt-6-luna" };
  result = await ask(override);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.text, "選択範囲の解説です。");
  assert.equal(requests.at(-1).provider, "openai");
  assert.equal((await ask({ type: "getSettings" })).settings.model, "claude-sonnet-5-5");
  check("page translation follows the chosen provider; explanation overrides use OpenAI without changing the page model");

  await h.ctx.route("https://www.youtube.com/**", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Provider fixture</title><p>Fixture</p>" }));
  const { tabId } = await h.open(`https://www.youtube.com/watch?v=${VIDEO}`);
  const fromTab = async (msg) => {
    const values = await h.sw.evaluate(({ id, msg }) => chrome.scripting.executeScript({ target: { tabId: id }, func: (m) => chrome.runtime.sendMessage(m), args: [msg] }), { id: tabId, msg });
    return values[0].result;
  };
  noKeys(await fromTab({ type: "getSettings" }));
  assert.equal((await fromTab({ type: "getSettingsFull" })).ok, false);
  const beforeForbidden = requests.length;
  assert.equal((await fromTab({ type: "testKey", model: "gpt-6-luna", openaiApiBase: openai.base })).ok, false);
  assert.equal(requests.length, beforeForbidden);
  await save({ subtitleModel: "gpt-6-luna", apiKey: "" });
  result = await fromTab({ type: "translateSubtitles", sessionId: "provider-subtitles", videoId: VIDEO,
    cues: [{ id: 0, start: 0, end: 2, text: "Hello there" }], targetLang: "日本語", context: {} });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.results[0], "字幕 0");
  assert.equal(result.model, "gpt-6-luna");
  assert.equal(requests.at(-1).provider, "openai");
  check("subtitles use their own model and key even when the page model's Anthropic key is absent; web tabs cannot test or retrieve keys");

  const popup = await h.ctx.newPage();
  await popup.goto(`chrome-extension://${h.extId}/popup/popup.html?tab=${tabId}`);
  await popup.waitForFunction(() => document.getElementById("subtitleModel")?.options.length > 4);
  assert.equal(await popup.locator("#nokey").isVisible(), true);
  assert.match(await popup.textContent("#nokeyText"), /Anthropic/);
  assert.match(await popup.textContent("#subtitleProvider"), /OpenAI API を使用/);
  await popup.selectOption("#model", "gpt-6.1-sol");
  await popup.locator("#nokey").waitFor({ state: "hidden" });
  assert.equal(await popup.inputValue("#subtitleModel"), "gpt-6-luna");
  await popup.selectOption("#subtitleModel", "claude-haiku-5-5");
  await popup.waitForFunction(() => document.getElementById("subtitleProvider").textContent.includes("Anthropic API キーが未登録"));
  assert.equal(await popup.locator("#nokey").isVisible(), false);
  assert.equal(await popup.inputValue("#model"), "gpt-6.1-sol");
  check("popup model changes refresh the page key warning while subtitle key notices follow the independent subtitle model");

  await save({ model: "retired-page-model", subtitleModel: "retired-subtitle-model" });
  await popup.reload();
  await popup.waitForFunction(() => document.getElementById("subtitleModel")?.options.length > 4);
  assert.match(await popup.textContent("#nokeyText"), /モデルを選び直して/);
  assert.match(await popup.textContent("#subtitleProvider"), /モデルを選び直して/);
  await popup.selectOption("#model", "gpt-6.1-sol");
  await popup.locator("#nokey").waitFor({ state: "hidden" });
  await popup.selectOption("#subtitleModel", "gpt-6-luna");
  await popup.waitForFunction(() => document.getElementById("subtitleProvider").textContent.includes("OpenAI API を使用"));
  await popup.close();
  check("unknown saved models leave both popup selectors usable for recovery");

  await save({ model: "gpt-6.1-sol" });
  const imageRequest = { type: "translateImage", sessionId: "provider-image", image: { data: png, mediaType: "image/png", width: 1, height: 1 }, context: {} };
  result = await fromTab(imageRequest);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.regions, []);
  const imageBody = requests.at(-1).body;
  assert.equal(requests.at(-1).provider, "openai");
  assert.equal(imageBody.input[0].content.find((part) => part.type === "input_image").image_url, `data:image/png;base64,${png}`);
  assert.equal(imageBody.text.format.type, "json_schema");
  assert.equal(imageBody.text.format.strict, true);
  check("OpenAI image translation sends a data URL and structured output schema through Responses");

  await save({ apiKey: settings.apiKey, openaiApiKey: "" });
  const beforeMissing = requests.length;
  result = await ask(pageRequest);
  assert.equal(result.ok, false);
  assert.match(result.error, /OpenAI/);
  assert.equal(requests.length, beforeMissing);
  noKeys(await ask({ type: "getSettings" }));
  assert.equal((await ask({ type: "getSettings" })).settings.hasKey, false);
  await save({ apiKey: "", openaiApiKey: settings.openaiApiKey, model: "claude-sonnet-5-5" });
  result = await ask(pageRequest);
  assert.equal(result.ok, false);
  assert.match(result.error, /Anthropic/);
  assert.equal(requests.length, beforeMissing);
  result = await ask(override);
  assert.equal(result.ok, true, JSON.stringify(result));
  check("missing provider keys fail locally with no fallback to the other provider's credentials");

  await save({ model: "gpt-6.1-sol", cacheEnabled: true });
  for (const mode of ["failed", "refusal", "incomplete"]) {
    responseMode = mode;
    const message = { ...override, selection: `cache-${mode}`, model: "gpt-6.1-sol" };
    const before = requests.length;
    const first = await ask(message);
    if (mode !== "incomplete") assert.equal(first.ok, false, JSON.stringify(first));
    responseMode = "ok";
    const second = await ask(message);
    assert.equal(second.ok, true, JSON.stringify(second));
    assert.equal(second.cached, 0);
    assert.equal(requests.length, before + 2, `${mode} responses must not be cached`);
  }
  check("failed, refused and incomplete OpenAI explanations are not cached as completed answers");

  for (const request of requests) {
    if (request.provider === "openai") {
      assert.equal(request.url, "/v1/responses");
      assert.equal(request.headers.authorization, "Bearer openai-test-key");
      assert.equal(request.headers["x-api-key"], undefined);
      assert.equal(request.headers["anthropic-version"], undefined);
      assert.equal(request.body.store, false);
      assert.equal(request.body.reasoning.effort, "low");
      assert.equal(request.body.messages, undefined);
      assert.equal(request.body.output_config, undefined);
    } else {
      assert.equal(request.url, "/v1/messages");
      assert.equal(request.headers["x-api-key"], "anthropic-test-key");
      assert.equal(request.headers.authorization, undefined);
      assert.equal(request.body.input, undefined);
    }
  }
  check("all observed requests keep endpoint, authorization headers and request schemas isolated by provider");
} finally {
  if (h) await h.close();
  anthropic.server.close();
  openai.server.close();
}
