import { MODELS, LANG_PRESETS, modelInfo, fmtUsd, fmtJpy } from "../shared/models.js";
import { $, bg, fillSelect, segmented } from "../shared/ui.js";
import { createYouTubeCard } from "./youtube.js";

const POLL_MS = 500;
let tab = null;
let settings = null;
let pollTimer = null;
let modeSeg = null;
const youtube = createYouTubeCard({ content, getSettings: () => settings, saveSettings: saveSetting });

async function content(msg) {
  if (!tab || !tab.id) return null;
  try {
    return await chrome.tabs.sendMessage(tab.id, msg);
  } catch {
    return null;
  }
}

function statusLabel(st) {
  if (st.status === "running") return `翻訳中 ${st.progress.done}/${st.progress.total}`;
  if (st.status === "translated") return st.mode === "bilingual" ? "翻訳済み（対訳）" : "翻訳済み（置換）";
  return "未翻訳";
}

function render(st) {
  $("main").hidden = false;
  const status = st.status || "idle";
  const p = st.progress || { done: 0, total: 0 };
  $("dot").className = `dot ${status}`;
  $("statusText").textContent = statusLabel({ ...st, status, progress: p });
  $("bar").style.width = status === "running" && p.total ? `${Math.round((p.done / p.total) * 100)}%` : status === "translated" ? "100%" : "0";
  $("translate").hidden = status !== "idle";
  $("restore").hidden = status !== "translated";
  $("cancel").hidden = status !== "running";
  $("err").hidden = !st.error;
  $("err").textContent = st.error || "";
  const u = st.usage;
  $("pageCost").textContent = u && u.requests
    ? `${(u.input + u.output).toLocaleString()} tok · ${fmtUsd(u.costUsd)} ≈ ${fmtJpy(u.costUsd, settings.usdJpy)}${u.cached ? ` · cache ${u.cached}` : ""}`
    : "--";
  const t = settings.usage;
  $("totalCost").textContent = `${fmtUsd(t.costUsd)} ≈ ${fmtJpy(t.costUsd, settings.usdJpy)} / ${t.requests} req`;
  modeSeg.set((status === "translated" ? st.mode : settings.displayMode) || "replace");
}

async function refresh() {
  const st = await content({ type: "tf:state" });
  if (!st) {
    $("main").hidden = true;
    $("unsupported").hidden = false;
    return;
  }
  $("unsupported").hidden = true;
  render(st);
  if (st.status === "running") {
    if (!pollTimer) pollTimer = setInterval(refresh, POLL_MS);
  } else if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
    const r = await bg({ type: "getSettings" });
    if (r && r.ok) settings = r.settings;
  }
}

function startTranslate(mode) {
  content({ type: "tf:translate", mode }); // 完了を待たない（ポーリングで反映）
  setTimeout(refresh, 150);
}

async function saveSetting(partial) {
  const r = await bg({ type: "saveSettings", partial });
  if (!r?.ok) throw new Error(r?.error || "設定を保存できません");
  settings = r.settings;
  renderKeyStatus();
}

function renderKeyStatus() {
  const model = modelInfo(settings.model);
  const provider = model?.provider === "openai" ? "OpenAI" : "Anthropic";
  $("nokey").hidden = !!model && settings.hasKey;
  $("nokeyText").textContent = model
    ? `ページ翻訳用の ${provider} API キーがまだ登録されていません。`
    : "保存されているモデルは使用できません。モデルを選び直してください。";
}

window.addEventListener("pagehide", () => { youtube.dispose(); clearInterval(pollTimer); });

function safeHost(url) {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u.hostname : "";
  } catch {
    return "";
  }
}

async function init() {
  // 設定ボタンは初期化の成否に関係なく常に効くよう最初に結ぶ
  for (const id of ["openOptions1", "openOptions2"]) $(id).addEventListener("click", () => chrome.runtime.openOptionsPage());

  // 開発用: popup.html?tab=<tabId> で対象タブを固定（タブとして開いて検証するため）
  const forced = new URLSearchParams(location.search).get("tab");
  if (forced) tab = await chrome.tabs.get(Number(forced)).catch(() => null);
  else [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  settings = (await bg({ type: "getSettings" })).settings;
  renderKeyStatus();

  fillSelect($("lang"), LANG_PRESETS, settings.targetLang);
  fillSelect($("model"), MODELS, settings.model, (m) => m.label);
  const host = tab && tab.url ? safeHost(tab.url) : "";
  $("autoHost").checked = !!host && settings.autoHosts.includes(host);
  $("autoHostLabel").textContent = host ? `${host} は常に翻訳` : "このサイトは常に翻訳";
  $("autoHost").disabled = !host;

  modeSeg = segmented($("modeSeg"), async (mode) => {
    await saveSetting({ displayMode: mode });
    const st = await content({ type: "tf:state" });
    if (st && st.status === "translated" && st.mode !== mode) startTranslate(mode); // モード切替は再翻訳（キャッシュで速い）
    else if (st) render(st);
  });

  const ok = tab && tab.id && (await bg({ type: "ensureContent", tabId: tab.id }));
  if (!ok || !ok.ok) {
    $("unsupported").hidden = false;
    return;
  }
  await refresh();
  if (host === "www.youtube.com") await youtube.init();

  $("translate").addEventListener("click", () => {
    if (!settings.hasKey) { $("nokey").hidden = false; return; }
    startTranslate(modeSeg.get() || settings.displayMode);
  });
  $("restore").addEventListener("click", async () => { await content({ type: "tf:restore" }); refresh(); });
  $("cancel").addEventListener("click", async () => { await content({ type: "tf:cancel" }); refresh(); });
  $("lang").addEventListener("change", (e) => saveSetting({ targetLang: e.target.value }));
  $("model").addEventListener("change", (e) => saveSetting({ model: e.target.value }));
  $("autoHost").addEventListener("change", (e) => {
    const set = new Set(settings.autoHosts);
    if (e.target.checked) set.add(host); else set.delete(host);
    saveSetting({ autoHosts: [...set] });
  });
}

init().catch((e) => {
  $("unsupported").hidden = false;
  $("unsupported").querySelector("p").textContent = `初期化に失敗: ${e.message || e}`;
});
