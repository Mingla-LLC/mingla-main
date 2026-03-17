import { useState, useEffect, useCallback } from "react";
import { Database, Search, AlertCircle, ChevronDown, ChevronRight, PanelLeftOpen, X } from "lucide-react";
import { supabase } from "../lib/supabase";
import { TABLES, TABLE_CATEGORIES } from "../lib/constants";
import { DataTable } from "../components/ui/Table";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";

const PAGE_SIZE = 20;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

function formatCellValue(value, key) {
  if (value === null || value === undefined) {
    return <span className="text-[var(--color-text-muted)] italic">null</span>;
  }
  if (typeof value === "object") {
    return <Badge variant="info">JSON</Badge>;
  }
  if (typeof value === "boolean") {
    return <Badge variant={value ? "success" : "error"} dot>{value ? "true" : "false"}</Badge>;
  }

  const str = String(value);

  if (UUID_REGEX.test(str)) {
    return (
      <span className="font-mono text-xs text-[var(--color-text-tertiary)] cursor-default" title={str}>
        {str.slice(0, 8)}...
      </span>
    );
  }

  if (ISO_DATE_REGEX.test(str)) {
    try {
      const date = new Date(str);
      if (!isNaN(date.getTime())) {
        return (
          <span className="text-xs whitespace-nowrap" title={str}>
            {date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        );
      }
    } catch {
      // Fall through
    }
  }

  return str.length > 60 ? str.slice(0, 57) + "..." : str;
}

export function TableBrowserPage() {
  const [selected, setSelected] = useState("profiles");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [tableFilter, setTableFilter] = useState("");
  const [tableCounts, setTableCounts] = useState({});
  const [collapsedCategories, setCollapsedCategories] = useState({});
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  useEffect(() => {
    let mounted = true;
    async function fetchCounts() {
      const counts = {};
      const BATCH_SIZE = 6;
      for (let i = 0; i < TABLES.length; i += BATCH_SIZE) {
        if (!mounted) return;
        const batch = TABLES.slice(i, i + BATCH_SIZE);
        await Promise.all(
          batch.map(async (table) => {
            try {
              const { count } = await supabase.from(table).select("*", { count: "exact", head: true });
              counts[table] = count ?? 0;
            } catch {
              counts[table] = 0;
            }
          })
        );
        if (mounted) setTableCounts({ ...counts });
      }
    }
    fetchCounts();
    return () => { mounted = false; };
  }, []);

  const loadData = useCallback(async (table, pg) => {
    setLoading(true);
    setError(null);
    try {
      const from = pg * PAGE_SIZE;
      const { data, count, error: queryError } = await supabase
        .from(table)
        .select("*", { count: "exact" })
        .range(from, from + PAGE_SIZE - 1);
      if (queryError) throw queryError;
      setRows(data || []);
      setTotal(count || 0);
    } catch (err) {
      setError(err.message || "Failed to load table data");
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(selected, page); }, [selected, page, loadData]);

  const handleSelectTable = (table) => {
    if (table === selected) { setMobileSidebarOpen(false); return; }
    setSelected(table);
    setPage(0);
    setMobileSidebarOpen(false);
  };

  const toggleCategory = (label) => {
    setCollapsedCategories((prev) => ({ ...prev, [label]: !prev[label] }));
  };

  const columns = rows.length
    ? Object.keys(rows[0]).map((key) => ({
        key,
        label: key,
        render: (value) => formatCellValue(value, key),
      }))
    : [];

  const filterLower = tableFilter.toLowerCase();
  const hasFilter = filterLower.length > 0;
  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min((page + 1) * PAGE_SIZE, total);

  return (
    <div className="flex flex-col gap-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Table Browser</h1>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1">
          Browse and inspect all database tables
        </p>
      </div>

      {/* Browser Layout */}
      <div className="flex gap-4 min-h-[600px] relative">
        {/* Mobile toggle */}
        <button
          onClick={() => setMobileSidebarOpen(true)}
          className="md:hidden flex items-center gap-2 px-3 py-2 text-xs font-medium text-[var(--color-text-secondary)] bg-[var(--color-background-primary)] border border-[var(--gray-200)] rounded-lg absolute top-0 left-0 z-10 cursor-pointer"
        >
          <PanelLeftOpen className="h-4 w-4" />
          Tables
        </button>

        {/* Mobile overlay */}
        {mobileSidebarOpen && (
          <div className="fixed inset-0 bg-black/40 z-20 md:hidden" onClick={() => setMobileSidebarOpen(false)} />
        )}

        {/* Table List Sidebar */}
        <div
          className={[
            "w-[240px] shrink-0 bg-[var(--color-background-primary)] border border-[var(--gray-200)] rounded-xl overflow-hidden flex flex-col",
            "md:relative md:translate-x-0",
            mobileSidebarOpen ? "fixed top-0 left-0 h-full z-30 rounded-none border-r" : "hidden md:flex",
          ].join(" ")}
        >
          {/* Mobile close */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--gray-200)] md:hidden">
            <span className="text-xs font-semibold text-[var(--color-text-primary)]">Tables</span>
            <button
              onClick={() => setMobileSidebarOpen(false)}
              className="flex items-center justify-center h-7 w-7 rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)] cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Search */}
          <div className="p-2 border-b border-[var(--gray-200)]">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--color-text-muted)]" />
              <input
                type="text"
                placeholder="Filter tables..."
                value={tableFilter}
                onChange={(e) => setTableFilter(e.target.value)}
                className="w-full h-8 pl-8 pr-2 text-xs bg-[var(--color-background-secondary)] border border-[var(--gray-200)] rounded-lg text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none focus:border-[#f97316] transition-colors duration-150"
              />
            </div>
          </div>

          {/* Grouped List */}
          <div className="flex-1 overflow-y-auto py-1">
            {TABLE_CATEGORIES.map((category) => {
              const filteredTables = hasFilter
                ? category.tables.filter((t) => t.includes(filterLower))
                : category.tables;

              if (filteredTables.length === 0) return null;
              const isCollapsed = collapsedCategories[category.label] && !hasFilter;

              return (
                <div key={category.label}>
                  <button
                    onClick={() => toggleCategory(category.label)}
                    className="w-full flex items-center gap-1.5 px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors duration-150 cursor-pointer"
                  >
                    {isCollapsed ? <ChevronRight className="h-3 w-3 shrink-0" /> : <ChevronDown className="h-3 w-3 shrink-0" />}
                    {category.label}
                    <span className="ml-auto text-[10px] font-normal">{filteredTables.length}</span>
                  </button>

                  {!isCollapsed && filteredTables.map((table) => {
                    const isActive = selected === table;
                    return (
                      <button
                        key={table}
                        onClick={() => handleSelectTable(table)}
                        className={[
                          "w-full flex items-center justify-between pr-3 py-1.5 text-left text-xs cursor-pointer",
                          "transition-all duration-150 border-l-[3px]",
                          isActive
                            ? "border-l-[#f97316] bg-[var(--color-brand-50)] text-[var(--color-brand-700)] pl-[25px] font-medium"
                            : "border-l-transparent text-[var(--color-text-secondary)] pl-[28px] hover:bg-[var(--gray-50)]",
                        ].join(" ")}
                      >
                        <span className="truncate">{table}</span>
                        {tableCounts[table] !== undefined && (
                          <span className="text-[10px] text-[var(--color-text-muted)] shrink-0 ml-2 tabular-nums">
                            {tableCounts[table].toLocaleString()}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        {/* Table Content */}
        <div className="flex-1 min-w-0 pt-10 md:pt-0">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">{selected}</h2>
              <Badge variant="outline">{total.toLocaleString()} rows</Badge>
            </div>
          </div>

          {error && !loading ? (
            <div className="bg-[var(--color-background-primary)] border border-[var(--gray-200)] rounded-xl p-8">
              <div className="flex flex-col items-center gap-3 text-center">
                <AlertCircle className="w-10 h-10 text-[#ef4444]" />
                <div>
                  <p className="text-sm font-medium text-[var(--color-text-primary)]">Failed to load table</p>
                  <p className="text-xs text-[var(--color-text-tertiary)] mt-1 max-w-md">{error}</p>
                </div>
                <Button variant="link" onClick={() => loadData(selected, page)}>Try again</Button>
              </div>
            </div>
          ) : (
            <DataTable
              columns={columns}
              rows={rows}
              loading={loading}
              striped
              emptyIcon={Database}
              emptyMessage={`No rows in ${selected}`}
              pagination={
                total > 0
                  ? { page, total, pageSize: PAGE_SIZE, from, to, onChange: setPage }
                  : undefined
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}
