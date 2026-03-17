import { useState, useMemo, useCallback } from "react";
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown } from "lucide-react";
import { Spinner } from "./Spinner";

export function DataTable({
  columns,
  rows,
  loading = false,
  emptyIcon: EmptyIcon,
  emptyMessage = "No results found",
  emptyAction,
  striped = false,
  pagination,
  className = "",
  sortKey: controlledSortKey,
  sortDirection: controlledSortDir,
  onSort,
  selectable = false,
  selectedIds,
  onSelect,
  onSelectAll,
  getRowId = (row) => row.id,
}) {
  const [internalSortKey, setInternalSortKey] = useState(null);
  const [internalSortDir, setInternalSortDir] = useState("asc");

  const activeSortKey = controlledSortKey !== undefined ? controlledSortKey : internalSortKey;
  const activeSortDir = controlledSortDir !== undefined ? controlledSortDir : internalSortDir;

  const handleHeaderClick = useCallback(
    (col) => {
      if (!col.sortable) return;

      let nextDir;
      if (activeSortKey !== col.key) {
        nextDir = "asc";
      } else if (activeSortDir === "asc") {
        nextDir = "desc";
      } else {
        nextDir = null;
      }

      if (onSort) {
        onSort(nextDir ? col.key : null, nextDir);
      } else {
        setInternalSortKey(nextDir ? col.key : null);
        setInternalSortDir(nextDir || "asc");
      }

      if (pagination?.onChange) {
        pagination.onChange(0);
      }
    },
    [activeSortKey, activeSortDir, onSort, pagination]
  );

  const sortedRows = useMemo(() => {
    if (onSort || !activeSortKey) return rows;

    return Array.from(rows).sort((a, b) => {
      const va = a[activeSortKey];
      const vb = b[activeSortKey];

      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;

      let cmp = 0;
      if (typeof va === "string" && typeof vb === "string" && /^\d{4}-\d{2}/.test(va) && /^\d{4}-\d{2}/.test(vb)) {
        cmp = new Date(va).getTime() - new Date(vb).getTime();
      } else if (typeof va === "number" && typeof vb === "number") {
        cmp = va - vb;
      } else {
        cmp = String(va).localeCompare(String(vb));
      }

      return activeSortDir === "desc" ? -cmp : cmp;
    });
  }, [rows, activeSortKey, activeSortDir, onSort]);

  const visibleIds = useMemo(() => {
    if (!selectable) return new Set();
    return new Set(sortedRows.map((r) => getRowId(r)).filter(Boolean));
  }, [selectable, sortedRows, getRowId]);

  const allVisibleSelected =
    selectable && selectedIds && visibleIds.size > 0 && [...visibleIds].every((id) => selectedIds.has(id));
  const someVisibleSelected =
    selectable && selectedIds && !allVisibleSelected && [...visibleIds].some((id) => selectedIds.has(id));

  return (
    <div
      className={[
        "bg-[var(--color-background-primary)] border border-[var(--gray-200)]",
        "rounded-xl overflow-hidden",
        className,
      ].join(" ")}
    >
      <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10">
            <tr>
              {selectable && (
                <th className="px-3 py-3 w-10 bg-[var(--table-header-bg)] border-b border-[var(--table-border)]">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    ref={(el) => { if (el) el.indeterminate = someVisibleSelected; }}
                    onChange={() => onSelectAll?.(!allVisibleSelected)}
                    className="h-4 w-4 rounded border-[var(--gray-300)] text-[#f97316] focus:ring-[#f97316] cursor-pointer"
                  />
                </th>
              )}
              {columns.map((col) => (
                <th
                  key={col.key}
                  onClick={() => handleHeaderClick(col)}
                  className={[
                    "px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider",
                    "text-[var(--color-text-tertiary)]",
                    "bg-[var(--table-header-bg)] border-b border-[var(--table-border)]",
                    "whitespace-nowrap",
                    col.sortable ? "cursor-pointer select-none group/sort" : "",
                    col.className || "",
                  ].join(" ")}
                  style={col.width ? { width: col.width } : undefined}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.label}
                    {col.sortable && (
                      <span className={[
                        "inline-flex",
                        activeSortKey === col.key ? "opacity-100" : "opacity-0 group-hover/sort:opacity-30",
                        "transition-opacity duration-150",
                      ].join(" ")}>
                        {activeSortKey === col.key && activeSortDir === "asc" ? (
                          <ChevronUp className="h-3 w-3 text-[#f97316]" />
                        ) : activeSortKey === col.key && activeSortDir === "desc" ? (
                          <ChevronDown className="h-3 w-3 text-[#f97316]" />
                        ) : (
                          <ChevronUp className="h-3 w-3" />
                        )}
                      </span>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={columns.length + (selectable ? 1 : 0)} className="text-center py-12">
                  <div className="flex items-center justify-center gap-2 text-[var(--color-text-secondary)]">
                    <Spinner size="sm" />
                    <span>Loading...</span>
                  </div>
                </td>
              </tr>
            ) : sortedRows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + (selectable ? 1 : 0)} className="text-center py-12">
                  <div className="flex flex-col items-center gap-2">
                    {EmptyIcon && <EmptyIcon className="h-10 w-10 text-[var(--gray-300)]" />}
                    <p className="text-sm text-[var(--color-text-tertiary)]">{emptyMessage}</p>
                    {emptyAction}
                  </div>
                </td>
              </tr>
            ) : (
              sortedRows.map((row, i) => {
                const rowId = getRowId(row);
                const isSelected = selectable && selectedIds?.has(rowId);

                return (
                  <tr
                    key={row._key ?? rowId ?? i}
                    className={[
                      "border-b border-[var(--table-border)]",
                      "hover:bg-[var(--table-row-hover)] transition-colors duration-150",
                      striped && i % 2 === 1 ? "bg-[var(--table-stripe)]" : "",
                      isSelected ? "bg-orange-50/50 dark:bg-orange-950/20" : "",
                    ].join(" ")}
                  >
                    {selectable && (
                      <td className="px-3 py-3 w-10">
                        <input
                          type="checkbox"
                          checked={isSelected || false}
                          onChange={() => onSelect?.(rowId, !isSelected)}
                          className="h-4 w-4 rounded border-[var(--gray-300)] text-[#f97316] focus:ring-[#f97316] cursor-pointer"
                        />
                      </td>
                    )}
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={[
                          "px-4 py-3 text-[var(--color-text-primary)]",
                          "max-w-[240px] overflow-hidden text-ellipsis whitespace-nowrap",
                          col.cellClassName || "",
                        ].join(" ")}
                        title={
                          typeof row[col.key] === "string" && row[col.key].length > 40
                            ? row[col.key]
                            : undefined
                        }
                      >
                        {col.render
                          ? col.render(row[col.key], row)
                          : row[col.key] ?? (
                              <span className="text-[var(--color-text-muted)]">&mdash;</span>
                            )}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {pagination && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--table-border)] text-sm text-[var(--color-text-secondary)]">
          <span>
            Showing {pagination.from}&ndash;{pagination.to} of {pagination.total}
          </span>
          <div className="flex items-center gap-1">
            <button
              disabled={pagination.page <= 0}
              onClick={() => pagination.onChange(pagination.page - 1)}
              className="flex items-center justify-center h-8 w-8 rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-150 cursor-pointer"
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            {buildPageNumbers(
              pagination.page,
              Math.ceil(pagination.total / pagination.pageSize)
            ).map((p, i) =>
              p === "..." ? (
                <span key={`ellipsis-${i}`} className="flex items-center justify-center h-8 w-8 text-[var(--color-text-muted)]">...</span>
              ) : (
                <button
                  key={p}
                  onClick={() => pagination.onChange(p)}
                  className={[
                    "flex items-center justify-center h-8 w-8 rounded-lg text-sm font-medium",
                    "cursor-pointer transition-all duration-150",
                    p === pagination.page
                      ? "bg-[#f97316] text-white"
                      : "text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)]",
                  ].join(" ")}
                >
                  {p + 1}
                </button>
              )
            )}
            <button
              disabled={(pagination.page + 1) * pagination.pageSize >= pagination.total}
              onClick={() => pagination.onChange(pagination.page + 1)}
              className="flex items-center justify-center h-8 w-8 rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-150 cursor-pointer"
              aria-label="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function buildPageNumbers(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i);
  const pages = new Set([0, 1, current - 1, current, current + 1, total - 2, total - 1]);
  const sorted = [...pages].filter((p) => p >= 0 && p < total).sort((a, b) => a - b);
  const result = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) result.push("...");
    result.push(sorted[i]);
  }
  return result;
}
