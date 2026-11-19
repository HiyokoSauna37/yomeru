// Service worker と classic content script の両方で同じ文書 URL を認識する。
(() => {
  if (globalThis.TFGoogleDocsLocation) return;
  const ORIGIN = "https://docs.google.com";
  const CHANGED_ERROR = "文書またはタブが切り替わりました。もう一度翻訳してください。";

  function parse(value) {
    let url;
    try { url = new URL(value); } catch { return null; }
    if (url.origin !== ORIGIN) return null;
    const match = url.pathname.match(/^\/document\/(?:u\/(\d+)\/)?d\/([\w-]+)\/(?:edit|view|preview|mobilebasic)?\/?$/);
    if (!match) return null;
    const [, account, documentId] = match;
    const tab = url.searchParams.get("tab") || new URLSearchParams(url.hash.slice(1)).get("tab") || "t.0";
    return { url, account, documentId, tab, key: `${documentId}:${tab}` };
  }

  globalThis.TFGoogleDocsLocation = { ORIGIN, CHANGED_ERROR, parse };
})();
