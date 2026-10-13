// Issue #3802 (Wave 1) — the Hosts and Creators boards (#/hosts, #/creators).
//
// One page, two pipelines. Everything it shows comes from the crm_* server
// functions through the hooks below; this file never talks to the database
// itself. The view, the filters and the open card live in the address, so a
// reload or a pasted link shows exactly the same thing.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { AlertCard } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Drawer } from "../components/ui/Drawer";
import { Skeleton } from "../components/ui/Skeleton";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useHashQuery } from "../hooks/useHashQuery";
import { useCrmConfig } from "../hooks/useCrmConfig";
import { useCrmPipeline, useOnline } from "../hooks/useCrmPipeline";
import { canOpenPage } from "../lib/access";
import {
  NO_REGION,
  errorWords,
  filterRecords,
  freshnessVerdict,
  hasActiveFilters,
  loadErrorWords,
  localToday,
  moveBlocker,
  regionBySlug,
  regionSlug,
  shouldHoldCard,
  stageDef,
  stageLabel,
} from "../lib/crmModel";
import { NEW_CARD, buildCrmSearch, cleanCrmState, parseCrmSearch, sameCrmState } from "../lib/crmUrl";
import { PipelineToolbar } from "../components/crm/PipelineToolbar";
import { PipelineBoard, PipelineBoardSkeleton } from "../components/crm/PipelineBoard";
import { PipelineList } from "../components/crm/PipelineList";
import { PipelineByRegion } from "../components/crm/PipelineByRegion";
import { RecordDrawer } from "../components/crm/RecordDrawer";
import { AddRecordForm } from "../components/crm/AddRecordForm";
import { ReasonPrompt } from "../components/crm/ReasonPrompt";

const UNDO_MS = 8000;
const BLOCK_TITLES = {
  stage_sets_itself: "Live sets itself",
  stage_is_live: "This host stays in Live",
  agreement_required: "The agreement isn't signed yet",
};
const OFFLINE_WORDS = "You're offline. You can look around, but changes won't save until you're back.";

