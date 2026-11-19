// 通常ページと Google Docs の本文翻訳を、準備から復元まで管理する。
(() => {
  if (globalThis.TFPageTranslation) return;
  const { TFSeg: Seg, TFPage: Page, TFPageObserver: PageObserver, TFGoogleDocs: GoogleDocs, TFExclusions: Exclusions } = globalThis;
  if (!Seg || !Page || !PageObserver || !GoogleDocs) return;

  const MAX_INCREMENTAL_RUNS = 60;
  const RETRY_LIMIT = 40;

  function create({ send, loadSettings, getSettings, requestTranslation, getUi, peekUi, usage, addUsage, costText, newSessionId, errorMessage, keepAliveMs }) {
    const state = {
      status: "idle", // idle | running | translated
      mode: "replace",
      progress: { done: 0, total: 0 },
      error: null,
    };
    let activeJob = null;
    let incrementalRuns = 0;

    const page = Page.create({ getMode: () => state.mode, mutate: (callback) => observer.mutate(callback) });
    const observer = PageObserver.create({ page, isTranslated: () => state.status === "translated", hideAds, rescan });
    const docsReader = GoogleDocs.create({ onClose: restore });
    const hasPageChanges = () => page.hasChanges() || docsReader.active || !!Exclusions?.hasHiddenAds();

    function hideAds(root = document.body) {
      if (!GoogleDocs.current()) observer.mutate(() => Exclusions?.hideAds(root));
    }

    function collectUnits(settings) {
      const root = GoogleDocs.current() ? docsReader.content : document.body;
      return root ? page.collectUnits(root, { targetLang: settings.targetLang, skipNav: settings.skipNav }) : [];
    }

    async function run(work) {
      if (activeJob) return;
      const job = { sessionId: null, keepAlive: null, cancelled: false };
      const current = () => activeJob === job && !job.cancelled;
      activeJob = job;
      try {
        await work(job, current);
      } catch (error) {
        if (!current()) return;
        cancelJob(job);
        state.error = errorMessage(error);
        state.status = hasPageChanges() ? "translated" : "idle";
        getUi().showBadge(state.error, "error", 8000);
      } finally {
        if (activeJob === job) {
          clearInterval(job.keepAlive);
          page.releasePending();
          activeJob = null;
        }
      }
    }

    function beginRequest(job, total) {
      if (!job.sessionId) {
        job.sessionId = newSessionId();
        job.keepAlive = setInterval(() => { send({ type: "tf:keepalive" }).catch(() => {}); }, keepAliveMs);
      }
      state.status = "running";
      state.progress = { done: 0, total };
    }

    async function openGoogleDoc(doc, job, current) {
      beginRequest(job, 0);
      getUi().showBadge("Googleドキュメントの本文を取得中…", "info", 0);
      try {
        const r = await send({ type: "getGoogleDoc", documentUrl: doc.url.href, sessionId: job.sessionId });
        if (!current()) return false;
        if (!r?.ok) throw new Error(r?.error || "本文を取得できませんでした。");
        if (r.key !== doc.key) throw new Error(globalThis.TFGoogleDocsLocation.CHANGED_ERROR);
        docsReader.show(r.html, doc.key);
        return true;
      } finally {
        if (activeJob === job) {
          state.status = docsReader.active ? "translated" : "idle";
          if (job.cancelled) getUi().showBadge("中止しました", "info", 2000);
        }
      }
    }

    function translate({ mode } = {}) {
      return run(async (job, current) => {
        state.error = null;
        const settings = await loadSettings();
        if (!current()) return;
        if (!settings.hasKey) {
          const provider = settings.models?.find((model) => model.id === settings.model)?.provider;
          getUi().showBadge(`${provider === "openai" ? "OpenAI" : "Anthropic"} APIキーが未設定です。拡張の設定画面で登録してください`, "error", 5000);
          return;
        }

        const nextMode = mode || settings.displayMode || "replace";
        if (state.status === "translated" && state.mode !== nextMode) resetView({ keepReader: true });
        state.mode = nextMode;
        const doc = GoogleDocs.current();
        if (doc && !docsReader.active && !await openGoogleDoc(doc, job, current)) return;
        if (!current()) return;
        hideAds();
        const units = collectUnits(settings);
        if (units.length) {
          await runUnits(units, settings, job, current);
        } else if (docsReader.active) {
          state.status = "translated";
          getUi().showBadge("本文を開きました。翻訳が必要な文は見つかりませんでした", "info", 3500);
        } else if (Exclusions?.hasHiddenAds()) {
          state.status = "translated";
          observer.start();
          getUi().showBadge("広告を非表示にしました。「原文に戻す」で復元できます", "done", 3500);
        } else if (state.status !== "translated") {
          getUi().showBadge("翻訳する文が見つかりません", "info", 2500);
        }
      });
    }

    function rescan() {
      if (state.status !== "translated" || incrementalRuns >= MAX_INCREMENTAL_RUNS) return;
      return run(async (job, current) => {
        const settings = getSettings() || (await loadSettings().catch(() => null));
        if (!settings || !current()) return;
        const units = collectUnits(settings);
        if (!units.length) return;
        incrementalRuns++;
        await runUnits(units, settings, job, current, { quiet: true });
      });
    }

    async function runUnits(units, settings, job, current, { quiet = false } = {}) {
      const wasTranslated = state.status === "translated";
      state.error = null;
      Seg.sortByViewport(units);
      page.begin(units);
      const batches = Seg.makeBatches(units, settings.batchChars || 2500);
      const concurrency = settings.concurrency || 4;
      beginRequest(job, units.length);
      const showProgress = () => { if (!quiet) getUi().showProgress(state.progress.done, state.progress.total); };
      showProgress();

      let fatal = null;
      const retry = [];
      const canContinue = () => current() && !fatal;
      const noteFailure = (r) => {
        if (r.fatal) fatal = r.error;
        else state.error = r.error;
      };

      await pool(batches, concurrency, canContinue, async (batch) => {
        const r = await requestTranslation(batch.map(({ id, text }) => ({ id, text })), job.sessionId);
        if (!canContinue()) return;
        if (!r.ok) {
          noteFailure(r);
          retry.push(...batch);
        } else {
          addUsage(r);
          for (const unit of batch) {
            const text = r.results?.[unit.id];
            if (text == null || !page.applyTranslation(unit, text, { allowLoose: false })) retry.push(unit);
          }
        }
        state.progress.done += batch.length;
        showProgress();
      });

      // 欠落・失敗した訳文だけをキャッシュなしで再試行する。
      await pool(retry.slice(0, RETRY_LIMIT), Math.min(4, concurrency), canContinue, async (unit) => {
        const r = await requestTranslation([{ id: unit.id, text: unit.text }], job.sessionId, true);
        if (!canContinue()) return;
        if (!r.ok) { noteFailure(r); return; }
        addUsage(r);
        const text = r.results?.[unit.id];
        if (text != null) page.applyTranslation(unit, text, { allowLoose: true });
      });
      if (activeJob === job) finishRun({ fatal, cancelled: job.cancelled, wasTranslated, quiet });
    }

    function finishRun({ fatal, cancelled, wasTranslated, quiet }) {
      hideAds();
      if (fatal) {
        state.error = fatal;
        state.status = hasPageChanges() ? "translated" : "idle";
        getUi().showBadge(fatal, "error", 8000);
      } else if (cancelled && !wasTranslated && !hasPageChanges()) {
        state.status = "idle";
        getUi().showBadge("中止しました", "info", 2000);
      } else {
        state.status = "translated";
        if (!quiet) {
          const cached = usage.cached ? ` · キャッシュ ${usage.cached}` : "";
          if (state.error) getUi().showBadge(`一部失敗: ${state.error}`, "error", 8000);
          else getUi().showBadge(`翻訳完了 · ${costText(usage.costUsd)}${cached}`, "done", 3500);
        }
      }
      if (state.status === "translated" && !docsReader.active) observer.start();
    }

    function cancelJob(job) {
      if (!job || job.cancelled) return;
      job.cancelled = true;
      if (job.sessionId) send({ type: "cancel", sessionId: job.sessionId }).catch(() => {});
    }

    function resetView({ keepReader = false } = {}) {
      observer.stop();
      page.restore();
      if (!keepReader) docsReader.close();
      Exclusions?.restoreAds();
      state.status = "idle";
      state.progress = { done: 0, total: 0 };
      state.error = null;
      incrementalRuns = 0;
      peekUi()?.hideBadge();
    }

    function restore() {
      if (activeJob) {
        cancelJob(activeJob);
        clearInterval(activeJob.keepAlive);
        activeJob = null;
      }
      resetView();
    }

    return {
      translate,
      restore,
      cancel: () => { if (state.status === "running") cancelJob(activeJob); },
      get status() { return state.status; },
      getState: () => ({ ...state, pageKind: GoogleDocs.current() ? "google-docs" : "page" }),
    };
  }

  function pool(items, concurrency, canContinue, worker) {
    let next = 0;
    const count = Math.min(concurrency, items.length);
    return Promise.all(Array.from({ length: count }, async () => {
      while (next < items.length && canContinue()) await worker(items[next++]);
    }));
  }

  globalThis.TFPageTranslation = { create };
})();
