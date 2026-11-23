import { useCallback, useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from "react";
import { ArrowRight, Calendar, ExternalLink, FileText, Lock, MessageSquare, Phone, Plus } from "lucide-react";
import { Drawer } from "../ui/Drawer";
import { SideLink } from "../ui/PanelStack";
import { Button } from "../ui/Button";
import { Skeleton } from "../ui/Skeleton";
import { useToast } from "../../context/ToastContext";
import { Badge } from "../ui/Badge";
import { CONTROL_CLASS, Field, MISSING_CITY, MISSING_CITY_LABEL, Select } from "./fields";
import { IdentifiersField } from "./IdentifiersField";
import { ContactRuleField } from "./ContactRuleField";
import { MissingCityLayer } from "./MissingCityLayer";
import { MinglaLinkField } from "./MinglaLinkField";
import { LogForm } from "./LogForm";
import { RecentTouchNotice } from "./RecentTouchNotice";
import { OnMinglaSection } from "./OnMinglaSection";
import { useHostOnMingla } from "../../hooks/useHostOnMingla";
import { HostToDoSection } from "./HostToDoSection";
import { HostTeamSection } from "./HostTeamSection";
import { HostPlanSection } from "./HostPlanSection";
import { RecordHygiene } from "./RecordHygiene";
import { hostMissing } from "../../lib/opsModel";
import { ActivityLog } from "./ActivityLog";
import { CardFiles } from "../ops/CardFiles";
import { useCardUploads } from "../../hooks/useCardFiles";
import { QuickLinks } from "./RecordCard";
import { PropChip, PeopleChip } from "../ops/WorkDetail";
import { PeopleField } from "../people/PeopleField";
import { OWNERS_HINT, WATCHERS_HINT, lastOwnerWords, lastWatcherWords } from "../../lib/peopleField";
import { usePeopleDirectory } from "../../hooks/usePeopleDirectory";
import { dayLabel, localWhen } from "../../lib/opsModel";
import {
  MOVE_BLOCK_COPY,
  TEXT_FIELDS,

  callOutcomeLabel,
  clockTime,
  demoLocked,
  demoLockWords,
  needsLinkingWords,
  dueChoices,
  channelsUsed,
  contactRuleView,
  editsToSend,
  errorWords,
  fieldLabel,
  hasUnsavedEdits,
  identifiersToSend,
  loadErrorWords,
  localToday,
  moveBlocker,
  nextStage,
  normalizeTyped,
  relativeTime,
  saveLine,
  stageDef,
  stageNeedsSignedAgreement,
  terminalStage,
} from "../../lib/crmModel";
import { buildCrmHash } from "../../lib/crmUrl";
import { demoUnlink, getRecord, newRequestKey, recordWork, setFollowers, setRecordPeople } from "../../services/crmService";
import { demoStatusWords, linkSourceWords, schedulerLink } from "../leads/demoLinkModel";
import { useRecordDraftCount } from "../../hooks/useDrafts";

// What someone typed on a card that could not be sent before the card went
// away (they left the page). Kept in memory only, by card id, so opening the
// card again shows their text as "Not saved" with Try again. Never server data.
const leftUnsent = new Map();

const LEFT_BEHIND_WORDS = "This wasn't saved before the card closed.";

/** The same value, for a field that holds text or a list (owners). */
function sameValue(a, b) {
  return Array.isArray(a) || Array.isArray(b) ? JSON.stringify(a) === JSON.stringify(b) : a === b;
}

function restoreLeftUnsent(recordId) {
  const kept = leftUnsent.get(recordId);
  if (!kept) return { drafts: {}, unsent: {} };
  leftUnsent.delete(recordId);
  const unsent = {};
  for (const key of Object.keys(kept)) unsent[key] = { value: kept[key], message: LEFT_BEHIND_WORDS };
  return { drafts: { ...kept }, unsent };
}

/**
 * #4270 W2: on a host card, everything after Status sits in one folded
 * "Details" row; a creator card shows it open, as before.
 */
function DetailsFold({ isHosts, detailsRef, fid, children }) {
  // #4571 W3: hosts and creators both fold the rest under Details.
  if (!isHosts) return <>{children}</>;
  return (
    <details ref={detailsRef} data-host-section="details" className="group min-w-0 border-t border-[var(--gray-200)] pt-3">
      <summary id={fid("details")} className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-1 text-[14px] font-semibold text-[var(--color-text-primary)] hover:bg-[var(--gray-50)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)]">
        <span className="min-w-0 break-words">Details · contact rule, imports, log and activity</span>
        <span aria-hidden="true" className="text-[var(--color-text-tertiary)] group-open:rotate-90">›</span>
      </summary>
      <div className="mt-3 flex min-w-0 flex-col gap-5">{children}</div>
    </details>
  );
}

const SECTION = "flex min-w-0 flex-col gap-2 border-t border-[var(--gray-200)] pt-3";
const H3 = "flex min-w-0 flex-wrap items-center justify-between gap-2 text-[14px] font-semibold text-[var(--color-text-primary)]";
const ACTIVITY_FILTERS = [["all", "All"], ["call", "Calls"], ["touch", "Touches"], ["stage", "Stage"], ["note", "Notes"]];

/** #4571 W3: which activity filter an entry falls under. */
export function activityFilterKind(a) {
  if (!a) return "";
  if (a.kind === "touch" && a.channel === "phone") return "call";
  if (a.kind === "touch") return "touch";
  if (a.kind === "stage_move") return "stage";
  if (a.kind === "note") return "note";
  return "";
}

/** #4571 W3: the record's Work (crm_record_work), loaded with the card. */
function useRecordWork(recordId, tick) {
  const [state, setState] = useState({ id: null, loading: true, error: null, data: null });
  const [again, setAgain] = useState(0);
  useEffect(() => {
    if (!recordId) return undefined;
    let live = true;
    setState((st) => (st.id === recordId ? { ...st, loading: !st.data } : { id: recordId, loading: true, error: null, data: null }));
    recordWork(recordId).then(
      (data) => { if (live) setState({ id: recordId, loading: false, error: null, data }); },
      (error) => { if (live) setState((st) => ({ ...st, id: recordId, loading: false, error })); },
    );
    return () => { live = false; };
  }, [recordId, tick, again]);
  return { ...state, retry: () => setAgain((n) => n + 1) };
}

