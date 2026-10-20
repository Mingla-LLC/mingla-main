import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, useReducedMotion } from "framer-motion";
import { PageHeader } from "../components/ui/PageHeader";
import { Badge } from "../components/ui/Badge";
import { AlertCard, SectionCard } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Segmented } from "../components/crm/fields";
import { DraftCard } from "../components/drafts/DraftCard";
import { DraftQueueSkeleton } from "../components/drafts/DraftQueueSkeleton";
import { useHashQuery } from "../hooks/useHashQuery";
import { useOnline } from "../hooks/useCrmPipeline";
import { useDrafts } from "../hooks/useDrafts";
import { announceDraftMutation, useDraftCountValue } from "../hooks/useDraftCounts";
import * as service from "../services/draftService";
import { DRAFT_STATES, draftErrorWords, remainingUndoMs } from "../lib/draftModel";
import { useToast } from "../context/ToastContext";
import { ReviewQueue } from "../components/ops/ReviewQueue";
import { WordingQueue } from "../components/ops/WordingQueue";
import { useAuth } from "../context/AuthContext";
import { DraftNeededContext, DraftNeededList, draftNeededCards, useDraftNeededReview } from "../components/ops/DraftNeededList";
import { parseReviewSearch } from "../lib/opsModel";
import { announceReviewChange, useReviewCount } from "../hooks/useReviewCount";


const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function paramsFrom(search) {
  const p = new URLSearchParams(search);
  const rawDraft = p.get("draft");
  return {
    state: ["waiting", "sent", "discarded"].includes(p.get("state")) ? p.get("state") : "waiting",
    record: UUID.test(p.get("record") || "") ? p.get("record") : null,
    draft: UUID.test(rawDraft || "") ? rawDraft : null,
    hasDraft: rawDraft !== null,
    draftInvalid: rawDraft !== null && !UUID.test(rawDraft),
  };
}

