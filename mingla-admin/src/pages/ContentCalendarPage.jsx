// Issue #3980 (R6) — the Calendar. Month first: every host's events with one
// of four plain states, today clearly marked and past days faded, posts
// behind Events | Posts | Both, a List grouped by state, and the content
// workflow board as its own view. With nothing open the month is full width
// and nothing sits under it (the grouped list is List view); the selected event (its sentence and its
// eight steps), a whole day or the posts with no date open in a right column
// (two columns from 1180px). The grid never scrolls sideways and words never
// break letter by letter.
//
// Issue #4130 (Wave 4a): one search filters the events and the posts. Events
// of staff or test brands are hidden unless asked for (calendar_runway).
//
// Issue #4255 (Wave 3): two views only, Month (the default) and Board (the
// posts board); the list view and its runway table are gone (?view=list opens
// Month). A Show dropdown (Everything, Events, Posts), the search and the test
// toggle apply to both views. Anything clicked opens in the first side panel
// (components/ui/PanelStack); a host, a work card or a post linked from it
// opens in the second, beside it, so nothing typed is lost. The table's two
// actions moved: Make a card and Plan a post sit in the event panel and in the
// page header. The two state tiles filter the month instead of opening a list.
//
// Issue #4339 Creators and Locals calls (Seth approved, 9 Nov): every booked
// call (Host, Creator and Local) is on the month too, read through
// admin_calendar_calls beside ops_calendar. Show gains Calls (Everything
// includes them). A call is an instant: it sits on its LOCAL day in the
// viewer's own time zone, time first, then its badge, then the name, and the
// footnote names that zone. Selecting one opens its panel (name, when in the
// viewer's zone, the booker's own time, what they run or make, city, social,
// Join video call and Open lead). On a phone a call is one dot like an event.
// #4339 calendar sync: a moved call sits at its new time with a "Moved" badge
// (the panel names the booked time); a cancelled or declined call stays,
// struck through, with a "Cancelled" / "Declined" badge and a hollow phone
// dot. The panel names the status and when it changed.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ClipboardList, Plus, Search, X } from "lucide-react";
import { PageHeader } from "../components/ui/PageHeader";
import { Button } from "../components/ui/Button";
import { AlertCard, SectionCard } from "../components/ui/Card";
import { Modal, ModalBody, ModalFooter } from "../components/ui/Modal";
import { Drawer } from "../components/ui/Drawer";
import { FilterSelect } from "../components/ui/FilterSelect";
import { PanelLinksContext, PanelStack, SideLink } from "../components/ui/PanelStack";
import { SidePanel } from "../components/panels/SidePanel";
import { WorkAddForm } from "../components/ops/WorkAddForm";
import { Segmented, CONTROL_CLASS } from "../components/crm/fields";
import { ContentCard } from "../components/contentCalendar/ContentCard";
import { ContentDrawer } from "../components/contentCalendar/ContentDrawer";
import { PeopleField } from "../components/people/PeopleField";
import { useHashQuery } from "../hooks/useHashQuery";
import { usePanelStack } from "../hooks/usePanelStack";
import { useOpsConfig } from "../hooks/useOpsConfig";
import { useOnline } from "../hooks/useCrmPipeline";
import { useContentCalendar } from "../hooks/useContentCalendar";
import { usePeopleDirectory } from "../hooks/usePeopleDirectory";
import { useOpsAttention } from "../hooks/useOpsWork";
import { useToast } from "../context/ToastContext";
import {
  CONTENT_STAGES,
  canMoveTo,
  contentErrorWords,
  createLatestOnlyGate,
  createSingleFlight,
  localDateKey,
  monthKey,
  monthWindow,
  moveNeedsFields,
  movePrompt,
  onCalendar,
  stageLabel,
  requestKey,
} from "../lib/contentCalendarModel";
import * as service from "../services/contentCalendarService";
import { EventPanel } from "../components/ops/EventPanel";
import { StateDot, StatePill } from "../components/ops/StateDot";
import { useCalendarCalls, useOpsCalendar } from "../hooks/useOpsCalendar";
import { CALL_LABELS, calendarZoneNote, callEntriesOn, callRange, callView, viewerTimeZone } from "../lib/calendarCalls";
import { useServerRead } from "../hooks/useServerRead";
import { getCalendarRunway } from "../services/dashboardService";
import { runwayAction, runwayCardItem, runwayPostTitle, testAnchorIds, visibleRunwayRows } from "../lib/calendarRunway";
import * as ops from "../services/opsService";
import { PLAIN_STATES, STATE_LEGEND, dayLong, opsErrorWords, parseEventParam, stateName, todayIso } from "../lib/opsModel";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";
const WORDS = "break-normal [overflow-wrap:normal] hyphens-none";
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
// #4255: Month and Board only. An old list address opens Month.
const VIEW_OPTIONS = [
  { value: "calendar", label: "Month" },
  { value: "board", label: "Board" },
];
const SHOW_OPTIONS = [
  { value: "", label: "Everything" },
  { value: "events", label: "Events" },
  { value: "posts", label: "Posts" },
  { value: "calls", label: "Calls" },
];
const SHOW_VALUES = ["events", "posts", "calls"];
// The two state tiles filter the month to these events.
const STATE_FILTERS = {
  notlive: { label: "Need to go live", keys: ["notlive"] },
  promote: { label: "Can be promoted", keys: ["ready", "short"] },
};
// A day shows up to three things; with more than three it shows two, then
// "+N more" opens the whole day (never "+1 more" in place of one entry).
const DAY_LIMIT = 2;
const DAY_ALL_UP_TO = 3;

// A title that wraps only between words and stops at two lines with an
// ellipsis. Each word is its own unbreakable piece, so a word is never split
// across lines; a word wider than the space ends in an ellipsis.
function ChipWords({ text }) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  return <span data-chip-words="" className="line-clamp-2 min-w-0 break-normal">{words.map((word, index) => <span key={index}>{index > 0 ? " " : ""}<span className="inline-block max-w-full truncate align-top">{word}</span></span>)}</span>;
}

