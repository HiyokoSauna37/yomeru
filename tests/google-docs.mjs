// Google Docs の Canvas 画面を模したタブで、本文取得から翻訳・復元までを検証。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { startServer, stats } from "./mock_server.mjs";
import { launch } from "./harness.mjs";

const watchdog = setTimeout(() => { console.error("Google Docs E2E timed out"); process.exit(3); }, 180000);
watchdog.unref();
const { server, port } = await startServer();
const h = await launch({ prefix: "tf-google-docs-" });
const DOC = "https://docs.google.com/document/d/fixture-doc/edit?tab=t.0#heading=h.summary";
const fixture = readFileSync(new URL("./fixture/google-docs.html", import.meta.url), "utf8");
const exportHtml = `<html><head><style>body{display:none}p{color:red}</style></head><body onload="alert('unsafe')">
  <h1 id="h.title">Document title</h1><h2 id="h.summary">Summary</h2>
  <p id="body">Content providers can restrict <strong>downloads</strong> in iframes.</p>
  <ul><li>Sandboxed iframe</li></ul><table><tr><td>All platforms</td><td>Except iOS</td></tr></table>
  <p><a href="https://www.google.com/url?q=https://example.org/spec">Specification</a></p>
  <p><a href="#h.summary">Jump to summary</a></p><p><code>allow-downloads</code> keyword</p>
  <script>window.__unsafe=true</script><iframe src="https://evil.test/">Secret iframe</iframe>
  <p><a href="javascript:alert('bad')" onclick="alert('bad')">Unsafe link</a></p>
</body></html>`;
const reader = (page) => page.locator("#tf-docs-reader");
const originalUi = async (page) => page.locator("body").innerHTML();

