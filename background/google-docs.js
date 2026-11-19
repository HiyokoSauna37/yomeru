// Google Docs の HTML 書き出しを、現在のタブと同じ閲覧権限で取得する。
import "../shared/google-docs-location.js";
import { withSession } from "./requests.js";

const { ORIGIN, CHANGED_ERROR, parse } = globalThis.TFGoogleDocsLocation;
const MAX_BYTES = 2 * 1024 * 1024;
const ACCESS_ERROR = "本文を取得できません。Googleへのログイン、文書の閲覧権限、ダウンロードの許可を確認してください。";

export function googleDocLocation(value) {
  const doc = parse(value);
  if (!doc || !/^[\w.-]{1,100}$/.test(doc.tab)) return null;
  const { url, account, documentId, tab, key } = doc;
  const exportUrl = new URL(`/document/${account ? `u/${account}/` : ""}d/${documentId}/export`, ORIGIN);
  exportUrl.searchParams.set("format", "html");
  exportUrl.searchParams.set("tab", tab);
  for (const name of ["authuser", "resourcekey"]) {
    const value = url.searchParams.get(name);
    if (value && value.length <= 200) exportUrl.searchParams.set(name, value);
  }
  return { key, exportUrl: exportUrl.href };
}

async function readHtml(response) {
  if (Number(response.headers.get("content-length")) > MAX_BYTES) throw new Error("文書が大きすぎます（HTMLは2 MBまで）。");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let html = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) throw new Error("文書が大きすぎます（HTMLは2 MBまで）。");
      html += decoder.decode(value, { stream: true });
    }
    return html + decoder.decode();
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
}

export async function loadGoogleDoc(msg, sender) {
  const expected = googleDocLocation(msg.documentUrl);
  let origin;
  try { origin = new URL(sender?.url).origin; } catch { /* 不正な送信元 */ }
  if (!expected || origin !== ORIGIN || sender?.frameId !== 0 || !sender?.tab?.id) {
    return { ok: false, error: "Googleドキュメントの文書画面から翻訳してください。" };
  }
  return withSession(msg.sessionId, async (signal) => {
    const current = googleDocLocation((await chrome.tabs.get(sender.tab.id)).url);
    if (!current || current.key !== expected.key) throw new Error(CHANGED_ERROR);
    const response = await fetch(current.exportUrl, { credentials: "include", cache: "no-store", signal });
    if ([401, 403, 404].includes(response.status)) throw new Error(ACCESS_ERROR);
    if (!response.ok) throw new Error(`本文の取得に失敗しました（HTTP ${response.status}）。時間をおいて再試行してください。`);
    // ログイン画面や Google のエラーページを本文として API に送らない。
    if (!/text\/html/i.test(response.headers.get("content-type") || "") ||
        !/\battachment\b/i.test(response.headers.get("content-disposition") || "")) throw new Error(ACCESS_ERROR);
    const html = await readHtml(response);
    if (googleDocLocation((await chrome.tabs.get(sender.tab.id)).url)?.key !== expected.key) throw new Error(CHANGED_ERROR);
    return { ok: true, html, key: expected.key };
  }, { timeoutMs: 30000, timeoutMessage: "本文の取得がタイムアウトしました。もう一度翻訳してください。" });
}
