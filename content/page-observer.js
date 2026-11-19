// 通常ページの DOM と開いた Shadow DOM を監視する。
(() => {
  if (globalThis.TFPageObserver) return;
  const Exclusions = globalThis.TFExclusions;
  const RESCAN_DELAY_MS = 700;
  const isOurs = (node) => node.nodeType === 1 && node.hasAttribute("data-tf");

  function create({ page, isTranslated, hideAds, rescan }) {
    let observer = null;
    let observedRoots = new WeakSet();
    let timer = null;

    function mutate(callback) {
      try { return callback(); } finally { observer?.takeRecords(); }
    }

    function needsRescan(mutation) {
      const { target, type, addedNodes } = mutation;
      const parent = target.nodeType === 1 ? target : target.parentElement;
      if (parent?.closest("[data-tf]") || Exclusions?.isWithinAd(parent)) return false;
      if (location.hostname === "www.youtube.com" && parent?.closest("#movie_player, ytd-transcript-renderer, ytd-transcript-segment-list-renderer, transcript-segment-view-model")) return false;
      if (type === "characterData") {
        if (!page.isDone(target)) return true;
        const translated = page.translatedValue(target);
        if (translated == null || target.data === translated) return false;
        // ページ側が原文を書き戻した。
        page.forget(target);
        return true;
      }
      if (type !== "childList") return true;
      return Array.from(addedNodes).some((node) => !page.isDone(node) && !isOurs(node));
    }

    function observe(root) {
      if (observedRoots.has(root)) return;
      observer.observe(root, {
        childList: true, subtree: true, characterData: true,
        attributes: true, attributeFilter: ["open", "hidden", "class", "style", "id", "data-ad-slot", "data-ad-client", "data-ad-unit", "data-google-query-id", "aria-label"],
      });
      observedRoots.add(root);
    }

    function observeShadowRoots(root) {
      if (isOurs(root)) return;
      if (root.shadowRoot) {
        observe(root.shadowRoot);
        observeShadowRoots(root.shadowRoot);
      }
      for (const child of root.children || []) observeShadowRoots(child);
    }

    function start() {
      if (observer) return;
      observer = new MutationObserver((mutations) => {
        if (!isTranslated()) return;
        const changedRoots = new Set();
        for (const { type, target, addedNodes } of mutations) {
          for (const node of addedNodes) observeShadowRoots(node);
          if (type !== "characterData") changedRoots.add(target);
        }
        // 後から配信された広告も、追い翻訳の上限とは別に隠す。
        for (const root of changedRoots) {
          const element = root.nodeType === 1 ? root : root.host;
          if (element && !element.closest("[data-tf]")) hideAds(root);
        }
        if (!mutations.some(needsRescan)) return;
        clearTimeout(timer);
        timer = setTimeout(rescan, RESCAN_DELAY_MS);
      });
      observe(document.documentElement);
      observeShadowRoots(document.body);
    }

    function stop() {
      observer?.disconnect();
      observer = null;
      observedRoots = new WeakSet();
      clearTimeout(timer);
      timer = null;
    }

    return { start, stop, mutate };
  }

  globalThis.TFPageObserver = { create };
})();
