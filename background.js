// Yomeru service worker: ブラウザイベント・メッセージの振り分け・コンテンツスクリプト注入。
import { MODELS, modelProvider } from "./shared/models.js";
import { cacheClear, cacheCount, cachePrune } from "./shared/cache.js";
import { getSettings, saveSettings, resetUsage } from "./shared/settings.js";
import { loadYouTubeCaptions } from "./shared/youtube.js";
import { imageSenderAllowed } from "./shared/image.js";
import { subtitleSenderAllowed } from "./shared/subtitles.js";
import { cancelSession } from "./background/requests.js";
import { translate, testKey } from "./background/translations.js";
import { translateSubtitles } from "./background/subtitles.js";
import { fetchImage, translateImage } from "./background/images.js";
import { explain } from "./background/explanation.js";

// インストール前から開いていたタブへの注入順も manifest の定義を使う。
const { js: CONTENT_JS, css: CONTENT_CSS } = chrome.runtime.getManifest().content_scripts[0];
const MENU_PAGE = "tf-page";
const MENU_SELECTION = "tf-selection";
const MENU_EXPLAIN = "tf-explain-selection";
const MENU_IMAGE = "tf-image";

// ---------- ブラウザ側のイベント ----------
chrome.runtime.onInstalled.addListener(async () => {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({ id: MENU_PAGE, title: "このページを Yomeru で翻訳", contexts: ["all"] });
  chrome.contextMenus.create({ id: MENU_SELECTION, title: "選択範囲を Yomeru で翻訳", contexts: ["selection"] });
  chrome.contextMenus.create({ id: MENU_IMAGE, title: "画像を翻訳", contexts: ["image"] });
  const s = await getSettings();
  chrome.contextMenus.create({ id: MENU_EXPLAIN, title: "選択範囲を Yomeru で解説", contexts: ["selection"], visible: s.explanationEnabled !== false });
  cachePrune();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === MENU_IMAGE) {
    if (tab?.id && info.srcUrl && await ensureContent(tab.id)) sendToTab(tab.id, { type: "tf:translateImage", srcUrl: info.srcUrl });
    return;
  }
  const type = {
    [MENU_PAGE]: "tf:translate",
    [MENU_SELECTION]: "tf:translateSelection",
    [MENU_EXPLAIN]: "tf:explainSelection",
  }[info.menuItemId];
  if (!type || !tab?.id) return;
  if (await ensureContent(tab.id)) sendToTab(tab.id, { type });
});

chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd !== "toggle-translate") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;
  if (await ensureContent(tab.id)) sendToTab(tab.id, { type: "tf:toggle" });
});

function sendToTab(tabId, msg) {
  chrome.tabs.sendMessage(tabId, msg).catch(() => {});
}

// content script が未注入（インストール前から開いていたタブ等）なら注入する
async function ensureContent(tabId) {
  try {
    const r = await chrome.tabs.sendMessage(tabId, { type: "tf:ping" });
    if (r && r.ok) return true;
  } catch {
    /* 未注入 */
  }
  try {
    await chrome.scripting.insertCSS({ target: { tabId }, files: CONTENT_CSS });
    await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_JS });
    return true;
  } catch {
    return false; // chrome:// や Web ストア等
  }
}

// ---------- メッセージ ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const p = handle(msg, sender);
  if (!p) return false;
  p.then(sendResponse, (e) => sendResponse({ ok: false, error: String((e && e.message) || e), fatal: !!(e && e.fatal) }));
  return true;
});

const fromExtensionPage = (sender) => !!sender.url && sender.url.startsWith(chrome.runtime.getURL(""));
const FORBIDDEN = Promise.resolve({ ok: false, error: "forbidden" });

// 両プロバイダーの API キーを外に出さない（content script / popup 向け）。
function publicSettings(s) {
  const { apiKey, openaiApiKey, ...rest } = s;
  const hasAnthropicKey = !!apiKey?.trim();
  const hasOpenAIKey = !!openaiApiKey?.trim();
  const provider = MODELS.some(({ id }) => id === s.model) ? modelProvider(s.model) : null;
  return { ...rest, hasKey: provider === "openai" ? hasOpenAIKey : provider === "anthropic" && hasAnthropicKey,
    hasAnthropicKey, hasOpenAIKey, models: MODELS.map(({ id, label }) => ({ id, label, provider: modelProvider(id) })) };
}

function handle(msg, sender) {
  switch (msg && msg.type) {
    case "tf:keepalive":
      return Promise.resolve({ ok: true });
    case "getSettings":
      return getSettings().then((s) => ({ ok: true, settings: publicSettings(s) }));
    case "getSettingsFull": // options ページ専用（拡張ページからのみ）
      return fromExtensionPage(sender) ? getSettings().then((s) => ({ ok: true, settings: s })) : FORBIDDEN;
    case "saveSettings":
      return fromExtensionPage(sender) ? saveSettings(msg.partial || {}).then(async (s) => {
        await chrome.contextMenus.update(MENU_EXPLAIN, { visible: s.explanationEnabled !== false }).catch(() => {});
        return { ok: true, settings: publicSettings(s) };
      }) : FORBIDDEN;
    case "resetUsage":
      return resetUsage().then((s) => ({ ok: true, settings: publicSettings(s) }));
    case "cacheStats":
      return cacheCount().then((count) => ({ ok: true, count }));
    case "clearCache":
      return cacheClear().then(() => ({ ok: true }));
    case "ensureContent":
      return ensureContent(msg.tabId).then((ok) => ({ ok }));
    case "openOptions":
      chrome.runtime.openOptionsPage();
      return Promise.resolve({ ok: true });
    case "testKey":
      return fromExtensionPage(sender) ? testKey(msg) : FORBIDDEN;
    case "translate":
      return translate(msg);
    case "fetchImage":
      return imageSenderAllowed(sender) ? fetchImage(msg) : FORBIDDEN;
    case "translateImage":
      return imageSenderAllowed(sender) ? translateImage(msg) : FORBIDDEN;
    case "getYouTubeCaptions":
      return loadYouTubeCaptions(sender, msg.videoId);
    case "translateSubtitles":
      return subtitleSenderAllowed(sender) ? translateSubtitles(msg, sender) : FORBIDDEN;
    case "explain":
      return explain(msg);
    case "cancel":
      cancelSession(msg.sessionId);
      return Promise.resolve({ ok: true });
    default:
      return null;
  }
}
