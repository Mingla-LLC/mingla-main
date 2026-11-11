// Issue #4255 — panel two: the linked item, whatever page it is opened from.
//
//   card              a work card (WorkDetail, the same card as on Work)
//   host / creator    a host or creator record (RecordDrawer, the same card as
//                     on Hosts and creators)
//   content           a post (ContentDrawer, the same panel as the Calendar's)
//   event / expected  an event or a promised event (EventPanel)
//   drafts            the message drafts of one record, or all of mine
//   brand             a brand (BrandDrawer, the same panel as on Brands;
//                     #4270 W7, so a Brand group's "Brand" opens beside)
//
// Each is drawn in a Drawer, which the PanelStack turns into a docked panel.
// A small "Open full page" link is there for when someone really means to go.
import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Drawer } from "../ui/Drawer";
import { Button } from "../ui/Button";
import { Modal, ModalBody, ModalFooter } from "../ui/Modal";
import { WorkDetail } from "../ops/WorkDetail";
import { EventPanel } from "../ops/EventPanel";
import { CardThread } from "../ops/CardThread";
import { RecordDrawer } from "../crm/RecordDrawer";
import { ReasonPrompt } from "../crm/ReasonPrompt";
import { ContentDrawer } from "../contentCalendar/ContentDrawer";
import { BrandDrawer } from "../brands/BrandDrawer";
import { DraftsPage } from "../../pages/DraftsPage";
import { useToast } from "../../context/ToastContext";
import { useOpsConfig } from "../../hooks/useOpsConfig";
import { useCrmConfig } from "../../hooks/useCrmConfig";
import { useCrmPipeline, useOnline } from "../../hooks/useCrmPipeline";
import { errorWords, freshnessVerdict, loadErrorWords, moveBlocker, stageDef, stageLabel } from "../../lib/crmModel";
import { CONTENT_STAGES, canMoveTo, contentErrorWords, moveNeedsFields, movePrompt, requestKey } from "../../lib/contentCalendarModel";
import * as contentService from "../../services/contentCalendarService";
import { sideHref } from "../../lib/panelStack";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";

export function FullPageLink({ side }) {
  const href = sideHref(side);
  if (!href) return null;
  return (
    <a href={href} data-full-page="" className={`inline-flex min-h-11 items-center gap-1.5 rounded-lg px-1 text-[12.5px] font-semibold text-[var(--color-text-secondary)] hover:underline ${FOCUS}`}>
      Open full page <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
    </a>
  );
}

// #4255 W3: the work card draws its own one-line header (bare panel).
function WorkCardSide({ side, onClose, onChanged, onOpenSide }) {
  const config = useOpsConfig();
  const online = useOnline();
  return (
    <Drawer open onClose={onClose} title="Work card" bare>
      <div className="min-h-0 flex-1">
        <WorkDetail key={side.id} cardId={side.id} config={config.data} online={online} onClose={onClose} onChanged={onChanged} onOpenSide={onOpenSide} />
      </div>
      <div className="shrink-0 border-t border-[var(--gray-200)] px-4"><FullPageLink side={side} /></div>
    </Drawer>
  );
}