function useCoarsePointer() {
  const [coarse, setCoarse] = useState(() => typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches);
  useEffect(() => {
    if (typeof matchMedia !== "function") return undefined;
    const media = matchMedia("(pointer: coarse)");
    const update = () => setCoarse(media.matches);
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);
  return coarse;
}

/** The month's 5 or 6 weeks, Monday first. */
function monthDays(month) {
  const days = monthWindow(month).days;
  const last = days.slice(35);
  return last.every((d) => monthKey(d) !== month) ? days.slice(0, 35) : days;
}

/** #4255: post chips by stage. Approved (go given, not yet in the posting tool) is
 *  dashed amber so it never reads as Scheduled; Scheduled is solid; Published is
 *  quiet green. Idea, Writing and Designed never reach the Calendar. */
const POST_TONE = {
  review: "border border-dashed border-[var(--color-warning-500)] bg-[var(--color-warning-50)] text-[var(--color-warning-700)] hover:bg-[var(--color-warning-100)]",
  scheduled: "border border-[var(--gray-300)] bg-[var(--color-background-primary)] text-[var(--color-text-primary)] hover:bg-[var(--gray-50)]",
  published: "border border-[var(--color-success-500)] bg-[var(--color-success-50)] text-[var(--color-success-700)] hover:bg-[var(--color-success-100)]",
};
const POST_LEGEND = [["review", "Approved post"], ["scheduled", "Scheduled post"], ["published", "Published post"]];

/** Everything dated on the Calendar for one day: events and promised dates, then calls, then posts. */
function dayEntries(key, data, items, show, calls = [], zone = undefined) {
  const out = [];
  if ((show === "" || show === "events") && data) {
    for (const e of data.events || []) if (e.start_on === key) out.push({ type: "event", id: `ev-${e.id}`, title: e.title, state: e.state, selection: { kind: "event", id: e.id }, on: e.start_on, host: e.host?.name });
    for (const x of data.expected || []) if (x.expected_on === key) out.push({ type: "expected", id: `x-${x.id}-${x.expected_on}`, title: x.title, state: x.state, selection: { kind: "expected", id: x.id }, on: x.expected_on, host: x.host_name, repeats: x.repeats && x.repeats !== "none", moment: x.promo_moment });
  }
  // #4339: calls on the viewer's own day (an instant in their device's zone).
  if (show === "" || show === "calls") out.push(...callEntriesOn(key, calls, zone));
  if (show === "" || show === "posts") for (const item of items) if (item.publish_at && onCalendar(item) && localDateKey(item.publish_at) === key) out.push({ type: "post", id: `c-${item.id}`, title: item.title, item });
  return out;
}

/** #4339 calendar sync: "Moved" (amber) or "Cancelled" / "Declined" (red) beside a call. */
function CallStatusBadge({ status, label }) {
  if (!label) return null;
  const tone = status === "moved" ? "bg-[var(--color-warning-50)] text-[var(--color-warning-700)]" : "bg-[var(--color-error-50)] text-[var(--color-error-700)]";
  return <span className={`whitespace-nowrap rounded-full px-1.5 text-[10.5px] font-semibold no-underline ${tone}`} data-call-status={status}>{label}</span>;
}

/** A call's chip on the month: time first, then its badge, then the name. A cancelled or declined call is struck through. */
function CallChip({ e, past, current, onOpen }) {
  const words = [e.time, e.badge, e.statusLabel, e.title].filter(Boolean);
  return (
    <button
      type="button"
      data-calendar-call={e.callId}
      data-call-audience={e.audience}
      data-call-state={e.status}
      aria-current={current ? "true" : undefined}
      onClick={() => onOpen(e.callId)}
      aria-label={words.join(", ")}
      title={words.join(" · ")}
      className={`block min-h-6 w-full min-w-0 rounded-md px-1 py-0.5 text-left text-[11.5px] leading-tight text-[var(--color-text-primary)] hover:bg-[var(--gray-100)] aria-[current=true]:bg-[var(--color-brand-50)] aria-[current=true]:ring-2 aria-[current=true]:ring-[var(--color-brand-700)] ${past || e.off ? "opacity-60" : ""} ${FOCUS}`}
    >
      <span className="flex min-w-0 flex-wrap items-center gap-1">
        <b className={`whitespace-nowrap tabular-nums ${e.off ? "line-through" : ""}`} data-call-time="">{e.time}</b>
        <span className="whitespace-nowrap rounded-full bg-[var(--color-brand-50)] px-1.5 text-[10.5px] font-semibold text-[var(--color-brand-700)]" data-call-badge="">{e.badge}</span>
        <CallStatusBadge status={e.status} label={e.statusLabel} />
      </span>
      <span className={`block font-semibold ${e.off ? "line-through" : ""}`} data-call-title=""><ChipWords text={e.title} /></span>
    </button>
  );
}

/** The phone dot for a call: brand coloured, beside the event dots; a cancelled or declined call's dot is hollow. */
function CallDot({ size = 10, off = false }) {
  return <i aria-hidden="true" data-call-dot="" style={{ width: size, height: size }} className={`inline-block shrink-0 rounded-[3px] not-italic ${off ? "border-2 border-[var(--color-brand-600)] bg-transparent" : "bg-[var(--color-brand-600)]"}`} />;
}

function MonthGrid({ month, data, items, show, today, open, selectEvent, currentEvent, onDay, openDay, reschedule, coarse, calls, zone, openCall, currentCall }) {
  const days = monthDays(month);
  const drop = (event, date) => {
    if (coarse) return;
    event.preventDefault();
    const id = event.dataTransfer.getData("text/x-mingla-content-id");
    const item = items.find((row) => row.id === id);
    if (item) reschedule(item, date);
  };
  return (
    <div data-calendar-grid="month" className="min-w-0 overflow-hidden">
      <div className="grid grid-cols-[repeat(7,minmax(0,1fr))] border-b border-[var(--gray-200)]">
        {WEEKDAYS.map((name) => <div key={name} className="min-w-0 p-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]"><span className="@min-[640px]:hidden">{name.slice(0, 1)}</span><span className="hidden @min-[640px]:inline">{name}</span></div>)}
      </div>
      <div className="grid grid-cols-[repeat(7,minmax(0,1fr))]">
        {days.map((date) => {
          const key = localDateKey(date);
          const inMonth = monthKey(date) === month;
          const isToday = key === today;
          const past = key < today;
          const entries = dayEntries(key, data, items, show, calls, zone);
          const dayWords = date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
          const visible = entries.length <= DAY_ALL_UP_TO ? entries : entries.slice(0, DAY_LIMIT);
          const hidden = entries.length - visible.length;
          const events = entries.filter((e) => e.type !== "post");
          return (
            <section
              key={key}
              aria-label={dayWords}
              data-calendar-day={key}
              onDragOver={coarse ? undefined : (event) => event.preventDefault()}
              onDrop={(event) => drop(event, date)}
              className={[
                "flex min-h-16 min-w-0 flex-col gap-1 border-b border-r border-[var(--gray-200)] p-1 @min-[640px]:min-h-24",
                isToday ? "bg-[var(--color-brand-50)] shadow-[inset_0_0_0_2px_var(--color-brand-500)]" : inMonth ? "" : "bg-[var(--gray-50)]",
                openDay === key ? "ring-2 ring-inset ring-[var(--color-brand-700)]" : "",
              ].join(" ")}
            >
              <p className={`text-[11.5px] tabular-nums ${isToday ? "font-bold text-[var(--color-brand-700)]" : inMonth ? "font-semibold text-[var(--color-text-secondary)]" : "text-[var(--color-text-tertiary)]"}`}>
                {date.getDate()}{isToday && <span className="hidden @min-[640px]:inline"> · Today</span>}
              </p>
              {/* Narrow: one 10px dot per event, the whole day opens on tap. The
                  button runs to the cell's edges so it is a 44 px target (#3980 P3-3). */}
              {events.length > 0 && (
                <button
                  type="button"
                  data-calendar-day-dense={key}
                  onClick={() => onDay(key)}
                  aria-label={`${dayWords}: ${events.map((e) => (e.type === "call" ? [e.time, e.badge, e.statusLabel, e.title].filter(Boolean).join(", ") : `${e.title}, ${stateName(e.state)}`)).join("; ")}`}
                  title={events.map((e) => e.title).join(", ")}
                  className={`-mx-1 flex min-h-11 w-[calc(100%+0.5rem)] flex-wrap content-start items-start gap-1 rounded-md px-1.5 py-1 hover:bg-[var(--gray-50)] @min-[640px]:hidden ${past ? "opacity-60" : ""} ${FOCUS}`}
                >
                  {events.slice(0, 6).map((e) => (e.type === "call" ? <CallDot key={e.id} off={e.off} /> : <StateDot key={e.id} k={e.state?.k} size={10} />))}
                </button>
              )}
              {/* Wide: dot and title, two lines, whole words; at most two, then "+N more". */}
              <div className="hidden min-w-0 flex-col gap-0.5 @min-[640px]:flex">
                {visible.map((e) => e.type === "call" ? (
                  <CallChip key={e.id} e={e} past={past} current={currentCall === e.callId} onOpen={openCall} />
                ) : e.type === "post" ? (
                  <button
                    key={e.id}
                    type="button"
                    draggable={!coarse}
                    onDragStart={(event) => { event.dataTransfer.setData("text/x-mingla-content-id", e.item.id); event.dataTransfer.effectAllowed = "move"; }}
                    onClick={() => open(e.item.id)}
                    data-post-stage={e.item.stage}
                    aria-label={`${e.title}, post, ${stageLabel(e.item.stage)}`}
                    title={e.title}
                    className={`block min-h-6 w-full min-w-0 rounded-md px-1.5 py-0.5 text-left text-[11.5px] font-semibold leading-tight ${POST_TONE[e.item.stage] || POST_TONE.scheduled} ${past ? "opacity-60" : ""} ${FOCUS}`}
                  >
                    <ChipWords text={e.title} />
                  </button>
                ) : (
                  <button
                    key={e.id}
                    type="button"
                    data-calendar-chip={e.id}
                    aria-current={currentEvent && currentEvent.kind === e.selection.kind && currentEvent.id === e.selection.id ? "true" : undefined}
                    onClick={() => selectEvent(e.selection, e.on)}
                    aria-label={`${e.title}, ${stateName(e.state)}${e.host ? `, ${e.host}` : ""}`}
                    title={`${e.title} · ${stateName(e.state)}`}
                    className={`grid min-h-6 w-full min-w-0 grid-cols-[10px_minmax(0,1fr)] items-start gap-1.5 rounded-md px-1 py-0.5 text-left text-[11.5px] font-semibold leading-tight text-[var(--color-text-primary)] hover:bg-[var(--gray-100)] aria-[current=true]:bg-[var(--color-brand-50)] aria-[current=true]:ring-2 aria-[current=true]:ring-[var(--color-brand-700)] ${past ? "opacity-60" : ""} ${FOCUS}`}
                  >
                    <span className="pt-[3px]"><StateDot k={e.state?.k} /></span>
                    <ChipWords text={e.title} />
                  </button>
                ))}
                {hidden > 0 && (
                  <button type="button" data-calendar-more={key} onClick={() => onDay(key)} aria-label={`Show all ${entries.length} on ${dayWords}`} className={`block min-h-6 w-full rounded-md px-1.5 py-0.5 text-left text-[11.5px] font-semibold text-[var(--color-brand-700)] hover:bg-[var(--gray-50)] ${FOCUS}`}>+{hidden} more</button>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Legend({ undated, onUndated, show, zone }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--gray-200)] px-3 py-2.5 text-[12.5px] text-[var(--color-text-secondary)]">
      {STATE_LEGEND.map((k) => <span key={k} className="inline-flex items-center gap-1.5 whitespace-nowrap"><StateDot k={k} />{PLAIN_STATES[k]}</span>)}
      {show !== "events" && show !== "calls" && POST_LEGEND.map(([stage, words]) => <span key={stage} className="inline-flex items-center gap-1.5 whitespace-nowrap"><span aria-hidden="true" className={`inline-block h-3 w-5 rounded-sm ${POST_TONE[stage]}`} />{words}</span>)}
      {show !== "events" && show !== "calls" && <Button type="button" variant="secondary" size="sm" className="ml-auto min-h-11" onClick={onUndated}>{undated} {undated === 1 ? "post" : "posts"} with no date</Button>}
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap"><CallDot size={8} />Booked call</span>
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap"><CallDot size={8} off />Cancelled or declined</span>
      <p className="w-full text-[11.5px] text-[var(--color-text-tertiary)]" data-calendar-zone-note="">{calendarZoneNote(zone)}</p>
    </div>
  );
}

function BoardView({ items, open, move, coarse }) {
  return <div className="overflow-x-auto pb-2"><div className="grid min-w-[1280px] grid-cols-6 gap-3">{CONTENT_STAGES.map((stage) => <section key={stage.value} aria-labelledby={`content-stage-${stage.value}`} onDragOver={(event) => { if (!coarse) { const item = items.find((row) => row.id === event.dataTransfer.getData("text/x-mingla-content-id")); if (item && canMoveTo(item, stage.value)) event.preventDefault(); } }} onDrop={(event) => { if (coarse) return; const item = items.find((row) => row.id === event.dataTransfer.getData("text/x-mingla-content-id")); if (item && canMoveTo(item, stage.value)) { event.preventDefault(); move(item, stage.value); } }} className="min-h-[320px] rounded-xl bg-[var(--gray-50)] p-2"><h2 id={`content-stage-${stage.value}`} className="mb-2 px-1 text-sm font-semibold text-[var(--color-text-primary)]">{stage.label} <span className="text-[var(--color-text-tertiary)]">{items.filter((item) => item.stage === stage.value).length}</span></h2><div className="space-y-2">{items.filter((item) => item.stage === stage.value).map((item) => <ContentCard key={item.id} item={item} onOpen={open} onMove={() => { const index = CONTENT_STAGES.findIndex((row) => row.value === item.stage); const next = CONTENT_STAGES[index + 1]?.value; if (canMoveTo(item, next)) move(item, next); }} onStage={move} stages={CONTENT_STAGES} draggable={!coarse} />)}</div></section>)}</div></div>;
}

// One day in full, in the first panel. Each item opens beside it.
function DayPanel({ day, entries, onClose, onCall }) {
  return (
    <Drawer open onClose={onClose} title={new Date(`${day}T12:00:00`).toLocaleDateString("en-GB", { weekday: "long", month: "long", day: "numeric" })}>
      {entries.length ? (
        <ul className="flex min-w-0 flex-col gap-1.5">
          {entries.map((e) => e.type === "call" ? (
            <li key={e.id}>
              <button type="button" data-day-call={e.callId} onClick={() => onCall(e.callId)} className={`flex min-h-11 w-full min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--gray-200)] px-3 py-2 text-left hover:bg-[var(--gray-50)] ${FOCUS}`}>
                <span className="min-w-0 flex-1">
                  <span className={`block text-[13.5px] font-semibold text-[var(--color-text-primary)] ${e.off ? "line-through" : ""} ${WORDS}`}>{e.time} · {e.title}</span>
                  <span className={`block text-[12px] text-[var(--color-text-tertiary)] ${WORDS}`}>{e.badge}</span>
                </span>
                <CallStatusBadge status={e.status} label={e.statusLabel} />
              </button>
            </li>
          ) : (
            <li key={e.id}>
              <SideLink side={e.type === "post" ? { kind: "content", id: e.item.id } : e.selection} className={`flex min-h-11 w-full min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--gray-200)] px-3 py-2 text-left hover:bg-[var(--gray-50)] ${FOCUS}`}>
                <span className="min-w-0 flex-1">
                  <span className={`block text-[13.5px] font-semibold text-[var(--color-text-primary)] ${WORDS}`}>{e.title}</span>
                  <span className={`block text-[12px] text-[var(--color-text-tertiary)] ${WORDS}`}>{e.type === "post" ? `Post · ${stageLabel(e.item.stage)}` : `${e.host || ""}${e.repeats ? " · repeats" : ""}${e.moment ? " · promo moment" : ""}`}</span>
                </span>
                {e.type !== "post" && <StatePill state={e.state} />}
              </SideLink>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-[var(--color-text-secondary)]">Nothing on this day.</p>}
    </Drawer>
  );
}

// The posts with no date yet, in the first panel; each opens beside it.
function UndatedPanel({ items, onOpen, onClose }) {
  return (
    <Drawer open onClose={onClose} title="Posts with no date">
      {items.length ? <div className="flex min-w-0 flex-col gap-2">{items.map((item) => <ContentCard key={item.id} item={item} compact onOpen={onOpen} />)}</div> : <p className="text-sm text-[var(--color-text-secondary)]">Every post has a date.</p>}
    </Drawer>
  );
}

// #4339: one booked call, in the first panel.
function CallPanel({ call, zone, loading, onClose }) {
  const v = callView(call, zone);
  const link = "inline-block max-w-full truncate align-bottom font-semibold text-[var(--color-brand-700)] hover:underline";
  const row = (label, value) => (value ? <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-2"><dt className="text-[var(--color-text-tertiary)]">{label}</dt><dd className={`min-w-0 text-[var(--color-text-primary)] ${WORDS}`}>{value}</dd></div> : null);
  return (
    <Drawer open onClose={onClose} title={v ? v.badge : "Booked call"}>
      {!v ? (
        <p className="text-sm text-[var(--color-text-secondary)]">{loading ? "Loading the call…" : "This call is not in the month on screen."}</p>
      ) : (
        <div data-call-panel={v.id} className="flex min-w-0 flex-col gap-4 text-[13.5px]">
          <div>
            <p className={`text-[17px] font-semibold text-[var(--color-text-primary)] ${v.off ? "line-through" : ""}`}>{v.name}</p>
            <p className={`text-[var(--color-text-secondary)] ${v.off ? "line-through" : ""}`} data-call-when="">{v.when}</p>
            {v.isTest && <p className="mt-1 text-[12px] text-[var(--color-text-tertiary)]">Staff or test booking</p>}
          </div>
          <dl className="flex min-w-0 flex-col gap-2">
            {row("Status", (
              <span className="inline-flex min-w-0 flex-wrap items-center gap-2" data-call-panel-status={v.status}>
                {v.status === "booked" ? "Booked" : <CallStatusBadge status={v.status} label={v.statusLabel} />}
                {v.status !== "booked" && <span className="text-[var(--color-text-secondary)]">{v.status === "moved" ? "Moved in Google Calendar" : v.status === "cancelled" ? "Cancelled in Google Calendar" : "They declined the invite"}</span>}
              </span>
            ))}
            {row("Changed", v.statusChangedWhen ? <span data-call-changed="">{v.statusChangedWhen}</span> : null)}
            {row("Booked for", v.originalWhen ? <span className="line-through" data-call-original="">{v.originalWhen}</span> : null)}
            {row("Their time", v.bookerWhen)}
            {row(v.badge === CALL_LABELS.host ? "What they run" : v.badge === CALL_LABELS.creator ? "What they make" : "First place", v.what ? v.what.replace(/^[^:]+: /, "") : null)}
            {row("Place or brand", v.venue)}
            {row("City", v.city)}
            {row("Social", v.socialUrl ? <a href={v.socialUrl} target="_blank" rel="noopener noreferrer" className={link} data-call-social="">{v.socialLabel}: {v.socialHandle || v.socialUrl}</a> : null)}
            {row("Best work", v.workUrl ? <a href={v.workUrl} target="_blank" rel="noopener noreferrer" className={link}>{v.workUrl}</a> : null)}
          </dl>
          <div className="flex min-w-0 flex-wrap gap-2">
            {v.meetUrl && <a href={v.meetUrl} target="_blank" rel="noopener noreferrer" data-call-meet="" className={`inline-flex min-h-11 items-center rounded-lg bg-[var(--color-brand-800)] px-4 text-[13px] font-semibold text-white hover:bg-[var(--color-brand-900)] ${FOCUS}`}>Join video call</a>}
            <a href={v.leadHash} data-call-lead="" className={`inline-flex min-h-11 items-center rounded-lg border border-[var(--gray-200)] px-4 text-[13px] font-semibold text-[var(--color-text-primary)] hover:bg-[var(--gray-50)] ${FOCUS}`}>Open lead</a>
            {v.eventUrl && <a href={v.eventUrl} target="_blank" rel="noopener noreferrer" className={`inline-flex min-h-11 items-center rounded-lg px-2 text-[13px] font-semibold text-[var(--color-brand-700)] hover:underline ${FOCUS}`}>Open in Google Calendar</a>}
          </div>
        </div>
      )}
    </Drawer>
  );
}

/** A runway row for an event opened from anywhere (its own row, or one made from the event). */
function eventRow(selection, rows, anchor) {
  const found = (Array.isArray(rows) ? rows : []).find((r) => r.anchor_kind === selection?.kind && String(r.anchor_id) === String(selection?.id));
  if (found) return found;
  if (!anchor) return null;
  return { anchor_kind: selection.kind, anchor_id: selection.id, title: anchor.title, brand_name: anchor.brand_name, start_on: anchor.start_on, state: anchor.state || null, is_public: !!anchor.is_public };
}

/** Make a card and Plan a post, under an event (#4255: from the old list's rows). */
function eventActions({ selection, rows, online, onMakeCard, onPlanPost }) {
  return (anchor) => {
    const row = eventRow(selection, rows, anchor);
    if (!row) return null;
    const action = runwayAction(row);
    return (
      <div data-event-actions="" className="flex min-w-0 flex-wrap gap-2">
        <Button type="button" variant={action === "card" ? "brandContrast" : "secondary"} size="sm" className="min-h-11" disabled={!online} onClick={() => onMakeCard(row)}>Make a card</Button>
        <Button type="button" variant={action === "post" ? "brandContrast" : "secondary"} size="sm" className="min-h-11" disabled={!online} onClick={() => onPlanPost(row)}>Plan a post</Button>
      </div>
    );
  };
}

export function ContentCalendarPage() {
  const [search, setSearch] = useHashQuery("content-calendar");
  const route = useMemo(() => {
    const p = new URLSearchParams(search);
    // #4255: Show is a dropdown. Old addresses still open: show=both and no
    // show are Everything; the old Content tab (show=posts) and Posts board
    // (view=board) keep their meaning; view=list opens Month.
    const rawShow = p.get("show");
    const show = SHOW_VALUES.includes(rawShow) ? rawShow : "";
    const state = Object.hasOwn(STATE_FILTERS, p.get("state") || "") ? p.get("state") : "";
    return {
      view: p.get("view") === "board" ? "board" : "calendar",
      show,
      state,
      test: p.get("test") === "1",
      month: /^\d{4}-(0[1-9]|1[0-2])$/.test(p.get("month") || "") ? p.get("month") : monthKey(),
      card: /^[0-9a-f-]{36}$/i.test(p.get("card") || "") ? p.get("card") : null,
      q: (p.get("q") || "").slice(0, 160),
      event: parseEventParam(p.get("event")),
      day: /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(p.get("day") || "") ? p.get("day") : null,
      call: /^[0-9a-f-]{36}$/i.test(p.get("call") || "") ? p.get("call") : null,
      undated: p.get("undated") === "1",
      addCard: p.get("add") === "card",
    };
  }, [search]);
  const stack = usePanelStack(search, setSearch);
  const query = useMemo(() => ({ ...(route.q ? { q: route.q } : {}), limit: 500 }), [route.q]);
  const calendar = useContentCalendar(query);
  const people = usePeopleDirectory();
  const opsConfig = useOpsConfig();
  const online = useOnline();
  const coarse = useCoarsePointer();
  const { addToast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [addOwners, setAddOwners] = useState([]);
  const [duplicate, setDuplicate] = useState({ checking: false, exact: null, similar: [] });
  const [similarAccepted, setSimilarAccepted] = useState(false);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [focusTarget, setFocusTarget] = useState(null);
  const [move, setMove] = useState(null);
  const [busy, setBusy] = useState(false);
  const [cardFor, setCardFor] = useState(null);
  const [cardBusy, setCardBusy] = useState(false);
  const [cardProblem, setCardProblem] = useState(null);
  const cardKey = useRef(null);
  const createFlight = useRef(createSingleFlight());
  const detailGate = useRef(createLatestOnlyGate());
  const days = monthDays(route.month);
  const opsCal = useOpsCalendar(localDateKey(days[0]), localDateKey(days[days.length - 1]));
  // #4130: the runway in each event's own time, test brands marked. #4255:
  // read for the month on screen in both views (the tiles, the test toggle
  // and the event panel's actions use it).
  const runwayFrom = localDateKey(days[0]);
  const runwayTo = localDateKey(days[days.length - 1]);
  const loadRunway = useCallback(() => getCalendarRunway(runwayFrom, runwayTo, todayIso()), [runwayFrom, runwayTo]);
  const runwayRead = useServerRead(loadRunway);
  // #4339: the booked calls for the days on screen, in the viewer's own zone.
  const zone = viewerTimeZone() || undefined;
  const callSpan = callRange(days[0], days[days.length - 1]);
  const callsRead = useCalendarCalls(callSpan.from, callSpan.to, route.test);
  const runway = { data: runwayRead.data, error: runwayRead.status === "error" ? runwayRead.error : null, refetch: runwayRead.retry };
  const attention = useOpsAttention();
  const today = todayIso();

  const setParam = (name, value, replace = false) => { const p = new URLSearchParams(search); if (!value || (name === "view" && value === "calendar")) p.delete(name); else p.set(name, value); setSearch(p.toString(), { replace }); };
  // Panel one is one thing at a time: a post, an event, a day, the undated
  // posts or the add-card form. Opening one closes the others and panel two.
  const openFirst = (name, value) => {
    const p = new URLSearchParams(search);
    for (const k of ["card", "event", "day", "undated", "add", "side", "call"]) p.delete(k);
    if (value) p.set(name, value);
    setSearch(p.toString());
  };
  const open = (id) => openFirst("card", id);
  const selectEvent = (selection, onDate) => {
    const p = new URLSearchParams(search);
    for (const k of ["card", "day", "undated", "add", "side", "call"]) p.delete(k);
    p.set("event", `${selection.kind}:${selection.id}`);
    if (typeof onDate === "string" && /^\d{4}-\d{2}/.test(onDate)) p.set("month", onDate.slice(0, 7));
    setSearch(p.toString());
  };
  const openDay = (key) => openFirst("day", key);
  const openCall = (id) => openFirst("call", id);
  const openUndated = () => openFirst("undated", "1");
  const closeFirst = () => openFirst("card", null);

  const close = () => { detailGate.current.close(); setDetail(null); setDetailLoading(false); setFocusTarget(null); closeFirst(); };

  useEffect(() => {
    if (!route.card) { detailGate.current.close(); setDetail(null); setDetailLoading(false); return undefined; }
    const ticket = detailGate.current.activate(route.card);
    setDetail(null); setDetailLoading(true);
    service.getContent(route.card).then((answer) => {
      if (detailGate.current.accepts(ticket)) setDetail(answer);
    }).catch((error) => {
      if (!detailGate.current.accepts(ticket)) return;
      addToast({ variant: "error", title: "Couldn’t open that card", description: contentErrorWords(error) });
      detailGate.current.close(); setDetail(null); setParam("card", null);
    }).finally(() => {
      if (detailGate.current.accepts(ticket)) setDetailLoading(false);
    });
    return undefined;
  }, [route.card]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!addOpen || title.trim().length < 3) { setDuplicate({ checking: false, exact: null, similar: [] }); return undefined; }
    let active = true;
    const timer = setTimeout(() => {
      setDuplicate((value) => ({ ...value, checking: true }));
      service.checkContentDuplicate(title.trim()).then((answer) => {
        if (active) setDuplicate({ checking: false, exact: answer?.exact || null, similar: Array.isArray(answer?.similar) ? answer.similar : [] });
      }).catch(() => { if (active) setDuplicate({ checking: false, exact: null, similar: [] }); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [addOpen, title]);
  useEffect(() => { if (addOpen) setAddOwners(people.me ? [people.me] : []); }, [addOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const create = () => {
    const clean = title.trim();
    if (!clean || duplicate.exact || (duplicate.similar.length && !similarAccepted) || !online) return Promise.resolve();
    setBusy(true);
    return createFlight.current.submit(clean, async (key) => {
      try {
        const checked = await service.checkContentDuplicate(clean);
        if (checked?.exact) {
          setDuplicate({ checking: false, exact: checked.exact, similar: [] });
          return;
        }
        if (Array.isArray(checked?.similar) && checked.similar.length > 0 && !similarAccepted) {
          setDuplicate({ checking: false, exact: null, similar: checked.similar });
          return;
        }
        let answer = await service.createContent(clean, key);
        // The post starts assigned to whoever adds it; other owners picked
        // here are set through the same assign path the drawer uses.
        const wanted = [...addOwners].sort();
        const have = [...(answer.item?.owners || [])].map((e) => String(e).toLowerCase()).sort();
        if (wanted.length && JSON.stringify(wanted) !== JSON.stringify(have)) {
          try { answer = await service.assignContent(answer.item.id, wanted, answer.item.revision, requestKey("web_assign")); }
          catch (error) { addToast({ variant: "warning", title: "Added, but the owners didn’t save", description: contentErrorWords(error) }); }
        }
        calendar.replaceItem(answer.item); setTitle(""); setAddOpen(false);
        // Planned from an open event: the new post opens beside it.
        if (route.event) stack.openSide({ kind: "content", id: answer.item.id }); else open(answer.item.id);
      } catch (error) {
        addToast({ variant: "error", title: "Couldn’t add content", description: contentErrorWords(error) });
      }
    }).finally(() => { if (!createFlight.current.busy()) setBusy(false); });
  };
  const openForField = (item, target, words) => {
    setMove(null); setFocusTarget(target); open(item.id);
    addToast({ variant: "error", title: "Finish this card first", description: words });
  };
  const beginMove = (item, to) => {
    if (!canMoveTo(item, to)) return;
    const missing = moveNeedsFields(item, to);
    if (missing) { openForField(item, missing.field, missing.message); return; }
    const prompt = movePrompt(item, to);
    if (prompt) setMove({ item, to, prompt }); else performMove(item, to, {});
  };
  const changed = (item) => {
    calendar.replaceItem(item);
    setDetail((current) => current?.item?.id === item.id ? { ...current, item } : current);
  };
  const offerUndo = (answer, titleText) => addToast({ variant: "success", title: titleText, duration: 8000, action: { label: "Undo", onClick: async () => {
    try {
      const undone = await service.undoContent(answer.audit_id, answer.item.revision);
      changed(undone.item);
      await calendar.refetch({ quiet: true });
    } catch (error) {
      addToast({ variant: "error", title: "Undo didn’t work", description: contentErrorWords(error) });
    }
  } } });
  const performMove = async (item, to, approvals) => {
    setBusy(true);
    try { const answer = await service.moveContent(item.id, to, item.revision, approvals, requestKey("web_move")); changed(answer.item); setMove(null); offerUndo(answer, `Moved to ${CONTENT_STAGES.find((stage) => stage.value === to)?.label || to}`); }
    catch (error) { addToast({ variant: "error", title: "Couldn’t move that card", description: contentErrorWords(error) }); }
    finally { setBusy(false); }
  };
  const reschedule = async (item, date) => {
    const next = new Date(date); const old = item.publish_at ? new Date(item.publish_at) : null;
    next.setHours(old && !Number.isNaN(old.getTime()) ? old.getHours() : 12, old && !Number.isNaN(old.getTime()) ? old.getMinutes() : 0, 0, 0);
    setBusy(true);
    try { const answer = await service.updateContent(item.id, { publish_at: next.toISOString() }, item.revision, requestKey("web_date")); changed(answer.item); offerUndo(answer, "Publish date moved"); }
    catch (error) { addToast({ variant: "error", title: "Couldn’t reschedule", description: contentErrorWords(error) }); }
    finally { setBusy(false); }
  };
  const shiftMonth = (by) => { const [year, month] = route.month.split("-").map(Number); setParam("month", monthKey(new Date(year, month - 1 + by, 1))); };
  const updateTitle = (value) => { setTitle(value); setSimilarAccepted(false); createFlight.current.reset(); };
  // "Plan a post" opens the existing Add content form, with a title about the
  // event when it comes from one; the form's duplicate check and Add button
  // are the confirmation.
  const planPost = (row) => { setTitle(row ? runwayPostTitle(row) : ""); setSimilarAccepted(false); createFlight.current.reset(); setAddOpen(true); };
  // "Make a card" from an event adds one Work card through the existing
  // checked add (ops_work_add), after a confirmation that shows the card.
  const makeCard = async () => {
    if (!cardFor || cardBusy) return;
    setCardBusy(true); setCardProblem(null);
    try {
      const answer = await ops.addWork([runwayCardItem(cardFor, people.me)], cardKey.current || (cardKey.current = requestKey("runway_card")));
      const row = answer?.results?.[0];
      if (row?.status === "added") {
        cardKey.current = null; setCardFor(null);
        const id = row.card?.id || row.id || null;
        addToast({ variant: "success", title: "Work card added", duration: 8000, action: id ? { label: "Open it", onClick: () => stack.openSide({ kind: "card", id }) } : undefined });
        if (id) stack.openSide({ kind: "card", id });
      } else if (row?.status === "duplicate") {
        setCardProblem(row.message || "An open card already does this.");
      } else {
        setCardProblem((row?.fixes || []).map((f) => f.message).filter(Boolean).join(" ") || "The card was not added.");
      }
    } catch (error) {
      setCardProblem(opsErrorWords(error));
    } finally {
      setCardBusy(false);
    }
  };
  const closeCard = () => { if (!cardBusy) { setCardFor(null); setCardProblem(null); cardKey.current = null; } };
  const closeAdd = () => { if (!busy) { setAddOpen(false); setTitle(""); setSimilarAccepted(false); createFlight.current.reset(); } };

  const duplicateBlocked = !!duplicate.exact || (duplicate.similar.length > 0 && !similarAccepted);
  // #4255: only Approved, Scheduled and Published posts belong to the Calendar.
  const undated = calendar.items.filter((item) => !item.publish_at && onCalendar(item));
  const allRunwayRows = Array.isArray(runway.data?.rows) ? runway.data.rows : [];
  const runwayRows = visibleRunwayRows(allRunwayRows, { showTest: route.test, q: route.q });
  const testHidden = Number(runway.data?.test_hidden || 0);
  const testIds = route.test ? new Set() : testAnchorIds(allRunwayRows);
  // The tiles count the events shown (test brands left out unless asked).
  const states = runway.data ? runwayRows.reduce((acc, r) => { const k = r.state?.k; if (k) acc[k] = (acc[k] || 0) + 1; return acc; }, { ready: 0, short: 0, late: 0, notlive: 0 }) : {};
  const stateKeys = route.state ? STATE_FILTERS[route.state].keys : null;
  const keep = (row) => !testIds.has(String(row.id)) && (!route.q || String(row.title || "").toLowerCase().includes(route.q.toLowerCase())) && (!stateKeys || stateKeys.includes(row.state?.k));
  const monthData = opsCal.data ? {
    ...opsCal.data,
    events: (opsCal.data.events || []).filter(keep),
    expected: (opsCal.data.expected || []).filter(keep),
  } : opsCal.data;
  // With a state tile on, the month shows those events only (no posts).
  const monthShow = route.state ? "events" : route.show;
  const callRows = Array.isArray(callsRead.data?.rows) ? callsRead.data.rows.filter((c) => !route.q || String(c.name || "").toLowerCase().includes(route.q.toLowerCase())) : [];
  const openCallRow = route.call ? (Array.isArray(callsRead.data?.rows) ? callsRead.data.rows.find((c) => c.id === route.call) : null) : null;
  const nonext = attention.data?.counts?.nonext;
  const monthName = monthWindow(route.month).first.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const dayItems = route.day ? dayEntries(route.day, monthData, calendar.items, monthShow, callRows, zone) : [];
  const boardItems = route.show === "events" || route.show === "calls" ? [] : calendar.items;
  const actionsFor = (selection) => eventActions({ selection, rows: allRunwayRows, online, onMakeCard: (row) => setCardFor(row), onPlanPost: planPost });

  const first = route.card ? (
    <ContentDrawer activeId={route.card} detail={detail} config={calendar.config} online={online} loading={detailLoading} focusTarget={focusTarget} suspended={!!move} onFocusHandled={() => setFocusTarget(null)} onClose={close} onChanged={changed} onMove={beginMove} onDeleted={calendar.removeItem} />
  ) : route.event ? (
    <Drawer open onClose={closeFirst} title={route.event.kind === "expected" ? "Promised event" : "Event"}>
      <EventPanel selection={route.event} onBack={closeFirst} online={online} embedded actions={actionsFor(route.event)} />
    </Drawer>
  ) : route.call ? (
    <CallPanel call={openCallRow} zone={zone} loading={!callsRead.data} onClose={closeFirst} />
  ) : route.day ? (
    <DayPanel day={route.day} entries={dayItems} onClose={closeFirst} onCall={openCall} />
  ) : route.undated ? (
    <UndatedPanel items={undated} onOpen={(id) => stack.openSide({ kind: "content", id })} onClose={closeFirst} />
  ) : route.addCard ? (
    <Drawer open onClose={closeFirst} title="Make a card">
      <WorkAddForm key="add" config={opsConfig.data} online={online} onCancel={closeFirst}
        onAdded={(card) => { closeFirst(); requestAnimationFrame(() => stack.openSide({ kind: "card", id: card.id })); }}
        onOpenCard={(id) => id && stack.openSide({ kind: "card", id })} />
    </Drawer>
  ) : null;
  const second = stack.side ? (
    <SidePanel side={stack.side} onClose={stack.closeSide} onChanged={() => { calendar.refetch({ quiet: true }); opsCal.refetch?.({ quiet: true }); }}
      eventActions={stack.side.kind === "event" || stack.side.kind === "expected" ? actionsFor(stack.side) : null} />
  ) : null;

  const box = (
    <div className="@container min-w-0 overflow-hidden rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] shadow-[var(--shadow-sm)]">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--gray-200)] p-2.5">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Button type="button" variant="secondary" icon={ChevronLeft} aria-label="Previous month" className="min-h-11 min-w-11" onClick={() => shiftMonth(-1)} />
          <span className="min-w-[8.5rem] text-center text-[14px] font-semibold tabular-nums text-[var(--color-text-primary)]">{monthName}</span>
          <Button type="button" variant="secondary" icon={ChevronRight} aria-label="Next month" className="min-h-11 min-w-11" onClick={() => shiftMonth(1)} />
          <button type="button" onClick={() => { setParam("month", null); }} className={`min-h-11 whitespace-nowrap rounded-full bg-[var(--color-brand-800)] px-3.5 text-[12.5px] font-semibold text-white hover:bg-[var(--color-brand-900)] ${FOCUS}`}>Today is {dayLong(today)}</button>
        </div>
      </div>
      {callsRead.error && !callsRead.data && monthShow !== "events" && monthShow !== "posts" && <div className="p-3"><AlertCard variant="warning" title="Couldn’t load booked calls" action={<Button type="button" variant="secondary" className="min-h-11" onClick={() => callsRead.refetch()}>Try again</Button>}>{opsErrorWords(callsRead.error)} Events and posts still work.</AlertCard></div>}
      {opsCal.error && !opsCal.data && <div className="p-3"><AlertCard variant="warning" title="Couldn’t load events on Mingla" action={<Button type="button" variant="secondary" className="min-h-11" onClick={() => opsCal.refetch()}>Try again</Button>}>{opsErrorWords(opsCal.error)} Posts still work.</AlertCard></div>}
      <MonthGrid month={route.month} data={monthData} items={calendar.items} show={monthShow} today={localDateKey()} open={open} selectEvent={selectEvent} currentEvent={route.event} onDay={openDay} openDay={route.event ? null : route.day} reschedule={reschedule} coarse={coarse} calls={callRows} zone={zone} openCall={openCall} currentCall={route.call} />
      <Legend undated={undated.length} onUndated={openUndated} show={monthShow} zone={zone} />
    </div>
  );

  const tile = (key, value, words, tone) => (
    <button type="button" data-state-tile={key} aria-pressed={route.state === key} onClick={() => { const p = new URLSearchParams(search); p.delete("view"); if (route.state === key) p.delete("state"); else p.set("state", key); setSearch(p.toString(), { replace: true }); }}
      className={`flex min-h-11 min-w-0 items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left hover:bg-[var(--gray-50)] ${route.state === key ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)]" : "border-[var(--gray-200)] bg-[var(--color-background-primary)]"} ${FOCUS}`}>
      <b className={`min-w-[1.6rem] text-[21px] tabular-nums ${tone}`}>{value}</b><span className="text-[13px] text-[var(--color-text-secondary)]">{words}</span>
    </button>
  );

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader title="Calendar" description="Events that need promoting, and the posts we are making." actions={
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" icon={ClipboardList} className="min-h-11" disabled={!online} onClick={() => openFirst("add", "card")}>Make a card</Button>
          <Button type="button" variant="brandContrast" icon={Plus} className="min-h-11" disabled={!online} onClick={() => planPost(null)}>Plan a post</Button>
        </div>
      } />
      {!online && <AlertCard variant="warning" title="You’re offline">You can read what is already here. Adding, saving, moving, commenting, deleting and Undo need a connection.</AlertCard>}
      {calendar.stale && <AlertCard variant="warning" title="Content may be out of date" action={<Button type="button" variant="secondary" className="min-h-11" onClick={() => calendar.refetch()}>Try again</Button>} />}
      {(route.show === "" || route.show === "events") && <div className="grid min-w-0 grid-cols-1 gap-2.5 sm:grid-cols-3">
        {tile("notlive", states.notlive ?? "–", "need to go live", "text-[var(--color-info-700)]")}
        {tile("promote", states.ready === undefined ? "–" : Number(states.ready || 0) + Number(states.short || 0), "can be promoted", "text-[var(--color-success-700)]")}
        <a href="#/outreach?tab=hosts&due=nonext" className={`flex min-h-11 min-w-0 items-center gap-3 rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] px-3.5 py-2.5 text-left hover:bg-[var(--gray-50)] ${FOCUS}`}><b className="min-w-[1.6rem] text-[21px] tabular-nums text-[var(--color-info-700)]">{nonext ?? "–"}</b><span className="text-[13px] text-[var(--color-text-secondary)]">hosts with no next event</span></a>
      </div>}
      <div data-calendar-filters="" className="flex min-w-0 flex-wrap items-center gap-2">
        <Segmented label="View" options={VIEW_OPTIONS} value={route.view} onChange={(v) => setParam("view", v)} fullWidth className="sm:!w-fit" />
        <label className="relative block min-w-0 flex-1 basis-[220px] sm:max-w-sm"><span className="sr-only">Search events and posts</span><Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-[var(--color-text-tertiary)]" aria-hidden="true" /><input className={`${CONTROL_CLASS} min-h-11 pl-9`} value={route.q} onChange={(event) => setParam("q", event.target.value, true)} placeholder="Search events and posts" /></label>
        <FilterSelect name="show" label="Show" value={route.show} options={SHOW_OPTIONS} onChange={(v) => setParam("show", v, true)} />
        {testHidden > 0 && (
          <label className="inline-flex min-h-11 items-center gap-2 text-[12.5px] text-[var(--color-text-secondary)]">
            <input type="checkbox" checked={route.test} onChange={(e) => setParam("test", e.target.checked ? "1" : null, true)} />
            Show test events ({testHidden})
          </label>
        )}
        {route.state && (
          <button type="button" data-state-filter={route.state} onClick={() => setParam("state", null, true)} className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border border-[var(--color-brand-500)] bg-[var(--color-brand-50)] px-3 text-[12.5px] font-semibold text-[var(--color-brand-700)] ${FOCUS}`}>
            Showing: {STATE_FILTERS[route.state].label.toLowerCase()} <X aria-hidden="true" className="h-3.5 w-3.5" /><span className="sr-only">Show every event again</span>
          </button>
        )}
      </div>
      {calendar.error && <AlertCard variant="error" title="Couldn’t load the posts" action={<Button type="button" variant="secondary" className="min-h-11" onClick={() => calendar.refetch()}>Try again</Button>}>{contentErrorWords(calendar.error)} Events still show.</AlertCard>}
      {route.view === "board"
        ? (calendar.loading
          ? <SectionCard><p role="status" className="text-sm text-[var(--color-text-secondary)]">Loading posts…</p></SectionCard>
          : <>
              {(route.show === "events" || route.show === "calls") && <AlertCard variant="info" title="The board lists posts">Pick Everything or Posts in Show to see them here. Events and calls are on the Month view.</AlertCard>}
              <BoardView items={boardItems} open={open} move={beginMove} coarse={coarse} />
            </>)
        : <div className="flex min-w-0 flex-col gap-4">{box}</div>}

      <PanelLinksContext.Provider value={stack.links}>
        <PanelStack stack={stack} first={first} second={second} />
      </PanelLinksContext.Provider>
      <Modal open={!!cardFor} onClose={closeCard} title="Make a Work card?" size="sm"><ModalBody>{cardFor && (() => { const item = runwayCardItem(cardFor, people.me); return <div className="flex min-w-0 flex-col gap-2 text-sm text-[var(--color-text-secondary)]"><p className="font-semibold text-[var(--color-text-primary)]">{item.title}</p><p className="break-words">{item.instructions}</p><p>Done means: {item.done_means}</p><p>It is yours, linked to this event, and due before the event starts.</p>{cardProblem && <p role="alert" className="break-words text-[var(--color-error-700)]">{cardProblem}</p>}</div>; })()}</ModalBody><ModalFooter><Button type="button" variant="secondary" className="min-h-11" disabled={cardBusy} onClick={closeCard}>Cancel</Button><Button type="button" variant="brandContrast" className="min-h-11" loading={cardBusy} disabled={!online || !people.me} onClick={() => void makeCard()}>Make the card</Button></ModalFooter></Modal>
      <Modal open={addOpen} onClose={closeAdd} title="Plan a post" size="sm"><ModalBody><label htmlFor="new-content-title" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">Title</label><input id="new-content-title" autoFocus className={`${CONTROL_CLASS} min-h-11`} value={title} maxLength={160} disabled={busy} onChange={(event) => updateTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); create(); } }} /><p className="mt-2 text-sm text-[var(--color-text-secondary)]">It starts in Idea and is assigned to you. Add other owners here.</p><div className="mt-3"><PeopleField id="new-content-owners" label="Owners" value={addOwners} onChange={(next) => setAddOwners(next)} team={people.people} suggested={[people.me].filter(Boolean)} me={people.me} disabled={busy} /></div>{duplicate.checking && <p role="status" className="mt-2 text-sm text-[var(--color-text-secondary)]">Checking for similar titles…</p>}{duplicate.exact && <AlertCard variant="error" title="That title already exists" action={<Button type="button" variant="secondary" className="min-h-11" onClick={() => { closeAdd(); open(duplicate.exact.id); }}>Open existing</Button>}>Use the existing card instead of creating a duplicate.</AlertCard>}{duplicate.similar.length > 0 && !duplicate.exact && <AlertCard variant="warning" title="This may be a duplicate" action={!similarAccepted ? <Button type="button" variant="secondary" className="min-h-11" onClick={() => setSimilarAccepted(true)}>Add anyway</Button> : null}>Similar: {duplicate.similar.map((row) => row.title).join(", ")}{similarAccepted ? ". You can continue." : ". Review before continuing."}</AlertCard>}</ModalBody><ModalFooter><Button type="button" variant="secondary" className="min-h-11" disabled={busy} onClick={closeAdd}>Cancel</Button><Button type="button" variant="brandContrast" className="min-h-11" loading={busy} disabled={!title.trim() || !online || duplicate.checking || duplicateBlocked} onClick={create}>Add content</Button></ModalFooter></Modal>
      <Modal open={!!move} onClose={() => setMove(null)} title={move?.prompt?.title || "Move content"} size="sm"><ModalBody><p className="text-sm text-[var(--color-text-secondary)]">{move?.prompt?.flag === "approve_copy" ? "Confirm that the copy is ready for design." : move?.prompt?.flag === "approve_design" ? "Confirm that Ray and Abimbola have given the go for this post. It then shows on the Calendar as Approved." : "A stable live link is not on this card yet. You can add it first, or explicitly continue without one."}</p></ModalBody><ModalFooter><Button type="button" variant="secondary" className="min-h-11" onClick={() => { if (move?.prompt?.flag === "publish_without_link") openForField(move.item, "content-live", "Add and save the live link, then publish again."); else setMove(null); }}>{move?.prompt?.flag === "publish_without_link" ? "Add link first" : "Cancel"}</Button><Button type="button" variant="brandContrast" className="min-h-11" loading={busy} onClick={() => performMove(move.item, move.to, { [move.prompt.flag]: true })}>{move?.prompt?.action}</Button></ModalFooter></Modal>
    </div>
  );
}
