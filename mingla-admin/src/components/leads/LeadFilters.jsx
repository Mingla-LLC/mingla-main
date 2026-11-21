// #4452 A1.8 — the Leads filter row: search (state only, never the address),
// label and source chips, and More filters. Every other filter is in the hash
// query, so a link reproduces the view.
import { useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { SearchInput } from "../ui/SearchInput";
import { Button } from "../ui/Button";
import { LABELS, SOURCES, EMAIL_STATUS_LABELS, querySet } from "../../lib/leadsModel";
import { CalendarInput } from "@mingla/calendar-web";

function Chip({ active, children, onClick }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={[
        "inline-flex min-h-9 items-center rounded-full border px-3 text-[13px] font-semibold transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]",
        active
          ? "border-transparent bg-[var(--a-text)] text-[var(--a-panel)]"
          : "border-[var(--a-line)] bg-[var(--color-background-primary)] text-[var(--color-text-secondary)] hover:bg-[var(--a-soft)]",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

const field = "h-11 rounded-xl border-[1.5px] border-[var(--a-line)] bg-[var(--color-background-primary)] px-3 text-sm text-[var(--color-text-primary)]";

export function LeadFilters({ search, onSearch, q, onQ, fixed = {}, forms = [] }) {
  const p = new URLSearchParams(search || "");
  const [more, setMore] = useState(() => ["form", "page", "consent", "email_status", "from", "to", "utm_source", "utm_campaign", "in_pipeline", "test"].some((k) => p.has(k)));
  const set = (key, value) => onSearch(querySet(search, key, value));
  const label = p.get("label") || "";
  const source = p.get("source") || "";
  return (
    <div className="flex min-w-0 flex-col gap-3" data-lead-filters="">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <SearchInput
          value={q}
          onChange={(e) => onQ(e.target.value)}
          placeholder="Search name or email"
          aria-label="Search name or email"
          className="w-full max-w-xs"
        />
        <div role="group" aria-label="Label" className="flex flex-wrap gap-1.5">
          <Chip active={!label} onClick={() => set("label", null)}>All</Chip>
          {LABELS.map((l) => <Chip key={l.value} active={label === l.value} onClick={() => set("label", l.value)}>{l.label}</Chip>)}
          <Chip active={label === "stopped"} onClick={() => set("label", "stopped")}>Emails stopped</Chip>
        </div>
        {!fixed.sources && (
          <div role="group" aria-label="Source" className="flex flex-wrap gap-1.5">
            <Chip active={!source} onClick={() => set("source", null)}>All</Chip>
            {SOURCES.map((s) => <Chip key={s.value} active={source === s.value} onClick={() => set("source", s.value)}>{s.label}</Chip>)}
          </div>
        )}
        <Button variant="secondary" size="sm" icon={SlidersHorizontal} aria-expanded={more} onClick={() => setMore((m) => !m)}>
          More filters
        </Button>
      </div>
      {more && (
        <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4" data-more-filters="">
          {!fixed.form_id && (
            <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--color-text-secondary)]">Form
              <select className={field} value={p.get("form") || ""} onChange={(e) => set("form", e.target.value)}>
                <option value="">Any form</option>
                {forms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </label>
          )}
          <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--color-text-secondary)]">Page
            <input className={field} defaultValue={p.get("page") || ""} placeholder="/creators" onBlur={(e) => set("page", e.target.value.trim().startsWith("/") ? e.target.value.trim() : null)} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--color-text-secondary)]">Consent
            <select className={field} value={p.get("consent") || ""} onChange={(e) => set("consent", e.target.value)}>
              <option value="">Any</option><option value="yes">Agreed to marketing</option><option value="no">No consent</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--color-text-secondary)]">Email status
            <select className={field} value={p.get("email_status") || ""} onChange={(e) => set("email_status", e.target.value)}>
              <option value="">Any</option>
              {Object.entries(EMAIL_STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--color-text-secondary)]">From
            <CalendarInput mode="date" className={field} value={p.get("from") || ""} onChange={(e) => set("from", e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--color-text-secondary)]">To
            <CalendarInput mode="date" className={field} value={p.get("to") || ""} onChange={(e) => set("to", e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--color-text-secondary)]">UTM source
            <input className={field} defaultValue={p.get("utm_source") || ""} onBlur={(e) => set("utm_source", e.target.value.trim())} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--color-text-secondary)]">UTM campaign
            <input className={field} defaultValue={p.get("utm_campaign") || ""} onBlur={(e) => set("utm_campaign", e.target.value.trim())} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--color-text-secondary)]">In pipeline
            <select className={field} value={p.get("in_pipeline") || ""} onChange={(e) => set("in_pipeline", e.target.value)}>
              <option value="">Any</option><option value="yes">On a card</option><option value="no">Not on a card</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
            <input type="checkbox" checked={p.get("test") === "1"} onChange={(e) => set("test", e.target.checked)} />
            Show test
          </label>
        </div>
      )}
    </div>
  );
}
