// #4339 — a searchable time zone picker (WAI-ARIA 1.2 combobox with a listbox
// popup). Type a city, zone id, country or offset ("GMT+1"); arrow keys move,
// Enter picks, Escape closes; matches are highlighted; each option shows its
// offset and the time there now. Mingla cities and common zones come first
// (COMMON_ZONES); only zones both this browser and the database know are
// offered (timeZoneOptions / SERVER_ZONES), so a pick is never refused.
//
// Reusable: <TimeZoneCombobox id value onChange labelId ... />.
import { forwardRef, useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { comboboxKeyStep, highlightParts, searchTimeZones, zoneCity, zoneClock, zoneCountry, zoneLabel, zoneOffset } from "../../lib/timeZoneSearch";

function Highlight({ text, query }) {
  return highlightParts(text, query).map((part, index) => (part.match
    ? <mark key={index} className="bg-transparent font-bold text-[var(--color-brand-700)]">{part.text}</mark>
    : <span key={index}>{part.text}</span>));
}

export const TimeZoneCombobox = forwardRef(function TimeZoneCombobox({
  id,
  value,
  onChange,
  labelId,
  invalid = false,
  describedBy,
  placeholder = "Search a city or country, e.g. Lagos",
  className = "",
}, ref) {
  const fallbackId = useId();
  const inputId = id || `tz-${fallbackId}`;
  const listId = `${inputId}-list`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(null); // null: not typing, show the chosen zone
  const [active, setActive] = useState(-1);
  const [at, setAt] = useState(() => new Date());
  const listRef = useRef(null);

  const typed = query ?? "";
  const { common, rest } = useMemo(() => searchTimeZones(typed, { at }), [typed, at]);
  const options = useMemo(() => [...common, ...rest], [common, rest]);

  // Keep the highlighted option in view while arrowing through a long list.
  useEffect(() => {
    if (!open || active < 0 || !listRef.current) return;
    const node = listRef.current.querySelector?.(`[data-index="${active}"]`);
    node?.scrollIntoView?.({ block: "nearest" });
  }, [active, open]);

  const show = () => {
    setAt(new Date());
    setOpen(true);
    setActive(-1);
  };
  const close = () => {
    setOpen(false);
    setQuery(null);
    setActive(-1);
  };
  const choose = (zone) => {
    onChange?.(zone);
    close();
  };

  const onKeyDown = (event) => {
    const step = comboboxKeyStep({ open, active, count: options.length }, event.key);
    if (step.handled) event.preventDefault();
    if (step.pick !== null) {
      choose(options[step.pick]);
      return;
    }
    if (step.open && !open) setAt(new Date());
    if (!step.open && open) {
      close();
      return;
    }
    setOpen(step.open);
    setActive(step.active);
  };

  const group = (title, zones, offset) => (zones.length ? [
    <li key={`g-${title}`} role="presentation" className="px-2.5 pb-1 pt-2 font-mono text-[10.5px] uppercase tracking-[0.1em] text-[var(--color-text-tertiary)]">{title}</li>,
    ...zones.map((zone, index) => {
      const position = offset + index;
      const selected = zone === value;
      const country = zoneCountry(zone);
      return (
        <li
          key={zone}
          id={`${listId}-${position}`}
          role="option"
          aria-selected={selected}
          data-zone={zone}
          data-index={position}
          onMouseDown={(event) => { event.preventDefault(); choose(zone); }}
          onMouseEnter={() => setActive(position)}
          className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-sm ${position === active || selected ? "bg-[var(--color-brand-50)]" : ""}`}
        >
          <span className="min-w-0">
            <span className="font-semibold text-[var(--color-text-primary)]"><Highlight text={zoneCity(zone)} query={typed} /></span>
            {country ? <span className="text-[var(--color-text-secondary)]"> · <Highlight text={country} query={typed} /></span> : null}
            <span className="block truncate font-mono text-xs text-[var(--color-text-tertiary)]">
              <Highlight text={zone} query={typed} /> · now {zoneClock(zone, at)}
            </span>
          </span>
          <span className="shrink-0 text-right font-mono text-xs tabular-nums text-[var(--color-text-secondary)]">{zoneOffset(zone, at)}</span>
        </li>
      );
    }),
  ] : []);

  return (
    <div className={`relative ${className}`}>
      <input
        ref={ref}
        id={inputId}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-labelledby={labelId}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        value={query ?? zoneLabel(value, at)}
        onFocus={(event) => { event.target.select?.(); show(); }}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); setActive(-1); }}
        onKeyDown={onKeyDown}
        onBlur={close}
        className={[
          "h-10 w-full rounded-lg border bg-[var(--color-background-primary)] pl-3 pr-9 text-sm text-[var(--color-text-primary)] outline-none transition-all duration-150",
          "focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-100)]",
          invalid ? "border-[#ef4444]" : "border-[var(--gray-300)]",
        ].join(" ")}
      />
      <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
      <ul
        ref={listRef}
        id={listId}
        role="listbox"
        aria-labelledby={labelId}
        hidden={!open}
        className="absolute left-0 right-0 top-[calc(100%+4px)] z-30 max-h-72 overflow-y-auto rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-1 shadow-lg"
      >
        {!open ? null : options.length ? [
          ...group(typed.trim() ? "Best matches" : "Mingla cities and common", common, 0),
          ...group(typed.trim() ? "All other zones" : "All zones", rest, common.length),
        ] : (
          <li role="presentation" className="px-2.5 py-2.5 text-sm text-[var(--color-text-secondary)]">
            No time zone matches “{typed.trim()}”. Try a city, like Lagos or Chicago.
          </li>
        )}
      </ul>
    </div>
  );
});
