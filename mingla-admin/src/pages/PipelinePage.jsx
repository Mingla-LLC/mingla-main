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
  hasActiveFilters,
  localToday,
  moveBlocker,
  regionBySlug,
  regionSlug,
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
  const pipe = useCrmPipeline(pipeline, { enabled: !!def });
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
  const openCard = useCallback(
    (id, { field = null, replace = false } = {}) => {
      setFocus(field ? { id, field } : null);
      patch({ card: id }, { replace });
    },
    [patch]
  );
  const closeCard = useCallback(() => {
    setFocus(null);
    patch({ card: "" });
  }, [patch]);
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

  const [reasonFor, setReasonFor] = useState(null); // { record, to }
  const [reasonBusy, setReasonBusy] = useState(false);

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
        addToast({ variant: "error", title: `${record.name} didn't move`, description: errorWords(err) });
        if (err?.token === "not_found") pipe.dropRecord(record.id);
        if (err?.token === "agreement_required") openCard(record.id, { field: "agreement" });
        return false;
      }
    },
    [pipe, def, addToast, clearUndoToast, undoMove, openCard]
  );

  const requestMove = useCallback(
    (record, to) => {
      if (!def) return;
      if (!online) {
        addToast({ variant: "warning", title: "You're offline", description: "The card stays where it is. Try again once you're back." });
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
        setReasonFor({ record, to });
        return;
      }
      performMove(record, to);
    },
    [def, online, addToast, openCard, performMove]
  );

  const confirmReason = async (reason) => {
    if (!reasonFor) return;
    setReasonBusy(true);
    await performMove(reasonFor.record, reasonFor.to, reason);
    setReasonBusy(false);
    setReasonFor(null);
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
      if (stateRef.current.card === record.id) closeCard();
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
  const openId = state.card && state.card !== NEW_CARD ? state.card : "";
  const openRecordInList = openId ? pipe.records.find((r) => r.id === openId) || null : null;
  const addDisabled = !ready || !online;

  const retry = () => {
    if (cfg.error) cfg.retry();
    else pipe.refetch();
  };
  const clearFilters = () => patch({ q: "", icp: "", region: "", mine: false }, { replace: true });
  const addButton = (variant = "primary", size = "md") => (
    <Button variant={variant} size={size} icon={Plus} disabled={addDisabled} onClick={() => openCard(NEW_CARD)}>
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
        {addButton()}
      </div>

      {!online && (
        <AlertCard variant="warning" title="You're offline">
          {OFFLINE_WORDS}
        </AlertCard>
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
          {errorWords(loadError)}
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

      {ready && state.card === NEW_CARD && (
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
        onConfirm={confirmReason}
        onCancel={() => setReasonFor(null)}
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
