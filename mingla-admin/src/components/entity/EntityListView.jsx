// ORCH-1271 [Admin authorization & audit FOUNDATION] — reusable, server-driven
// entity list. Wraps the existing ui/* kit (DataTable, SearchInput, Dropdown,
// AlertCard, Button) + lib/exportCsv. Domain consoles (1272/1273/1274) feed it a
// `fetchPage` that is the SINGLE data authority — no client-side row fabrication.
//
// Contract:
//   - debounced search (300ms) → resets to page 0
//   - server sort via DataTable controlled sortKey/sortDirection/onSort
//   - server pagination via DataTable pagination { page, pageSize, total, from, to, onChange } (0-based page)
//   - every async state handled: loading / error(+retry) / empty / populated
//   - #4130: CSV export of EVERY row matching the search, filters and sort
//     (fetched page by page up to EXPORT_ROW_CAP, with the cap stated), via
//     exportCsv(csv.columns, rows, csv.filename)
//   - #4130: sort covers the whole filtered list. A fetchPage that sorts on
//     the server says so with `serverSort`; for any other, a sort fetches the
//     filtered rows (up to CLIENT_SORT_ROW_CAP, stated when hit) and sorts
//     them here, instead of a header click that silently does nothing
//   - #4130: a failed load is the shared LoadError card with Retry
//   - #4130 Wave 2a: `initialFilters` opens the list already filtered
//   - row click → onRowClick(row): DataTable (ui kit, not forked here) has no
//     onRowClick, so we wrap each cell's render in a clickable element that fills
//     the cell — deterministic, no DOM querying / index mapping.

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { DataTable } from "../ui/Table";
import { SearchInput } from "../ui/SearchInput";
import { Dropdown, DropdownItem, DropdownLabel } from "../ui/Dropdown";
import { AlertCard } from "../ui/Card";
import { Button } from "../ui/Button";
import { LoadError } from "../ui/LoadError";
import { Download, ChevronDown } from "lucide-react";
import { exportCsv } from "../../lib/exportCsv";
import { CLIENT_SORT_ROW_CAP, EXPORT_ROW_CAP, fetchAllRows, sortRowsBy } from "../../lib/listAll";