/** #4571 W3: calls on this card: outcome, when, who, length, PressOne. */
function CallsSection({ activity, onLogCall, disabled }) {
  const calls = (Array.isArray(activity) ? activity : []).filter((a) => activityFilterKind(a) === "call");
  return (
    <section aria-label="Calls" data-record-section="calls" className={SECTION}>
      <h3 className={H3}>
        <span>Calls <span className="font-medium text-[var(--color-text-tertiary)]">· {calls.length}</span></span>
        <Button variant="ghost" size="sm" className="min-h-11" icon={Phone} disabled={disabled} onClick={onLogCall}>Log call</Button>
      </h3>
      {calls.length === 0 ? <p className="text-[13px] text-[var(--color-text-tertiary)]">No calls logged yet.</p> : (
        <ul className="flex min-w-0 flex-col gap-1.5">
          {calls.map((a) => (
            <li key={a.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--gray-200)] px-3 py-2 text-[12.5px]">
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full bg-[var(--gray-100)] px-2 py-px font-semibold text-[var(--color-text-primary)]">{callOutcomeLabel(a.outcome) || "Logged"}</span>
                  <span className="text-[var(--color-text-tertiary)]">{[localWhen(a.occurred_at), a.actor_name, a.direction === "inbound" ? "Inbound" : "Outbound",
                    Number(a.duration_seconds) > 0 ? `${Math.round(Number(a.duration_seconds) / 60)} min` : ""].filter(Boolean).join(" · ")}</span>
                </span>
                {a.body ? <span className="break-words text-[var(--color-text-secondary)]">{a.body}</span> : null}
              </span>
              {a.message_ref && /^https?:\/\//i.test(a.message_ref) && (
                <a href={a.message_ref} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 font-semibold text-[var(--color-brand-700)] hover:bg-[var(--color-brand-50)]">
                  Open in PressOne <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * #4571 W3/W4: Demos (Google Meet), design tab 3. The card's linked demos (from
 * crm_record_get), the Demo booked lock with its reason (demo_gate), and the
 * card's own scheduler link: Book a demo opens it in a new tab so the rep books
 * during the call; Copy scheduler link copies it. A booking made with it links
 * itself. Staff book only through this link (Mingla does not read personal
 * calendars). Unlinking is refused while the card stands on that demo alone.
 */
function DemosSection({ record, demos, scheduleToken, disabled, onChanged }) {
  const { addToast } = useToast();
  const [busy, setBusy] = useState("");
  const list = Array.isArray(demos) ? demos : [];
  const link = schedulerLink(scheduleToken);
  const gate = record.demo_gate || null;
  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      addToast({ variant: "success", title: "Scheduler link copied. A demo booked with it links to this card." });
    } catch (err) {
      console.error("[crm] copy scheduler link failed:", err?.message || err);
      addToast({ variant: "error", title: "Couldn't copy the link", description: link });
    }
  };
  const unlink = async (bookingId) => {
    setBusy(bookingId);
    try {
      await demoUnlink(bookingId);
      addToast({ variant: "success", title: "Demo unlinked. It is back on Demos to link." });
      onChanged();
    } catch (err) {
      addToast({ variant: "error", title: "Couldn't unlink the demo", description: errorWords(err) });
    } finally {
      setBusy("");
    }
  };
  return (
    <section aria-label="Demos" data-record-section="demos" className={SECTION}>
      <h3 className={H3}><span>Demos (Google Meet) <span className="font-medium text-[var(--color-text-tertiary)]">· {list.length}</span></span></h3>
      {list.length === 0 ? (
        <p className="text-[13px] text-[var(--color-text-tertiary)]">No demo booked through the scheduler is linked yet.</p>
      ) : (
        <ul className="flex min-w-0 flex-col gap-1.5">
          {list.map((d) => (
            <li key={d.booking_id || d.id} data-demo={d.status} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--gray-200)] px-3 py-2 text-[12.5px] text-[var(--color-text-secondary)]">
              <span className="min-w-0 break-words">
                <b className="text-[var(--color-text-primary)]">{demoStatusWords(d.status)}</b> · {localWhen(d.call_at)}
                {d.status === "moved" && d.original_call_at ? <span> (was {localWhen(d.original_call_at)})</span> : null}
                {linkSourceWords(d.link_source) ? <span className="text-[var(--color-text-tertiary)]"> · {linkSourceWords(d.link_source)}{d.linked_by_name ? ` by ${d.linked_by_name}` : ""}</span> : null}
              </span>
              <span className="flex flex-wrap gap-1">
                {d.meet_url && d.status !== "cancelled" && d.status !== "declined" && (
                  <a href={d.meet_url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-lg px-2 font-semibold text-[var(--color-brand-700)] hover:bg-[var(--color-brand-50)]">Join <ExternalLink aria-hidden="true" className="ml-1 h-3.5 w-3.5" /></a>
                )}
                <Button variant="ghost" size="sm" className="min-h-11" disabled={disabled || busy === d.booking_id} loading={busy === d.booking_id} onClick={() => unlink(d.booking_id)}>Unlink</Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {gate?.demo_cancelled && (
        <p role="note" data-demo-cancelled="" className="rounded-lg bg-[var(--color-warning-50)] px-3 py-2 text-[12.5px] text-[var(--color-warning-700)]">
          <b>Demo cancelled.</b> The card stays where it is. Book a new demo, or move the card back.
        </p>
      )}
      {gate?.needs_linking && !gate?.demo_cancelled && (
        <p role="note" data-demo-needs-linking="" className="rounded-lg bg-[var(--a-sched-bg)] px-3 py-2 text-[12.5px] text-[var(--a-sched-ink)]">
          <b>Needs linking.</b> {needsLinkingWords(record)}
        </p>
      )}
      {gate?.locked && (
        <p role="note" data-demo-lock="" className="rounded-lg bg-[var(--color-error-50)] px-3 py-2 text-[12.5px] text-[var(--color-error-700)]">
          <b>Demo booked is locked.</b> {gate.reason || "It needs a Google Meet booked through the scheduler and linked to this card."}
        </p>
      )}
      {link ? (
        <div className="flex min-w-0 flex-wrap gap-2">
          <a href={link} target="_blank" rel="noopener noreferrer" data-book-demo=""
            className="inline-flex min-h-11 items-center gap-1 rounded-lg bg-[var(--color-brand-800)] px-3 text-[13px] font-semibold text-white hover:bg-[var(--color-brand-900)]">
            <Phone aria-hidden="true" className="h-3.5 w-3.5" />Book a demo
          </a>
          <Button variant="secondary" size="sm" className="min-h-11" onClick={copy} data-copy-scheduler="">Copy scheduler link</Button>
          <a href="#/inbound" className="inline-flex min-h-11 items-center rounded-lg border border-[var(--gray-200)] px-3 text-[13px] font-semibold text-[var(--color-text-primary)] hover:bg-[var(--gray-50)]">Link a booked demo</a>
        </div>
      ) : (
        <p className="text-[12.5px] text-[var(--color-text-tertiary)]">The card&apos;s scheduler link shows once the card has loaded.</p>
      )}
    </section>
  );
}

/**
 * Everything about one host or creator. Each field saves by itself when it
 * changes (selects, date, owners) or when focus leaves it (text).
 *
 * The rule this component keeps: nothing a person typed is ever lost quietly.
 *   - Every field whose save failed is remembered (not only the latest), the
 *     header names them, and Try again sends ALL of them.
 *   - The header never says Saved while anything is unsent or still typed.
 *   - Closing sends what is unsent first; if that fails the card stays open
 *     and says so, with Try again and "Close without saving".
 *   - If the page itself goes away, the text is kept and a message offers the
 *     card back.
 */
export function RecordPanel({
  pipeline,
  def,
  config,
  recordId,
  listRecord,
  pipe,
  online,
  canDelete,
  focusField,
  activityTick,
  suspended,
  holding = false,
  guardRef,
  onDirtyChange,
  onClose,
  onRequestMove,
  onDelete,
  onOpenCard,
  onRefreshRegions,
  footerExtra = null,
  // #4270 W7 rework (D-1): set inside the Brand group panel; links then open
  // in that panel (or show as plain words) and the page never changes.
  onOpenSide = null,
  // #4571 rework: archive, merge or undo changed the board's lists (Duplicate pairs, Show archived).
  onHygieneChanged = null,
}) {
  const { addToast } = useToast();
  const uid = useId();
  const fid = (key) => `${uid}-${key}`;
  const [detail, setDetail] = useState({ id: null, status: "loading", data: null, message: "" });
  const [reloadTick, setReloadTick] = useState(0);
  const [edits, setEdits] = useState(() => restoreLeftUnsent(recordId));
  const { drafts, unsent } = edits;
  const [savingCount, setSavingCount] = useState(0);
  const [savedAt, setSavedAt] = useState("");
  const [nameNote, setNameNote] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [closeBlocked, setCloseBlocked] = useState(false);
  const [cityMissing, setCityMissing] = useState(false);
  const regionRef = useRef(null);
  const askDeleteRef = useRef(null);
  const keepRef = useRef(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // The page gives each card its own `key`, so a different card starts clean.

  const { applyRecord } = pipe;
  useEffect(() => {
    let live = true;
    setDetail((d) => (d.id === recordId && d.status === "ready" ? d : { id: recordId, status: "loading", data: null, message: "" }));
    getRecord(recordId).then(
      (data) => {
        if (!live) return;
        if (!data?.record || data.record.pipeline !== pipeline) {
          setDetail({ id: recordId, status: "missing", data: null, message: "" });
          return;
        }
        applyRecord(data.record);
        setDetail({ id: recordId, status: "ready", data, message: "" });
      },
      (err) => {
        if (!live) return;
        if (err?.token === "not_found") {
          setDetail({ id: recordId, status: "missing", data: null, message: "" });
        } else {
          // A refresh that failed keeps the card that is already on screen.
          setDetail((d) =>
            d.id === recordId && d.status === "ready" ? d : { id: recordId, status: "error", data: null, message: loadErrorWords(err) }
          );
        }
      }
    );
    return () => {
      live = false;
    };
  }, [recordId, pipeline, reloadTick, activityTick, applyRecord]);

  const current = detail.id === recordId ? detail : { status: "loading", data: null, message: "" };
  const record = listRecord || current.data?.record || null;
  const usedChannels = useMemo(
    () => channelsUsed(current.data?.activity, config?.channels),
    [current.data?.activity, config?.channels],
  );
  const draftCount = useRecordDraftCount(record?.id || null);
  const locked = !online;
  // #4270 W2: the host card's one server read, shared by To do, On Mingla and
  // Brand and team. Details folds the rest; a deep link to a field opens it.
  const hostRead = useHostOnMingla(pipeline === "hosts" ? record?.id || null : null, record?.brand_id || "");
  const detailsRef = useRef(null);
  // #4571 W3: the Work section (hosts and creators), the people chips, the activity filter.
  const [workTick, setWorkTick] = useState(0);
  const work = useRecordWork(record?.id || null, `${activityTick}:${workTick}`);
  const directory = usePeopleDirectory();
  const [activityFilter, setActivityFilter] = useState("all");
  const [peopleBusy, setPeopleBusy] = useState(false);
  const logRef = useRef(null);
  const demosRef = useRef(null);
  // #4571 rework: each "Log call" opens the log form as a call, on its outcomes.
  const [callTick, setCallTick] = useState(0);
  const openLogCall = () => {
    setCallTick((n) => n + 1);
    const box = logRef.current;
    const fold = box?.closest?.("details");
    if (fold && !fold.open) fold.open = true;
    box?.scrollIntoView?.({ block: "center" });
  };
  // #4571 W3: the record's files, the Work card's files model (same bucket and limits).
  const fileUploads = useCardUploads(record?.id || null, () => setReloadTick((n) => n + 1), { record: true });
  // #4571 W3: the notes composer at the top of the timeline; Thread focuses it.
  const noteRef = useRef(null);
  const [note, setNote] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);
  const noteKey = useRef({ key: null, value: "" });
  const focusNote = () => {
    const box = noteRef.current;
    const fold = box?.closest?.("details");
    if (fold && !fold.open) fold.open = true;
    setActivityFilter("all");
    box?.scrollIntoView?.({ block: "center" });
    box?.focus?.();
  };

  // The latest values, for code that runs later (a close, an unmount).
  const live = useRef({ drafts, unsent, record, discarded: false });
  useEffect(() => {
    live.current = { ...live.current, drafts, unsent, record };
  }, [drafts, unsent, record]);

  useEffect(() => {
    if (!focusField || !record) return undefined;
    // #4270 W2: a field folded under Details opens it first.
    const t = setTimeout(() => {
      const target = document.getElementById(`${uid}-${focusField}`);
      const fold = target?.closest?.("details");
      if (fold && !fold.open) fold.open = true;
      target?.focus();
    }, 60);
    return () => clearTimeout(t);
  }, [focusField, record?.id, uid]); // eslint-disable-line react-hooks/exhaustive-deps

  const markMissing = useCallback(() => {
    live.current.discarded = true;
    setEdits({ drafts: {}, unsent: {} });
    setDetail({ id: recordId, status: "missing", data: null, message: "" });
    pipe.dropRecord(recordId);
  }, [recordId, pipe]);

  /** Keep the text and say so, for an edit that failed after the card went away. */
  const keepForLater = useCallback(
    (entries, name) => {
      if (entries.length === 0) return;
      const kept = { ...(leftUnsent.get(recordId) || {}) };
      for (const e of entries) kept[e.key] = e.value;
      leftUnsent.set(recordId, kept);
      const labels = Object.keys(kept).map((k) => fieldLabel(k, pipeline)).join(", ");
      addToast({
        variant: "error",
        title: `Changes to ${name} weren't saved`,
        description: `${labels}. What you typed is kept: open the card to send it again.`,
        action: {
          label: "Open the card",
          onClick: () => {
            // In the Brand group panel the card opens there again; elsewhere on its page.
            if (typeof onOpenSide === "function") onOpenSide(pipeline === "creators" ? "creator" : "host", recordId);
            else window.location.hash = buildCrmHash(pipeline, { card: recordId });
          },
        },
      });
    },
    [recordId, pipeline, addToast, onOpenSide]
  );

  // Saves that are on their way to the server, by field: key -> { value,
  // promise }. Closing a card while a field is still saving must wait for that
  // answer, not send the same value a second time.
  const inFlight = useRef(new Map());

  /** Send one field to the server. Returns true when the server took it. */
  const sendField = useCallback(
    async (key, value) => {
      const before = live.current.record;
      if (!before) return false;
      setEdits((e) => {
        const nextUnsent = { ...e.unsent };
        delete nextUnsent[key];
        return { drafts: { ...e.drafts, [key]: value }, unsent: nextUnsent };
      });
      setSavingCount((n) => n + 1);
      try {
        let res;
        if (key === "owners") {
          res = await pipe.setOwners(before.id, value);
        } else {
          let sent = value === "" ? null : value;
          if (key === "followers" && sent !== null) sent = Number(sent);
          res = await pipe.update(before.id, { [key]: sent });
        }
        if (!mounted.current) return true;
        setEdits((e) => {
          if (e.drafts[key] !== value) return e;
          const nextDrafts = { ...e.drafts };
          delete nextDrafts[key];
          return { drafts: nextDrafts, unsent: e.unsent };
        });
        setSavedAt(clockTime());
        if (key === "brand_id" || key === "place_pool_id") {
          if (res.moved_to === "live") {
            addToast({ variant: "success", title: `Linked. ${res.record.name} moved to Live.` });
          } else if (res.moved_to === "onboarded" && before.stage === "live") {
            addToast({
              variant: "warning",
              title: `${res.record.name} moved back to Onboarded`,
              description: "It is no longer linked to a brand with a public listing. Live sets itself again once it is.",
            });
          } else if (res.moved_to === "onboarded") {
            addToast({ variant: "success", title: `Linked. ${res.record.name} moved to Onboarded.` });
          }
          setReloadTick((n) => n + 1);
        }
        return true;
      } catch (err) {
        if (!mounted.current) {
          // The card is gone from the screen: never drop this quietly.
          if (err?.token !== "not_found") keepForLater([{ key, value }], before.name);
          return false;
        }
        if (err?.token === "not_found") {
          markMissing();
          return false;
        }
        setEdits((e) => ({
          drafts: e.drafts,
          unsent: {
            ...e.unsent,
            [key]: { value, message: errorWords(err), existingId: err?.token === "duplicate_name" ? err.detail : "" },
          },
        }));
        return false;
      } finally {
        if (mounted.current) setSavingCount((n) => Math.max(0, n - 1));
      }
    },
    [pipe, addToast, markMissing, keepForLater]
  );

  /**
   * Save the identifiers or the contact rule (each is saved the moment it is
   * changed, with its own answer). Resolves to { ok } or to the server's
   * sentence, with the record that already holds a contact detail when the
   * answer names one.
   */
  const saveExtra = useCallback(
    async (changes) => {
      const before = live.current.record;
      if (!before) return { message: "This card is no longer here." };
      setSavingCount((n) => n + 1);
      try {
        await pipe.update(before.id, changes);
        if (mounted.current) setSavedAt(clockTime());
        return { ok: true };
      } catch (err) {
        if (err?.token === "not_found" && mounted.current) markMissing();
        return { message: errorWords(err), existingId: err?.token === "duplicate_identifier" ? err.detail || "" : "" };
      } finally {
        if (mounted.current) setSavingCount((n) => Math.max(0, n - 1));
      }
    },
    [pipe, markMissing]
  );

  /** Save one field. Returns true when the server took it. */
  const save = useCallback(
    (key, value) => {
      const promise = sendField(key, value);
      const entry = { value, promise };
      inFlight.current.set(key, entry);
      promise.finally(() => {
        if (inFlight.current.get(key) === entry) inFlight.current.delete(key);
      });
      return promise;
    },
    [sendField]
  );

  const dropDraft = (key) =>
    setEdits((e) => {
      if (!Object.hasOwn(e.drafts, key) && !Object.hasOwn(e.unsent, key)) return e;
      const nextDrafts = { ...e.drafts };
      const nextUnsent = { ...e.unsent };
      delete nextDrafts[key];
      delete nextUnsent[key];
      return { drafts: nextDrafts, unsent: nextUnsent };
    });

  /** Check a typed value and send it. Returns true when nothing is left unsent for this field. */
  const commitValue = useCallback(
    async (key, typed) => {
      const rec = live.current.record;
      if (!rec) return false;
      const was = rec[key] === null || rec[key] === undefined ? "" : String(rec[key]);
      if (key === "name" && typed === "") {
        dropDraft("name");
        setNameNote("A name can't be empty, so the old one was kept.");
        return true;
      }
      if (key === "followers" && typed !== "" && !/^\d{1,9}$/.test(typed)) {
        setEdits((e) => ({
          drafts: { ...e.drafts, [key]: typed },
          unsent: { ...e.unsent, [key]: { value: typed, message: "Followers must be a whole number, 0 or more.", local: true } },
        }));
        return false;
      }
      if (typed === was) {
        dropDraft(key);
        return true;
      }
      return save(key, typed);
    },
    [save]
  );

  const commitText = (key) => {
    if (!Object.hasOwn(drafts, key)) return;
    commitValue(key, normalizeTyped(key, drafts[key]));
  };

  /**
   * Send EVERYTHING that has not reached the server: every field whose save
   * failed and anything typed and not yet sent. True when nothing is left.
   */
  const sendAll = useCallback(async () => {
    const { drafts: d, unsent: u, record: rec } = live.current;
    let ok = true;
    for (const edit of editsToSend(d, rec, u)) {
      const typed = TEXT_FIELDS.includes(edit.key);
      const value = typed ? normalizeTyped(edit.key, edit.value) : edit.value;
      const flying = inFlight.current.get(edit.key);
      let sent;
      if (flying && sameValue(flying.value, value)) {
        // This very value is already on its way: use that answer. Sending it
        // again would write the field (and its history) twice.
        sent = await flying.promise;
      } else {
        // A different value for a field that is mid-save goes after it.
        if (flying) await flying.promise;
        // Typed fields are checked again (a blank name, a non-number); the
        // rest are sent as they are.
        sent = typed ? await commitValue(edit.key, value) : await save(edit.key, value);
      }
      if (!sent) ok = false;
    }
    return ok;
  }, [save, commitValue]);

  const dirty = hasUnsavedEdits({ saving: savingCount, drafts, record, unsent });
  useEffect(() => {
    onDirtyChange?.(recordId, dirty);
  }, [recordId, dirty, onDirtyChange]);

  // What the page can ask of this card before it lets it go.
  useImperativeHandle(
    guardRef,
    () => ({
      id: recordId,
      /** Send what is unsent. False (and the card says why) when something still is. */
      flush: async () => {
        const ok = await sendAll();
        if (mounted.current) setCloseBlocked(!ok);
        return ok;
      },
      discard: () => {
        live.current.discarded = true;
        leftUnsent.delete(recordId);
        if (mounted.current) setEdits({ drafts: {}, unsent: {} });
      },
    }),
    [recordId, sendAll]
  );

  // The card is leaving the screen with something unsent (the person went to
  // another page): keep the text and say so.
  useEffect(
    () => () => {
      onDirtyChange?.(recordId, false);
      // Decided a tick later, and only if the card really is gone: React's
      // development mode runs every cleanup once on a card that stays.
      setTimeout(() => {
        if (mounted.current) return;
        const { drafts: d, unsent: u, record: rec, discarded } = live.current;
        if (discarded || !rec) return;
        const left = editsToSend(d, rec, u);
        if (left.length > 0) keepForLater(left, rec.name);
      }, 0);
    },
    [] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const val = (key) => {
    if (Object.hasOwn(drafts, key)) return drafts[key];
    const v = record?.[key];
    return v === null || v === undefined ? "" : String(v);
  };
  const setDraft = (key, value) => {
    setEdits((e) => {
      const nextUnsent = { ...e.unsent };
      // Typing again in a field that failed: it is "typed, not sent" again.
      delete nextUnsent[key];
      return { drafts: { ...e.drafts, [key]: value }, unsent: nextUnsent };
    });
    if (key === "name") setNameNote("");
  };

  const textProps = (key) => ({
    id: fid(key),
    value: val(key),
    disabled: locked,
    onChange: (e) => setDraft(key, e.target.value),
    onBlur: () => commitText(key),
    onKeyDown: (e) => {
      if (e.key === "Enter") e.currentTarget.blur();
    },
    className: CONTROL_CLASS,
  });
  const selectProps = (key) => ({
    id: fid(key),
    value: val(key),
    disabled: locked,
    onChange: (e) => save(key, e.target.value),
  });
  const fieldError = (key) => (Object.hasOwn(unsent, key) ? unsent[key].message : "");

  /** #4571 W3: a note from the timeline's composer; the same request key until it is sent. */
  const addNote = async () => {
    const body = note.trim();
    if (!body || noteBusy || !record) return;
    if (noteKey.current.value !== body) noteKey.current = { key: newRequestKey(), value: body };
    setNoteBusy(true);
    const res = await submitLog({ kind: "note", body }, noteKey.current.key);
    if (mounted.current) {
      setNoteBusy(false);
      if (res.ok) { setNote(""); noteKey.current = { key: null, value: "" }; }
      else addToast({ variant: "error", title: "Note not added", description: res.message });
    }
  };

  /** #4571 W3: owners and watchers in one step (crm_record_set_people). */
  const savePeople = async (owners, watchers, words) => {
    if (!record || peopleBusy) return;
    setPeopleBusy(true);
    try {
      const res = await setRecordPeople(record.id, owners, watchers, record.updated_at || null);
      if (res?.record) applyRecord(res.record);
      if (mounted.current) { setSavedAt(clockTime()); addToast({ variant: "success", title: words }); }
    } catch (err) {
      if (err?.token === "not_found") markMissing();
      else addToast({ variant: "error", title: "People not changed", description: errorWords(err) });
    } finally {
      if (mounted.current) setPeopleBusy(false);
    }
  };

  /** #4571 W3: a handle's follower count, as a person read it. */
  const saveFollowers = async (item, typed) => {
    const t = String(typed || "").trim();
    if (t !== "" && !/^\d{1,9}$/.test(t)) { addToast({ variant: "error", title: "Followers must be a whole number, 0 or more." }); return; }
    try {
      const res = await setFollowers(item.id, t === "" ? null : Number(t));
      if (res?.record) applyRecord(res.record);
      addToast({ variant: "success", title: t === "" ? "Follower count cleared" : "Follower count saved" });
    } catch (err) {
      addToast({ variant: "error", title: "Follower count not saved", description: errorWords(err) });
    }
  };

  const submitLog = async (entry, requestKey) => {
    try {
      const res = await pipe.log(record.id, entry, requestKey);
      if (mounted.current) {
        setDetail((d) =>
          d.id === recordId && d.data
            ? { ...d, data: { ...d.data, activity: [res.activity, ...(d.data.activity || []).filter((a) => a.id !== res.activity.id)] } }
            : d
        );
        addToast({ variant: "success", title: "Added to the log" });
        setWorkTick((n) => n + 1);
      }
      // #4571 W2: the answer goes back to the form (a call's suggested next step).
      return { ok: true, result: res };
    } catch (err) {
      if (err?.token === "not_found") markMissing();
      return { ok: false, message: errorWords(err), retryable: err?.token === "network" || err?.token === "unknown" };
    }
  };

  // Keyboard: focus goes INTO the delete question, and back to the button that
  // asked when the answer is Keep.
  const askedRef = useRef(false);
  useEffect(() => {
    if (confirmDelete) {
      askedRef.current = true;
      keepRef.current?.focus();
    } else if (askedRef.current) {
      askedRef.current = false;
      askDeleteRef.current?.focus();
    }
  }, [confirmDelete]);

  const doDelete = async () => {
    setDeleting(true);
    const ok = await onDelete(record);
    if (mounted.current) {
      setDeleting(false);
      if (!ok) setConfirmDelete(false);
    }
  };

  const closeWithoutSaving = () => {
    live.current.discarded = true;
    leftUnsent.delete(recordId);
    setEdits({ drafts: {}, unsent: {} });
    setCloseBlocked(false);
    onDirtyChange?.(recordId, false);
    onClose();
  };

  const plural = def.label;
  const singular = def.singular;

  // ── States with no card to show ──────────────────────────────────────────
  if (!record) {
    const title =
      current.status === "missing"
        ? `That ${singular} is no longer here.`
        : current.status === "error"
          ? `Couldn't open this ${singular}`
          : `Opening ${singular}`;
    return (
      <Drawer open onClose={onClose} title={title}>
        {current.status === "loading" && (
          <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading">
            <Skeleton height={40} />
            <div className="grid grid-cols-2 gap-3">
              <Skeleton height={40} />
              <Skeleton height={40} />
              <Skeleton height={40} />
              <Skeleton height={40} />
            </div>
            <Skeleton height={72} />
            <Skeleton height={14} width="60%" />
          </div>
        )}
        {current.status === "missing" && (
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-[var(--color-text-secondary)]">
              It may have been deleted, or this link is for something that was never in {plural}.
            </p>
            <Button variant="primary" onClick={onClose}>
              Back to {plural}
            </Button>
          </div>
        )}
        {current.status === "error" && (
          <div className="flex flex-col items-start gap-3" role="alert">
            <p className="text-sm text-[var(--color-text-secondary)]">{current.message}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => setReloadTick((n) => n + 1)}>
                Try again
              </Button>
              <Button variant="secondary" onClick={onClose}>
                Back to {plural}
              </Button>
            </div>
          </div>
        )}
      </Drawer>
    );
  }

  // #4270 W2: a deep link to a host field opens Details before focusing it.
  const fillIn = (what) => {
    const target = document.getElementById(fid(what === "type" ? "icp" : what === "region" ? "region_id" : "contact"));
    const fold = target?.closest?.("details") || detailsRef.current;
    if (fold && !fold.open) fold.open = true;
    target?.scrollIntoView?.({ block: "center" });
    target?.focus?.();
  };

  // ── The card ─────────────────────────────────────────────────────────────
  const pending = pipe.pendingIds.has(record.id);
  const next = nextStage(def, record);
  const closing = terminalStage(def);
  const here = stageDef(def, record.stage);
  const isHosts = pipeline === "hosts";
  const keepsAgreement = stageNeedsSignedAgreement(def, record.stage);
  const opt = (list) => (list || []).map((o) => ({ value: o.id, label: o.label }));
  const regionOptions = (config.regions || []).map((r) => ({
    value: r.id,
    label: r.is_live ? r.name : `${r.name} (not live yet)`,
  }));
  if (record.region_id && !regionOptions.some((r) => r.value === record.region_id)) {
    regionOptions.push({ value: record.region_id, label: "A region no longer in the list" });
  }
  regionOptions.push({ value: MISSING_CITY, label: MISSING_CITY_LABEL });
  const rule = contactRuleView(record, config.team);
  const stageOptions = def.stages.map((s) => ({
    value: s.id,
    label: s.label,
    disabled: s.id !== record.stage && (!!s.auto || (!!here?.auto && !s.terminal) || demoLocked(def, record, s.id)),
    locked: s.id !== record.stage && demoLocked(def, record, s.id),
  }));
  // #4571 rework: the next stage needs a linked demo first; offer the gate action instead.
  const nextLocked = !!next && moveBlocker(def, record, next.id)?.token === "demo_required";
  let stageHelp = "";
  if (here?.auto) stageHelp = MOVE_BLOCK_COPY.stage_is_live;
  else if (isHosts) stageHelp = "Live sets itself when the linked brand has a public listing.";
  else if (record.agreement !== "signed" && !here?.terminal) stageHelp = "Booked and Posted need the agreement marked as signed.";

  const line = saveLine({ saving: savingCount, drafts, record, unsent, savedAt });
  const names = line.keys.map((k) => fieldLabel(k, pipeline)).join(", ");
  const canRetry = line.kind === "unsent" && line.keys.some((k) => !unsent[k]?.local);
  const duplicate = Object.values(unsent).find((u) => u.existingId) || null;
  const header = (
    <div className="min-w-0">
      <input
        id={fid("name")}
        aria-label="Name"
        type="text"
        maxLength={160}
        value={val("name")}
        disabled={locked}
        onChange={(e) => setDraft("name", e.target.value)}
        onBlur={() => commitText("name")}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className="h-10 w-full rounded-lg border border-transparent bg-transparent px-2 text-lg font-semibold text-[var(--color-text-primary)] outline-none transition-colors duration-150 hover:border-[var(--gray-300)] focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-100)] disabled:cursor-not-allowed disabled:opacity-70"
      />
      <div className="mt-1 flex min-h-8 flex-wrap items-center gap-2 px-2 text-xs" aria-live="polite">
        {line.kind === "saving" ? (
          <span className="text-[var(--color-text-tertiary)]">{holding ? "Saving before closing…" : "Saving…"}</span>
        ) : line.kind === "unsent" ? (
          <>
            <span className="font-semibold text-[var(--color-error-700)]">Not saved: {names}</span>
            {canRetry && (
              <Button variant="secondary" size="sm" className="max-sm:h-11" disabled={locked} onClick={sendAll}>
                Try again
              </Button>
            )}
          </>
        ) : line.kind === "pending" ? (
          <span className="text-[var(--color-text-tertiary)]">
            {names} not saved yet. It saves when you leave the field.
          </span>
        ) : line.kind === "saved" ? (
          <span className="text-[var(--color-success-700)]">Saved · {savedAt}</span>
        ) : (
          <span className="text-[var(--color-text-tertiary)]">Changes save as you make them</span>
        )}
      </div>
      {line.kind === "unsent" && (
        <p role="alert" className="px-2 text-xs text-[var(--color-error-700)]">
          {line.keys.length === 1 ? unsent[line.keys[0]].message : "What you typed is still here. Try again sends all of it."}{" "}
          {duplicate && (
            <button
              type="button"
              className="cursor-pointer font-semibold underline"
              onClick={() => onOpenCard(duplicate.existingId)}
            >
              Open it
            </button>
          )}
        </p>
      )}
      {closeBlocked && line.kind !== "saved" && line.kind !== "idle" && line.kind !== "saving" && (
        <div
          role="alert"
          className="mx-2 mt-2 flex flex-col gap-2 rounded-lg bg-[var(--color-warning-50)] px-3 py-2 text-xs text-[var(--color-warning-700)]"
        >
          <span>
            The card stayed open because {names} {line.keys.length === 1 ? "isn't" : "aren't"} saved. What you typed is still here.
          </span>
          <span className="flex flex-wrap gap-2">
            {canRetry && (
              <Button variant="secondary" size="sm" className="max-sm:h-11" disabled={locked} onClick={sendAll}>
                Try again
              </Button>
            )}
            <Button variant="ghost" size="sm" className="max-sm:h-11" onClick={closeWithoutSaving}>
              Close without saving
            </Button>
          </span>
        </div>
      )}
      {nameNote && <p className="px-2 text-xs text-[var(--color-text-tertiary)]">{nameNote}</p>}
    </div>
  );

  const footer = canDelete ? (
    confirmDelete ? (
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Confirm delete">
        <span className="text-sm text-[var(--color-text-primary)]">Delete for everyone?</span>
        <Button variant="danger" size="sm" className="max-sm:h-11" loading={deleting} disabled={locked} onClick={doDelete}>
          Delete
        </Button>
        <Button ref={keepRef} variant="ghost" size="sm" className="max-sm:h-11" disabled={deleting} onClick={() => setConfirmDelete(false)}>
          Keep
        </Button>
      </div>
    ) : (
      <Button ref={askDeleteRef} variant="ghost" size="sm" className="max-sm:h-11" disabled={locked || pending} onClick={() => setConfirmDelete(true)}>
        Delete
      </Button>
    )
  ) : closing && record.stage !== closing.id ? (
    <Button
      variant="ghost"
      size="sm"
      className="max-sm:h-11"
      disabled={locked || pending}
      onClick={() => onRequestMove(record, closing.id)}
    >
      Mark as {closing.label.toLowerCase()}
    </Button>
  ) : (
    <p className="text-xs text-[var(--color-text-tertiary)]">Only an owner or admin can delete.</p>
  );

  return (
    <Drawer open onClose={onClose} title={record.name} header={header} footer={footer} suspended={suspended}>
      {/* The space at the end is as tall as any message shown over the card on
          a phone, so the last fields can always be scrolled clear of it
          (components/ui/Toast.jsx sets --toast-clear). */}
      <div className="flex flex-col gap-5" style={{ paddingBottom: "var(--toast-clear, 0px)" }}>
        {locked && (
          <p className="rounded-lg bg-[var(--color-warning-50)] px-3 py-2 text-xs text-[var(--color-warning-700)]">
            You&apos;re offline. You can read this card, but changes won&apos;t save until you&apos;re back.
          </p>
        )}
        {rule && (
          <p
            role="status"
            className={[
              "flex min-w-0 flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-[13px]",
              rule.variant === "error"
                ? "bg-[var(--color-error-50)] text-[var(--color-error-700)]"
                : "bg-[var(--color-warning-50)] text-[var(--color-warning-700)]",
            ].join(" ")}
          >
            <Badge variant={rule.variant}>{rule.label}</Badge>
            <span className="min-w-0 break-words">{rule.banner.slice(rule.label.length).replace(/^ \u00b7 /, "")}</span>
          </p>
        )}
        {draftCount > 0 && (
          <SideLink
            side={{ kind: "drafts", id: record.id }}
            href={`#/drafts?record=${record.id}`}
            aria-label={`${draftCount} ${draftCount === 1 ? "draft" : "drafts"} waiting for ${record.name}. Review drafts.`}
            className="flex min-h-11 w-full items-center gap-2 rounded-lg border border-[var(--gray-200)] bg-[var(--color-background-primary)] px-3 text-[13.5px] font-semibold text-[var(--color-text-primary)] hover:bg-[var(--gray-50)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)]"
          >
            <FileText aria-hidden="true" className="h-4 w-4 shrink-0" />
            <span>{draftCount} {draftCount === 1 ? "draft" : "drafts"} waiting</span>
            <ArrowRight aria-hidden="true" className="ml-auto h-4 w-4 shrink-0" />
          </SideLink>
        )}
        {/* #4571 W3: the WorkDetail anatomy. Region and type, quick links,
            a stage pill with one next action, then people and follow-up chips. */}
        <div className="flex min-w-0 flex-col gap-2" data-record-section="top">
          <p className="text-[12.5px] text-[var(--color-text-tertiary)]">{[plural, here?.label].filter(Boolean).join(" › ")} · {[(config.regions || []).find((r) => r.id === record.region_id)?.name, (def.icps || []).find((i) => i.id === record.icp)?.label].filter(Boolean).join(" · ") || "No region or type yet"}</p>
          <QuickLinks record={record} big>
            <Button variant="ghost" size="sm" className="min-h-9" icon={Plus} disabled={locked} onClick={() => fillIn("contact")}>Website</Button>
            <Button variant="ghost" size="sm" className="min-h-9" icon={Plus} disabled={locked} onClick={() => fillIn("contact")}>Email</Button>
            <Button variant="ghost" size="sm" className="min-h-9" icon={Plus} disabled={locked} onClick={() => fillIn("contact")}>Social</Button>
          </QuickLinks>
          {(record.identifiers || []).filter((i) => i.kind === "handle" && i.id).length > 0 && (
            <details className="text-[12px] text-[var(--color-text-tertiary)]">
              <summary className="min-h-9 cursor-pointer">Follower counts</summary>
              <div className="mt-1 flex flex-col gap-1">
                {(record.identifiers || []).filter((i) => i.kind === "handle" && i.id).map((i) => (
                  <label key={i.id} className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 flex-1 truncate">{i.value}</span>
                    <input type="text" inputMode="numeric" maxLength={9} defaultValue={i.followers ?? ""} disabled={locked} aria-label={`Followers of ${i.value}`}
                      onBlur={(e) => { if (String(i.followers ?? "") !== e.target.value.trim()) saveFollowers(i, e.target.value); }}
                      className={`${CONTROL_CLASS} h-9 w-28`} />
                  </label>
                ))}
              </div>
            </details>
          )}
        </div>
        <section aria-label="Stage" data-record-section="stage" className="flex min-w-0 flex-wrap items-center gap-2">
          <PropChip label="Stage" value={here?.label || record.stage} disabled={locked || pending} width="w-60">
            {(closeIt) => stageOptions.map((o) => (
              <button key={o.value} type="button" disabled={o.disabled || o.value === record.stage} aria-pressed={o.value === record.stage}
                onClick={() => { closeIt(); onRequestMove(record, o.value); }}
                className="min-h-9 rounded-md px-2 text-left text-[13px] hover:bg-[var(--gray-50)] disabled:opacity-50">{o.label}{o.locked ? ` · ${demoLockWords(o.value)}` : ""}</button>
            ))}
          </PropChip>
          {next && !nextLocked && (
            <Button size="sm" className="min-h-11 max-sm:h-11" iconRight={ArrowRight} disabled={locked || pending} onClick={() => onRequestMove(record, next.id)}>
              Move to {next.label}
            </Button>
          )}
          {nextLocked && (
            <>
              <span data-next-locked="" className="inline-flex min-h-11 items-center gap-1 text-[12.5px] font-semibold text-[var(--color-error-700)]">
                <Lock aria-hidden="true" className="h-3.5 w-3.5" />{next.label} locked
              </span>
              <Button size="sm" className="min-h-11 max-sm:h-11" icon={Calendar} data-gate-action="" disabled={locked}
                onClick={() => { const box = demosRef.current; box?.scrollIntoView?.({ block: "center" }); box?.querySelector?.("a, button")?.focus?.(); }}>
                Book a demo
              </Button>
            </>
          )}
          <Button variant="secondary" size="sm" className="min-h-11" icon={Phone} disabled={locked} data-log-call="" onClick={openLogCall}>
            Log call
          </Button>
          <Button variant="ghost" size="sm" className="min-h-11" icon={MessageSquare} data-thread-button="" onClick={focusNote}>Thread</Button>
          {(record.stage_reason || stageHelp) && <p className="w-full text-[12px] text-[var(--color-text-tertiary)]">{record.stage_reason ? `Reason: ${record.stage_reason}. ` : ""}{stageHelp}</p>}
        </section>
        {/* #4571 W6: archive state, merge, a reply that suggests Replied, the cadence round. */}
        <RecordHygiene record={record} pipeline={pipeline} disabled={locked || pending}
          onChanged={() => { setReloadTick((n) => n + 1); pipe.refetch({ quiet: true }); onHygieneChanged?.(); }}
          onRequestMove={onRequestMove} onOpenCard={onOpenCard} />
        <section aria-label="People and details" data-record-section="people" className="flex min-w-0 flex-wrap items-center gap-1">
          <PeopleChip id={fid("owners-pop")} label="Owners" people={(record.owners || []).map((e) => (config.team || []).find((p) => p.email === e) || { email: e, name: e })} field={
            <PeopleField id={fid("owners")} label="Owners" value={record.owners || []} team={directory.people || config.team} me={directory.me}
              exclude={record.watchers || []} min={(record.owners || []).length ? 1 : 0} max={10} minWords={lastOwnerWords} hint={OWNERS_HINT}
              disabled={locked} busy={peopleBusy}
              onChange={(nextOwners) => savePeople(nextOwners, record.watchers || [], "Owners changed")} />
          } />
          <PeopleChip id={fid("watchers-pop")} label="Watching" people={(record.watchers || []).map((e) => (config.team || []).find((p) => p.email === e) || { email: e, name: e })} field={
            <PeopleField id={fid("watchers")} label="Watching" value={record.watchers || []} team={directory.people || config.team} me={directory.me}
              exclude={record.owners || []} min={0} max={10} minWords={lastWatcherWords} hint={WATCHERS_HINT}
              disabled={locked} busy={peopleBusy}
              onChange={(nextWatchers) => savePeople(record.owners || [], nextWatchers, "Watchers changed. They hear about stage moves and see calls.")} />
          } />
          <PropChip label="Next follow-up" value={record.next_action || ""} empty="Next follow-up" disabled={locked} width="w-72">
            {(closeIt) => (
              <input type="text" autoFocus maxLength={200} placeholder="What happens next" aria-label="Next action" defaultValue={record.next_action || ""}
                onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                onBlur={(e) => { const t = normalizeTyped("next_action", e.target.value); closeIt(); if (t !== (record.next_action || "")) save("next_action", t); }}
                className={CONTROL_CLASS} />
            )}
          </PropChip>
          <PropChip label="Due" value={record.due_on ? dayLabel(record.due_on) : ""} disabled={locked} width="w-56">
            {(closeIt) => (
              <>
                {dueChoices(localToday()).map((c) => (
                  <button key={c.label} type="button" onClick={() => { closeIt(); save("due_on", c.value); }}
                    className="min-h-9 rounded-md px-2 text-left text-[13px] hover:bg-[var(--gray-50)]">{c.label} <span className="text-[var(--color-text-tertiary)]">{dayLabel(c.value)}</span></button>
                ))}
                {record.due_on && <button type="button" onClick={() => { closeIt(); save("due_on", ""); }} className="min-h-9 rounded-md px-2 text-left text-[13px] text-[var(--color-error-700)] hover:bg-[var(--gray-50)]">Clear the date</button>}
              </>
            )}
          </PropChip>
          {fieldError("next_action") && <p role="alert" className="w-full text-xs text-[var(--color-error-700)]">{fieldError("next_action")}</p>}
          {fieldError("due_on") && <p role="alert" className="w-full text-xs text-[var(--color-error-700)]">{fieldError("due_on")}</p>}
          {fieldError("owners") && <p role="alert" className="w-full text-xs text-[var(--color-error-700)]">{fieldError("owners")}</p>}
        </section>
        {isHosts && (!(record.owners || []).length || hostMissing(record).length > 0) && (
          <div data-needs-attention="" className="flex min-w-0 flex-col gap-1.5 rounded-xl bg-[var(--color-error-50)] px-3 py-2.5 text-[13px]">
            <b className="text-[var(--color-error-700)]">Needs attention</b>
            {!(record.owners || []).length && (
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                <span className="text-[var(--color-text-primary)]">No owner</span>
                {config.me?.email && <Button variant="secondary" size="sm" className="min-h-11" disabled={locked} onClick={() => { const mine = String(config.me?.email || "").toLowerCase(); if (mine) save("owners", [...new Set([...(record.owners || []), mine])].sort()); }}>Assign to me</Button>}
              </div>
            )}
            {hostMissing(record).length > 0 && (
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 break-words text-[var(--color-text-primary)]">Missing {hostMissing(record).join(", ")}</span>
                <Button variant="secondary" size="sm" className="min-h-11" disabled={locked} onClick={() => fillIn(hostMissing(record)[0])}>Fill in</Button>
              </div>
            )}
          </div>
        )}
        {/* #4571 W3: Work for hosts and creators (crm_record_work); its Add work item keeps #4270's form. */}
        <HostToDoSection key={`record-work-${record.id}`} record={record} read={work} online={online && !locked} onAdded={() => { work.retry(); if (isHosts) hostRead.retry(); }} />
        {isHosts && <div ref={demosRef} className="min-w-0"><DemosSection record={record} demos={current.data?.demos} scheduleToken={current.data?.schedule_token} disabled={locked || !online} onChanged={() => setReloadTick((n) => n + 1)} /></div>}
        <CallsSection activity={current.data?.activity} disabled={locked} onLogCall={openLogCall} />
        {isHosts && (
          <>
            {/* #4270: the plan (W3), On Mingla, Brand and team stay on the host card. */}
            <HostPlanSection key={`host-plan-${record.id}`} record={record} online={online && !locked} onChanged={() => hostRead.retry()} />
            <div className="border-t border-[var(--gray-200)] pt-3">
              <OnMinglaSection key={`on-mingla-${record.id}`} record={record} read={hostRead} online={online && !locked} />
            </div>
            <HostTeamSection record={record} read={hostRead} onOpenSide={onOpenSide} />
          </>
        )}
        {/* #4270 W2: hosts fold contact, ICP, region, channels, contact rule,
            imports, the log form and activity under one Details row. */}
        <DetailsFold isHosts detailsRef={detailsRef} fid={fid}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="ICP" htmlFor={fid("icp")} error={fieldError("icp")}>
            <Select {...selectProps("icp")} placeholder="None yet" options={opt(def.icps)} />
          </Field>
          <Field label="Region" htmlFor={fid("region_id")} error={fieldError("region_id")}>
            <Select
              {...selectProps("region_id")}
              ref={regionRef}
              placeholder="None yet"
              options={regionOptions}
              onChange={(e) => {
                if (e.target.value === MISSING_CITY) setCityMissing(true);
                else save("region_id", e.target.value);
              }}
            />
          </Field>
          {cityMissing && (
            <MissingCityLayer
              canAddRegion={!!config.me?.can_add_region}
              onRefresh={onRefreshRegions}
              onClose={() => {
                setCityMissing(false);
                regionRef.current?.focus();
              }}
            />
          )}
          <Field label={isHosts ? "Contact" : "Handle and reach"} htmlFor={fid("contact")} full error={fieldError("contact")}>
            <input type="text" maxLength={300} placeholder="Who to talk to" {...textProps("contact")} />
          </Field>
          <IdentifiersField
            value={record.identifiers}
            disabled={locked}
            onChange={(list, options) =>
              saveExtra(
                options?.allowShared
                  ? { identifiers: identifiersToSend(list), allow_shared_identifier: true }
                  : { identifiers: identifiersToSend(list) }
              )
            }
            onOpenRecord={onOpenCard}
          />
          <ContactRuleField record={record} disabled={locked} onSave={saveExtra} />
          <Field label="Preferred channel" htmlFor={fid("channel")} error={fieldError("channel")}>
            <Select {...selectProps("channel")} placeholder="None yet" options={opt(config.channels)} />
          </Field>
          <Field label="Source" htmlFor={fid("source")} error={fieldError("source")}>
            <Select {...selectProps("source")} placeholder="None yet" options={opt(config.sources)} />
          </Field>
          <div className="sm:col-span-2" aria-label="Channels used">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">Channels used</span>
            {usedChannels.length ? (
              <div className="flex flex-wrap gap-2">
                {usedChannels.map((channel) => (
                  <span key={channel.id} title={`First used ${new Date(channel.firstUsedAt).toLocaleString()} · Last used ${new Date(channel.lastUsedAt).toLocaleString()}`} className="rounded-full border border-[var(--gray-200)] bg-[var(--gray-50)] px-2.5 py-1 text-xs text-[var(--color-text-secondary)]">
                    <b className="text-[var(--color-text-primary)]">{channel.label}</b> · last used {relativeTime(channel.lastUsedAt)}{channel.count > 1 ? ` · ${channel.count} touches` : ""}
                  </span>
                ))}
              </div>
            ) : <p className="text-xs text-[var(--color-text-tertiary)]">No contact logged yet.</p>}
          </div>
          {isHosts ? (
            <MinglaLinkField
              record={record}
              links={current.data?.links}
              disabled={locked}
              saving={savingCount > 0}
              onSave={(changes) => {
                const [key] = Object.keys(changes);
                return save(key, changes[key] === null ? "" : changes[key]);
              }}
            />
          ) : (
            <fieldset className="grid grid-cols-1 gap-3 rounded-lg border border-[var(--gray-200)] p-3 sm:col-span-2 sm:grid-cols-2">
              <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">
                Deal
              </legend>
              <Field label="Followers" htmlFor={fid("followers")} error={fieldError("followers")}>
                <input type="text" inputMode="numeric" maxLength={9} placeholder="For example 12000" {...textProps("followers")} />
              </Field>
              <Field
                label="Agreement"
                htmlFor={fid("agreement")}
                error={fieldError("agreement")}
                helper={
                  keepsAgreement
                    ? `${here.label} keeps a signed agreement. Move the card back to Negotiating to change it.`
                    : "Mark it Signed before moving to Booked."
                }
              >
                <Select
                  {...selectProps("agreement")}
                  disabled={locked || keepsAgreement}
                  placeholder="None yet"
                  options={opt(config.agreements)}
                />
              </Field>
              <Field label="Rate" htmlFor={fid("rate")} full error={fieldError("rate")}>
                <input type="text" maxLength={120} placeholder="What they charge, in their words" {...textProps("rate")} />
              </Field>
            </fieldset>
          )}
          {isHosts && (fieldError("brand_id") || fieldError("place_pool_id")) && (
            <p role="alert" className="text-xs text-[var(--color-error-700)] sm:col-span-2">
              {fieldError("brand_id") || fieldError("place_pool_id")}
            </p>
          )}
        </div>

        {current.data?.imports?.length > 0 && (
          <section
            aria-labelledby={fid("import-history")}
            className="rounded-xl border border-[var(--gray-200)] bg-[var(--gray-50)] p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 id={fid("import-history")} className="text-sm font-semibold text-[var(--color-text-primary)]">
                  Imported from ClickUp
                </h3>
                <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">
                  Original cards are kept as read-only context. Work continues here in Mingla.
                </p>
              </div>
              <Badge variant="default">
                {current.data.imports.length} {current.data.imports.length === 1 ? "source card" : "source cards"}
              </Badge>
            </div>
            <ul className="mt-3 space-y-2">
              {current.data.imports.map((item) => (
                <li
                  key={`${item.source_system}:${item.source_id}`}
                  className="flex min-w-0 flex-col gap-2 rounded-lg border border-[var(--gray-200)] bg-[var(--color-background-primary)] px-3 py-2.5 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-[var(--color-text-primary)]">
                      {item.task_name || record.name}
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
                      {[item.original_status && `Original stage: ${item.original_status}`, item.city].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  {item.source_url && (
                    <a
                      href={item.source_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-[var(--color-brand-700)] hover:bg-[var(--color-brand-50)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)]"
                    >
                      Open original
                      <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}


        <RecentTouchNotice key={`signals-${record.id}`} record={record} online={online} />

        <div ref={logRef} data-record-section="log" className="border-t border-[var(--gray-200)] pt-4">
          <LogForm key={record.id} record={record} config={config} def={def} disabled={locked} onSubmit={submitLog} callTick={callTick} />
        </div>

        <div data-record-section="note" className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-[var(--gray-200)] p-2">
          <label htmlFor={fid("note")} className="sr-only">Add a note</label>
          <textarea ref={noteRef} id={fid("note")} rows={2} maxLength={2000} value={note} disabled={locked || noteBusy}
            placeholder="Add a note for the team" onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); addNote(); } }}
            className={`${CONTROL_CLASS} min-h-[44px] py-2`} />
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" className="min-h-11" loading={noteBusy} disabled={locked || noteBusy || !note.trim()} onClick={addNote}>Add note</Button>
            <span className="text-[12px] text-[var(--color-text-tertiary)]">Touches, stage moves, calls and notes in one list.</span>
          </div>
        </div>
        <div role="group" aria-label="Filter activity" className="flex flex-wrap gap-1">
          {ACTIVITY_FILTERS.map(([k, l]) => (
            <button key={k} type="button" aria-pressed={activityFilter === k} onClick={() => setActivityFilter(k)}
              className={`min-h-9 rounded-full border px-2.5 text-[12px] font-semibold ${activityFilter === k ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)]" : "border-[var(--gray-200)] text-[var(--color-text-secondary)]"}`}>{l}</button>
          ))}
        </div>
        <ActivityLog
          activity={(current.data?.activity || []).filter((a) => activityFilter === "all" || activityFilterKind(a) === activityFilter)}
          def={def}
          config={config}
          loading={current.status === "loading"}
        />
        {current.status === "error" && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-error-700)]" role="alert">
            <span>Couldn&apos;t load the activity. {current.message}</span>
            <Button variant="secondary" size="sm" className="max-sm:h-11" onClick={() => setReloadTick((n) => n + 1)}>
              Try again
            </Button>
          </div>
        )}
        </DetailsFold>
        {/* #4571 W3: Files, the Work card's files section on a host or creator. */}
        <div data-record-section="files" className="border-t border-[var(--gray-200)] pt-3">
          <CardFiles card={record} record files={current.data?.files || []} disabled={locked} uploads={fileUploads} onChanged={() => setReloadTick((n) => n + 1)} />
        </div>
        {footerExtra}
      </div>
    </Drawer>
  );
}
