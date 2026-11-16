// #4452 A1.8 — the one Leads list: filters, the table (50 at a time, keyset
// Load more), selection and its banner, Email <n> selected, Export CSV and the
// drawer. The Leads page renders it; Forms' Submissions and a form's Results
// render it with a fixed form filter.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Mail } from "lucide-react";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { Skeleton } from "../ui/Skeleton";
import { LoadError } from "../ui/LoadError";
import { useToast } from "../../context/ToastContext";
import { formatDate } from "../../lib/formatters";
import { filterFromQuery, leadRowView, leadsCsv, leadsErrorWords, marketableOf, selectionBanner } from "../../lib/leadsModel";
import { createLeadSelection, exportLeads, listLeads } from "../../services/leadsService";
import { LeadFilters } from "./LeadFilters";
import { LeadDrawer } from "./LeadDrawer";

const STATUS_VARIANT = { unsubscribed: "error", follow_ups_stopped: "warning", follow_ups_active: "info", emailed: "success" };

export function LeadsList({ search, onSearch, fixed = {}, forms = [], onCan }) {
  const { addToast } = useToast();
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q), 300);
    return () => clearTimeout(t);
  }, [q]);
  const filter = useMemo(() => ({ ...filterFromQuery(search, qDebounced), ...fixed }), [search, qDebounced, fixed]);
  const filterKey = JSON.stringify(filter);

  const [state, setState] = useState({ status: "loading", rows: [], next: null, total: 0, can: {}, as_of: null, error: null });
  const [selected, setSelected] = useState(() => new Set());
  const [allMatching, setAllMatching] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [busy, setBusy] = useState("");
  const gen = useRef(0);

  const load = useCallback(async (after = null) => {
    const mine = ++gen.current;
    setState((s) => ({ ...s, status: after ? "more" : s.rows.length ? "refreshing" : "loading", error: null }));
    try {
      const page = await listLeads(JSON.parse(filterKey), after, 50);
      if (mine !== gen.current) return;
      setState((s) => ({
        status: "ready",
        rows: after ? [...s.rows, ...(page?.rows || [])] : page?.rows || [],
        next: page?.next || null,
        total: Number(page?.total || 0),
        can: page?.can || {},
        as_of: page?.as_of || null,
        error: null,
      }));
      onCan?.(page?.can || {}, page);
    } catch (error) {
      if (mine !== gen.current) return;
      setState((s) => ({ ...s, status: "error", error }));
    }
  }, [filterKey, onCan]);

  useEffect(() => {
    setSelected(new Set());
    setAllMatching(null);
    void load(null);
  }, [load]);

  const rows = state.rows;
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggle = (id) => {
    setAllMatching(null);
    setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };
  const toggleAll = () => {
    setAllMatching(null);
    setSelected(allOnPage ? new Set() : new Set(rows.map((r) => r.id)));
  };
  const selectAllMatching = async () => {
    setBusy("all");
    try {
      const counts = await createLeadSelection({ filter: JSON.parse(filterKey) });
      setAllMatching(counts);
    } catch (err) {
      addToast({ variant: "error", title: "Couldn't select every match", description: leadsErrorWords(err) });
    } finally {
      setBusy("");
    }
  };

  const count = allMatching ? Number(allMatching.selected || 0) : selected.size;
  const banner = allMatching
    ? selectionBanner(allMatching)
    : selectionBanner({ selected: selected.size, marketable: marketableOf(rows.filter((r) => selected.has(r.id))) });

  const emailSelected = async () => {
    setBusy("email");
    try {
      const sel = allMatching || await createLeadSelection({ ids: [...selected] });
      window.location.hash = `#/email?leads=${encodeURIComponent(sel.selection_id)}`;
    } catch (err) {
      addToast({ variant: "error", title: "Couldn't start the email", description: leadsErrorWords(err) });
    } finally {
      setBusy("");
    }
  };

  const exportCsv = async () => {
    setBusy("export");
    try {
      const out = await exportLeads(JSON.parse(filterKey));
      const blob = new Blob([leadsCsv(out)], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `mingla-leads-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      addToast({ variant: "success", title: `Exported ${Number(out?.row_count || 0).toLocaleString()} leads` });
    } catch (err) {
      addToast({ variant: "error", title: "Couldn't export", description: leadsErrorWords(err) });
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-4" data-leads-list="">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <LeadFilters search={search} onSearch={onSearch} q={q} onQ={setQ} fixed={fixed} forms={forms} />
        <div className="flex flex-wrap gap-2">
          {state.can.export && (
            <Button variant="secondary" icon={Download} loading={busy === "export"} onClick={exportCsv}>Export CSV</Button>
          )}
          <Button icon={Mail} disabled={count === 0} loading={busy === "email"} onClick={emailSelected}>
            Email {count.toLocaleString()} selected
          </Button>
        </div>
      </div>

      {count > 0 && (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-xl bg-[var(--a-chip)] px-4 py-3 text-sm text-[var(--a-chip-ink)]" data-selection-banner="">
          <span><strong>{banner.strong}</strong> {banner.rest}</span>
          <Button variant="ghost" size="sm" onClick={() => { setSelected(new Set()); setAllMatching(null); }}>Clear</Button>
        </div>
      )}
      {allOnPage && !allMatching && state.total > rows.length && (
        <button type="button" className="self-start text-sm font-semibold text-[var(--color-brand-700)] hover:underline" disabled={busy === "all"} onClick={selectAllMatching}>
          Select all {state.total.toLocaleString()} matching
        </button>
      )}

      {state.status === "error" && rows.length === 0 ? (
        <LoadError title="Couldn't load leads" message={leadsErrorWords(state.error)} onRetry={() => load(null)} />
      ) : state.status === "loading" ? (
        <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading leads">
          {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} height={56} rounded="lg" />)}
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-[var(--a-line)] p-6 text-sm text-[var(--color-text-secondary)]"><strong>No leads match.</strong></p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[var(--a-line)] bg-[var(--color-background-primary)]">
          <table className="w-full min-w-[860px] text-sm">
            <caption className="sr-only">Leads, newest first</caption>
            <thead>
              <tr className="border-b border-[var(--a-line)] text-left font-mono text-[10px] uppercase tracking-[.12em] text-[var(--color-text-tertiary)]">
                <th scope="col" className="w-10 px-4 py-3"><input type="checkbox" aria-label="Select every lead on this page" checked={allOnPage} onChange={toggleAll} /></th>
                <th scope="col" className="px-4 py-3 font-semibold">Person</th>
                <th scope="col" className="px-4 py-3 font-semibold">Label</th>
                <th scope="col" className="px-4 py-3 font-semibold">Came from</th>
                <th scope="col" className="px-4 py-3 font-semibold">Source</th>
                <th scope="col" className="px-4 py-3 font-semibold">Emails</th>
                <th scope="col" className="px-4 py-3 font-semibold">When</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((raw) => {
                const r = leadRowView(raw);
                return (
                  <tr key={r.id} data-lead-id={r.id} className="cursor-pointer border-b border-[var(--a-line)] last:border-b-0 hover:bg-[var(--a-soft)]" onClick={() => setOpenId(r.id)}>
                    <td className="px-4 py-3.5" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" aria-label={`Select ${r.name}`} checked={allMatching ? true : selected.has(r.id)} disabled={!!allMatching} onChange={() => toggle(r.id)} />
                    </td>
                    <td className="px-4 py-3.5">
                      <button type="button" className="text-left font-semibold text-[var(--color-text-primary)] hover:underline" onClick={(e) => { e.stopPropagation(); setOpenId(r.id); }}>{r.name}</button>
                      <span className="block break-all text-xs text-[var(--color-text-tertiary)]">{r.email}</span>
                    </td>
                    <td className="px-4 py-3.5">
                      <Badge variant="brand">{r.label}</Badge>{r.moreLabels > 0 && <span className="ml-1 text-xs text-[var(--color-text-tertiary)]">+{r.moreLabels}</span>}
                      {r.isTest && <span className="ml-1"><Badge variant="outline">Test</Badge></span>}
                    </td>
                    <td className="px-4 py-3.5"><span className="text-xs font-semibold text-[var(--color-text-secondary)]">{r.source}</span><span className="block text-xs text-[var(--color-text-tertiary)]">{r.cameFrom}</span></td>
                    <td className="px-4 py-3.5 text-[var(--color-text-secondary)]">{r.utm}</td>
                    <td className="px-4 py-3.5"><Badge variant={STATUS_VARIANT[r.emailStatusKey] || "default"}>{r.emailStatus}</Badge></td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-[var(--color-text-secondary)]">{r.when ? formatDate(r.when) : "–"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {state.status === "error" && rows.length > 0 && (
        <LoadError title="Couldn't load more leads" message={leadsErrorWords(state.error)} onRetry={() => load(state.next)} />
      )}
      {state.next && (
        <Button variant="secondary" className="self-center" loading={state.status === "more"} onClick={() => load(state.next)}>Load more</Button>
      )}

      {openId && <LeadDrawer leadId={openId} onClose={() => setOpenId(null)} onChanged={() => load(null)} />}
    </div>
  );
}