function PipelinePage({ pipeline, onTabChange }) {
  const { access } = useAuth();
  const { addToast, removeToast } = useToast();
  const online = useOnline();
  const [search, setSearch] = useHashQuery(pipeline);
  const state = useMemo(() => parseCrmSearch(search), [search]);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const cfg = useCrmConfig();
  const config = cfg.config;
  const def = config?.pipelines?.[pipeline] || null;
  // The card whose edits have not all reached the server yet ("" = none), and
  // the Lost/Passed question that is open. Both pause the quiet refresh.
  const [dirtyCard, setDirtyCard] = useState("");
  const [reasonFor, setReasonFor] = useState(null); // { record, to }
  const [reasonBusy, setReasonBusy] = useState(false);
  const [reasonError, setReasonError] = useState("");
  const pipe = useCrmPipeline(pipeline, { enabled: !!def, paused: !!dirtyCard || !!reasonFor });
  const handleDirtyChange = useCallback((id, dirty) => {
    setDirtyCard((prev) => (dirty ? id : prev === id ? "" : prev));
  }, []);
  // What the open card can be asked before it is let go (RecordDrawer fills it).
  const guardRef = useRef(null);
  const addButtonRef = useRef(null);
  const me = config?.me?.email || "";
  const canDelete = !!config?.me?.can_delete;
  const today = localToday();
  // Dragging needs a mouse or trackpad; touch screens use the arrow and the
  // stage menu instead (native drag does not fire on touch).
  const canDrag = useMemo(
    () => typeof window !== "undefined" && !!window.matchMedia?.("(hover: hover) and (pointer: fine)").matches,
    []
  );

  const title = pipeline === "creators" ? "Creators" : "Hosts";
  const singular = pipeline === "creators" ? "creator" : "host";

  const patch = useCallback(
    (changes, { replace = false } = {}) => {
      setSearch(buildCrmSearch({ ...stateRef.current, ...changes }), { replace });
    },
    [setSearch]
  );

  // A filter in the address that names nothing real is dropped quietly.
  useEffect(() => {
    if (!def || !config) return;
    const clean = cleanCrmState(state, {
      icpIds: def.icps.map((i) => i.id),
      regionSlugs: [...config.regions.map((r) => regionSlug(r.name)), NO_REGION],
    });
    if (!sameCrmState(clean, state)) setSearch(buildCrmSearch(clean), { replace: true });
  }, [def, config, state, setSearch]);

  const regionId = useMemo(() => {
    if (!state.region) return "";
    if (state.region === NO_REGION) return NO_REGION;
    return regionBySlug(config?.regions, state.region)?.id || "";
  }, [state.region, config]);

  const filtered = useMemo(
    () => filterRecords(pipe.records, { q: state.q, icp: state.icp, regionId, mine: state.mine, me }),
    [pipe.records, state.q, state.icp, regionId, state.mine, me]
  );
  const filtersOn = hasActiveFilters(state);

  // ── Open card ───────────────────────────────────────────────────────────
  const [focus, setFocus] = useState(null); // { id, field }
  const [activityTick, setActivityTick] = useState(0);
  // True while the open card has its own history entry (it was opened by a
  // click on this page). Closing then goes BACK to the entry before it, so the
  // Back button never reopens a card that was closed with X.
  const cardEntryPushed = useRef(false);
  const openCard = useCallback(
    (id, { field = null, replace = false } = {}) => {
      setFocus(field ? { id, field } : null);
      if (!replace && !stateRef.current.card) cardEntryPushed.current = true;
      patch({ card: id }, { replace });
    },
    [patch]
  );
  const closeCard = useCallback(() => {
    setFocus(null);
    if (!stateRef.current.card) return;
    if (cardEntryPushed.current) {
      cardEntryPushed.current = false;
      window.history.back();
    } else {
      patch({ card: "" }, { replace: true });
    }
  }, [patch]);
  useEffect(() => {
    if (!state.card) cardEntryPushed.current = false;
  }, [state.card]);
  const openRecord = useCallback((record) => openCard(record.id), [openCard]);

  // ── Moving a card ───────────────────────────────────────────────────────
  // The Undo toast for the last move. It is taken away as soon as something
  // else is logged on that card, because the server would then refuse the undo.
  const undoToast = useRef(null);
  const clearUndoToast = useCallback(
    (recordId) => {
      const live = undoToast.current;
      if (live && (!recordId || live.recordId === recordId)) {
        removeToast(live.toastId);
        undoToast.current = null;
      }
    },
    [removeToast]
  );

  // Where a failed move reports to. Normally a toast; while the Lost/Passed
  // question is open it reports there instead, so the typed reason is kept.
  const moveErrorSink = useRef(null);

  const undoMove = useCallback(
    async (activityId) => {
      undoToast.current = null;
      try {
        await pipe.undoMove(activityId);
        setActivityTick((n) => n + 1);
        addToast({ variant: "success", title: "Move undone" });
      } catch (err) {
        addToast({ variant: "error", title: "Couldn't undo that move", description: errorWords(err) });
      }
    },
    [pipe, addToast]
  );

  const performMove = useCallback(
    async (record, to, reason = null) => {
      clearUndoToast(record.id);
      try {
        const res = await pipe.moveStage(record, to, reason);
        setActivityTick((n) => n + 1);
        // The server says the card was already there: someone made the same
        // move at the same moment. Say so, so this press is not silent.
        if (!res.changed) {
          addToast({
            variant: "info",
            title: `${record.name} is already in ${stageLabel(def, to)}`,
            description: "Someone else made the same move first. Nothing else was changed.",
          });
        }
        if (!res.changed) return true;
        const toastId = addToast({
          variant: "success",
          title: `${record.name} moved to ${stageLabel(def, to)}`,
          duration: UNDO_MS,
          action: res.activity_id ? { label: "Undo", onClick: () => undoMove(res.activity_id) } : undefined,
        });
        undoToast.current = { toastId, recordId: record.id };
        return true;
      } catch (err) {
        if (err?.token === "not_found") pipe.dropRecord(record.id);
        if (moveErrorSink.current && err?.token !== "not_found") {
          moveErrorSink.current(errorWords(err));
          return false;
        }
        addToast({ variant: "error", title: `${record.name} didn't move`, description: errorWords(err) });
        if (err?.token === "agreement_required") openCard(record.id, { field: "agreement" });
        return false;
      }
    },
    [pipe, def, addToast, clearUndoToast, undoMove, openCard]
  );

  const requestMove = useCallback(
    async (shown, to) => {
      if (!def || !shown || shown.stage === to) return;
      if (!online) {
        addToast({ variant: "warning", title: "You're offline", description: "The card stays where it is. Try again once you're back." });
        return;
      }
      // The board may be old: ask the server where the card is NOW before
      // moving it, so a card a colleague already moved is never moved again
      // from where it used to be. (The server's move function has no "only if
      // it is still in stage X" option, so this check is made here.)
      pipe.setBusy(shown.id, true);
      let fresh;
      try {
        fresh = await pipe.checkFresh(shown.id);
      } catch (err) {
        if (err?.token === "not_found") {
          pipe.dropRecord(shown.id);
          addToast({ variant: "warning", title: `${shown.name} is no longer here`, description: "It was deleted. The board is up to date now." });
        } else {
          addToast({ variant: "error", title: `${shown.name} didn't move`, description: loadErrorWords(err) });
        }
        return;
      } finally {
        pipe.setBusy(shown.id, false);
      }
      const record = fresh.record;
      pipe.applyRecord(record);
      const verdict = freshnessVerdict(def, shown, record, to, fresh.activity);
      if (verdict.kind !== "go") {
        setActivityTick((n) => n + 1);
        addToast({ variant: verdict.kind === "already" ? "info" : "warning", title: verdict.title, description: verdict.description });
        return;
      }
      const block = moveBlocker(def, record, to);
      if (block) {
        if (block.token === "same") return;
        addToast({ variant: "warning", title: BLOCK_TITLES[block.token] || "That move isn't possible", description: block.message });
        // Show the person the field that unblocks the move.
        if (block.token === "agreement_required") openCard(record.id, { field: "agreement" });
        return;
      }
      if (stageDef(def, to)?.terminal) {
        // Lost and Passed need a reason: ask BEFORE anything moves.
        setReasonError("");
        setReasonFor({ record, to });
        return;
      }
      performMove(record, to);
    },
    [def, online, pipe, addToast, openCard, performMove]
  );

  // A failed move to Lost or Passed keeps the question open, with the reason
  // that was typed and the reason it failed.
  const confirmReason = async (reason) => {
    if (!reasonFor) return;
    setReasonBusy(true);
    setReasonError("");
    let failure = "";
    moveErrorSink.current = (words) => {
      failure = words;
    };
    const ok = await performMove(reasonFor.record, reasonFor.to, reason);
    moveErrorSink.current = null;
    setReasonBusy(false);
    if (ok || !failure) setReasonFor(null);
    else setReasonError(failure);
  };

  // ── Add, delete ─────────────────────────────────────────────────────────
  const handleDelete = useCallback(
    async (record) => {
      clearUndoToast(record.id);
      try {
        await pipe.remove(record.id);
      } catch (err) {
        addToast({ variant: "error", title: `${record.name} wasn't deleted`, description: errorWords(err) });
        return false;
      }
      if (stateRef.current.card === record.id) {
        // Nothing typed on a deleted card is worth keeping it open for.
        if (guardRef.current?.id === record.id) guardRef.current.discard();
        closeCard();
        // The card that had focus is gone: put focus somewhere real.
        setTimeout(() => addButtonRef.current?.focus(), 120);
      }
      addToast({
        variant: "success",
        title: `${record.name} deleted`,
        duration: UNDO_MS,
        action: {
          label: "Undo",
          onClick: async () => {
            try {
              await pipe.restore(record.id);
              addToast({ variant: "success", title: `${record.name} is back` });
            } catch (err) {
              addToast({ variant: "error", title: `Couldn't bring ${record.name} back`, description: errorWords(err) });
            }
          },
        },
      });
      return true;
    },
    [pipe, addToast, clearUndoToast, closeCard]
  );

  const handleCreate = useCallback(
    async (fields, requestKey) => {
      let res;
      try {
        res = await pipe.create(fields, requestKey);
      } catch (err) {
        return { message: errorWords(err) };
      }
      if (res?.status === "duplicate") return { duplicate: res.existing };
      const record = res.record;
      openCard(record.id, { replace: true });
      addToast({
        variant: "success",
        title: `${record.name} added to ${stageLabel(def, record.stage)}`,
        duration: UNDO_MS,
        // Undoing an add is a delete, which only an owner or admin may do.
        action: canDelete
          ? { label: "Undo", onClick: () => handleDelete(record) }
          : { label: "Open", onClick: () => openCard(record.id) },
      });
      return { ok: true };
    },
    [pipe, def, canDelete, addToast, openCard, handleDelete]
  );

  // The drawer's writes: a logged entry or a brand link adds to the card's
  // history, after which the last move can no longer be undone.
  const drawerPipe = useMemo(
    () => ({
      ...pipe,
      log: async (id, ...rest) => {
        clearUndoToast(id);
        return pipe.log(id, ...rest);
      },
      update: async (id, changes) => {
        if (changes && Object.hasOwn(changes, "brand_id")) clearUndoToast(id);
        return pipe.update(id, changes);
      },
    }),
    [pipe, clearUndoToast]
  );

  // ── Screen ──────────────────────────────────────────────────────────────
  const loadError = cfg.error || pipe.error;
  const loading = !loadError && (cfg.loading || pipe.loading);
  const ready = !loading && !loadError && !!def;
  // The card on screen. Normally the one the address names; but a card whose
  // edits are not all saved is HELD on screen when the address lets go of it
  // (Close, Escape, Back), its edits are sent, and it only then closes. If
  // they cannot be sent it stays open and says so.
  const urlCard = state.card && state.card !== NEW_CARD ? state.card : "";
  const [shownCard, setShownCard] = useState(urlCard);
  const holding = shouldHoldCard(shownCard, urlCard, dirtyCard);
  if (shownCard !== urlCard && !holding) setShownCard(urlCard);
  const openId = holding ? shownCard : urlCard;
  useEffect(() => {
    if (!holding) return undefined;
    let live = true;
    const guard = guardRef.current;
    Promise.resolve(guard ? guard.flush() : true).then((ok) => {
      if (!live || ok) return;
      // Not saved: the card stays, so the address names it again.
      cardEntryPushed.current = false;
      setSearch(buildCrmSearch({ ...stateRef.current, card: shownCard }), { replace: true });
    });
    return () => {
      live = false;
    };
  }, [holding, shownCard, setSearch]);
  // When a card closes, keyboard focus goes back to that card on the board.
  // (The drawer returns focus to where it was, but a card that changed column
  // while it was open is a new element, so it is found again by its id.)
  const lastOpenId = useRef("");
  useEffect(() => {
    const closed = lastOpenId.current;
    lastOpenId.current = openId;
    if (!closed || openId) return undefined;
    const t = setTimeout(() => {
      const active = document.activeElement;
      if (active && active !== document.body && document.body.contains(active)) return;
      const card = [...document.querySelectorAll("[data-record-id]")].find((el) => el.getAttribute("data-record-id") === closed);
      (card || addButtonRef.current)?.focus();
    }, 80);
    return () => clearTimeout(t);
  }, [openId]);
  const openRecordInList = openId ? pipe.records.find((r) => r.id === openId) || null : null;
  const addDisabled = !ready || !online;

  const retry = () => {
    if (cfg.error) cfg.retry();
    else pipe.refetch();
  };
  const clearFilters = () => patch({ q: "", icp: "", region: "", mine: false }, { replace: true });
  const addButton = (variant = "primary", size = "md", ref = null) => (
    <Button ref={ref} variant={variant} size={size} icon={Plus} disabled={addDisabled} onClick={() => openCard(NEW_CARD)}>
      Add {singular}
    </Button>
  );

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">{title}</h1>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            {canDrag ? "Drag a card to move it, or use the arrow on the card." : "Use the arrow on a card to move it."}{" "}
            Click a card to see and edit everything about it.
          </p>
        </div>
        {addButton("primary", "md", addButtonRef)}
      </div>

      {!online && (
        <AlertCard variant="warning">{OFFLINE_WORDS}</AlertCard>
      )}

      {loadError ? (
        <AlertCard
          variant="error"
          title={`Couldn't load ${title.toLowerCase()}`}
          action={
            <Button variant="secondary" size="sm" onClick={retry}>
              Retry
            </Button>
          }
        >
          {loadErrorWords(loadError)}
        </AlertCard>
      ) : (
        <>
          <PipelineToolbar
            state={state}
            def={def}
            regions={config?.regions}
            hasNoRegion={pipe.records.some((r) => !r.region_id)}
            disabled={!ready}
            onChange={patch}
          />

          {ready && pipe.truncated && (
            <AlertCard variant="info">Showing the 5,000 most recently changed. Use search to find older ones.</AlertCard>
          )}

          {loading ? (
            state.view === "board" ? (
              <PipelineBoardSkeleton />
            ) : state.view === "list" ? (
              <PipelineList def={def} records={[]} regions={[]} team={[]} today={today} loading onOpen={openRecord} />
            ) : (
              <Skeleton height={220} style={{ borderRadius: 12 }} />
            )
          ) : pipe.records.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-[var(--gray-300)] bg-[var(--color-background-primary)] px-4 py-12 text-center">
              <p className="max-w-md text-sm text-[var(--color-text-secondary)]">
                {pipeline === "hosts"
                  ? canOpenPage(access, "beta-leads")
                    ? "No hosts yet. Add the first one, or turn a beta lead into a host."
                    : "No hosts yet. Add the first one."
                  : "No creators yet. Add the first one."}
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {addButton()}
                {pipeline === "hosts" && canOpenPage(access, "beta-leads") && (
                  <Button variant="secondary" onClick={() => onTabChange?.("beta-leads")}>
                    Open Beta leads
                  </Button>
                )}
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-[var(--gray-300)] bg-[var(--color-background-primary)] px-4 py-12 text-center">
              <p className="text-sm text-[var(--color-text-secondary)]">No {singular}s match.</p>
              <div className="flex flex-wrap justify-center gap-2">
                {filtersOn && (
                  <Button variant="secondary" onClick={clearFilters}>
                    Clear filters
                  </Button>
                )}
                {addButton()}
              </div>
            </div>
          ) : state.view === "list" ? (
            <PipelineList
              def={def}
              records={filtered}
              regions={config.regions}
              team={config.team}
              today={today}
              onOpen={openRecord}
            />
          ) : state.view === "region" ? (
            <PipelineByRegion
              def={def}
              records={filtered}
              regions={config.regions}
              onPickRegion={(slug) => patch({ region: slug, view: "board" })}
            />
          ) : (
            <PipelineBoard
              def={def}
              records={filtered}
              regions={config.regions}
              team={config.team}
              today={today}
              pendingIds={pipe.pendingIds}
              disabled={!online}
              canDrag={canDrag}
              onOpen={openRecord}
              onMove={requestMove}
            />
          )}
        </>
      )}

      {ready && state.card === NEW_CARD && !holding && (
        <Drawer open onClose={closeCard} title={`New ${singular}`}>
          <AddRecordForm
            pipeline={pipeline}
            def={def}
            config={config}
            records={pipe.records}
            defaults={{ icp: state.icp, regionId: regionId === NO_REGION ? "" : regionId, me }}
            disabled={!online}
            onCreate={handleCreate}
            onOpenExisting={(id) => openCard(id, { replace: true })}
            onCancel={closeCard}
          />
        </Drawer>
      )}

      {ready && openId && (
        <RecordDrawer
          key={openId}
          pipeline={pipeline}
          def={def}
          config={config}
          recordId={openId}
          listRecord={openRecordInList}
          pipe={drawerPipe}
          online={online}
          canDelete={canDelete}
          focusField={focus?.id === openId ? focus.field : null}
          activityTick={activityTick}
          suspended={!!reasonFor}
          holding={holding}
          guardRef={guardRef}
          onDirtyChange={handleDirtyChange}
          onClose={closeCard}
          onRequestMove={requestMove}
          onDelete={handleDelete}
          onOpenCard={(id) => openCard(id, { replace: true })}
        />
      )}

      <ReasonPrompt
        key={reasonFor ? `${reasonFor.record.id}:${reasonFor.to}` : "closed"}
        open={!!reasonFor}
        stageId={reasonFor?.to}
        recordName={reasonFor?.record?.name}
        busy={reasonBusy}
        error={reasonError}
        onConfirm={confirmReason}
        onCancel={() => {
          setReasonError("");
          setReasonFor(null);
        }}
      />
    </div>
  );
}

export function HostsPage(props) {
  return <PipelinePage pipeline="hosts" {...props} />;
}

export function CreatorsPage(props) {
  return <PipelinePage pipeline="creators" {...props} />;
}
