// Issue #3980 (R6) — the Calendar. Month first: every host's events with one
// of four plain states, today clearly marked and past days faded, posts
// behind Events | Posts | Both, a List grouped by state, and the content
// workflow board as its own view. With nothing open the month is full width
// and nothing sits under it (the grouped list is List view); the selected event (its sentence and its
// eight steps), a whole day or the posts with no date open in a right column
// (two columns from 1180px). The grid never scrolls sideways and words never
// break letter by letter.
//
// Issue #4130 (Wave 4a): two tabs, Event runway (default: the runway list in
// each event's own local time) and Content (default: the posts board, so posts
// show without picking a filter). One search filters the events and the posts.
// Events of staff or test brands are hidden unless asked for (calendar_runway).
import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Plus, Search } from "lucide-react";
import { PageHeader } from "../components/ui/PageHeader";
import { Button } from "../components/ui/Button";
import { AlertCard, SectionCard } from "../components/ui/Card";
import { Modal, ModalBody, ModalFooter } from "../components/ui/Modal";
import { Segmented, CONTROL_CLASS } from "../components/crm/fields";
import { ContentCard } from "../components/contentCalendar/ContentCard";
import { ContentDrawer } from "../components/contentCalendar/ContentDrawer";
import { PeopleField } from "../components/people/PeopleField";
import { useHashQuery } from "../hooks/useHashQuery";
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
  requestKey,
} from "../lib/contentCalendarModel";
import * as service from "../services/contentCalendarService";
import { TwoColumn } from "../components/ops/TwoColumn";
import { revealDetail } from "../components/ops/revealDetail";
import { EventPanel } from "../components/ops/EventPanel";
import { StateDot, StatePill } from "../components/ops/StateDot";
import { useOpsCalendar } from "../hooks/useOpsCalendar";
import { useServerRead } from "../hooks/useServerRead";
import { Tabs } from "../components/ui/Tabs";
import { getCalendarRunway } from "../services/dashboardService";
import { liveLabel, localWhen, promotionWindow, runwayAction, runwayCardItem, runwayPostTitle, testAnchorIds, visibleRunwayRows } from "../lib/calendarRunway";
import { Badge } from "../components/ui/Badge";
import * as ops from "../services/opsService";
import { PLAIN_STATES, STATE_LEGEND, dayLong, opsErrorWords, parseEventParam, stateName, todayIso } from "../lib/opsModel";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";
const WORDS = "break-normal [overflow-wrap:normal] hyphens-none";
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
// #4130: the Show control became the page's two tabs (show=events is Event
// runway, show=posts is Content).
const CALENDAR_TABS = [
  { id: "events", label: "Event runway" },
  { id: "posts", label: "Content" },
];
const VIEW_OPTIONS = [
  { value: "calendar", label: "Month" },
  { value: "list", label: "List" },
  { value: "board", label: "Posts board" },
];
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

/** Everything dated on the Calendar for one day: events and promised dates, then posts. */
function dayEntries(key, data, items, show) {
  const out = [];
  if (show !== "posts" && data) {
    for (const e of data.events || []) if (e.start_on === key) out.push({ type: "event", id: `ev-${e.id}`, title: e.title, state: e.state, selection: { kind: "event", id: e.id }, on: e.start_on, host: e.host?.name });
    for (const x of data.expected || []) if (x.expected_on === key) out.push({ type: "expected", id: `x-${x.id}-${x.expected_on}`, title: x.title, state: x.state, selection: { kind: "expected", id: x.id }, on: x.expected_on, host: x.host_name, repeats: x.repeats && x.repeats !== "none", moment: x.promo_moment });
  }
  if (show !== "events") for (const item of items) if (item.publish_at && localDateKey(item.publish_at) === key) out.push({ type: "post", id: `c-${item.id}`, title: item.title, item });
  return out;
}

