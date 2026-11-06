// モデル表・価格・既定設定（background / popup / options / tests で共有。純粋モジュール）
// OpenAI単価: 2026-11-06確認、Standard・通常長 https://developers.openai.com/api/docs/pricing

export const MODELS = [
  { id: "claude-opus-5-5",   label: "Claude Opus 5.5",   input: 4.0,  output: 20.0, fallbacks: true,  note: "最も自然（高め）" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", input: 2.0,  output: 10.0, fallbacks: true,  note: "既定・速さと品質のバランス" },
  { id: "claude-haiku-5-5",  label: "Claude Haiku 5.5",  input: 0.10, output: 0.50, fallbacks: false, note: "最速・最安" },
  { id: "claude-fable-5-1",  label: "Claude Fable 5.1",  input: 10.0, output: 50.0, fallbacks: true,  note: "最上位（高価）" },
].map((model) => ({ ...model, provider: "anthropic" })).concat([
  { id: "gpt-6.1-sol", label: "GPT-6.1 Sol", provider: "openai", input: 2.0, output: 10.0, cachedInput: 0.10, note: "速さと品質のバランス" },
  { id: "gpt-6.1-terra", label: "GPT-6.1 Terra", provider: "openai", input: 1.0, output: 5.0, cachedInput: 0.05, note: "画像の理解・自然な文章" },
  { id: "gpt-6-luna", label: "GPT-6 Luna", provider: "openai", input: 0.10, output: 0.50, cachedInput: 0.01, note: "低コスト・大量の翻訳向き" },
  { id: "gpt-6-astra", label: "GPT-6 Astra", provider: "openai", input: 10.0, output: 50.0, cachedInput: 1.0, note: "最上位（高価）" },
]);

export const EFFORTS = [
  { id: "low",    label: "low（速い・翻訳向き）" },
  { id: "medium", label: "medium" },
  { id: "high",   label: "high（遅い）" },
];

export const LANG_PRESETS = ["日本語", "English", "한국어", "中文（简体）", "中文（繁體）", "Deutsch", "Français", "Español"];

export const SETTINGS_SCHEMA = 3;   // 3: 字幕の既定を日本語・専用Haikuモデルに変更

export const DEFAULTS = {
  schema: SETTINGS_SCHEMA,
  apiKey: "",
  apiBase: "https://api.anthropic.com",
  openaiApiKey: "",
  openaiApiBase: "https://api.openai.com",
  model: "claude-sonnet-5-5",
  effort: "low",
  targetLang: "日本語",
  displayMode: "replace",      // "replace" | "bilingual"
  subtitleTargetLang: "日本語",
  subtitleModel: "claude-haiku-5-5",
  subtitleMode: "bilingual",
  customInstructions: "",
  glossary: "",                // 1行1語: "term = 訳語"
  batchChars: 2500,
  concurrency: 4,
  cacheEnabled: true,
  explanationEnabled: true,    // 選択範囲の解説ボタンと右クリックメニュー
  skipNav: true,               // nav / aside を翻訳対象から外す
  autoHosts: [],               // 常に翻訳するホスト
  usdJpy: 150,
  usage: { input: 0, output: 0, costUsd: 0, requests: 0 },
};

export function modelInfo(id) {
  return MODELS.find((m) => m.id === id) || null;
}

export function modelProvider(id) {
  const model = modelInfo(id);
  if (!model) throw Object.assign(new Error("選択したモデルは使用できません"), { fatal: true });
  return model.provider;
}

// usage = {input, output, cacheRead, cacheWrite}（トークン数）→ USD
export function estimateCostUsd(modelId, usage) {
  const m = modelInfo(modelId);
  if (!m || !usage) return 0;
  const cacheRead = usage.cacheRead || 0;
  const cacheWrite = usage.cacheWrite || 0;
  const plainIn = Math.max(0, (usage.input || 0));
  // OpenAI はモデルごとのキャッシュ読取単価を使う。書込は30分キャッシュの目安。
  const inCost = plainIn * m.input + cacheRead * (m.cachedInput ?? m.input * 0.1) + cacheWrite * m.input * 1.25;
  const outCost = (usage.output || 0) * m.output;
  return (inCost + outCost) / 1_000_000;
}

export function fmtUsd(v) {
  if (!v) return "$0.00";
  return v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`;
}

export function fmtJpy(usd, rate) {
  const y = usd * (rate || 150);
  return y < 1 ? `¥${y.toFixed(2)}` : `¥${Math.round(y).toLocaleString("ja-JP")}`;
}