function RecordSide({ side, onClose, onOpenSide }) {
  const pipeline = side.kind === "creator" ? "creators" : "hosts";
  const { addToast } = useToast();
  const online = useOnline();
  const cfg = useCrmConfig();
  const config = cfg.config;
  const def = config?.pipelines?.[pipeline] || null;
  // The record's writes, without loading the whole pipeline.
  const pipe = useCrmPipeline(pipeline, { enabled: false });
  const [activityTick, setActivityTick] = useState(0);
  const [reasonFor, setReasonFor] = useState(null);
  const [reasonBusy, setReasonBusy] = useState(false);
  const [reasonError, setReasonError] = useState("");

  const move = useCallback(async (record, to, reason = null) => {
    try {
      const res = await pipe.moveStage(record, to, reason);
      setActivityTick((n) => n + 1);
      addToast({ variant: res?.changed === false ? "info" : "success", title: res?.changed === false ? `${record.name} is already in ${stageLabel(def, to)}` : `${record.name} moved to ${stageLabel(def, to)}` });
      return "";
    } catch (err) {
      return errorWords(err);
    }
  }, [pipe, def, addToast]);

  const requestMove = useCallback(async (shown, to) => {
    if (!def || !shown || shown.stage === to) return;
    if (!online) { addToast({ variant: "warning", title: "You're offline", description: "The card stays where it is. Try again once you're back." }); return; }
    let fresh;
    try {
      fresh = await pipe.checkFresh(shown.id);
    } catch (err) {
      addToast({ variant: "error", title: `${shown.name} didn't move`, description: loadErrorWords(err) });
      return;
    }
    pipe.applyRecord(fresh.record);
    const verdict = freshnessVerdict(def, shown, fresh.record, to, fresh.activity);
    if (verdict.kind !== "go") {
      setActivityTick((n) => n + 1);
      addToast({ variant: verdict.kind === "already" ? "info" : "warning", title: verdict.title, description: verdict.description });
      return;
    }
    const block = moveBlocker(def, fresh.record, to);
    if (block) {
      if (block.token !== "same") addToast({ variant: "warning", title: "That move isn't possible", description: block.message });
      return;
    }
    if (stageDef(def, to)?.terminal) { setReasonError(""); setReasonFor({ record: fresh.record, to }); return; }
    const failure = await move(fresh.record, to);
    if (failure) addToast({ variant: "error", title: `${shown.name} didn't move`, description: failure });
  }, [def, online, pipe, addToast, move]);

  if (cfg.error) {
    return (
      <Drawer open onClose={onClose} title="Couldn't open this card">
        <div className="flex flex-col items-start gap-3" role="alert">
          <p className="text-sm text-[var(--color-text-secondary)]">{loadErrorWords(cfg.error)}</p>
          <Button variant="secondary" className="min-h-11" onClick={cfg.retry}>Try again</Button>
        </div>
      </Drawer>
    );
  }
  if (!def) {
    return (
      <Drawer open onClose={onClose} title={`Opening ${side.kind}`}>
        <p role="status" aria-busy="true" className="text-sm text-[var(--color-text-secondary)]">Loading…</p>
      </Drawer>
    );
  }
  return (
    <>
      <RecordDrawer
        key={side.id}
        pipeline={pipeline}
        def={def}
        config={config}
        recordId={side.id}
        listRecord={pipe.records.find((r) => r.id === side.id) || null}
        pipe={pipe}
        online={online}
        canDelete={false}
        activityTick={activityTick}
        suspended={!!reasonFor}
        onClose={onClose}
        onRequestMove={requestMove}
        onDelete={async () => false}
        onRefreshRegions={cfg.retry}
        footerExtra={<FullPageLink side={side} />}
        onOpenSide={onOpenSide}
      />
      {reasonFor && (
        <ReasonPrompt
          open
          stageId={reasonFor.to}
          recordName={reasonFor.record.name}
          busy={reasonBusy}
          error={reasonError}
          onConfirm={async (reason) => {
            setReasonBusy(true);
            const failure = await move(reasonFor.record, reasonFor.to, reason);
            setReasonBusy(false);
            if (failure) setReasonError(failure); else setReasonFor(null);
          }}
          onCancel={() => { setReasonError(""); setReasonFor(null); }}
        />
      )}
    </>
  );
}

