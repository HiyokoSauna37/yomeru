import assert from "node:assert/strict";
import { googleDocLocation, loadGoogleDoc } from "../background/google-docs.js";
import { cancelSession } from "../background/requests.js";

const DOC = "https://docs.google.com/document/d/example-document/edit?tab=t.1#heading=h.summary";
const sender = { url: DOC, frameId: 0, tab: { id: 10 } };
const msg = { documentUrl: DOC, sessionId: "docs-unit" };
const loc = googleDocLocation(DOC);
assert.equal(loc.key, "example-document:t.1");
assert.equal(loc.exportUrl, "https://docs.google.com/document/d/example-document/export?format=html&tab=t.1");
const account = googleDocLocation("https://docs.google.com/document/u/0/d/abc/view?authuser=0&resourcekey=key#tab=t.2");
assert.equal(account.key, "abc:t.2");
assert.equal(account.exportUrl, "https://docs.google.com/document/u/0/d/abc/export?format=html&tab=t.2&authuser=0&resourcekey=key");
for (const value of ["https://docs.google.com.evil.test/document/d/abc/edit", "http://docs.google.com/document/d/abc/edit", "https://docs.google.com/spreadsheets/d/abc/edit", "https://docs.google.com/document/d/abc/export", "https://docs.google.com/document/d/abc/edit?tab=../other", "junk"]) assert.equal(googleDocLocation(value), null);
console.log("✓ document, account and tab URLs resolve to a fixed Google Docs export endpoint");

const originalFetch = globalThis.fetch;
const originalChrome = globalThis.chrome;
let currentUrl = DOC;
let calls = [];
const headers = { "content-type": "text/html; charset=utf-8", "content-disposition": 'attachment; filename="document.html"' };
const html = "<html><body><h1>Document</h1><p>Real content.</p></body></html>";
const response = () => new Response(html, { headers });
globalThis.chrome = { tabs: { get: async () => ({ url: currentUrl }) } };
globalThis.fetch = async (url, options) => { calls.push({ url, options }); return response(); };
try {
  for (const badSender of [{ ...sender, url: "https://evil.test/" }, { ...sender, frameId: 1 }, { ...sender, tab: null }]) {
    assert.equal((await loadGoogleDoc(msg, badSender)).ok, false);
  }
  currentUrl = DOC.replace("t.1", "t.2");
  await assert.rejects(loadGoogleDoc(msg, sender), /切り替わりました/);
  assert.equal(calls.length, 0);
  currentUrl = DOC;
  const result = await loadGoogleDoc(msg, sender);
  assert.equal(result.html, html);
  assert.equal(result.key, loc.key);
  assert.equal(calls[0].options.credentials, "include");
  assert.equal(calls[0].options.cache, "no-store");
  console.log("✓ only the current top-level document can request its authenticated export");

  for (const status of [401, 403, 404]) {
    globalThis.fetch = async () => new Response("denied", { status });
    await assert.rejects(loadGoogleDoc(msg, sender), /閲覧権限/);
  }
  globalThis.fetch = async () => new Response("<html>Sign in to Google</html>", { headers: { "content-type": "text/html" } });
  await assert.rejects(loadGoogleDoc(msg, sender), /ログイン/);
  globalThis.fetch = async () => new Response("PK zip data", { headers: { ...headers, "content-type": "application/zip" } });
  await assert.rejects(loadGoogleDoc(msg, sender), /本文を取得できません/);
  globalThis.fetch = async () => new Response("retry", { status: 503 });
  await assert.rejects(loadGoogleDoc(msg, sender), /HTTP 503/);
  console.log("✓ permission failures, login pages, non-HTML downloads and server errors never become document content");

  globalThis.fetch = async () => new Response(html, { headers: { ...headers, "content-length": String(3 * 1024 * 1024) } });
  await assert.rejects(loadGoogleDoc(msg, sender), /大きすぎます/);
  globalThis.fetch = async () => new Response("x".repeat(2 * 1024 * 1024 + 1), { headers });
  await assert.rejects(loadGoogleDoc(msg, sender), /大きすぎます/);
  console.log("✓ HTML size limits apply to both declared and streamed bytes");

  globalThis.fetch = async () => { currentUrl = DOC.replace("t.1", "t.2"); return response(); };
  await assert.rejects(loadGoogleDoc(msg, sender), /切り替わりました/);
  currentUrl = DOC;
  globalThis.fetch = async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
  });
  const pending = loadGoogleDoc(msg, sender);
  await new Promise((resolve) => setTimeout(resolve, 0));
  cancelSession(msg.sessionId);
  await assert.rejects(pending, /cancelled/);
  console.log("✓ navigation during download and cancellation prevent stale document delivery");
} finally {
  globalThis.fetch = originalFetch;
  globalThis.chrome = originalChrome;
}
