/**
 * ISSUE-864 WP4 — Step: Destination (SPEC §2.3 + A4.0(3) destination policy
 * v1, blueprint §1.2). Searchable card grid of LIVE PUBLIC pages only
 * (public + status ∈ {scheduled, live} + future start). The ad-visible link
 * is the CANONICAL usemingla.com URL on ALL channels — the OneLink is built
 * server-side and rides only in Google's tracking template (PROOF D-P1: the
 * OneLink serves crawlers an app-install interstitial).
 */

import { useCallback, useEffect, useState } from "react";
import { AlertCard } from "../ui/Card";
import { SearchInput } from "../ui/SearchInput";
import { Button } from "../ui/Button";
import { Skeleton } from "../ui/Skeleton";
import { listBrandDestinations, listEventDestinations } from "../../services/adDestinationsService";

const TABS = [
  { id: "event", label: "Event pages" },
  { id: "brand", label: "Brand pages" },
];

export function StepDestination({ destination, onDestinationChange }) {
  const [tab, setTab] = useState(destination?.page_type === "brand" ? "brand" : "event");
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

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Where are we sending people?</h2>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Live public pages only — every platform reviews the destination and rejects broken,
          private or past pages.
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
          Nothing public and upcoming matches that search. Publish the page first, or clear the search.
        </AlertCard>
      )}

      {!loading && !error && rows && rows.length > 0 && (
        <div role="radiogroup" aria-label="Destination page" className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {rows.map((row) => {
            const selected = destination?.id === row.id && destination?.page_type === row.page_type;
            return (
              <button
                key={`${row.page_type}-${row.id}`}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onDestinationChange(row)}
                className={[
                  "text-left rounded-xl border overflow-hidden transition-all duration-150 cursor-pointer",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)] focus-visible:ring-offset-2",
                  selected
                    ? "border-[var(--color-brand-500)] ring-2 ring-[var(--color-brand-500)]"
                    : "border-[var(--gray-200)] hover:border-[var(--gray-300)]",
                ].join(" ")}
              >
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

      {destination && (
        <div className="p-3 rounded-lg border border-[var(--gray-200)] text-xs space-y-1">
          <p>
            <span className="font-semibold">Ad link (canonical): </span>
            <span className="font-mono">{destination.dest_url}</span>
          </p>
          <p className="text-[var(--color-text-secondary)]">
            Every channel's ad points at this public page. The app-or-web smart link is built
            server-side and used only inside Google's tracking template — crawlers see an
            app-store interstitial on the smart link, which platforms police as cloaking.
          </p>
        </div>
      )}
    </div>
  );
}