function MonthGrid({ month, data, items, show, today, open, selectEvent, currentEvent, onDay, openDay, reschedule, coarse }) {
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
          const entries = dayEntries(key, data, items, show);
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
                  aria-label={`${dayWords}: ${events.map((e) => `${e.title}, ${stateName(e.state)}`).join("; ")}`}
                  title={events.map((e) => e.title).join(", ")}
                  className={`-mx-1 flex min-h-11 w-[calc(100%+0.5rem)] flex-wrap content-start items-start gap-1 rounded-md px-1.5 py-1 hover:bg-[var(--gray-50)] @min-[640px]:hidden ${past ? "opacity-60" : ""} ${FOCUS}`}
                >
                  {events.slice(0, 6).map((e) => <StateDot key={e.id} k={e.state?.k} size={10} />)}
                </button>
              )}
              {/* Wide: dot and title, two lines, whole words; at most two, then "+N more". */}
              <div className="hidden min-w-0 flex-col gap-0.5 @min-[640px]:flex">
                {visible.map((e) => e.type === "post" ? (
                  <button
                    key={e.id}
                    type="button"
                    draggable={!coarse}
                    onDragStart={(event) => { event.dataTransfer.setData("text/x-mingla-content-id", e.item.id); event.dataTransfer.effectAllowed = "move"; }}
                    onClick={() => open(e.item.id)}
                    aria-label={`${e.title}, post, ${e.item.stage}`}
                    title={e.title}
                    className={`block min-h-6 w-full min-w-0 rounded-md border border-[var(--gray-200)] bg-[var(--color-background-primary)] px-1.5 py-0.5 text-left text-[11.5px] font-semibold leading-tight text-[var(--color-text-primary)] hover:bg-[var(--gray-50)] ${past ? "opacity-60" : ""} ${FOCUS}`}
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

function Legend({ undated, onUndated, show }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--gray-200)] px-3 py-2.5 text-[12.5px] text-[var(--color-text-secondary)]">
      {STATE_LEGEND.map((k) => <span key={k} className="inline-flex items-center gap-1.5 whitespace-nowrap"><StateDot k={k} />{PLAIN_STATES[k]}</span>)}
      {show !== "events" && <Button type="button" variant="secondary" size="sm" className="ml-auto min-h-11" onClick={onUndated}>{undated} {undated === 1 ? "post" : "posts"} with no date</Button>}
      <p className="w-full text-[11.5px] text-[var(--color-text-tertiary)]">Events are on their own local day and time. Post times are in your time zone ({Intl.DateTimeFormat().resolvedOptions().timeZone || "local time"}).</p>
    </div>
  );
}

