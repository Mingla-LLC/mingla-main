/**
 * ISSUE-864 WP4 + toward #3697 Wave 3 (#3700) — destination picker.
 * Lists via `listAdvertisablePages` (SQL `ad_advertisable_pages`) so Admin
 * matches the create-campaign gate. Single select per campaign (#3707).
 *
 * Tab order keeps Event → Stay → Brand first (#1431), then the Wave 1 types.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check } from "lucide-react";
import { AlertCard } from "../ui/Card";
import { SearchInput } from "../ui/SearchInput";
import { Button } from "../ui/Button";
import { Skeleton } from "../ui/Skeleton";
import {
  listAdvertisablePages,
  listNativeAppDestinations,
} from "../../services/adDestinationsService";

const TABS = [
  { id: "all", label: "All" },
  { id: "event", label: "Events" },
  { id: "venue", label: "Stays" },
  { id: "brand", label: "Brands" },
  { id: "rsvp", label: "RSVPs" },
  { id: "trip", label: "Trips" },
  { id: "experience", label: "Experiences" },
  { id: "reservation", label: "Reservations" },
  { id: "site", label: "Sites" },
  // toward #3697 Wave 4 — Mingla marketing landings (after Host page types; #1431 order preserved).
  { id: "marketing", label: "Marketing" },
  { id: "explorer_app", label: "Explorer app" },
  { id: "host_app", label: "Host app" },
];

const PAGE_TYPE_LABEL = Object.fromEntries(
  TABS.filter((t) => t.id !== "all").map((t) => [t.id, t.label]),
);

/** Stable identity for a destination row across tab reloads (page_type + id). */
function destKey(row) {
  return `${row.page_type}:${row.id}`;
}

function isAvailable(row) {
  return row.availability == null || row.availability === "available";
}

