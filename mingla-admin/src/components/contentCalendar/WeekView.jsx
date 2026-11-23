// Issue #4571 W5 — the Calendar's Week view: one Monday-to-Sunday week with four
// layers (Events, Demos, Call-backs, Work due) you can switch on and off. Every
// chip opens its card or record in the side panel (the page's panelStack); a
// demo with no host card says "Needs linking". Demo times are in the viewer's
// zone. Seven columns when there is room, one column on a phone; a chip wraps
// inside its own day and never runs into the next.
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "../ui/Button";
import { AlertCard } from "../ui/Card";
import { StateDot } from "../ops/StateDot";
import { calendarZoneNote } from "../../lib/calendarCalls";
import { WEEK_CHIP_TITLE, WEEK_LAYERS, layerCounts, weekChipClass, weekLabel } from "../../lib/calendarWeek";
import { opsErrorWords } from "../../lib/opsModel";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";
const SWATCH = {
  events: "bg-[var(--color-info-600)]",
  demos: "bg-[var(--color-success-600)]",
  callbacks: "bg-[var(--color-warning-600)]",
  work: "bg-[var(--color-brand-600)]",
};
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function dayParts(key) {
  const d = new Date(`${key}T12:00:00Z`);
  return {
    name: DAY_NAMES[(d.getUTCDay() + 6) % 7],
    number: d.getUTCDate(),
    long: d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }),
  };
}

function itemWords(item) {
  return [item.label, item.time, item.statusLabel, item.needsLinking ? "Needs linking" : "", item.title, item.sub].filter(Boolean).join(", ");
}

function WeekChip({ item, current, onOpen }) {
  return (
    <button
      type="button"
      data-week-item={item.id}
      data-week-layer={item.layer}
      data-needs-linking={item.needsLinking ? "" : undefined}
      aria-current={current ? "true" : undefined}
      aria-label={itemWords(item)}
      onClick={() => onOpen(item)}
      className={`${weekChipClass(item)} rounded-lg border px-2 py-1.5 text-[12px] hover:brightness-[0.97] aria-[current=true]:ring-2 aria-[current=true]:ring-[var(--color-brand-700)] ${item.off ? "opacity-60" : ""} ${FOCUS}`}
    >
      <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10.5px] font-semibold uppercase tracking-wide opacity-90">
        {item.layer === "events" && item.state?.k ? <StateDot k={item.state.k} size={8} /> : null}
        {item.time ? <b className="tabular-nums" data-week-time="">{item.time}</b> : null}
        <span>{item.label}</span>
        {item.statusLabel ? <span className="rounded-full bg-[var(--color-background-primary)] px-1.5 normal-case" data-week-status="">{item.statusLabel}</span> : null}
        {item.overdue ? <span className="rounded-full bg-[var(--color-error-50)] px-1.5 normal-case text-[var(--color-error-700)]" data-week-overdue="">Late</span> : null}
      </span>
      <span className={`${WEEK_CHIP_TITLE} text-[12.5px] ${item.off ? "line-through" : ""}`} data-week-title="">{item.title}</span>
      {item.sub ? (
        <span
          className={`block min-w-0 whitespace-normal [overflow-wrap:anywhere] text-[11px] ${item.needsLinking ? "font-semibold text-[var(--a-sched-ink)]" : "opacity-80"}`}
          data-week-sub=""
        >{item.sub}</span>
      ) : null}
    </button>
  );
}