export function DraftsPage() {
  const [search, setSearch] = useHashQuery("drafts");
  const query = useMemo(() => paramsFrom(search), [search]);
  const review = useMemo(() => parseReviewSearch(search), [search]);
  const selectTab = (tab) => setSearch(tab === "spend" ? "tab=spend" : tab === "told" ? "tab=told" : "");
  const { access } = useAuth();
  // What hosts are told is decided by the owner and admins only.
  const canTell = access?.role === "owner" || access?.role === "admin";
  const online = useOnline();
  const reduced = useReducedMotion();
  const counts = useDraftCountValue();
  const { addToast } = useToast();
  const [dirtyIds, setDirtyIds] = useState(() => new Set());
  const headingRef = useRef(null);
  const emptyHeadingRef = useRef(null);
  const queue = useDrafts({ state: query.state, recordId: query.hasDraft ? null : query.record, draftId: query.draft, paused: dirtyIds.size > 0, protectedIds: dirtyIds });

  useEffect(() => {
    if (query.hasDraft && query.record) {
      const p = new URLSearchParams(search); p.delete("record"); setSearch(p.toString(), { replace: true });
    }
  }, [query.hasDraft, query.record, search, setSearch]);

  const selectState = (state) => {
    const p = new URLSearchParams(search);
    if (state === "waiting") p.delete("state"); else p.set("state", state);
    p.delete("draft");
    setSearch(p.toString());
  };
  const busyAny = queue.mutationIds.size > 0;
  const mutate = (draft, run, action) => queue.mutate(draft.id, run, action);
  const removeDirty = (id) => setDirtyIds((ids) => { const next = new Set(ids); next.delete(id); return next; });
  const setDirty = (id, value) => setDirtyIds((ids) => { const next = new Set(ids); if (value) next.add(id); else next.delete(id); return next; });

  const focusCardHeading = (id) => document.querySelector(`[data-draft-id="${id}"] h2`);
  const focusAfterRemoval = (id) => {
    const index = queue.drafts.findIndex((draft) => draft.id === id);
    const nextId = queue.drafts[index + 1]?.id || queue.drafts[index - 1]?.id;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const card = nextId ? document.querySelector(`[data-draft-id="${nextId}"]`) : null;
      const target = card?.querySelector("button:not([disabled]), a[href]") || emptyHeadingRef.current;
      target?.focus?.();
    }));
  };
  const discard = async (draft) => {
    const result = await mutate(draft, () => service.discardDrafts([draft.id]), "discarding");
    const row = result?.results?.[0];
    if (row?.status === "error") throw Object.assign(new Error(row.error?.message), row.error);
    removeDirty(draft.id);
    focusAfterRemoval(draft.id);
    addToast({ variant: "success", title: "Draft discarded", description: `${draft.record?.name || "Draft"} moved to Discarded.`, duration: 8000,
      action: { label: "Undo", focusAfter: () => headingRef.current, onClick: async () => { await service.restoreDraft(draft.id); announceDraftMutation(); await queue.refetch({ quiet: true }); counts.refetch({ quiet: true }); requestAnimationFrame(() => focusCardHeading(draft.id)?.focus?.()); } } });
  };
  const mark = async (draft, body) => {
    const result = await mutate(draft, () => service.markDraftSent(draft.id, body), "marking");
    removeDirty(draft.id);
    focusAfterRemoval(draft.id);
    const duration = Math.max(1, remainingUndoMs(result?.draft?.sent_at));
    addToast({ variant: "success", title: "Copied and marked sent", description: `${draft.record?.name || "This draft"} is recorded in Mingla. Undo changes Mingla only; it does not recall the message.`, duration,
      action: { label: "Undo", focusAfter: () => headingRef.current, onClick: async () => { const undone = await service.undoDraftSent(draft.id); announceDraftMutation(); await queue.refetch({ quiet: true }); counts.refetch({ quiet: true }); requestAnimationFrame(() => focusCardHeading(draft.id)?.focus?.()); if (undone?.stage_undone === false) addToast({ variant: "warning", title: "Mingla record partly undone", description: `The draft is waiting again. The sent record was removed, but the card stayed in ${undone?.record?.stage || "its current stage"}: ${undone.stage_note || "Move it by hand if needed."}` }); } } });
    return result;
  };
  const restore = async (draft) => {
    await mutate(draft, () => service.restoreDraft(draft.id), "restoring");
    focusAfterRemoval(draft.id);
    addToast({ variant: "success", title: "Draft restored to Waiting." });
  };
  const undo = async (draft) => {
    const result = await mutate(draft, () => service.undoDraftSent(draft.id), "undoing");
    focusAfterRemoval(draft.id);
    if (result?.stage_undone === false) addToast({ variant: "warning", title: "Mingla record partly undone", description: `The draft is waiting again. The sent record was removed, but the card stayed in ${result?.record?.stage || "its current stage"}: ${result.stage_note || "Move it by hand if needed."}` });
    else addToast({ variant: "success", title: "Mingla record undone", description: "The draft is waiting again." });
  };
  const showWaiting = (draft) => {
    const p = new URLSearchParams();
    if (draft.record?.id) p.set("record", draft.record.id);
    setSearch(p.toString());
  };

  // #3980: the header counts exactly what the menu badge counts and the tabs
  // list: waiting messages, cards that still need a draft, and cards waiting
  // to spend or publish.
  const reviewCount = useReviewCount();
  const totalWaiting = reviewCount.total;
  const meta = `${totalWaiting} waiting`;
  const reviewTabs = [
    { value: "messages", label: "Messages" },
    { value: "spend", label: "Spend or publish" },
    ...(canTell ? [{ value: "told", label: "What hosts are told" }] : []),
  ];
  const notFound = query.hasDraft && queue.loaded && !queue.error && (query.draftInvalid || queue.drafts.length === 0);
  const filtered = !!query.record;
  const loadedRecordName = queue.drafts.find((draft) => draft.record?.id === query.record)?.record?.name;
  const filterRecordName = loadedRecordName || "";
  // Cards listed under "Draft needed" are waiting too, so the empty queue
  // below them never says "Nothing waiting." The copy follows the cards the
  // list actually shows (one load, shared with the list), never the menu
  // count, which can be slow, failing or out of date.
  const draftNeededListed = review.tab !== "spend" && query.state === "waiting" && !filtered;
  const draftNeeded = useDraftNeededReview({ enabled: draftNeededListed });
  const draftNeededShown = draftNeededListed && draftNeededCards(draftNeeded).length > 0;
  const emptyTitle = filtered ? `No ${query.state} drafts for this card.` : draftNeededShown ? "No drafts written yet." : query.state === "waiting" ? "Nothing waiting." : query.state === "sent" ? "No sent drafts yet." : "No discarded drafts.";
  const emptyCopy = filtered ? "Clear the filter to see the full queue." : draftNeededShown ? "Ask your agent to write a draft for the cards above." : query.state === "waiting" ? "Ask your agent to write a draft." : query.state === "sent" ? "Drafts you mark sent will appear here." : "Drafts you discard appear here for review.";

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div ref={headingRef} tabIndex={-1}><PageHeader title="Needs you" description="Only what needs a person: messages to send, money to spend, events to publish." meta={<span role="status" aria-live="polite"><Badge variant={totalWaiting > 0 ? "warning" : "success"}>{meta}</Badge></span>} /></div>
      <Segmented label="What to review" options={reviewTabs} value={review.tab} onChange={selectTab} variant="highContrast" fullWidth className="sm:!w-fit" />
      {review.tab === "told" && canTell ? (
        <WordingQueue onChanged={() => { counts.refetch({ quiet: true }); announceReviewChange(); }} />
      ) : review.tab === "spend" ? (
        <ReviewQueue online={online} selectedId={review.card} onSelect={(id) => setSearch(id ? `tab=spend&card=${id}` : "tab=spend")} onChanged={() => { counts.refetch({ quiet: true }); announceReviewChange(); }} />
      ) : (<DraftNeededContext.Provider value={draftNeeded}>
      <p className="sr-only" role="status" aria-live="polite">{queue.notice}</p>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><Segmented label="Draft state" options={DRAFT_STATES} value={query.state} onChange={selectState} variant="highContrast" fullWidth className="sm:!w-fit" /></div>
      {query.state === "waiting" && !filtered && <DraftNeededList />}
      {filtered && <AlertCard variant="info" action={<Button type="button" variant="secondary" className="min-h-11" onClick={() => { const p = new URLSearchParams(search); p.delete("record"); setSearch(p.toString()); }}>Clear filter</Button>}>Showing drafts for {filterRecordName || "a record that is no longer available"}</AlertCard>}
      {!online && <div id="drafts-offline"><AlertCard variant="warning" title="You’re offline">{queue.drafts.length ? "You can read these drafts, but saving, marking, discarding, restoring and Undo need a connection." : "Drafts will load when you’re back online."}</AlertCard></div>}
      {queue.stale && <AlertCard variant="warning" title="Drafts may be out of date" action={<Button type="button" variant="secondary" className="min-h-11" onClick={() => queue.refetch()}>Try again</Button>} />}

      {queue.loading || (!online && queue.error && queue.drafts.length === 0) ? <DraftQueueSkeleton still={!online || reduced} /> : queue.error ? (
        <AlertCard variant="error" title="Couldn’t load your drafts" action={<Button type="button" variant="secondary" className="min-h-11" onClick={() => queue.refetch()}>Try again</Button>}>{draftErrorWords(queue.error)}</AlertCard>
      ) : notFound ? (
        <SectionCard><h2 ref={emptyHeadingRef} tabIndex={-1} className="text-[15px] font-semibold text-[var(--color-text-primary)]">That draft isn’t here.</h2><p className="mt-2 text-[13px] text-[var(--color-text-secondary)]">It may have been removed, or this link is not available to you.</p><a href="#/drafts" className="mt-4 inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-[var(--color-brand-700)]">Back to drafts</a></SectionCard>
      ) : queue.drafts.length === 0 ? (
        <SectionCard><h2 ref={emptyHeadingRef} tabIndex={-1} className="text-[15px] font-semibold text-[var(--color-text-primary)]">{emptyTitle}</h2><p className="mt-2 text-[13px] text-[var(--color-text-secondary)]">{emptyCopy}</p>{query.state === "waiting" && !filtered ? <a href="#/agent" className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-[var(--color-brand-800)] px-4 text-sm font-semibold text-white hover:bg-[var(--color-brand-900)]">Open My agent</a> : <Button type="button" variant="secondary" className="mt-4 min-h-11" onClick={() => filtered ? (() => { const p = new URLSearchParams(search); p.delete("record"); setSearch(p.toString()); })() : selectState("waiting")}>{filtered ? "Clear filter" : "Show waiting"}</Button>}</SectionCard>
      ) : (
        <>
          <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
            <AnimatePresence initial={false}>
              {queue.drafts.map((draft) => <DraftCard key={draft.id} draft={draft} online={online} busy={queue.mutationIds.has(draft.id)} busyAction={queue.mutationActions.get(draft.id)} offlineHelpId="drafts-offline" deepLinked={query.draft === draft.id} onDirty={(value) => setDirty(draft.id, value)}
                onUpdate={(changes) => mutate(draft, () => service.updateDraft(draft.id, changes), "saving")}
                onUseLatest={() => queue.acceptRemote(draft.id)}
                onCloseWithdrawn={() => { removeDirty(draft.id); focusAfterRemoval(draft.id); return queue.refetch({ quiet: true, ignoreProtectedIds: [draft.id] }); }}
                onDiscard={() => discard(draft)}
                onRestore={() => restore(draft)}
                onMark={(body) => mark(draft, body)}
                onUndo={() => undo(draft)} onShowWaiting={() => showWaiting(draft)} />)}
            </AnimatePresence>
          </div>
          {(queue.nextCursor || queue.moreError) && <div className="flex flex-col items-center gap-2 pt-2">{queue.moreError && <p role="alert" className="text-[13px] font-semibold text-[var(--color-error-700)]">Couldn’t load more drafts.</p>}<Button type="button" variant="secondary" loading={queue.loadingMore} className="min-h-11" disabled={busyAny || queue.loadingMore} onClick={() => queue.loadMore()}>{queue.loadingMore ? "Loading more…" : queue.moreError ? "Try again" : "Show more"}</Button></div>}
        </>
      )}
      </DraftNeededContext.Provider>)}
    </div>
  );
}
