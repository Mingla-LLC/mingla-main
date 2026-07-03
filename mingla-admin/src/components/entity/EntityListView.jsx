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
//   - CSV export of the current page's rows via exportCsv(csv.columns, rows, csv.filename)
//   - row click → onRowClick(row): DataTable (ui kit, not forked here) has no
//     onRowClick, so we wrap each cell's render in a clickable element that fills
//     the cell — deterministic, no DOM querying / index mapping.

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { DataTable } from "../ui/Table";
import { SearchInput } from "../ui/SearchInput";
import { Dropdown, DropdownItem, DropdownLabel } from "../ui/Dropdown";
import { AlertCard } from "../ui/Card";
import { Button } from "../ui/Button";
import { Download, ChevronDown, RotateCcw } from "lucide-react";
import { exportCsv } from "../../lib/exportCsv";

export function EntityListView({
  title,
  columns,
  fetchPage,
  searchPlaceholder = "Search…",
  filters = [],
  pageSize = 25,
  onRowClick,
  csv,
  emptyMessage = "No results found",
  emptyIcon,
  rowKey = (row) => row.id,
}) {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState(null);
  const [selectedFilters, setSelectedFilters] = useState({});
  const [page, setPage] = useState(0);

  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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

  const load = useCallback(async () => {
    const reqId = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    try {
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
    } catch (err) {
      if (reqId !== reqIdRef.current) return;
      setRows([]);
      setTotal(0);
      setError(err?.message || "Failed to load. Please try again.");
    } finally {
      if (reqId === reqIdRef.current) setLoading(false);
    }
  }, [fetchPage, search, sortKey, sortDir, selectedFilters, page, pageSize]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSort = useCallback((key, dir) => {
    setSortKey(key);
    setSortDir(dir);
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

  const handleExport = useCallback(() => {
    if (!csv || rows.length === 0) return;
    exportCsv(csv.columns, rows, csv.filename);
  }, [csv, rows]);

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
        {filters.map((f) => {
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
            disabled={rows.length === 0}
            title="Export current page as CSV"
          >
            CSV
          </Button>
        )}
      </div>

      {/* Error state — actionable + retry. */}
      {error ? (
        <AlertCard
          variant="error"
          title="Couldn't load this list"
          action={
            <Button variant="secondary" size="sm" icon={RotateCcw} onClick={load}>
              Retry
            </Button>
          }
        >
          {error}
        </AlertCard>
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