function ContentSide({ side, onClose, onChanged }) {
  const { addToast } = useToast();
  const online = useOnline();
  const [config, setConfig] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [prompt, setPrompt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [focusTarget, setFocusTarget] = useState(null);
  useEffect(() => {
    let live = true;
    setLoading(true);
    Promise.all([contentService.fetchContentConfig(), contentService.getContent(side.id)]).then(
      ([cfg, answer]) => { if (live) { setConfig(cfg); setDetail(answer); setLoading(false); } },
      (error) => {
        if (!live) return;
        setLoading(false);
        addToast({ variant: "error", title: "Couldn’t open that post", description: contentErrorWords(error) });
        onClose();
      }
    );
    return () => { live = false; };
  }, [side.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const changed = (item) => { setDetail((current) => (current?.item?.id === item.id ? { ...current, item } : current)); onChanged?.(item); };
  const perform = async (item, to, approvals) => {
    setBusy(true);
    try {
      const answer = await contentService.moveContent(item.id, to, item.revision, approvals, requestKey("web_move"));
      changed(answer.item);
      setPrompt(null);
      addToast({ variant: "success", title: `Moved to ${CONTENT_STAGES.find((s) => s.value === to)?.label || to}` });
    } catch (error) {
      addToast({ variant: "error", title: "Couldn’t move that post", description: contentErrorWords(error) });
    } finally {
      setBusy(false);
    }
  };
  const beginMove = (item, to) => {
    if (!canMoveTo(item, to)) return;
    const missing = moveNeedsFields(item, to);
    if (missing) { setFocusTarget(missing.field); addToast({ variant: "error", title: "Finish this post first", description: missing.message }); return; }
    const ask = movePrompt(item, to);
    if (ask) setPrompt({ item, to, ask }); else perform(item, to, {});
  };
  return (
    <>
      <ContentDrawer activeId={side.id} detail={detail} config={config} online={online} loading={loading} focusTarget={focusTarget} suspended={!!prompt}
        onFocusHandled={() => setFocusTarget(null)} onClose={onClose} onChanged={changed} onMove={beginMove} onDeleted={() => onClose()} footerExtra={<FullPageLink side={side} />} />
      <Modal open={!!prompt} onClose={() => setPrompt(null)} title={prompt?.ask?.title || "Move post"} size="sm">
        <ModalBody><p className="text-sm text-[var(--color-text-secondary)]">{prompt?.ask?.flag === "approve_copy" ? "Confirm that the copy is ready for design." : prompt?.ask?.flag === "approve_design" ? "Confirm that the design is ready and the publish time and channels are set." : "A stable live link is not on this post yet. You can continue without one."}</p></ModalBody>
        <ModalFooter>
          <Button type="button" variant="secondary" className="min-h-11" onClick={() => setPrompt(null)}>Cancel</Button>
          <Button type="button" variant="brandContrast" className="min-h-11" loading={busy} onClick={() => perform(prompt.item, prompt.to, { [prompt.ask.flag]: true })}>{prompt?.ask?.action}</Button>
        </ModalFooter>
      </Modal>
    </>
  );
}

function EventSide({ side, onClose, actions }) {
  const online = useOnline();
  const selection = useMemo(() => ({ kind: side.kind, id: side.id }), [side.kind, side.id]);
  return (
    <Drawer open onClose={onClose} title={side.kind === "expected" ? "Promised event" : "Event"}>
      <div className="flex min-w-0 flex-col gap-2">
        <EventPanel selection={selection} onBack={onClose} online={online} embedded actions={actions} />
        <FullPageLink side={side} />
      </div>
    </Drawer>
  );
}

function DraftsSide({ side, onClose, onOpenSide }) {
  return (
    <Drawer open onClose={onClose} title={side.id === "all" ? "All my message drafts" : "Message drafts for this host or creator"}>
      <div className="flex min-w-0 flex-col gap-2">
        <DraftsPage key={side.id} embedded={{ search: side.id === "all" ? "" : `record=${side.id}` }} onOpenSide={onOpenSide} />
        <FullPageLink side={side} />
      </div>
    </Drawer>
  );
}

// #4270 W7: BrandDrawer loads its own board row when opened by id (row null).
// It has no footer slot, so a page that docks it shows "Open full page"
// itself (the Brand group panel does, in its trail bar).
function BrandSide({ side, onClose, onChanged, onOpenSide }) {
  return <BrandDrawer brandId={side.id} row={null} onClose={onClose} onChanged={onChanged} onOpenSide={onOpenSide} />;
}

/**
 * Panel two. `onChanged(kind)` lets the page refresh what it shows after a
 * change made in the panel (a card closed, a post moved). `eventActions`
 * (a function of the event, or null) adds the Calendar's own actions to an
 * event.
 *
 * #4270 W7 rework (D-1): `onOpenSide(kind, id)` (optional) is for a page that
 * must not change, the Brand group: each drawer's links to other pages then
 * open in this panel or show as plain words. Without it nothing changes.
 */
export function SidePanel({ side, onClose, onChanged, eventActions = null, onOpenSide = null }) {
  if (!side) return null;
  switch (side.kind) {
    case "card":
      return <WorkCardSide side={side} onClose={onClose} onChanged={() => onChanged?.("card")} onOpenSide={onOpenSide} />;
    case "host":
    case "creator":
      return <RecordSide side={side} onClose={onClose} onOpenSide={onOpenSide} />;
    case "content":
      return <ContentSide side={side} onClose={onClose} onChanged={() => onChanged?.("content")} />;
    case "event":
    case "expected":
      return <EventSide side={side} onClose={onClose} actions={eventActions} />;
    case "drafts":
      return <DraftsSide side={side} onClose={onClose} onOpenSide={onOpenSide} />;
    case "brand":
      return <BrandSide side={side} onClose={onClose} onChanged={() => onChanged?.("brand")} onOpenSide={onOpenSide} />;
    // #4255 W3: a work card's thread, beside the card.
    case "thread":
      return <CardThread key={side.id} cardId={side.id} onClose={onClose} onCardChanged={() => onChanged?.("card")} />;
    default:
      return null;
  }
}
