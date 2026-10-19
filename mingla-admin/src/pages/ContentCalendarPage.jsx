import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Plus, Search } from "lucide-react";
import { PageHeader } from "../components/ui/PageHeader";
import { Button } from "../components/ui/Button";
import { AlertCard, SectionCard } from "../components/ui/Card";
import { Modal, ModalBody, ModalFooter } from "../components/ui/Modal";
import { Segmented, CONTROL_CLASS } from "../components/crm/fields";
import { ContentCard } from "../components/contentCalendar/ContentCard";
import { ContentDrawer } from "../components/contentCalendar/ContentDrawer";
import { useHashQuery } from "../hooks/useHashQuery";
import { useOnline } from "../hooks/useCrmPipeline";
import { useContentCalendar } from "../hooks/useContentCalendar";
import { useToast } from "../context/ToastContext";
import {
  CONTENT_STAGES,
  CONTENT_VIEWS,
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
import { CalendarLayers, RunwayLegend } from "../components/ops/CalendarLayers";
import { EventPanel } from "../components/ops/EventPanel";
import { useOpsCalendar } from "../hooks/useOpsCalendar";
import { bandShort, bandTone, buildLayers, opsErrorWords, parseEventParam, parseLayers } from "../lib/opsModel";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
// #3980: event layer chips, coloured by runway band.
const EVENT_CHIP = "block w-full break-words rounded-md px-1.5 text-left font-semibold leading-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-1";
const EVENT_TONE = {
  success: "bg-[var(--color-success-50)] text-[var(--color-success-700)]",
  warning: "bg-[var(--color-warning-50)] text-[var(--color-warning-700)]",
  error: "bg-[var(--color-error-50)] text-[var(--color-error-700)]",
  info: "bg-[var(--color-info-50)] text-[var(--color-info-700)]",
  brand: "bg-[var(--color-brand-50)] text-[var(--color-brand-700)]",
  expected: "bg-[var(--color-background-primary)] text-[var(--color-text-secondary)]",
  default: "bg-[var(--gray-100)] text-[var(--gray-700)]",
};

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

// #3980: how many entries a day shows in the month grid beside the event
// panel before "+N more" opens the whole day in the panel.
const DAY_CHIP_LIMIT = 3;
const CONTENT_CHIP = "block w-full break-words rounded-md border border-[var(--gray-200)] bg-[var(--color-background-primary)] px-1.5 py-0.5 text-left text-[11px] font-semibold leading-tight text-[var(--color-text-primary)] hover:bg-[var(--gray-50)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-1";

function CalendarView({ items, month, open, reschedule, coarse, extras = null, showContent = true, withPanel = false, onDay = null, openDay = null }) {
  const window = monthWindow(month);
  // #3980: the Calendar's event layers ride beside the content cards; the
  // content layer can be turned off (Unscheduled stays). With the event panel
  // beside it, the whole Mon–Sun grid shrinks to fit (equal columns that may
  // shrink to nothing, compact chips that wrap by word, at most
  // DAY_CHIP_LIMIT entries a day and "+N more" for the rest), so it never
  // scrolls sideways.
  const gridItems = showContent ? items : [];
  const more = (key, mode) => (extras ? extras(key, mode) : []);
  const today = localDateKey();
  const firstInMonth = `${month}-01`;
  const [selected, setSelected] = useState(() => today.startsWith(month) ? today : firstInMonth);
  useEffect(() => setSelected((current) => current.startsWith(month) ? current : firstInMonth), [firstInMonth, month]);
  const inMonth = (date) => monthKey(date) === month;
  const byDate = (date) => gridItems.filter((item) => item.publish_at && localDateKey(item.publish_at) === localDateKey(date));
  const selectedItems = gridItems.filter((item) => item.publish_at && localDateKey(item.publish_at) === selected);
  const selectedMore = more(selected, "agenda");
  const drop = (event, date) => {
    if (coarse) return;
    event.preventDefault();
    const id = event.dataTransfer.getData("text/x-mingla-content-id");
    const item = items.find((row) => row.id === id);
    if (item) reschedule(item, date);
  };
  const moveDateFocus = (event, index) => {
    const steps = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -(index % 7), End: 6 - (index % 7) };
    if (!(event.key in steps)) return;
    event.preventDefault();
    const next = Math.max(0, Math.min(window.days.length - 1, index + steps[event.key]));
    const key = localDateKey(window.days[next]);
    setSelected(key);
    requestAnimationFrame(() => document.querySelector(`[data-calendar-date="${key}"]`)?.focus());
  };
  const undated = items.filter((item) => !item.publish_at);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Local time";
  return <div className={withPanel ? "grid min-w-0 grid-cols-1 gap-4" : "grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[220px_minmax(0,1fr)]"}>
    <SectionCard title="Unscheduled" subtitle={`${undated.length}`}><div className="space-y-2">{undated.length ? undated.map((item) => <ContentCard key={item.id} item={item} compact onOpen={open} draggable={!coarse} />) : <p className="text-sm text-[var(--color-text-secondary)]">Every card has a date.</p>}</div></SectionCard>
    <section aria-label="Content month" className="min-w-0">
      <p className="mb-2 text-xs text-[var(--color-text-tertiary)]">Times shown in {timezone}</p>
      <div className="rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] shadow-[var(--shadow-sm)] md:hidden">
        <div className="grid grid-cols-7 border-b border-[var(--gray-200)]">{WEEKDAYS.map((name) => <div key={name} className="p-1 text-center text-[11px] font-semibold uppercase text-[var(--color-text-tertiary)]">{name.slice(0, 1)}</div>)}</div>
        <div className="grid grid-cols-7">{window.days.map((date, index) => {
          const key = localDateKey(date); const count = byDate(date).length + more(key, "count").length; const isSelected = selected === key;
          return <button key={key} type="button" data-calendar-date={key} aria-pressed={isSelected} aria-label={`${date.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" })}, ${count} cards`} onKeyDown={(event) => moveDateFocus(event, index)} onClick={() => setSelected(key)} className={`min-h-11 border-b border-r border-[var(--gray-200)] p-1 text-center ${FOCUS} ${isSelected ? "bg-[var(--color-brand-800)] text-white" : inMonth(date) ? "text-[var(--color-text-primary)]" : "bg-[var(--gray-50)] text-[var(--color-text-tertiary)]"}`}><span className="block text-xs font-semibold">{date.getDate()}</span><span className="block text-[10px]" aria-hidden="true">{count || "·"}</span></button>;
        })}</div>
        <div className="p-3"><h2 className="text-sm font-semibold text-[var(--color-text-primary)]">{new Date(`${selected}T12:00:00`).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</h2><div className="mt-2 space-y-2">{selectedItems.length || selectedMore.length ? <>{selectedItems.map((item) => <ContentCard key={item.id} item={item} compact onOpen={open} />)}{selectedMore}</> : <p className="text-sm text-[var(--color-text-secondary)]">Nothing scheduled.</p>}</div></div>
      </div>
      {withPanel ? <div data-calendar-grid="panel" className="hidden min-w-0 overflow-hidden rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] shadow-[var(--shadow-sm)] md:block"><div className="grid grid-cols-[repeat(7,minmax(0,1fr))] border-b border-[var(--gray-200)]">{WEEKDAYS.map((name) => <div key={name} className="min-w-0 p-2 text-center text-xs font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">{name}</div>)}</div><div className="grid grid-cols-[repeat(7,minmax(0,1fr))]">{window.days.map((date) => {
        const key = localDateKey(date);
        const entries = [...byDate(date).map((item) => <button key={`c-${item.id}`} type="button" draggable={!coarse} onDragStart={(event) => { event.dataTransfer.setData("text/x-mingla-content-id", item.id); event.dataTransfer.effectAllowed = "move"; }} onClick={() => open(item.id)} aria-label={`${item.title}, content, ${item.stage}`} className={`${CONTENT_CHIP} min-h-6`}>{item.title}</button>), ...more(key, "grid")];
        const hidden = entries.length - DAY_CHIP_LIMIT;
        const dayWords = date.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" });
        return <section key={date.toISOString()} onDragOver={coarse ? undefined : (event) => event.preventDefault()} onDrop={(event) => drop(event, date)} aria-label={dayWords} className={`min-h-28 min-w-0 border-b border-r border-[var(--gray-200)] p-1 ${inMonth(date) ? "" : "bg-[var(--gray-50)] opacity-70"} ${openDay === key ? "ring-2 ring-inset ring-[var(--color-brand-700)]" : ""}`}><p className="mb-1 text-xs font-semibold text-[var(--color-text-secondary)]">{date.getDate()}</p><div className="min-w-0 space-y-1">{hidden > 0 ? entries.slice(0, DAY_CHIP_LIMIT - 1) : entries}{hidden > 0 && <button type="button" onClick={() => onDay?.(key)} aria-label={`Show all ${entries.length} on ${dayWords}`} className={`block min-h-6 w-full rounded-md px-1.5 py-0.5 text-left text-[11px] font-semibold text-[var(--color-brand-700)] hover:bg-[var(--gray-50)] ${FOCUS}`}>+{hidden + 1} more</button>}</div></section>;
      })}</div></div>
      : <div className="hidden overflow-x-auto rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] shadow-[var(--shadow-sm)] md:block"><div className="grid min-w-[700px] grid-cols-7 border-b border-[var(--gray-200)]">{WEEKDAYS.map((name) => <div key={name} className="p-2 text-center text-xs font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">{name}</div>)}</div><div className="grid min-w-[700px] grid-cols-7">{window.days.map((date) => <section key={date.toISOString()} onDragOver={coarse ? undefined : (event) => event.preventDefault()} onDrop={(event) => drop(event, date)} aria-label={date.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" })} className={`min-h-32 border-b border-r border-[var(--gray-200)] p-1.5 ${inMonth(date) ? "" : "bg-[var(--gray-50)] opacity-70"}`}><p className="mb-1 text-xs font-semibold text-[var(--color-text-secondary)]">{date.getDate()}</p><div className="space-y-1">{byDate(date).map((item) => <ContentCard key={item.id} item={item} compact onOpen={open} draggable={!coarse} />)}{more(localDateKey(date), "grid")}</div></section>)}</div></div>}
    </section>
  </div>;
}

function BoardView({ items, open, move, coarse }) {
  return <div className="overflow-x-auto pb-2"><div className="grid min-w-[1280px] grid-cols-6 gap-3">{CONTENT_STAGES.map((stage) => <section key={stage.value} aria-labelledby={`content-stage-${stage.value}`} onDragOver={(event) => { if (!coarse) { const item = items.find((row) => row.id === event.dataTransfer.getData("text/x-mingla-content-id")); if (item && canMoveTo(item, stage.value)) event.preventDefault(); } }} onDrop={(event) => { if (coarse) return; const item = items.find((row) => row.id === event.dataTransfer.getData("text/x-mingla-content-id")); if (item && canMoveTo(item, stage.value)) { event.preventDefault(); move(item, stage.value); } }} className="min-h-[320px] rounded-xl bg-[var(--gray-50)] p-2"><h2 id={`content-stage-${stage.value}`} className="mb-2 px-1 text-sm font-semibold text-[var(--color-text-primary)]">{stage.label} <span className="text-[var(--color-text-tertiary)]">{items.filter((item) => item.stage === stage.value).length}</span></h2><div className="space-y-2">{items.filter((item) => item.stage === stage.value).map((item) => <ContentCard key={item.id} item={item} onOpen={open} onMove={() => { const index = CONTENT_STAGES.findIndex((row) => row.value === item.stage); const next = CONTENT_STAGES[index + 1]?.value; if (canMoveTo(item, next)) move(item, next); }} onStage={move} stages={CONTENT_STAGES} draggable={!coarse} />)}</div></section>)}</div></div>;
}

// #3980: one day in full, in the Calendar's right column, opened from
// "+N more" in the month grid.
const DayPanel = forwardRef(function DayPanel({ day, items, open, chips, onClose }, headingRef) {
  const list = items.filter((item) => item.publish_at && localDateKey(item.publish_at) === day);
  return <SectionCard><div className="flex min-w-0 flex-col gap-3">
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
      <h2 ref={headingRef} tabIndex={-1} className="min-w-0 break-words text-[16px] font-semibold text-[var(--color-text-primary)] focus-visible:outline-none">{new Date(`${day}T12:00:00`).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</h2>
      <Button type="button" variant="ghost" size="sm" icon={ArrowLeft} className="min-h-11" onClick={onClose}>Back to runway</Button>
    </div>
    {list.length || chips.length ? <div className="flex min-w-0 flex-col gap-2">{chips}{list.map((item) => <ContentCard key={item.id} item={item} compact onOpen={open} />)}</div> : <p className="text-sm text-[var(--color-text-secondary)]">Nothing on this day.</p>}
  </div></SectionCard>;
});

function ListView({ items, open }) {
  return <SectionCard noPadding>
    <div className="hidden grid-cols-[minmax(0,2fr)_1fr_1.25fr_1.25fr_1.25fr] gap-3 border-b border-[var(--gray-200)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)] md:grid"><span>Title</span><span>Stage</span><span>Owners</span><span>Publish time</span><span>Channels</span></div>
    <div className="divide-y divide-[var(--gray-200)]">{items.map((item) => <button key={item.id} type="button" onClick={() => open(item.id)} className={`grid min-h-11 w-full grid-cols-1 gap-1 px-4 py-3 text-left hover:bg-[var(--gray-50)] md:grid-cols-[minmax(0,2fr)_1fr_1.25fr_1.25fr_1.25fr] md:items-center md:gap-3 ${FOCUS}`}><span className="font-semibold text-[var(--color-text-primary)]">{item.title}</span><span className="text-sm capitalize text-[var(--color-text-secondary)]"><span className="font-semibold md:hidden">Stage: </span>{item.stage}</span><span className="truncate text-sm text-[var(--color-text-secondary)]"><span className="font-semibold md:hidden">Owners: </span>{item.owners?.join(", ") || "Unassigned"}</span><span className="text-sm text-[var(--color-text-secondary)]"><span className="font-semibold md:hidden">Publish time: </span>{item.publish_at ? new Date(item.publish_at).toLocaleString() : "Unscheduled"}</span><span className="text-sm text-[var(--color-text-secondary)]"><span className="font-semibold md:hidden">Channels: </span>{item.channels?.join(", ") || "None"}</span></button>)}</div>
  </SectionCard>;
}

export function ContentCalendarPage() {
  const [search, setSearch] = useHashQuery("content-calendar");
  const route = useMemo(() => { const p = new URLSearchParams(search); return { view: ["calendar", "board", "list"].includes(p.get("view")) ? p.get("view") : "calendar", month: /^\d{4}-(0[1-9]|1[0-2])$/.test(p.get("month") || "") ? p.get("month") : monthKey(), card: /^[0-9a-f-]{36}$/i.test(p.get("card") || "") ? p.get("card") : null, q: (p.get("q") || "").slice(0, 160), layers: parseLayers(p.get("layers")), event: parseEventParam(p.get("event")), day: /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(p.get("day") || "") ? p.get("day") : null }; }, [search]);
  const query = useMemo(() => ({ ...(route.q ? { q: route.q } : {}), limit: 500 }), [route.q]);
  const calendar = useContentCalendar(query);
  const online = useOnline();
  const coarse = useCoarsePointer();
  const { addToast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [duplicate, setDuplicate] = useState({ checking: false, exact: null, similar: [] });
  const [similarAccepted, setSimilarAccepted] = useState(false);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [focusTarget, setFocusTarget] = useState(null);
  const [move, setMove] = useState(null);
  const [busy, setBusy] = useState(false);
  const createFlight = useRef(createSingleFlight());
  const detailGate = useRef(createLatestOnlyGate());
  const eventDetailRef = useRef(null);
  const eventHeadingRef = useRef(null);
  const days = monthWindow(route.month).days;
  const opsCal = useOpsCalendar(localDateKey(days[0]), localDateKey(days[days.length - 1]));

  const setParam = (name, value, replace = false) => { const p = new URLSearchParams(search); if (!value || (name === "view" && value === "calendar")) p.delete(name); else p.set(name, value); setSearch(p.toString(), { replace }); };
  const open = (id) => setParam("card", id);
  const toggleLayer = (id) => setParam("layers", buildLayers({ ...route.layers, [id]: !route.layers[id] }), true);
  const selectEvent = (selection, onDate) => {
    const p = new URLSearchParams(search);
    p.set("event", `${selection.kind}:${selection.id}`);
    if (typeof onDate === "string" && /^\d{4}-\d{2}/.test(onDate)) p.set("month", onDate.slice(0, 7));
    setSearch(p.toString());
    revealDetail(eventDetailRef, eventHeadingRef);
  };
  const clearEvent = () => setParam("event", null);
  // #3980: "+N more" on a day opens the whole day in the right column.
  const openDay = (key) => {
    const p = new URLSearchParams(search);
    p.set("day", key);
    p.delete("event");
    setSearch(p.toString());
    revealDetail(eventDetailRef, eventHeadingRef);
  };
  const clearDay = () => setParam("day", null);
  const eventLayers = (key, mode) => {
    const data = opsCal.data;
    if (!data) return [];
    const on = route.layers;
    const chips = [];
    const chip = (id, label, tone, dashed, selection, onDate, words = label) => {
      const current = route.event && selection && route.event.kind === selection.kind && route.event.id === selection.id;
      chips.push(<button key={`${id}-${mode}`} type="button" aria-current={current ? "true" : undefined} aria-label={words} onClick={() => selectEvent(selection, onDate)} className={`${EVENT_CHIP} ${mode === "grid" ? "min-h-6 py-0.5 text-[11px]" : "min-h-11 py-2 text-[13px]"} ${EVENT_TONE[tone] || EVENT_TONE.default} ${dashed ? "border-[1.5px] border-dashed border-[var(--gray-400)]" : "border border-transparent"} ${current ? "ring-2 ring-[var(--color-brand-700)]" : ""}`}>{label}</button>);
    };
    if (on.live) for (const e of data.events || []) if (e.start_on === key) chip(`ev-${e.id}`, e.is_public ? e.title : `${e.title} · not public yet`, bandTone(e.runway?.band), e.runway?.band === "missed", { kind: "event", id: e.id }, e.start_on, `${e.title}, ${bandShort(e.runway)}`);
    if (on.exp) for (const x of data.expected || []) if (x.expected_on === key) chip(`x-${x.id}`, `${x.title} · expected`, "expected", true, { kind: "expected", id: x.id }, x.expected_on, `${x.title}, expected from ${x.host_name || "a host"}, ${bandShort(x.runway)}`);
    if (on.dead) for (const d of data.deadlines || []) if (d.date === key) chip(`d-${d.anchor_kind}-${d.anchor_id}`, d.label, "info", false, { kind: d.anchor_kind, id: d.anchor_id }, null);
    if (on.promo) for (const p of data.promotions || []) if (p.source === "promo_start" && p.date === key) chip(`p-${p.anchor_kind}-${p.anchor_id}`, p.label, "brand", false, { kind: p.anchor_kind, id: p.anchor_id }, null);
    return chips;
  };
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
        const answer = await service.createContent(clean, key);
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
  const closeAdd = () => { if (!busy) { setAddOpen(false); setTitle(""); setSimilarAccepted(false); createFlight.current.reset(); } };

  const empty = calendar.loaded && !calendar.error && calendar.items.length === 0;
  const duplicateBlocked = !!duplicate.exact || (duplicate.similar.length > 0 && !similarAccepted);
  return (
    <div className="flex min-w-0 flex-col gap-6">
    <PageHeader title="Calendar" description="What is on Mingla, what hosts have promised, and what we post and promote." actions={<Button type="button" variant="brandContrast" icon={Plus} className="min-h-11" disabled={!online} onClick={() => setAddOpen(true)}>Add content</Button>} tabs={<Segmented label="Content view" options={CONTENT_VIEWS} value={route.view} onChange={(view) => setParam("view", view)} variant="highContrast" fullWidth className="sm:!w-fit" />} />
    {!online && <AlertCard variant="warning" title="You’re offline">You can read what is already here. Adding, saving, moving, commenting, deleting and Undo need a connection.</AlertCard>}
    {calendar.stale && <AlertCard variant="warning" title="Content may be out of date" action={<Button type="button" variant="secondary" className="min-h-11" onClick={() => calendar.refetch()}>Try again</Button>} />}
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <label className="relative block min-w-0 flex-1 sm:max-w-sm"><span className="sr-only">Search content</span><Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-[var(--color-text-tertiary)]" aria-hidden="true" /><input className={`${CONTROL_CLASS} min-h-11 pl-9`} value={route.q} onChange={(event) => setParam("q", event.target.value, true)} placeholder="Search title, copy or notes" /></label>
      {route.view === "calendar" && <div className="flex flex-wrap items-center gap-1"><Button type="button" variant="secondary" icon={ChevronLeft} aria-label="Previous month" className="min-h-11 min-w-11" onClick={() => shiftMonth(-1)} /><Button type="button" variant="secondary" className="min-h-11" onClick={() => setParam("month", monthKey())}>Today</Button><span className="min-w-32 text-center text-sm font-semibold text-[var(--color-text-primary)]">{monthWindow(route.month).first.toLocaleDateString([], { month: "long", year: "numeric" })}</span><Button type="button" variant="secondary" icon={ChevronRight} aria-label="Next month" className="min-h-11 min-w-11" onClick={() => shiftMonth(1)} /></div>}
    </div>
    {route.view === "calendar" && <CalendarLayers layers={route.layers} onToggle={toggleLayer} />}
    {route.view === "calendar" && opsCal.error && !opsCal.data && <AlertCard variant="warning" title="Couldn’t load events on Mingla" action={<Button type="button" variant="secondary" className="min-h-11" onClick={() => opsCal.refetch()}>Try again</Button>}>{opsErrorWords(opsCal.error)} Content still works.</AlertCard>}
    {calendar.loading ? <SectionCard><p role="status" className="text-sm text-[var(--color-text-secondary)]">Loading content…</p></SectionCard> : calendar.error ? <AlertCard variant="error" title="Couldn’t load the content calendar" action={<Button type="button" variant="secondary" className="min-h-11" onClick={() => calendar.refetch()}>Try again</Button>}>{contentErrorWords(calendar.error)}</AlertCard> : empty && route.view !== "calendar" ? <SectionCard><h2 className="text-base font-semibold text-[var(--color-text-primary)]">No content cards yet.</h2><p className="mt-1 text-sm text-[var(--color-text-secondary)]">Add a title to start in Idea.</p><Button type="button" variant="brandContrast" className="mt-4 min-h-11" disabled={!online} onClick={() => setAddOpen(true)}>Add content</Button></SectionCard> : route.view === "calendar" ? <TwoColumn ref={eventDetailRef} detailLabel="Event details" list={<div className="flex min-w-0 flex-col gap-2"><CalendarView items={calendar.items} month={route.month} open={open} reschedule={reschedule} coarse={coarse} extras={eventLayers} showContent={route.layers.content} withPanel onDay={openDay} openDay={route.event ? null : route.day} /><RunwayLegend /></div>} detail={!route.event && route.day ? <DayPanel ref={eventHeadingRef} day={route.day} items={route.layers.content ? calendar.items : []} open={open} chips={eventLayers(route.day, "agenda")} onClose={clearDay} /> : <EventPanel ref={eventHeadingRef} selection={route.event} onSelect={selectEvent} onBack={clearEvent} online={online} />} /> : route.view === "board" ? <BoardView items={calendar.items} open={open} move={beginMove} coarse={coarse} /> : <ListView items={calendar.items} open={open} />}

    <ContentDrawer activeId={route.card} detail={detail} config={calendar.config} online={online} loading={detailLoading} focusTarget={focusTarget} suspended={!!move} onFocusHandled={() => setFocusTarget(null)} onClose={close} onChanged={changed} onMove={beginMove} onDeleted={calendar.removeItem} />
    <Modal open={addOpen} onClose={closeAdd} title="Add content" size="sm"><ModalBody><label htmlFor="new-content-title" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">Title</label><input id="new-content-title" autoFocus className={`${CONTROL_CLASS} min-h-11`} value={title} maxLength={160} disabled={busy} onChange={(event) => updateTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); create(); } }} /><p className="mt-2 text-sm text-[var(--color-text-secondary)]">It starts in Idea and is assigned to you.</p>{duplicate.checking && <p role="status" className="mt-2 text-sm text-[var(--color-text-secondary)]">Checking for similar titles…</p>}{duplicate.exact && <AlertCard variant="error" title="That title already exists" action={<Button type="button" variant="secondary" className="min-h-11" onClick={() => { closeAdd(); open(duplicate.exact.id); }}>Open existing</Button>}>Use the existing card instead of creating a duplicate.</AlertCard>}{duplicate.similar.length > 0 && !duplicate.exact && <AlertCard variant="warning" title="This may be a duplicate" action={!similarAccepted ? <Button type="button" variant="secondary" className="min-h-11" onClick={() => setSimilarAccepted(true)}>Add anyway</Button> : null}>Similar: {duplicate.similar.map((row) => row.title).join(", ")}{similarAccepted ? ". You can continue." : ". Review before continuing."}</AlertCard>}</ModalBody><ModalFooter><Button type="button" variant="secondary" className="min-h-11" disabled={busy} onClick={closeAdd}>Cancel</Button><Button type="button" variant="brandContrast" className="min-h-11" loading={busy} disabled={!title.trim() || !online || duplicate.checking || duplicateBlocked} onClick={create}>Add content</Button></ModalFooter></Modal>
    <Modal open={!!move} onClose={() => setMove(null)} title={move?.prompt?.title || "Move content"} size="sm"><ModalBody><p className="text-sm text-[var(--color-text-secondary)]">{move?.prompt?.flag === "approve_copy" ? "Confirm that the copy is ready for design." : move?.prompt?.flag === "approve_design" ? "Confirm that the design is ready and the publish time and channels are set." : "A stable live link is not on this card yet. You can add it first, or explicitly continue without one."}</p></ModalBody><ModalFooter><Button type="button" variant="secondary" className="min-h-11" onClick={() => { if (move?.prompt?.flag === "publish_without_link") openForField(move.item, "content-live", "Add and save the live link, then publish again."); else setMove(null); }}>{move?.prompt?.flag === "publish_without_link" ? "Add link first" : "Cancel"}</Button><Button type="button" variant="brandContrast" className="min-h-11" loading={busy} onClick={() => performMove(move.item, move.to, { [move.prompt.flag]: true })}>{move?.prompt?.action}</Button></ModalFooter></Modal>
    </div>
  );
}