try {
  await h.setSettings({ schema: 2, apiKey: "test-key", apiBase: `http://127.0.0.1:${port}`, model: "claude-opus-5-5", effort: "low", targetLang: "日本語", displayMode: "replace", cacheEnabled: false, skipNav: true, autoHosts: [], concurrency: 2, batchChars: 2500, usdJpy: 150 });
  await h.ctx.route("https://docs.google.com/document/**", (route) => route.fulfill({ contentType: "text/html", body: fixture }));
  await h.sw.evaluate((html) => {
    const original = globalThis.fetch;
    globalThis.docsFixture = { html, calls: [], delay: 0, deny: false, login: false };
    globalThis.fetch = async (url, options) => {
      if (!String(url).startsWith("https://docs.google.com/document/")) return original(url, options);
      const f = globalThis.docsFixture;
      f.calls.push(String(url));
      if (f.delay) await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, f.delay);
        const abort = () => { clearTimeout(timer); reject(new Error("cancelled")); };
        if (options.signal.aborted) abort();
        else options.signal.addEventListener("abort", abort, { once: true });
      });
      return new Response(f.deny ? "denied" : f.html, { status: f.deny ? 403 : 200,
        headers: { "content-type": "text/html", ...(!f.login && { "content-disposition": 'attachment; filename="doc.html"' }) } });
    };
  }, exportHtml);
  const { page, tabId } = await h.open(DOC);
  await page.locator("nav button").focus();
  const before = await originalUi(page);
  stats.requests.length = 0;
  let st = await h.msg(tabId, { type: "tf:translate", mode: "replace" });
  assert.equal(st.status, "translated", JSON.stringify(st));
  assert.equal(st.error, null);
  assert.ok(st.progress.total > 5);
  assert.match(await reader(page).locator("#body").innerText(), /【/);
  assert.match(await reader(page).locator("td").first().innerText(), /【All platforms】/);
  assert.equal(await reader(page).locator("code").innerText(), "allow-downloads");
  assert.equal(await reader(page).locator('a[href="https://example.org/spec"]').count(), 1);
  assert.equal(await reader(page).locator("script, iframe, [onclick], [onload], a[href^='javascript:']").count(), 0);
  assert.equal(await originalUi(page), before);
  assert.equal(await page.locator("body").evaluate((el) => el.inert), true);
  assert.ok(stats.requests.length);
  assert.ok(stats.requests.every((r) => !/Share document|File Edit View|Secret iframe|window.__unsafe/.test(r.body.messages[0].content)));
  console.log("✓ replace translates the exported body, keeps structure and links, and excludes editor UI and active HTML");

  const calls = await h.sw.evaluate(() => docsFixture.calls.length);
  st = await h.msg(tabId, { type: "tf:translate", mode: "bilingual" });
  assert.equal(st.mode, "bilingual");
  assert.match(await reader(page).locator("#body").innerText(), /^Content providers/);
  assert.ok(await reader(page).locator(".tf-trans").count() > 5);
  assert.equal(await h.sw.evaluate(() => docsFixture.calls.length), calls);
  console.log("✓ bilingual mode reuses the body with paragraph translations styled inside the reader");

  await h.msg(tabId, { type: "tf:restore" });
  assert.equal(await reader(page).count(), 0);
  assert.equal(await originalUi(page), before);
  assert.equal(await page.locator("body").evaluate((el) => el.inert), false);
  assert.equal(await page.evaluate(() => document.activeElement === document.querySelector("nav button")), true);
  console.log("✓ restore removes the reader and returns the original editor and focus");

  await h.msg(tabId, { type: "tf:toggle" });
  await reader(page).getByRole("button", { name: "編集画面に戻る" }).click();
  assert.equal((await h.msg(tabId, { type: "tf:state" })).status, "idle");
  await h.msg(tabId, { type: "tf:toggle" });
  await page.keyboard.press("Escape");
  assert.equal(await reader(page).count(), 0);
  console.log("✓ toggle, reader close button and Escape all restore the editor");

  for (const failure of ["deny", "login"]) {
    await h.sw.evaluate((name) => { docsFixture[name] = true; }, failure);
    const count = stats.requests.length;
    st = await h.msg(tabId, { type: "tf:translate" });
    assert.equal(st.status, "idle");
    assert.match(st.error, /閲覧権限/);
    assert.equal(await reader(page).count(), 0);
    assert.equal(await originalUi(page), before);
    assert.equal(stats.requests.length, count);
    await h.sw.evaluate((name) => { docsFixture[name] = false; }, failure);
  }
  console.log("✓ denied downloads and login pages leave the editor usable and do not call the translation API");

  await h.sw.evaluate(() => { docsFixture.delay = 1000; });
  const pending = h.msg(tabId, { type: "tf:translate" });
  await page.waitForFunction(() => document.getElementById("tf-host")?.shadowRoot?.textContent.includes("本文を取得中"));
  await h.msg(tabId, { type: "tf:cancel" });
  await pending;
  assert.equal((await h.msg(tabId, { type: "tf:state" })).status, "idle");
  assert.equal((await h.msg(tabId, { type: "tf:state" })).error, null);
  assert.equal(await reader(page).count(), 0);
  console.log("✓ cancellation while loading does not open a reader or leave a running state");

  const stale = h.msg(tabId, { type: "tf:translate" });
  await page.waitForFunction(() => document.getElementById("tf-host")?.shadowRoot?.textContent.includes("本文を取得中"));
  await page.evaluate(() => history.pushState({}, "", "?tab=t.2"));
  st = await stale;
  assert.equal(st.status, "idle");
  assert.match(st.error, /切り替わりました/);
  assert.equal(await reader(page).count(), 0);
  await h.sw.evaluate(() => { docsFixture.delay = 0; });
  st = await h.msg(tabId, { type: "tf:translate" });
  assert.equal(st.status, "translated");
  assert.ok((await h.sw.evaluate(() => docsFixture.calls.at(-1))).endsWith("tab=t.2"));
  await page.evaluate(() => history.pushState({}, "", "?tab=t.3"));
  await reader(page).waitFor({ state: "detached" });
  assert.equal((await h.msg(tabId, { type: "tf:state" })).status, "idle");
  console.log("✓ tab changes during and after loading close stale content, and the selected tab is exported");

  // 明示した公開文書だけを、実際の Google HTML 書き出し経由で任意に確認する。
  if (process.env.GOOGLE_DOCS_LIVE_URL) {
    // モックを入れていない新しいコンテキストで取得する。
    const live = await launch({ prefix: "tf-google-docs-live-" });
    try {
      await live.setSettings(await h.sw.evaluate(async () => (await chrome.storage.local.get("settings")).settings));
      const doc = await live.open(process.env.GOOGLE_DOCS_LIVE_URL);
      const result = await live.msg(doc.tabId, { type: "tf:translate", mode: "bilingual" });
      assert.equal(result.status, "translated", JSON.stringify(result));
      assert.equal(result.error, null, JSON.stringify(result));
      assert.ok(result.progress.total > 10);
      await doc.page.screenshot({ path: "/tmp/yomeru-google-docs-live.png" });
      console.log(`✓ live Google Docs export and mock translation completed (${result.progress.total} paragraphs)`);
    } finally { await live.close(); }
  }
} finally {
  await h.close();
  await new Promise((resolve) => server.close(resolve));
  clearTimeout(watchdog);
}
