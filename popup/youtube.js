import { DEFAULTS, MODELS, modelInfo, fmtUsd, fmtJpy } from "../shared/models.js";
import { $, fillSelect } from "../shared/ui.js";

const POLL_MS = 500;

// 字幕カードの設定・操作・ポーリングを閉じ込め、ページ翻訳のモデル選択から独立させる。
export function createYouTubeCard({ content, getSettings, saveSettings }) {
  let timer = null;

  function render(state) {
    $("youtube").hidden = !state?.supported;
    if (!state?.supported) return;
    const settings = getSettings();
    const started = state.status === "loading" || state.status === "active";
    $("subtitleStart").hidden = started;
    $("subtitleStop").hidden = !started && state.status !== "error";
    $("subtitleLang").disabled = started;
    $("subtitleModel").disabled = started;
    $("subtitleMode").value = state.status === "idle" ? settings.subtitleMode || "bilingual" : state.mode;
    $("subtitleLang").value = state.status === "idle" ? settings.subtitleTargetLang || DEFAULTS.subtitleTargetLang : state.targetLang;
    $("subtitleModel").value = started && state.model ? state.model : settings.subtitleModel || DEFAULTS.subtitleModel;
    const provider = modelInfo($("subtitleModel").value)?.provider;
    const hasKey = provider === "openai" ? settings.hasOpenAIKey : settings.hasAnthropicKey;
    $("subtitleProvider").textContent = provider
      ? `${provider === "openai" ? "OpenAI" : "Anthropic"} API${hasKey ? " を使用" : " キーが未登録です。設定から登録してください。"}`
      : "保存されている字幕モデルは使用できません。モデルを選び直してください。";
    $("subtitleStatus").textContent = state.status === "loading" ? "字幕を読み込んでいます…" : state.status === "active"
      ? `${state.sourceLabel} → ${state.targetLang} · ${state.done}/${state.total} 件を翻訳済み（再生位置の先を順次翻訳）`
      : "字幕付きの通常動画に対応しています。";
    $("subtitleError").textContent = state.error || "";
    $("subtitleError").hidden = !state.error;
    $("subtitleCost").textContent = state.usage?.requests || state.usage?.cached
      ? `この動画 ${fmtUsd(state.usage.costUsd)} ≈ ${fmtJpy(state.usage.costUsd, settings.usdJpy)}${state.usage.cached ? ` · cache ${state.usage.cached}` : ""}` : "";
  }

  async function refresh() {
    render(await content({ type: "tf:youtubeState" }));
  }

  async function init() {
    const settings = getSettings();
    fillSelect($("subtitleModel"), MODELS, settings.subtitleModel || DEFAULTS.subtitleModel, (m) => m.label);
    $("subtitleLang").addEventListener("change", (e) => saveSettings({ subtitleTargetLang: e.target.value }));
    $("subtitleModel").addEventListener("change", async (e) => { await saveSettings({ subtitleModel: e.target.value }); refresh(); });
    $("subtitleMode").addEventListener("change", async (e) => {
      await saveSettings({ subtitleMode: e.target.value });
      await content({ type: "tf:youtubeMode", mode: e.target.value });
      refresh();
    });
    $("subtitleStart").addEventListener("click", async () => {
      await content({ type: "tf:youtubeStart", targetLang: $("subtitleLang").value, mode: $("subtitleMode").value });
      refresh();
    });
    $("subtitleStop").addEventListener("click", async () => { await content({ type: "tf:youtubeStop" }); refresh(); });
    await refresh();
    timer = setInterval(refresh, POLL_MS);
  }

  function dispose() {
    clearInterval(timer);
    timer = null;
  }

  return { init, dispose };
}