export function StepDestination({
  destinations,
  onDestinationsChange,
  platforms = [],
  certificationMode = false,
  initialAppFamily = null,
  certificationAppKey = null,
  certificationOs = null,
}) {
  const selected = useMemo(
    () => (Array.isArray(destinations) ? destinations : []),
    [destinations],
  );
  const selectedType = selected[0]?.page_type;
  const [tab, setTab] = useState(
    selectedType && PAGE_TYPE_LABEL[selectedType]
      ? selectedType
      : initialAppFamily && PAGE_TYPE_LABEL[initialAppFamily]
        ? initialAppFamily
        : "all",
  );
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [includeUnavailable, setIncludeUnavailable] = useState(false);
  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(24);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const appFamilies =
        tab === "all"
          ? ["explorer_app", "host_app"]
          : tab === "explorer_app" || tab === "host_app"
            ? [tab]
            : [];
      const includePages = tab !== "explorer_app" && tab !== "host_app";
      const [pageResult, appRows] = await Promise.all([
        includePages
          ? listAdvertisablePages({
              search,
              page,
              types: tab === "all" ? null : [tab],
              includeUnavailable,
            })
          : Promise.resolve({ rows: [], total: 0, pageSize: 24 }),
        appFamilies.length > 0
          ? listNativeAppDestinations({
              families: appFamilies,
              platforms,
              certificationMode,
            })
          : Promise.resolve([]),
      ]);
      const normalizedSearch = search.trim().toLowerCase();
      const visibleApps = appRows.filter(
        (row) =>
          (includeUnavailable || isAvailable(row)) &&
          (!certificationMode ||
            (row.app_key === certificationAppKey &&
              row.os === certificationOs)) &&
          (!normalizedSearch ||
            row.title.toLowerCase().includes(normalizedSearch)),
      );
      const combined = [...visibleApps, ...pageResult.rows];
      setRows(combined);
      setTotal(
        (pageResult.total ?? pageResult.rows.length) + visibleApps.length,
      );
      setPageSize(pageResult.pageSize ?? 24);
    } catch (err) {
      setError(err.message);
      setRows(null);
      setTotal(0);
    }
    setLoading(false);
  }, [
    tab,
    search,
    page,
    includeUnavailable,
    platforms,
    certificationMode,
    certificationAppKey,
    certificationOs,
  ]);

  useEffect(() => {
    const t = setTimeout(load, search ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  // toward #3697 Wave 2 (#3707): single select — tap again to clear, tap another to replace.
  const toggle = useCallback(
    (row) => {
      if (!isAvailable(row)) return;
      const key = destKey(row);
      const isSelected = selected.some((d) => destKey(d) === key);
      onDestinationsChange(isSelected ? [] : [row]);
    },
    [selected, onDestinationsChange],
  );

  const maxPage =
    pageSize > 0 ? Math.max(0, Math.ceil(total / pageSize) - 1) : 0;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Where are we sending people?</h2>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Pick one public or Marketing page, or a provider-native Explorer/Host
          app target.
          {certificationMode
            ? " Certification mode offers only app targets with fresh exact provider and measurement readiness; it still requires explicit owner approval before any paused provider object is created."
            : " App targets become selectable only when every chosen provider has fresh exact app, measurement, funding, and certification evidence."}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div
          role="radiogroup"
          aria-label="Destination type"
          className="inline-flex flex-wrap rounded-lg border border-[var(--gray-300)] p-0.5 gap-0.5"
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={tab === t.id}
              onClick={() => {
                setTab(t.id);
                setPage(0);
              }}
              className={[
                "h-8 px-2.5 text-xs font-medium rounded-md transition-colors",
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
          <SearchInput
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder="Search destinations…"
          />
        </div>
        <label className="inline-flex items-center gap-2 text-xs text-[var(--color-text-secondary)] cursor-pointer select-none">
          <input
            type="checkbox"
            checked={includeUnavailable}
            onChange={(e) => {
              setIncludeUnavailable(e.target.checked);
              setPage(0);
            }}
            className="rounded border-[var(--gray-300)]"
          />
          Show unavailable
        </label>
      </div>

      {loading && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} height={140} rounded className="rounded-xl" />
          ))}
        </div>
      )}

      {!loading && error && (
        <AlertCard
          variant="error"
          title="Couldn't load pages"
          action={
            <Button size="sm" variant="secondary" onClick={load}>
              Retry
            </Button>
          }
        >
          {error}
        </AlertCard>
      )}

      {!loading && !error && rows && rows.length === 0 && (
        <AlertCard variant="info" title="No pages match">
          Nothing matches that search
          {includeUnavailable ? "" : " among available pages"}. Try another
          type, clear the search, or show unavailable pages.
        </AlertCard>
      )}

      {!loading && !error && rows && rows.length > 0 && (
        <div
          role="group"
          aria-label="Destination pages"
          className="grid grid-cols-2 md:grid-cols-3 gap-3"
        >
          {rows.map((row) => {
            const available = isAvailable(row);
            const isSelected = selected.some(
              (d) => destKey(d) === destKey(row),
            );
            return (
              <button
                key={`${row.page_type}-${row.id}`}
                type="button"
                role="checkbox"
                aria-checked={isSelected}
                aria-disabled={!available}
                disabled={!available}
                onClick={() => toggle(row)}
                className={[
                  "relative text-left rounded-xl border overflow-hidden transition-all duration-150",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)] focus-visible:ring-offset-2",
                  !available
                    ? "opacity-55 cursor-not-allowed border-[var(--gray-200)]"
                    : isSelected
                      ? "border-[var(--color-brand-500)] ring-2 ring-[var(--color-brand-500)] cursor-pointer"
                      : "border-[var(--gray-200)] hover:border-[var(--gray-300)] cursor-pointer",
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
                  <img
                    src={row.cover_media_url}
                    alt=""
                    className="w-full h-20 object-cover"
                  />
                ) : (
                  <div
                    aria-hidden="true"
                    className="w-full h-20 bg-[var(--gray-100)]"
                  />
                )}
                <div className="p-2.5">
                  <p className="text-xs font-semibold truncate">{row.title}</p>
                  <p className="text-[10px] text-[var(--color-text-secondary)] truncate">
                    {PAGE_TYPE_LABEL[row.page_type] ?? row.page_type}
                    {row.brand_name ? ` · ${row.brand_name}` : ""}
                    {row.city ? ` · ${row.city}` : ""}
                    {row.master_start_at
                      ? ` · ${new Date(row.master_start_at).toLocaleDateString()}`
                      : ""}
                  </p>
                  {!available && (
                    <p className="text-[10px] text-[var(--color-warning-700)] mt-0.5">
                      Unavailable
                      {row.availability_reason
                        ? ` — ${row.availability_reason}`
                        : ""}
                    </p>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {!loading && !error && total > pageSize && (
        <div className="flex items-center justify-between gap-2 text-xs text-[var(--color-text-secondary)]">
          <span>
            Showing {page * pageSize + 1}–
            {Math.min((page + 1) * pageSize, total)} of {total}
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={page <= 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={page >= maxPage}
              onClick={() => setPage((p) => Math.min(maxPage, p + 1))}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {selected.length > 0 && (
        <div className="p-3 rounded-lg border border-[var(--gray-200)] text-xs space-y-2">
          <p className="font-semibold">1 destination selected</p>
          <ul className="space-y-1">
            {selected.map((d) => (
              <li
                key={destKey(d)}
                className="flex items-start justify-between gap-2"
              >
                <span className="min-w-0">
                  <span className="font-medium">{d.title}</span>{" "}
                  <span className="font-mono text-[var(--color-text-secondary)] break-all">
                    {d.dest_url}
                  </span>
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
            {selected[0]?.page_type?.endsWith("_app")
              ? "Every selected channel receives its provider-native app identity and install measurement event. The store URL is shown here; OneLink remains attribution metadata, not a web-traffic substitute."
              : "Every channel’s ad points at this public page. Smart links remain attribution metadata and never replace the visible destination."}
          </p>
        </div>
      )}
    </div>
  );
}