export function WeekView({
  monday, days, today, zone, items, byDay, layers, onToggleLayer, onPrev, onNext, onThisWeek, onOpen, currentKey,
  loading, errors, onRetry,
}) {
  const counts = layerCounts(items);
  const shown = days.reduce((n, d) => n + (byDay[d]?.length || 0), 0);
  return (
    <div data-calendar-grid="week" className="@container min-w-0 overflow-hidden rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] shadow-[var(--shadow-sm)]">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--gray-200)] p-2.5">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Button type="button" variant="secondary" icon={ChevronLeft} aria-label="Previous week" className="min-h-11 min-w-11" onClick={onPrev} />
          <span className="min-w-[10.5rem] text-center text-[14px] font-semibold tabular-nums text-[var(--color-text-primary)]" data-week-label="">{weekLabel(monday)}</span>
          <Button type="button" variant="secondary" icon={ChevronRight} aria-label="Next week" className="min-h-11 min-w-11" onClick={onNext} />
          <button type="button" onClick={onThisWeek} className={`min-h-11 whitespace-nowrap rounded-full bg-[var(--color-brand-800)] px-3.5 text-[12.5px] font-semibold text-white hover:bg-[var(--color-brand-900)] ${FOCUS}`}>This week</button>
        </div>
        <div role="group" aria-label="Layers" className="flex min-w-0 flex-wrap items-center gap-1.5" data-week-layers="">
          {WEEK_LAYERS.map((layer) => {
            const on = layers.has(layer.key);
            return (
              <button
                key={layer.key}
                type="button"
                aria-pressed={on}
                data-week-layer-toggle={layer.key}
                onClick={() => onToggleLayer(layer.key)}
                className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-3 text-[12.5px] font-semibold ${on ? "border-[var(--gray-300)] text-[var(--color-text-primary)]" : "border-[var(--gray-200)] text-[var(--color-text-tertiary)] opacity-70"} hover:bg-[var(--gray-50)] ${FOCUS}`}
              >
                <span aria-hidden="true" className={`inline-block h-2.5 w-2.5 shrink-0 rounded-[3px] ${on ? SWATCH[layer.tone] : "border-[1.5px] border-current bg-transparent"}`} />
                {layer.label}
                <span className="tabular-nums text-[11.5px] font-normal text-[var(--color-text-tertiary)]" data-week-count={layer.key}>{counts[layer.key] || ""}</span>
              </button>
            );
          })}
        </div>
      </div>
      {errors.map((e) => (
        <div key={e.key} className="p-3">
          <AlertCard variant="warning" title={e.title} action={<Button type="button" variant="secondary" className="min-h-11" onClick={() => onRetry(e.key)}>Try again</Button>}>
            {opsErrorWords(e.error)} The other layers still show.
          </AlertCard>
        </div>
      ))}
      {loading ? <p role="status" className="px-3 py-2 text-[12.5px] text-[var(--color-text-secondary)]">Loading the week…</p> : null}
      {!loading && layers.size === 0 ? (
        <p role="status" className="px-3 py-2 text-[12.5px] text-[var(--color-text-secondary)]" data-week-none="">Every layer is off. Switch one on to see this week.</p>
      ) : null}
      {!loading && layers.size > 0 && shown === 0 && !errors.length ? (
        <p role="status" className="px-3 py-2 text-[12.5px] text-[var(--color-text-secondary)]" data-week-empty="">Nothing on for the layers you have on this week.</p>
      ) : null}
      <div className="grid grid-cols-1 @min-[760px]:grid-cols-[repeat(7,minmax(0,1fr))]">
        {days.map((day) => {
          const p = dayParts(day);
          const isToday = day === today;
          const list = byDay[day] || [];
          return (
            <section
              key={day}
              aria-label={p.long}
              data-week-day={day}
              className={`flex min-w-0 flex-col border-b border-[var(--gray-200)] @min-[760px]:min-h-[320px] @min-[760px]:border-r @min-[760px]:last:border-r-0 ${isToday ? "bg-[var(--color-brand-50)] shadow-[inset_0_0_0_2px_var(--color-brand-500)]" : day < today ? "opacity-70" : ""}`}
            >
              <h3 className="flex min-w-0 items-baseline gap-1.5 border-b border-[var(--gray-200)] px-2.5 py-2 text-[12px] text-[var(--color-text-tertiary)]">
                <span>{p.name}</span>
                <b className={`text-[16px] tabular-nums ${isToday ? "text-[var(--color-brand-700)]" : "text-[var(--color-text-primary)]"}`}>{p.number}</b>
                {isToday ? <span className="font-semibold text-[var(--color-brand-700)]">Today</span> : null}
              </h3>
              <div className="flex min-w-0 flex-col gap-1.5 p-2">
                {list.length ? list.map((item) => <WeekChip key={item.id} item={item} current={currentKey === item.id} onOpen={onOpen} />) : <span className="text-[11.5px] text-[var(--color-text-tertiary)]" data-week-empty-day="">Nothing on</span>}
              </div>
            </section>
          );
        })}
      </div>
      <p className="border-t border-[var(--gray-200)] px-3 py-2.5 text-[11.5px] text-[var(--color-text-tertiary)]" data-calendar-zone-note="">
        {calendarZoneNote(zone)} Call-backs, Work due and promised events are dates, so they carry no time.
      </p>
    </div>
  );
}