export function EntityListView({
  title,
  columns,
  fetchPage,
  searchPlaceholder = "Search…",
  filters = [],
  filterVariant = "dropdown",
  pageSize = 25,
  onRowClick,
  csv,
  emptyMessage = "No results found",
  emptyIcon,
  rowKey = (row) => row.id,
  serverSort = false,
  // #4130 Wave 2a: a list opened from a link starts on that filter
  // (e.g. Orders "Host not paid" from Mingla money). Read once, on mount.
  initialFilters,
}) {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState(null);
  const [selectedFilters, setSelectedFilters] = useState(() => ({ ...(initialFilters || {}) }));
  const [page, setPage] = useState(0);

  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Set when a browser-side sort hit its cap: { sorted, total }.
  const [sortCapped, setSortCapped] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState(null);
  const [exportError, setExportError] = useState(null);

  // Debounce the search box → commit to `search` after 300ms, reset to page 0.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Guard against out-of-order responses (a slow earlier request resolving after
  // a faster later one) — only the latest request may write state.
  const reqIdRef = useRef(0);
  // Read through a ref: a page may pass a new columns array on every render,
  // and that must not refetch the list.
  const columnsRef = useRef(columns);
  columnsRef.current = columns;

  const load = useCallback(async () => {
    const reqId = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    try {
      if (sortKey && sortDir && !serverSort) {
        // This list's server does not sort: sort every filtered row here.
        const all = await fetchAllRows(
          fetchPage,
          { search, sortKey: null, sortDir: null, filters: selectedFilters },
          { cap: CLIENT_SORT_ROW_CAP }
        );
        if (reqId !== reqIdRef.current) return; // superseded
        const column = columnsRef.current.find((c) => c.key === sortKey);
        const sorted = sortRowsBy(all.rows, sortKey, sortDir, column?.sortValue);
        setRows(sorted.slice(page * pageSize, (page + 1) * pageSize));
        setTotal(sorted.length);
        setSortCapped(all.truncated ? { sorted: sorted.length, total: all.total } : null);
        return;
      }
      const result = await fetchPage({
        search,
        sortKey,
        sortDir,
        filters: selectedFilters,
        page,
        pageSize,
      });
      if (reqId !== reqIdRef.current) return; // superseded
      setRows(Array.isArray(result?.rows) ? result.rows : []);
      setTotal(Number.isFinite(result?.total) ? result.total : 0);
      setSortCapped(null);
    } catch (err) {
      if (reqId !== reqIdRef.current) return;
      setRows([]);
      setTotal(0);
      setError(err?.message || "Failed to load. Please try again.");
    } finally {
      if (reqId === reqIdRef.current) setLoading(false);
    }
  }, [fetchPage, search, sortKey, sortDir, selectedFilters, page, pageSize, serverSort]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSort = useCallback((key, dir) => {
    setSortKey(key);
    setSortDir(dir);
    setPage(0);
  }, []);

  const setFilter = useCallback((key, value) => {
    setSelectedFilters((prev) => {
      const next = { ...prev };
      if (value === null || value === undefined || value === "") delete next[key];
      else next[key] = value;
      return next;
    });
    setPage(0);
  }, []);

  // Wrap each cell so the whole cell (incl. td padding, via negative margins) is
  // clickable when onRowClick is provided; preserve the em-dash null fallback.
  const effectiveColumns = useMemo(() => {
    if (!onRowClick) return columns;
    return columns.map((col) => ({
      ...col,
      render: (value, row) => {
        const inner = col.render ? col.render(value, row) : value;
        return (
          <div
            className="-mx-4 -my-3 px-4 py-3 cursor-pointer"
            role="button"
            tabIndex={0}
            onClick={() => onRowClick(row)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onRowClick(row);
              }
            }}
          >
            {inner != null && inner !== "" ? (
              inner
            ) : (
              <span className="text-[var(--color-text-muted)]">&mdash;</span>
            )}
          </div>
        );
      },
    }));
  }, [columns, onRowClick]);

  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min((page + 1) * pageSize, total);

  // Every row matching the search, filters and sort, not just this page.
  const handleExport = useCallback(async () => {
    if (!csv || total === 0) return;
    setExporting(true);
    setExportError(null);
    setExportNote(null);
    try {
      const sortOnServer = serverSort && sortKey && sortDir;
      const all = await fetchAllRows(
        fetchPage,
        {
          search,
          sortKey: sortOnServer ? sortKey : null,
          sortDir: sortOnServer ? sortDir : null,
          filters: selectedFilters,
        },
        { cap: EXPORT_ROW_CAP }
      );
      const column = columnsRef.current.find((c) => c.key === sortKey);
      const out = sortKey && sortDir && !serverSort ? sortRowsBy(all.rows, sortKey, sortDir, column?.sortValue) : all.rows;
      if (out.length === 0) {
        setExportNote("Nothing to export: no rows match the search and filters.");
        return;
      }
      exportCsv(csv.columns, out, csv.filename);
      if (all.truncated) {
        setExportNote(
          `Exported the first ${out.length.toLocaleString()} of ${all.total.toLocaleString()} rows (the limit for one file). Narrow the search or filters to export the rest.`
        );
      }
    } catch (err) {
      setExportError(err?.message || "The export could not load the rows.");
    } finally {
      setExporting(false);
    }
  }, [csv, total, serverSort, sortKey, sortDir, fetchPage, search, selectedFilters]);

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        {title && (
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mr-auto">
            {title}
          </h2>
        )}
        <SearchInput
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onClear={() => setSearchInput("")}
          placeholder={searchPlaceholder}
          className="w-full sm:w-64"
        />
        {filterVariant === "chips" && filters.length === 1 ? (
          <div className="flex w-full flex-wrap gap-2" role="group" aria-label={`Filter by ${filters[0].label.toLowerCase()}`}>
            <button
              type="button"
              onClick={() => setFilter(filters[0].key, null)}
              aria-pressed={!selectedFilters[filters[0].key]}
              className={`min-h-11 rounded-full border px-4 text-sm font-semibold ${!selectedFilters[filters[0].key] ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-text-primary)]" : "border-[var(--gray-200)] bg-white text-[var(--color-text-secondary)]"}`}
            >
              {filters[0].allLabel || "All"}
            </button>
            {filters[0].options.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setFilter(filters[0].key, option.value)}
                aria-pressed={selectedFilters[filters[0].key] === option.value}
                className={`min-h-11 rounded-full border px-4 text-sm font-semibold ${selectedFilters[filters[0].key] === option.value ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-text-primary)]" : "border-[var(--gray-200)] bg-white text-[var(--color-text-secondary)]"}`}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : filters.map((f) => {
          const selectedLabel =
            f.options.find((o) => o.value === selectedFilters[f.key])?.label || f.label;
          return (
            <Dropdown
              key={f.key}
              align="left"
              trigger={
                <Button variant="secondary" size="md" iconRight={ChevronDown}>
                  {selectedLabel}
                </Button>
              }
            >
              {(close) => (
                <>
                  <DropdownLabel>{f.label}</DropdownLabel>
                  <DropdownItem onClick={() => setFilter(f.key, null)} onClose={close}>
                    All
                  </DropdownItem>
                  {f.options.map((o) => (
                    <DropdownItem
                      key={o.value}
                      onClick={() => setFilter(f.key, o.value)}
                      onClose={close}
                    >
                      {o.label}
                    </DropdownItem>
                  ))}
                </>
              )}
            </Dropdown>
          );
        })}
        {csv && (
          <Button
            variant="secondary"
            size="md"
            icon={Download}
            onClick={handleExport}
            loading={exporting}
            disabled={loading || total === 0}
            title={`Export every row that matches the search and filters as CSV (up to ${EXPORT_ROW_CAP.toLocaleString()})`}
          >
            Export all
          </Button>
        )}
      </div>

      {exportError && (
        <LoadError title="Couldn't export this list" message={exportError} onRetry={handleExport} retrying={exporting} />
      )}
      {exportNote && <AlertCard variant="info">{exportNote}</AlertCard>}
      {sortCapped && !error && (
        <AlertCard variant="info">
          {`Sorted across the first ${sortCapped.sorted.toLocaleString()} of ${sortCapped.total.toLocaleString()} matching rows. Narrow the search or filters to sort the rest.`}
        </AlertCard>
      )}

      {/* Error state — actionable + retry (the shared LoadError, #4130). */}
      {error ? (
        <LoadError title="Couldn't load this list" message={error} onRetry={load} />
      ) : (
        <DataTable
          columns={effectiveColumns}
          rows={rows}
          loading={loading}
          emptyIcon={emptyIcon}
          emptyMessage={emptyMessage}
          sortKey={sortKey}
          sortDirection={sortDir}
          onSort={handleSort}
          getRowId={rowKey}
          pagination={{
            page,
            pageSize,
            total,
            from,
            to,
            onChange: setPage,
          }}
        />
      )}
    </div>
  );
}
