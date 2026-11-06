import { MODELS, EFFORTS, LANG_PRESETS, DEFAULTS, modelInfo, modelProvider, fmtUsd, fmtJpy } from "../shared/models.js";
import { $, bg, fillSelect, segmented } from "../shared/ui.js";

const LIMITS = { batchChars: [500, 8000], concurrency: [1, 8] };
let settings = null;
const modeSeg = segmented($("modeSeg"), (mode) => modeSeg.set(mode));

const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));

// 1万字の英文 ≈ 入力 3,000 tok + システム/マーカー 2,000 tok、出力 ≈ 7,000 tok の概算
function estimatePageUsd(m) {
  return (5000 * m.input + 7000 * m.output) / 1_000_000;
}

function showModelPrice() {
  const m = modelInfo($("model").value);
  if (!m) { $("modelPrice").textContent = ""; return; }
  const provider = modelProvider(m.id) === "openai" ? "OpenAI" : "Anthropic";
  $("modelProvider").textContent = `${provider} API キーを使います。`;
  $("testProvider").textContent = `接続テスト: ${m.label} / ${provider}`;
  const usd = estimatePageUsd(m);
  const rate = Number($("usdJpy").value) || DEFAULTS.usdJpy;
  $("modelPrice").textContent = `入力 $${m.input}/MTok · 出力 $${m.output}/MTok（目安: 英文1万字のページ ≈ ${fmtUsd(usd)} ≈ ${fmtJpy(usd, rate)}）`;
}

function renderUsage() {
  const u = settings.usage;
  $("usage").innerHTML = "";
  const rows = [
    ["requests", `${u.requests.toLocaleString()} 回`],
    ["input", `${u.input.toLocaleString()} tok`],
    ["output", `${u.output.toLocaleString()} tok`],
    ["cost", `${fmtUsd(u.costUsd)} ≈ ${fmtJpy(u.costUsd, settings.usdJpy)}`],
  ];
  for (const [k, v] of rows) {
    const a = document.createElement("span"); a.className = "k"; a.textContent = k;
    const b = document.createElement("span"); b.textContent = v;
    $("usage").append(a, b);
  }
}

async function refreshCache() {
  const r = await bg({ type: "cacheStats" });
  $("cacheStats").textContent = `cache: ${r && r.ok ? r.count.toLocaleString() : "?"} entries`;
}

async function load() {
  const r = await bg({ type: "getSettingsFull" });
  if (!r || !r.ok) throw new Error((r && r.error) || "設定を読めません");
  settings = r.settings;
  $("ver").textContent = `v${chrome.runtime.getManifest().version}`;
  $("apiKey").value = settings.apiKey || "";
  $("apiBase").value = settings.apiBase || "";
  $("openaiApiKey").value = settings.openaiApiKey || "";
  $("openaiApiBase").value = settings.openaiApiBase || DEFAULTS.openaiApiBase;
  fillSelect($("model"), MODELS, settings.model, (m) => `${m.label} — ${m.note}`);
  fillSelect($("effort"), EFFORTS, settings.effort, (e) => e.label);
  $("targetLang").value = settings.targetLang;
  for (const l of LANG_PRESETS) { const o = document.createElement("option"); o.value = l; $("langs").appendChild(o); }
  modeSeg.set(settings.displayMode);
  $("customInstructions").value = settings.customInstructions || "";
  $("glossary").value = settings.glossary || "";
  $("skipNav").checked = !!settings.skipNav;
  $("explanationEnabled").checked = settings.explanationEnabled !== false;
  $("batchChars").value = settings.batchChars;
  $("concurrency").value = settings.concurrency;
  $("usdJpy").value = settings.usdJpy;
  $("cacheEnabled").checked = !!settings.cacheEnabled;
  $("autoHosts").value = (settings.autoHosts || []).join("\n");
  showModelPrice();
  renderUsage();
  refreshCache();
}

// 画面の入力 → 保存する設定
function collect() {
  return {
    apiKey: $("apiKey").value.trim(),
    apiBase: $("apiBase").value.trim() || DEFAULTS.apiBase,
    openaiApiKey: $("openaiApiKey").value.trim(),
    openaiApiBase: $("openaiApiBase").value.trim() || DEFAULTS.openaiApiBase,
    model: $("model").value,
    effort: $("effort").value,
    targetLang: $("targetLang").value.trim() || DEFAULTS.targetLang,
    displayMode: modeSeg.get(),
    customInstructions: $("customInstructions").value,
    glossary: $("glossary").value,
    skipNav: $("skipNav").checked,
    explanationEnabled: $("explanationEnabled").checked,
    batchChars: clamp(Number($("batchChars").value) || DEFAULTS.batchChars, LIMITS.batchChars),
    concurrency: clamp(Number($("concurrency").value) || DEFAULTS.concurrency, LIMITS.concurrency),
    usdJpy: Number($("usdJpy").value) || DEFAULTS.usdJpy,
    cacheEnabled: $("cacheEnabled").checked,
    autoHosts: $("autoHosts").value.split(/\r?\n/).map((s) => s.trim().toLowerCase()).filter(Boolean),
  };
}

async function save() {
  const partial = collect();
  const r = await bg({ type: "saveSettings", partial });
  if (!r || !r.ok) { alert(`保存に失敗: ${(r && r.error) || "?"}`); return; }
  settings = { ...settings, ...partial };
  $("saved").hidden = false;
  setTimeout(() => { $("saved").hidden = true; }, 1600);
}

async function testKey() {
  const out = $("testResult");
  out.className = "help testing";
  out.textContent = "接続中…";
  const r = await bg({
    type: "testKey", model: $("model").value,
    apiKey: $("apiKey").value.trim(), apiBase: $("apiBase").value.trim() || DEFAULTS.apiBase,
    openaiApiKey: $("openaiApiKey").value.trim(), openaiApiBase: $("openaiApiBase").value.trim() || DEFAULTS.openaiApiBase,
  });
  if (r && r.ok) {
    out.className = "help ok";
    out.textContent = `OK — ${r.model} が応答（${r.text || ""}）· ${fmtUsd(r.costUsd || 0)}`;
  } else {
    out.className = "help err";
    out.textContent = `失敗: ${(r && r.error) || "不明なエラー"}`;
  }
}

$("save").addEventListener("click", save);
$("testKey").addEventListener("click", testKey);
for (const [button, input] of [["toggleKey", "apiKey"], ["toggleOpenAIKey", "openaiApiKey"]]) {
  $(button).addEventListener("click", () => {
    const i = $(input);
    i.type = i.type === "password" ? "text" : "password";
    $(button).textContent = i.type === "password" ? "表示" : "隠す";
  });
}
$("model").addEventListener("change", () => { showModelPrice(); $("testResult").textContent = ""; });
$("usdJpy").addEventListener("input", showModelPrice);
$("clearCache").addEventListener("click", async () => {
  if (!confirm("翻訳キャッシュをすべて削除します。よろしいですか？")) return;
  await bg({ type: "clearCache" });
  refreshCache();
});
$("resetUsage").addEventListener("click", async () => {
  if (!confirm("累計使用量をリセットします。よろしいですか？")) return;
  const r = await bg({ type: "resetUsage" });
  if (r && r.ok) { settings.usage = r.settings.usage; renderUsage(); }
});
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); save(); }
});

load().catch((e) => {
  document.body.insertAdjacentHTML("afterbegin", `<p class="err" style="padding:20px">${e.message || e}</p>`);
});
