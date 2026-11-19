// Canvas の編集画面を変更せず、書き出した本文だけを閲覧・翻訳する。
(() => {
  if (globalThis.TFGoogleDocs) return;

  function current() {
    if (location.origin !== "https://docs.google.com") return null;
    const match = location.pathname.match(/^\/document\/(?:u\/\d+\/)?d\/([\w-]+)\/(?:edit|view|preview|mobilebasic)?\/?$/);
    if (!match) return null;
    const tab = new URLSearchParams(location.search).get("tab") || new URLSearchParams(location.hash.slice(1)).get("tab") || "t.0";
    return { key: `${match[1]}:${tab}`, url: location.href };
  }

  const ALLOWED = new Set("P DIV SECTION ARTICLE H1 H2 H3 H4 H5 H6 UL OL LI DL DT DD TABLE THEAD TBODY TFOOT TR TH TD CAPTION COLGROUP COL BLOCKQUOTE PRE CODE KBD SAMP VAR SPAN A B STRONG I EM U S DEL SUB SUP BR HR SMALL ABBR Q CITE FIGURE FIGCAPTION".split(" "));
  const DROP = new Set("SCRIPT STYLE NOSCRIPT TEMPLATE IFRAME OBJECT EMBED FORM INPUT BUTTON SELECT TEXTAREA SVG MATH LINK META BASE".split(" "));

  // 元の CSS / イベント / 任意の属性は取り込まず、文書の構造だけを再構築する。
  function articleFromHtml(html) {
    const parsed = new DOMParser().parseFromString(html, "text/html");
    const article = document.createElement("article");
    article.id = "tf-docs-content";
    let count = 0;
    function copy(node, parent, depth) {
      if (++count > 40000 || depth > 80) throw new Error("文書の構造が大きすぎます。短い文書でお試しください。");
      if (node.nodeType === 3) { parent.append(document.createTextNode(node.data)); return; }
      if (node.nodeType !== 1 || DROP.has(node.tagName)) return;
      // エクスポートの画像は本文翻訳の対象外。代替テキストがあれば残す。
      if (node.tagName === "IMG") {
        if (node.alt) parent.append(document.createTextNode(`[${node.alt}]`));
        return;
      }
      const el = ALLOWED.has(node.tagName) ? document.createElement(node.localName) : document.createElement("span");
      if (/^[\w.-]{1,150}$/.test(node.id)) el.id = node.id;
      if (node.tagName === "A") {
        try {
          let href = node.getAttribute("href") || "";
          let url = new URL(href, location.href);
          if (url.origin === "https://www.google.com" && url.pathname === "/url") {
            href = url.searchParams.get("q") || href;
            url = new URL(href, location.href);
          }
          if (/^(https?:|mailto:)$/.test(url.protocol)) {
            el.setAttribute("href", href.startsWith("#") ? href : url.href);
            if (!href.startsWith("#")) { el.target = "_blank"; el.rel = "noopener noreferrer"; }
          }
        } catch { /* 不正なリンクは文字だけ残す */ }
      }
      for (const attr of ["colspan", "rowspan", "start", "value"]) {
        const value = node.getAttribute(attr);
        if (value && /^\d{1,4}$/.test(value)) el.setAttribute(attr, value);
      }
      for (const child of node.childNodes) copy(child, el, depth + 1);
      parent.append(el);
    }
    for (const child of parsed.body.childNodes) copy(child, article, 0);
    if (!article.textContent.trim()) throw new Error("文書の本文が空か、テキストを取得できませんでした。");
    return article;
  }

  const CSS = `
    :host { all:initial; color-scheme:light; }
    * { box-sizing:border-box; }
    .reader { position:fixed; inset:0; display:flex; flex-direction:column; background:#faf7f2; color:#302e2b; font:16px/1.9 "Yomeru Rounded",system-ui,sans-serif; }
    header { display:flex; flex-wrap:wrap; align-items:center; gap:8px 24px; padding:14px 28px; background:#fffdf9; border-bottom:1px solid #e6ddd1; }
    .title { flex:1; min-width:180px; font-size:14px; font-weight:700; }
    .note { font-size:12px; color:#776b60; }
    button { cursor:pointer; padding:8px 16px; border:1px solid #d9cbbd; border-radius:10px; background:#fff; color:#574337; font:inherit; font-size:13px; }
    button:focus-visible,a:focus-visible { outline:2px solid #c46b48; outline-offset:3px; }
    .scroll { flex:1; min-height:0; overflow:auto; overscroll-behavior:contain; padding:36px 24px 100px; }
    article { max-width:880px; margin:auto; padding:40px 48px; border:1px solid #ede5db; border-radius:16px; background:#fffdf9; overflow-wrap:anywhere; }
    h1,h2,h3,h4,h5,h6 { line-height:1.5; margin:1.5em 0 .65em; }
    h1 { font-size:1.65em; } h2 { font-size:1.35em; } h3 { font-size:1.15em; }
    p { margin:.7em 0; } a { color:#ac593a; } ul,ol { padding-left:1.8em; }
    table { width:100%; border-collapse:collapse; margin:1em 0; } th,td { padding:10px; border:1px solid #ddd2c6; vertical-align:top; }
    pre,code,kbd,samp { font-family:ui-monospace,monospace; background:#f0eae2; } pre { padding:16px; overflow:auto; }
    blockquote { margin:1em 0; padding-left:1em; border-left:3px solid #d9cbbd; }
    .tf-trans-block { margin:.35em 0 .15em; padding-left:.65em; border-left:3px solid #d977578c; }
    span.tf-trans::before { content:" ⟶ "; color:#d97757; }
    [data-tf-loose] { text-decoration:underline dotted #a8761f; }
    @media(max-width:600px) { header { padding:12px 16px; } .scroll { padding:16px 12px 80px; } article { padding:20px; } }
  `;

  function create({ onClose }) {
    let host = null;
    let content = null;
    let key = null;
    let timer = null;
    let previousFocus = null;
    let bodyWasInert = false;

    function close() {
      if (!host) return;
      clearInterval(timer);
      host.remove();
      host = content = key = timer = null;
      document.body.inert = bodyWasInert;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
      previousFocus = null;
    }

    function show(html, expectedKey) {
      const article = articleFromHtml(html);
      if (current()?.key !== expectedKey) throw new Error("文書またはタブが切り替わりました。もう一度翻訳してください。");
      close();
      host = document.createElement("div");
      host.id = "tf-docs-reader";
      host.setAttribute("data-tf", "ui");
      host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483646;";
      const shadow = host.attachShadow({ mode: "open" });
      const style = document.createElement("style");
      style.textContent = CSS;
      const reader = document.createElement("section");
      reader.className = "reader";
      reader.setAttribute("role", "dialog");
      reader.setAttribute("aria-modal", "true");
      reader.setAttribute("aria-label", "Yomeru Googleドキュメント翻訳");
      const header = document.createElement("header");
      const title = document.createElement("span");
      title.className = "title";
      title.textContent = `Yomeru · ${document.title.replace(/\s*[-–—]\s*Google (Docs|ドキュメント)$/, "")}`;
      const note = document.createElement("span");
      note.className = "note";
      note.textContent = "閲覧用の翻訳です。元の文書は変更されません。";
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "編集画面に戻る";
      button.addEventListener("click", onClose);
      header.append(title, note, button);
      const scroll = document.createElement("div");
      scroll.className = "scroll";
      scroll.tabIndex = 0;
      scroll.append(article);
      reader.append(header, scroll);
      shadow.append(style, reader);
      shadow.addEventListener("click", (event) => {
        const href = event.target.closest("a")?.getAttribute("href");
        if (href?.startsWith("#")) {
          event.preventDefault();
          try { shadow.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView(); } catch { /* 不正な fragment */ }
        }
      });
      shadow.addEventListener("keydown", (event) => {
        if (event.key === "Escape") { event.preventDefault(); onClose(); }
        // 編集画面のキーボード操作を起動しない。
        event.stopPropagation();
      });
      previousFocus = document.activeElement;
      bodyWasInert = document.body.inert;
      document.body.inert = true;
      document.documentElement.append(host);
      content = article;
      key = expectedKey;
      // Docs 内の文書タブが切り替わった場合、古い本文の翻訳画面を閉じる。
      timer = setInterval(() => { if (current()?.key !== key) onClose(); }, 500);
      button.focus({ preventScroll: true });
      const heading = new URLSearchParams(location.hash.slice(1)).get("heading");
      if (heading) shadow.getElementById(heading)?.scrollIntoView();
    }

    return { show, close, get content() { return content; }, get active() { return !!host?.isConnected; } };
  }

  globalThis.TFGoogleDocs = { current, create };
})();