// #4130 (integration): the Event runway is a table, as designed: Event, Host,
// When (local), Live?, Promotion window, and one action per row. The actions
// only open a confirmation (Make a card) or the existing Add content form
// (Plan a post); nothing is written from the row itself.
function RunwayTable({ rows, onSelect, onMakeCard, onPlanPost, online }) {
  if (rows.length === 0) return <p className="p-4 text-[13px] text-[var(--color-text-secondary)]">Nothing dated in the next 90 days. Events and promised dates will appear here.</p>;
  return (
    <div className="min-w-0 overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-left text-[13px]">
        <thead>
          <tr className="border-b border-[var(--gray-200)] text-[11.5px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">
            <th scope="col" className="px-3 py-2">Event</th>
            <th scope="col" className="px-3 py-2">Host</th>
            <th scope="col" className="px-3 py-2">When (local)</th>
            <th scope="col" className="px-3 py-2">Live?</th>
            <th scope="col" className="px-3 py-2">Promotion window</th>
            <th scope="col" className="px-3 py-2"><span className="sr-only">Action</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--gray-100)]">
          {rows.map((r) => {
            const live = liveLabel(r);
            const windowCell = promotionWindow(r);
            const action = runwayAction(r);
            return (
              <tr key={`${r.anchor_kind}:${r.anchor_id}:${r.start_on}`} className="align-middle">
                <td className="px-3 py-2">
                  <button type="button" data-runway-row={`${r.anchor_kind}:${r.anchor_id}`} onClick={() => onSelect({ kind: r.anchor_kind, id: r.anchor_id }, r.start_on)} className={`min-h-11 text-left font-semibold text-[var(--color-text-primary)] underline-offset-2 hover:underline ${WORDS} ${FOCUS}`}>
                    {r.title}{r.is_test ? <span className="ml-1.5 text-[12px] font-normal text-[var(--color-text-tertiary)]">Test</span> : null}
                  </button>
                </td>
                <td className={`px-3 py-2 text-[var(--color-text-secondary)] ${WORDS}`}>{r.host_name || r.brand_name || "No host yet"}</td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums text-[var(--color-text-secondary)]">{localWhen(r)}</td>
                <td className="px-3 py-2"><Badge variant={live.tone}>{live.label}</Badge></td>
                <td className="px-3 py-2"><Badge variant={windowCell.tone}>{windowCell.label}</Badge></td>
                <td className="px-3 py-2 text-right">
                  {action === "card" && <Button type="button" variant="secondary" size="sm" className="min-h-11 whitespace-nowrap" disabled={!online} onClick={() => onMakeCard(r)}>Make a card</Button>}
                  {action === "post" && <Button type="button" variant="secondary" size="sm" className="min-h-11 whitespace-nowrap" disabled={!online} onClick={() => onPlanPost(r)}>Plan a post</Button>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function BoardView({ items, open, move, coarse }) {
  return <div className="overflow-x-auto pb-2"><div className="grid min-w-[1280px] grid-cols-6 gap-3">{CONTENT_STAGES.map((stage) => <section key={stage.value} aria-labelledby={`content-stage-${stage.value}`} onDragOver={(event) => { if (!coarse) { const item = items.find((row) => row.id === event.dataTransfer.getData("text/x-mingla-content-id")); if (item && canMoveTo(item, stage.value)) event.preventDefault(); } }} onDrop={(event) => { if (coarse) return; const item = items.find((row) => row.id === event.dataTransfer.getData("text/x-mingla-content-id")); if (item && canMoveTo(item, stage.value)) { event.preventDefault(); move(item, stage.value); } }} className="min-h-[320px] rounded-xl bg-[var(--gray-50)] p-2"><h2 id={`content-stage-${stage.value}`} className="mb-2 px-1 text-sm font-semibold text-[var(--color-text-primary)]">{stage.label} <span className="text-[var(--color-text-tertiary)]">{items.filter((item) => item.stage === stage.value).length}</span></h2><div className="space-y-2">{items.filter((item) => item.stage === stage.value).map((item) => <ContentCard key={item.id} item={item} onOpen={open} onMove={() => { const index = CONTENT_STAGES.findIndex((row) => row.value === item.stage); const next = CONTENT_STAGES[index + 1]?.value; if (canMoveTo(item, next)) move(item, next); }} onStage={move} stages={CONTENT_STAGES} draggable={!coarse} />)}</div></section>)}</div></div>;
}

function PostsList({ items, open }) {
  return <div className="min-w-0 border-t border-[var(--gray-200)]">
    <h3 className="px-4 pt-3 text-[12px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">Posts</h3>
    <div className="hidden grid-cols-[minmax(0,2fr)_1fr_1.25fr_1.25fr_1.25fr] gap-3 border-b border-[var(--gray-200)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)] md:grid"><span>Title</span><span>Stage</span><span>Owners</span><span>Publish time</span><span>Channels</span></div>
    <div className="divide-y divide-[var(--gray-200)]">{items.length ? items.map((item) => <button key={item.id} type="button" onClick={() => open(item.id)} className={`grid min-h-11 w-full grid-cols-1 gap-1 px-4 py-3 text-left hover:bg-[var(--gray-50)] md:grid-cols-[minmax(0,2fr)_1fr_1.25fr_1.25fr_1.25fr] md:items-center md:gap-3 ${FOCUS}`}><span className={`font-semibold text-[var(--color-text-primary)] ${WORDS}`}>{item.title}</span><span className="text-sm capitalize text-[var(--color-text-secondary)]"><span className="font-semibold md:hidden">Stage: </span>{item.stage}</span><span className={`text-sm text-[var(--color-text-secondary)] ${WORDS}`}><span className="font-semibold md:hidden">Owners: </span>{item.owners?.join(", ") || "Unassigned"}</span><span className="text-sm text-[var(--color-text-secondary)]"><span className="font-semibold md:hidden">Publish time: </span>{item.publish_at ? new Date(item.publish_at).toLocaleString() : "No date yet"}</span><span className={`text-sm text-[var(--color-text-secondary)] ${WORDS}`}><span className="font-semibold md:hidden">Channels: </span>{item.channels?.join(", ") || "None"}</span></button>) : <p className="px-4 py-3 text-[13px] text-[var(--color-text-secondary)]">No posts match.</p>}</div>
  </div>;
}

// One day in full, in the right column, opened from a day or "+N more".
const DayPanel = forwardRef(function DayPanel({ day, entries, open, selectEvent, onClose }, headingRef) {
  return <SectionCard><div className="flex min-w-0 flex-col gap-3">
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
      <h2 ref={headingRef} tabIndex={-1} className={`min-w-0 text-[16px] font-semibold text-[var(--color-text-primary)] focus-visible:outline-none ${WORDS}`}>{new Date(`${day}T12:00:00`).toLocaleDateString("en-GB", { weekday: "long", month: "long", day: "numeric" })}</h2>
      <Button type="button" variant="ghost" size="sm" icon={ArrowLeft} className="min-h-11" onClick={onClose}>Back to the calendar</Button>
    </div>
    {entries.length ? <ul className="flex min-w-0 flex-col gap-1.5">{entries.map((e) => <li key={e.id}>{e.type === "post"
      ? <ContentCard item={e.item} compact onOpen={open} />
      : <button type="button" onClick={() => selectEvent(e.selection, e.on)} className={`flex min-h-11 w-full min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--gray-200)] px-3 py-2 text-left hover:bg-[var(--gray-50)] ${FOCUS}`}><span className="min-w-0 flex-1"><span className={`block text-[13.5px] font-semibold text-[var(--color-text-primary)] ${WORDS}`}>{e.title}</span><span className={`block text-[12px] text-[var(--color-text-tertiary)] ${WORDS}`}>{e.host || ""}{e.repeats ? " · repeats" : ""}{e.moment ? " · promo moment" : ""}</span></span><StatePill state={e.state} /></button>}</li>)}</ul>
      : <p className="text-sm text-[var(--color-text-secondary)]">Nothing on this day.</p>}
  </div></SectionCard>;
});

// The posts with no date yet (they used to fill a column on the page).
const UndatedPanel = forwardRef(function UndatedPanel({ items, open, onClose }, headingRef) {
  return <SectionCard><div className="flex min-w-0 flex-col gap-3">
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
      <h2 ref={headingRef} tabIndex={-1} className="text-[16px] font-semibold text-[var(--color-text-primary)] focus-visible:outline-none">Posts with no date</h2>
      <Button type="button" variant="ghost" size="sm" icon={ArrowLeft} className="min-h-11" onClick={onClose}>Back to the calendar</Button>
    </div>
    {items.length ? <div className="flex min-w-0 flex-col gap-2">{items.map((item) => <ContentCard key={item.id} item={item} compact onOpen={open} />)}</div> : <p className="text-sm text-[var(--color-text-secondary)]">Every post has a date.</p>}
  </div></SectionCard>;
});

/** #4130: each tab's own first view. */
function defaultView(show) {
  return show === "posts" ? "board" : "list";
}

export function ContentCalendarPage() {
  const [search, setSearch] = useHashQuery("content-calendar");
  const route = useMemo(() => {
    const p = new URLSearchParams(search);
    // #4130: Content (show=posts) opens on the posts board; Event runway on
    // the runway list. An old "both" or Posts board address opens Content.
    const show = ["posts", "both"].includes(p.get("show")) || p.get("view") === "board" ? "posts" : "events";
    return {
      view: ["calendar", "board", "list"].includes(p.get("view")) ? p.get("view") : defaultView(show),
      show,
      test: p.get("test") === "1",
      month: /^\d{4}-(0[1-9]|1[0-2])$/.test(p.get("month") || "") ? p.get("month") : monthKey(),
      card: /^[0-9a-f-]{36}$/i.test(p.get("card") || "") ? p.get("card") : null,
      q: (p.get("q") || "").slice(0, 160),
      event: parseEventParam(p.get("event")),
      day: /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(p.get("day") || "") ? p.get("day") : null,
      undated: p.get("undated") === "1",
    };
  }, [search]);
  const query = useMemo(() => ({ ...(route.q ? { q: route.q } : {}), limit: 500 }), [route.q]);
  const calendar = useContentCalendar(query);
  const people = usePeopleDirectory();
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
  const eventDetailRef = useRef(null);
  const eventHeadingRef = useRef(null);
  // The control that opened the right column (a day, "+N more" or an event),
  // so going back to the calendar returns focus to it.
  const openerRef = useRef(null);
  const focusBack = useRef(false);
  const days = monthDays(route.month);
  const opsCal = useOpsCalendar(localDateKey(days[0]), localDateKey(days[days.length - 1]));
  // #4130: the runway in each event's own time, test brands marked. The Month
  // view reads the month's window so its test events can be hidden too.
  const runwayFrom = route.view === "calendar" ? localDateKey(days[0]) : null;
  const runwayTo = route.view === "calendar" ? localDateKey(days[days.length - 1]) : null;
  const loadRunway = useCallback(() => getCalendarRunway(runwayFrom, runwayTo, todayIso()), [runwayFrom, runwayTo]);
  const runwayRead = useServerRead(loadRunway);
  const runway = { data: runwayRead.data, error: runwayRead.status === "error" ? runwayRead.error : null, refetch: runwayRead.retry };
  const attention = useOpsAttention();
  const today = todayIso();

  const setParam = (name, value, replace = false) => { const p = new URLSearchParams(search); if (!value || (name === "view" && value === defaultView(route.show)) || (name === "show" && value === "events")) p.delete(name); else p.set(name, value); setSearch(p.toString(), { replace }); };
  const switchTab = (show) => { const p = new URLSearchParams(search); p.delete("view"); p.delete("event"); p.delete("day"); p.delete("undated"); if (show === "events") p.delete("show"); else p.set("show", show); setSearch(p.toString()); };
  const open = (id) => setParam("card", id);
  const rememberOpener = () => {
    if (typeof document === "undefined") return;
    const el = document.activeElement;
    if (!el || el === document.body || ((route.event || route.day || route.undated) && eventDetailRef.current?.contains(el))) return;
    const attr = ["data-calendar-chip", "data-calendar-more", "data-calendar-day-dense", "data-calendar-date", "data-runway-row"].find((name) => el.hasAttribute?.(name));
    openerRef.current = { el, selector: attr ? `[${attr}="${el.getAttribute(attr)}"]` : null };
  };
  const backToCalendar = (name) => { focusBack.current = true; setParam(name, null); };
  const selectEvent = (selection, onDate) => {
    rememberOpener();
    const p = new URLSearchParams(search);
    p.set("event", `${selection.kind}:${selection.id}`);
    p.delete("undated");
    if (typeof onDate === "string" && /^\d{4}-\d{2}/.test(onDate)) p.set("month", onDate.slice(0, 7));
    setSearch(p.toString());
    revealDetail(eventDetailRef, eventHeadingRef);
  };
  const clearEvent = () => backToCalendar("event");
  const openDay = (key) => {
    rememberOpener();
    const p = new URLSearchParams(search);
    p.set("day", key);
    p.delete("event");
    p.delete("undated");
    setSearch(p.toString());
    revealDetail(eventDetailRef, eventHeadingRef);
  };
  const clearDay = () => backToCalendar("day");
  const openUndated = () => {
    rememberOpener();
    const p = new URLSearchParams(search);
    p.set("undated", "1");
    p.delete("event");
    p.delete("day");
    setSearch(p.toString());
    revealDetail(eventDetailRef, eventHeadingRef);
  };
  useEffect(() => {
    if (!focusBack.current || route.event) return undefined;
    focusBack.current = false;
    if (route.day) {
      const frame = requestAnimationFrame(() => eventHeadingRef.current?.focus?.());
      return () => cancelAnimationFrame(frame);
    }
    const opener = openerRef.current;
    openerRef.current = null;
    const frame = requestAnimationFrame(() => {
      const visible = (el) => el && el.isConnected && el.getClientRects().length > 0;
      const target = [opener?.el, opener?.selector ? document.querySelector(opener.selector) : null].find(visible);
      target?.focus?.();
      if (!target || document.activeElement !== target) eventHeadingRef.current?.focus?.();
    });
    return () => cancelAnimationFrame(frame);
  }, [route.day, route.event, route.undated]);

  const close = () => { detailGate.current.close(); setDetail(null); setDetailLoading(false); setFocusTarget(null); setParam("card", null); };

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
        calendar.replaceItem(answer.item); setTitle(""); setAddOpen(false); open(answer.item.id);
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
  // #4130 (integration): "Plan a post" opens the existing Add content form with
  // a title about the event; the form's duplicate check and Add button are
  // the confirmation, and the post is created through the same path.
  const planPost = (row) => { setTitle(runwayPostTitle(row)); setSimilarAccepted(false); createFlight.current.reset(); setAddOpen(true); };
  // "Make a card" adds one Work card through the existing checked add
  // (ops_work_add), after a confirmation that shows the card.
  const makeCard = async () => {
    if (!cardFor || cardBusy) return;
    setCardBusy(true); setCardProblem(null);
    try {
      const answer = await ops.addWork([runwayCardItem(cardFor, people.me)], cardKey.current || (cardKey.current = requestKey("runway_card")));
      const row = answer?.results?.[0];
      if (row?.status === "added") {
        cardKey.current = null; setCardFor(null);
        addToast({ variant: "success", title: "Work card added", duration: 8000, action: { label: "Open Work", onClick: () => { window.location.hash = "#/work-board"; } } });
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
  const undated = calendar.items.filter((item) => !item.publish_at);
  const allRunwayRows = Array.isArray(runway.data?.rows) ? runway.data.rows : [];
  const runwayRows = visibleRunwayRows(allRunwayRows, { showTest: route.test, q: route.q });
  const testHidden = Number(runway.data?.test_hidden || 0);
  const testIds = route.test ? new Set() : testAnchorIds(allRunwayRows);
  // The tiles count the events shown (test brands left out unless asked).
  const states = runway.data ? runwayRows.reduce((acc, r) => { const k = r.state?.k; if (k) acc[k] = (acc[k] || 0) + 1; return acc; }, { ready: 0, short: 0, late: 0, notlive: 0 }) : {};
  const monthData = opsCal.data ? {
    ...opsCal.data,
    events: (opsCal.data.events || []).filter((e) => !testIds.has(String(e.id)) && (!route.q || String(e.title || "").toLowerCase().includes(route.q.toLowerCase()))),
    expected: (opsCal.data.expected || []).filter((x) => !testIds.has(String(x.id)) && (!route.q || String(x.title || "").toLowerCase().includes(route.q.toLowerCase()))),
  } : opsCal.data;
  const nonext = attention.data?.counts?.nonext;
  const monthName = monthWindow(route.month).first.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  // Every list follows Show: a day opened under Events lists only events.
  const dayItems = route.day ? dayEntries(route.day, monthData, calendar.items, route.show) : [];

  const right = route.undated
    ? <UndatedPanel ref={eventHeadingRef} items={undated} open={open} onClose={() => backToCalendar("undated")} />
    : !route.event && route.day
      ? <DayPanel ref={eventHeadingRef} day={route.day} entries={dayItems} open={open} selectEvent={selectEvent} onClose={clearDay} />
      : <EventPanel ref={eventHeadingRef} selection={route.event} onSelect={selectEvent} onBack={clearEvent} online={online} />;

  const box = (
    <div className="@container min-w-0 overflow-hidden rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] shadow-[var(--shadow-sm)]">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--gray-200)] p-2.5">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Button type="button" variant="secondary" icon={ChevronLeft} aria-label="Previous month" className="min-h-11 min-w-11" onClick={() => shiftMonth(-1)} />
          <span className="min-w-[8.5rem] text-center text-[14px] font-semibold tabular-nums text-[var(--color-text-primary)]">{monthName}</span>
          <Button type="button" variant="secondary" icon={ChevronRight} aria-label="Next month" className="min-h-11 min-w-11" onClick={() => shiftMonth(1)} />
          <button type="button" onClick={() => { setParam("month", null); }} className={`min-h-11 whitespace-nowrap rounded-full bg-[var(--color-brand-800)] px-3.5 text-[12.5px] font-semibold text-white hover:bg-[var(--color-brand-900)] ${FOCUS}`}>Today is {dayLong(today)}</button>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {route.show !== "posts" && testHidden > 0 && (
            <label className="inline-flex min-h-11 items-center gap-2 text-[12.5px] text-[var(--color-text-secondary)]">
              <input type="checkbox" checked={route.test} onChange={(e) => setParam("test", e.target.checked ? "1" : null, true)} />
              Show test events ({testHidden})
            </label>
          )}
          <Segmented label="View" options={VIEW_OPTIONS} value={route.view} onChange={(v) => setParam("view", v)} fullWidth className="sm:!w-fit" />
        </div>
      </div>
      {route.view === "calendar" ? (
        <>
          {opsCal.error && !opsCal.data && <div className="p-3"><AlertCard variant="warning" title="Couldn’t load events on Mingla" action={<Button type="button" variant="secondary" className="min-h-11" onClick={() => opsCal.refetch()}>Try again</Button>}>{opsErrorWords(opsCal.error)} Posts still work.</AlertCard></div>}
          <MonthGrid month={route.month} data={monthData} items={calendar.items} show={route.show} today={localDateKey()} open={open} selectEvent={selectEvent} currentEvent={route.event} onDay={openDay} openDay={route.event ? null : route.day} reschedule={reschedule} coarse={coarse} />
          <Legend undated={undated.length} onUndated={openUndated} show={route.show} />
        </>
      ) : route.view === "list" ? (
        <>
          {route.show !== "posts" && (runway.error && !runway.data
            ? <div className="p-3"><AlertCard variant="warning" title="Couldn’t load events on Mingla" action={<Button type="button" variant="secondary" className="min-h-11" onClick={() => runway.refetch()}>Try again</Button>}>{opsErrorWords(runway.error)}</AlertCard></div>
            : <RunwayTable rows={runwayRows} onSelect={selectEvent} onMakeCard={(r) => setCardFor(r)} onPlanPost={planPost} online={online} />)}
          {route.show !== "events" && <PostsList items={calendar.items} open={open} />}
          <Legend undated={undated.length} onUndated={openUndated} show={route.show} />
        </>
      ) : null}
    </div>
  );

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader title="Calendar" description="Events that need promoting, and the posts we are making." actions={<Button type="button" variant="brandContrast" icon={Plus} className="min-h-11" disabled={!online} onClick={() => setAddOpen(true)}>Add content</Button>} tabs={<Tabs tabs={CALENDAR_TABS.map((t) => ({ id: t.id, label: t.id === "posts" && !calendar.loading && !calendar.error ? `${t.label} · ${calendar.items.length} ${calendar.items.length === 1 ? "post" : "posts"}` : t.label }))} activeTab={route.show} onChange={switchTab} />} />
      {!online && <AlertCard variant="warning" title="You’re offline">You can read what is already here. Adding, saving, moving, commenting, deleting and Undo need a connection.</AlertCard>}
      {calendar.stale && <AlertCard variant="warning" title="Content may be out of date" action={<Button type="button" variant="secondary" className="min-h-11" onClick={() => calendar.refetch()}>Try again</Button>} />}
      {route.show !== "posts" && <div className="grid min-w-0 grid-cols-1 gap-2.5 sm:grid-cols-3">
        <button type="button" onClick={() => setParam("view", "list")} className={`flex min-h-11 min-w-0 items-center gap-3 rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] px-3.5 py-2.5 text-left hover:bg-[var(--gray-50)] ${FOCUS}`}><b className="min-w-[1.6rem] text-[21px] tabular-nums text-[var(--color-info-700)]">{states.notlive ?? "–"}</b><span className="text-[13px] text-[var(--color-text-secondary)]">need to go live</span></button>
        <button type="button" onClick={() => setParam("view", "list")} className={`flex min-h-11 min-w-0 items-center gap-3 rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] px-3.5 py-2.5 text-left hover:bg-[var(--gray-50)] ${FOCUS}`}><b className="min-w-[1.6rem] text-[21px] tabular-nums text-[var(--color-success-700)]">{states.ready === undefined ? "–" : Number(states.ready || 0) + Number(states.short || 0)}</b><span className="text-[13px] text-[var(--color-text-secondary)]">can be promoted</span></button>
        <a href="#/outreach?tab=hosts&filter=nonext" className={`flex min-h-11 min-w-0 items-center gap-3 rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] px-3.5 py-2.5 text-left hover:bg-[var(--gray-50)] ${FOCUS}`}><b className="min-w-[1.6rem] text-[21px] tabular-nums text-[var(--color-info-700)]">{nonext ?? "–"}</b><span className="text-[13px] text-[var(--color-text-secondary)]">hosts with no next event</span></a>
      </div>}
      <label className="relative block min-w-0 sm:max-w-sm"><span className="sr-only">Search events and posts</span><Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-[var(--color-text-tertiary)]" aria-hidden="true" /><input className={`${CONTROL_CLASS} min-h-11 pl-9`} value={route.q} onChange={(event) => setParam("q", event.target.value, true)} placeholder={route.show === "posts" ? "Search posts by title, copy or notes" : "Search events by title or host"} /></label>
      {calendar.error && <AlertCard variant="error" title="Couldn’t load the posts" action={<Button type="button" variant="secondary" className="min-h-11" onClick={() => calendar.refetch()}>Try again</Button>}>{contentErrorWords(calendar.error)} Events still show.</AlertCard>}
      {route.view === "board"
        ? (calendar.loading ? <SectionCard><p role="status" className="text-sm text-[var(--color-text-secondary)]">Loading posts…</p></SectionCard> : <>{box}<BoardView items={calendar.items} open={open} move={beginMove} coarse={coarse} /></>)
        : route.event || route.day || route.undated
          ? <TwoColumn ref={eventDetailRef} detailLabel="Event details" list={box} detail={right} />
          : <div className="flex min-w-0 flex-col gap-4">{box}</div>}

      <ContentDrawer activeId={route.card} detail={detail} config={calendar.config} online={online} loading={detailLoading} focusTarget={focusTarget} suspended={!!move} onFocusHandled={() => setFocusTarget(null)} onClose={close} onChanged={changed} onMove={beginMove} onDeleted={calendar.removeItem} />
      <Modal open={!!cardFor} onClose={closeCard} title="Make a Work card?" size="sm"><ModalBody>{cardFor && (() => { const item = runwayCardItem(cardFor, people.me); return <div className="flex min-w-0 flex-col gap-2 text-sm text-[var(--color-text-secondary)]"><p className="font-semibold text-[var(--color-text-primary)]">{item.title}</p><p className="break-words">{item.instructions}</p><p>Done means: {item.done_means}</p><p>It is yours, linked to this event, and due before the event starts.</p>{cardProblem && <p role="alert" className="break-words text-[var(--color-error-700)]">{cardProblem}</p>}</div>; })()}</ModalBody><ModalFooter><Button type="button" variant="secondary" className="min-h-11" disabled={cardBusy} onClick={closeCard}>Cancel</Button><Button type="button" variant="brandContrast" className="min-h-11" loading={cardBusy} disabled={!online || !people.me} onClick={() => void makeCard()}>Make the card</Button></ModalFooter></Modal>
      <Modal open={addOpen} onClose={closeAdd} title="Add content" size="sm"><ModalBody><label htmlFor="new-content-title" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">Title</label><input id="new-content-title" autoFocus className={`${CONTROL_CLASS} min-h-11`} value={title} maxLength={160} disabled={busy} onChange={(event) => updateTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); create(); } }} /><p className="mt-2 text-sm text-[var(--color-text-secondary)]">It starts in Idea and is assigned to you. Add other owners here.</p><div className="mt-3"><PeopleField id="new-content-owners" label="Owners" value={addOwners} onChange={(next) => setAddOwners(next)} team={people.people} suggested={[people.me].filter(Boolean)} me={people.me} disabled={busy} /></div>{duplicate.checking && <p role="status" className="mt-2 text-sm text-[var(--color-text-secondary)]">Checking for similar titles…</p>}{duplicate.exact && <AlertCard variant="error" title="That title already exists" action={<Button type="button" variant="secondary" className="min-h-11" onClick={() => { closeAdd(); open(duplicate.exact.id); }}>Open existing</Button>}>Use the existing card instead of creating a duplicate.</AlertCard>}{duplicate.similar.length > 0 && !duplicate.exact && <AlertCard variant="warning" title="This may be a duplicate" action={!similarAccepted ? <Button type="button" variant="secondary" className="min-h-11" onClick={() => setSimilarAccepted(true)}>Add anyway</Button> : null}>Similar: {duplicate.similar.map((row) => row.title).join(", ")}{similarAccepted ? ". You can continue." : ". Review before continuing."}</AlertCard>}</ModalBody><ModalFooter><Button type="button" variant="secondary" className="min-h-11" disabled={busy} onClick={closeAdd}>Cancel</Button><Button type="button" variant="brandContrast" className="min-h-11" loading={busy} disabled={!title.trim() || !online || duplicate.checking || duplicateBlocked} onClick={create}>Add content</Button></ModalFooter></Modal>
      <Modal open={!!move} onClose={() => setMove(null)} title={move?.prompt?.title || "Move content"} size="sm"><ModalBody><p className="text-sm text-[var(--color-text-secondary)]">{move?.prompt?.flag === "approve_copy" ? "Confirm that the copy is ready for design." : move?.prompt?.flag === "approve_design" ? "Confirm that the design is ready and the publish time and channels are set." : "A stable live link is not on this card yet. You can add it first, or explicitly continue without one."}</p></ModalBody><ModalFooter><Button type="button" variant="secondary" className="min-h-11" onClick={() => { if (move?.prompt?.flag === "publish_without_link") openForField(move.item, "content-live", "Add and save the live link, then publish again."); else setMove(null); }}>{move?.prompt?.flag === "publish_without_link" ? "Add link first" : "Cancel"}</Button><Button type="button" variant="brandContrast" className="min-h-11" loading={busy} onClick={() => performMove(move.item, move.to, { [move.prompt.flag]: true })}>{move?.prompt?.action}</Button></ModalFooter></Modal>
    </div>
  );
}
