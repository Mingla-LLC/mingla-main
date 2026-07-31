/**
 * ISSUE-864 WP4 — Step: Destination (SPEC §2.3 + A4.0(3) destination policy
 * v1, blueprint §1.2). Searchable card grid of LIVE PUBLIC pages only
 * (public + status ∈ {scheduled, live} + future start). The ad-visible link
 * is the CANONICAL public-web URL (PUBLIC_WEB_ORIGIN — the server-of-record
 * host, QA P1-1) on ALL channels — the OneLink is built
 * server-side and rides only in Google's tracking template (PROOF D-P1: the
 * OneLink serves crawlers an app-install interstitial).
 *
 * ISSUE-1002 [multi-destination fan-out] — Wave 4 of #977. The picker is now a
 * CHECKBOX MULTI-SELECT (mirroring the Goal step's goalIds pattern): the operator
 * can select ANY MIX of event pages + the brand page. Selections PERSIST across
 * the Event/Brand tabs (the tab only filters what's shown — it never clears the
 * set). The wizard then fans out one ad per (selected destination × platform).
 * A single selection behaves exactly as before.
 */

import { useCallback, useEffect, useState } from "react";
import { Check } from "lucide-react";
import { AlertCard } from "../ui/Card";
import { SearchInput } from "../ui/SearchInput";
import { Button } from "../ui/Button";
import { Skeleton } from "../ui/Skeleton";
import {
  listBrandDestinations,
  listEventDestinations,
  listStayDestinations,
} from "../../services/adDestinationsService";

const TABS = [
  { id: "event", label: "Event pages" },
  { id: "venue", label: "Stay pages" },
  { id: "brand", label: "Brand pages" },
];

/** Stable identity for a destination row across tab reloads (page_type + id). */
function destKey(row) {
  return `${row.page_type}:${row.id}`;
}

export function StepDestination({ destinations, onDestinationsChange }) {
  const selected = Array.isArray(destinations) ? destinations : [];
  const [tab, setTab] = useState(
    ["event", "venue", "brand"].includes(selected[0]?.page_type)
      ? selected[0].page_type
      : "event",
  );
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = tab === "event"
        ? await listEventDestinations({ search })
        : tab === "venue"
          ? await listStayDestinations({ search })
          : await listBrandDestinations({ search });
      setRows(result.rows);
    } catch (err) {
      setError(err.message);
      setRows(null);
    }
    setLoading(false);
  }, [tab, search]);

  useEffect(() => {
    const t = setTimeout(load, search ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  // ISSUE-1002: toggle a row in/out of the selection set (the goalIds idiom).
  // Selections from BOTH tabs accumulate — switching tabs never clears the set,
  // so "2 event pages + the brand page" is one continuous selection.
  const toggle = useCallback(
    (row) => {
      const key = destKey(row);
      const isSelected = selected.some((d) => destKey(d) === key);
      onDestinationsChange(
        isSelected
          ? selected.filter((d) => destKey(d) !== key)
          : [...selected, row],
      );
    },
    [selected, onDestinationsChange],
  );

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Where are we sending people?</h2>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Pick one or more — every selected page gets its own ad on every channel. Live public
          pages only; each platform reviews the destination and rejects broken, private or past
          pages.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label="Destination type" className="inline-flex rounded-lg border border-[var(--gray-300)] p-0.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={tab === t.id}
              onClick={() => setTab(t.id)}
              className={[
                "h-8 px-3 text-xs font-medium rounded-md transition-colors",
                tab === t.id
                  ? "bg-[var(--color-brand-500)] text-white"
                  : "text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)]",
              ].join(" ")}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex-1 min-w-48">
          <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search pages…" />
        </div>
      </div>

      {loading && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} height={140} rounded className="rounded-xl" />)}
        </div>
      )}

      {!loading && error && (
        <AlertCard
          variant="error"
          title="Couldn't load pages"
          action={<Button size="sm" variant="secondary" onClick={load}>Retry</Button>}
        >
          {error}
        </AlertCard>
      )}

      {!loading && !error && rows && rows.length === 0 && (
        <AlertCard variant="info" title="No live pages match">
          Nothing public and eligible matches that search. Publish the page first, or clear the search.
        </AlertCard>
      )}

      {!loading && !error && rows && rows.length > 0 && (
        <div role="group" aria-label="Destination pages" className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {rows.map((row) => {
            const isSelected = selected.some((d) => destKey(d) === destKey(row));
            return (
              <button
                key={`${row.page_type}-${row.id}`}
                type="button"
                role="checkbox"
                aria-checked={isSelected}
                onClick={() => toggle(row)}
                className={[
                  "relative text-left rounded-xl border overflow-hidden transition-all duration-150 cursor-pointer",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)] focus-visible:ring-offset-2",
                  isSelected
                    ? "border-[var(--color-brand-500)] ring-2 ring-[var(--color-brand-500)]"
                    : "border-[var(--gray-200)] hover:border-[var(--gray-300)]",
                ].join(" ")}
              >
                {isSelected && (
                  <span
                    aria-hidden="true"
                    className="absolute top-1.5 right-1.5 z-10 inline-flex items-center justify-center w-5 h-5 rounded-full bg-[var(--color-brand-500)] text-white"
                  >
                    <Check size={12} />
                  </span>
                )}
                {row.cover_media_url ? (
                  <img src={row.cover_media_url} alt="" className="w-full h-20 object-cover" />
                ) : (
                  <div aria-hidden="true" className="w-full h-20 bg-[var(--gray-100)]" />
                )}
                <div className="p-2.5">
                  <p className="text-xs font-semibold truncate">{row.title}</p>
                  <p className="text-[10px] text-[var(--color-text-secondary)] truncate">
                    {row.brand_name}
                    {row.city ? ` · ${row.city}` : ""}
                    {row.master_start_at ? ` · ${new Date(row.master_start_at).toLocaleDateString()}` : ""}
                  </p>
                  {row.status && (
                    <p className="text-[10px] text-[var(--color-text-tertiary)] mt-0.5">{row.status}</p>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selected.length > 0 && (
        <div className="p-3 rounded-lg border border-[var(--gray-200)] text-xs space-y-2">
          <p className="font-semibold">
            {selected.length === 1
              ? "1 destination selected"
              : `${selected.length} destinations selected — one ad each, per channel`}
          </p>
          <ul className="space-y-1">
            {selected.map((d) => (
              <li key={destKey(d)} className="flex items-start justify-between gap-2">
                <span className="min-w-0">
                  <span className="font-medium">{d.title}</span>{" "}
                  <span className="font-mono text-[var(--color-text-secondary)] break-all">{d.dest_url}</span>
                </span>
                <button
                  type="button"
                  onClick={() => toggle(d)}
                  className="shrink-0 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] underline"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <p className="text-[var(--color-text-secondary)]">
            Every channel's ad points at these public pages. The app-or-web smart link is built
            server-side and used only inside Google's tracking template — crawlers see an
            app-store interstitial on the smart link, which platforms police as cloaking.
          </p>
        </div>
      )}
    </div>
  );
}
