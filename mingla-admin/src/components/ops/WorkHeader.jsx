// Issue #4255 (W2, rev2) — the Work header on ONE line (drawn inside the one
// PageHeader, after its title "Work", #3802): the four tabs,
// search, Owner, Show and Linked to as compact chips, the Show subtasks
// switch and + New card. An active filter turns orange and Clear appears.
// Under 1,150px the three chips fold into one "Filters · n" button; under
// 640px only the active tab shows (the others behind it). The row never
// wraps and never overflows: it is not overflow-hidden (that clipped the
// views and Filters menus on phones), so on a phone the search box gives way
// (min width 0) and the Filters menu opens right-aligned so it stays on
// screen. 390px (and 320px) fit with no sideways scroll. The filters filter the board, Today, This week and This month alike.
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ClipboardCopy, ListTree, Plus, Search, SlidersHorizontal } from "lucide-react";
import { MenuItem, Popover } from "./Popover";
import { activeFilterCount, headerFit } from "../../lib/workBoardModel";
import { WORK_LINKED, WORK_SHOW, WORK_VIEWS } from "../../lib/workViews";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";

/** "Owner · Everyone ▾": a chip around a native select (keyboard and screen readers for free). */
export function FilterChip({ name, label, value, options, onChange, disabled = false }) {
  const on = !!value;
  const shown = options.find((o) => o.value === value)?.label || options[0]?.label || "";
  return (
    <label data-filter-chip={name} data-on={on ? "true" : "false"}
      className={`relative inline-flex h-9 min-w-0 shrink-0 items-center gap-1 rounded-full border px-3 text-[12.5px] ${on ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)]" : "border-[var(--gray-200)] bg-[var(--color-background-primary)] text-[var(--color-text-secondary)]"} focus-within:ring-2 focus-within:ring-[var(--color-brand-700)]`}>
      <span className="whitespace-nowrap">{label} ·</span>
      <span className="max-w-[9rem] truncate font-semibold text-[var(--color-text-primary)]">{shown}</span>
      <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
      <select data-filter={name} aria-label={label} value={value || ""} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0">
        {options.map((o) => <option key={o.value || "all"} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

// #4255 rework (P3): the fold is decided by the width of the whole Work
// frame (the page's scroll area, like the design contract's
// "@container frame"), not by this row: measuring the row folded the three
// filter chips at 1440 with the menu open.
export function workFrameOf(el) {
  if (!el) return null;
  return (typeof el.closest === "function" && el.closest("[data-work-frame], main")) || el.parentElement || el;
}

function useFrameWidth(ref) {
  const [width, setWidth] = useState(1440);
  useEffect(() => {
    const frame = workFrameOf(ref.current);
    if (!frame || typeof ResizeObserver !== "function") return undefined;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    ro.observe(frame);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

export function WorkHeader({
  view,
  onView,
  typed,
  onTyped,
  onSearch,
  ownerOptions,
  owner,
  onOwner,
  show,
  onShow,
  linked,
  onLinked,
  onClear,
  filtersOn,
  showSubtasks,
  onToggleSubtasks,
  onNewCard,
  onCopyStandup,
  online = true,
  fit: forcedFit = null,
}) {
  const ref = useRef(null);
  const width = useFrameWidth(ref);
  const fit = forcedFit || headerFit(width);
  const count = activeFilterCount({ owner, show, linked });
  const onBoard = view === "board";
  const chips = (
    <>
      <FilterChip name="owner" label="Owner" value={owner || ""} options={ownerOptions} onChange={(v) => onOwner(v || null)} />
      <FilterChip name="show" label="Show" value={show} options={WORK_SHOW} onChange={(v) => onShow(v || null)} />
      <FilterChip name="linked" label="Linked to" value={linked} options={WORK_LINKED} onChange={(v) => onLinked(v || null)} />
    </>
  );
  const active = WORK_VIEWS.find((v) => v.value === view) || WORK_VIEWS[0];
  return (
    <div ref={ref} data-work-header="" data-fit={fit} className="flex h-12 min-w-0 flex-1 flex-nowrap items-center gap-2">
      {fit === "compact" ? (
        <Popover label="Choose a view" role="menu" width="w-44" dataAttr="views" rootClassName="shrink-0"
          button={<span className="inline-flex items-center gap-1">{active.label}<ChevronDown aria-hidden="true" className="h-3.5 w-3.5" /></span>}
          buttonClassName="inline-flex h-9 shrink-0 items-center rounded-lg bg-[var(--gray-100)] px-3 text-[13px] font-semibold text-[var(--color-text-primary)]">
          {(close) => WORK_VIEWS.map((v) => <MenuItem key={v.value} onClick={() => { onView(v.value); close(); }}>{v.label}{v.value === view ? " ✓" : ""}</MenuItem>)}
        </Popover>
      ) : (
        <nav role="tablist" aria-label="Work views" className="flex shrink-0 items-center gap-0.5 rounded-lg bg-[var(--gray-100)] p-0.5">
          {WORK_VIEWS.map((v) => (
            <button key={v.value} type="button" role="tab" id={`tab-${v.value}`} aria-selected={view === v.value} aria-controls={`tabpanel-${v.value}`} tabIndex={view === v.value ? 0 : -1}
              onClick={() => onView(v.value)}
              onKeyDown={(e) => {
                const i = WORK_VIEWS.findIndex((x) => x.value === view);
                if (e.key === "ArrowRight") { e.preventDefault(); onView(WORK_VIEWS[(i + 1) % WORK_VIEWS.length].value); }
                if (e.key === "ArrowLeft") { e.preventDefault(); onView(WORK_VIEWS[(i - 1 + WORK_VIEWS.length) % WORK_VIEWS.length].value); }
              }}
              className={`h-8 whitespace-nowrap rounded-md px-2.5 text-[13px] font-semibold ${view === v.value ? "bg-[var(--color-background-primary)] text-[var(--color-text-primary)] shadow-sm" : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"} ${FOCUS}`}>
              {v.label}
            </button>
          ))}
        </nav>
      )}
      <form role="search" className={`relative flex ${fit === "compact" ? "min-w-0" : "min-w-[7rem]"} flex-1 basis-[10rem] items-center lg:max-w-[16rem]`} onSubmit={(e) => { e.preventDefault(); onSearch(typed.trim().slice(0, 160)); }}>
        <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-[var(--color-text-tertiary)]" />
        <label className="sr-only" htmlFor="work-search">Search cards</label>
        <input id="work-search" type="search" value={typed} maxLength={160} placeholder="Search cards"
          onChange={(e) => { onTyped(e.target.value); if (!e.target.value) onSearch(""); }}
          onBlur={() => onSearch(typed.trim().slice(0, 160))}
          className={`h-9 w-full min-w-0 rounded-lg border border-[var(--gray-200)] bg-[var(--color-background-primary)] pl-8 pr-2 text-[13px] text-[var(--color-text-primary)] ${FOCUS}`} />
      </form>
      {fit === "full" ? chips : (
        <Popover label={count ? `Filters, ${count} on` : "Filters"} width="w-72" dataAttr="filters" rootClassName="shrink-0" align={fit === "compact" ? "right" : "left"}
          button={<span className="inline-flex items-center gap-1.5"><SlidersHorizontal aria-hidden="true" className="h-3.5 w-3.5" />{fit === "compact" ? (count ? count : "") : `Filters${count ? ` · ${count}` : ""}`}</span>}
          buttonClassName={`inline-flex h-9 shrink-0 items-center rounded-full border px-3 text-[12.5px] font-semibold ${count ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)]" : "border-[var(--gray-200)] text-[var(--color-text-secondary)]"}`}>
          <div className="flex flex-col gap-2 p-1">{chips}{filtersOn && <button type="button" onClick={onClear} className={`min-h-9 self-start rounded-md px-2 text-[12.5px] font-semibold text-[var(--color-brand-700)] hover:underline ${FOCUS}`}>Clear filters</button>}</div>
        </Popover>
      )}
      {filtersOn && fit === "full" && <button type="button" data-clear-filters="" onClick={onClear} className={`h-9 shrink-0 rounded-md px-1.5 text-[12.5px] font-semibold text-[var(--color-brand-700)] hover:underline ${FOCUS}`}>Clear</button>}
      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        {onBoard ? (
          <button type="button" data-show-subtasks="" aria-pressed={showSubtasks ? "true" : "false"} aria-label="Show subtasks on the board" title="Show subtasks on the board" onClick={onToggleSubtasks}
            className={`inline-grid h-9 w-9 place-items-center rounded-lg border ${showSubtasks ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)]" : "border-[var(--gray-200)] text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)]"} ${FOCUS}`}>
            <ListTree aria-hidden="true" className="h-4 w-4" />
          </button>
        ) : (
          <button type="button" aria-label="Copy standup" title="Copy standup" disabled={!online} onClick={onCopyStandup} className={`inline-grid h-9 w-9 place-items-center rounded-lg border border-[var(--gray-200)] text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)] disabled:opacity-50 ${FOCUS}`}>
            <ClipboardCopy aria-hidden="true" className="h-4 w-4" />
          </button>
        )}
        <button type="button" data-new-card="" disabled={!online} onClick={onNewCard} aria-label="New card"
          className={`inline-flex h-9 items-center gap-1 whitespace-nowrap rounded-lg bg-[var(--color-brand-500)] px-3 text-[13px] font-semibold text-white hover:bg-[var(--color-brand-600)] disabled:opacity-50 ${FOCUS}`}>
          <Plus aria-hidden="true" className="h-4 w-4" />{fit === "compact" ? "" : "New card"}
        </button>
      </span>
    </div>
  );
}
