// #4382 Wave 3 — the Product board. Five columns (New, Triaged, Planned,
// Shipped, Told), with Won't do as a filter. Each card carries its reporters
// (linked tickets plus Community idea votes). Clicking a card opens it beside
// the board (components/support/ProductCardPanel.jsx) for triage, GitHub,
// verify live and Tell reporters. This replaces both the Product inbox box on
// Support and the old list-and-form Product tab.
import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Spinner } from "../ui/Spinner";
import { SearchInput } from "../ui/SearchInput";
import { Segmented } from "../crm/fields";
import { useToast } from "../../context/ToastContext";
import { listProductAvengersWorkspace, listReporterTickets } from "../../services/productAvengersService";
import { listAdminCommunityPosts } from "../../services/communityService";
import { ProductCardPanel } from "../support/ProductCardPanel";
import { BOARD_COLUMNS, groupSignals, signalTypeLabel } from "../support/productBoardModel";

function signalIdFromHash() {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.hash.split("?")[1] || "").get("signal");
}

function setSignalInHash(signalId) {
  if (typeof window === "undefined") return;
  const [path, query = ""] = window.location.hash.split("?");
  const params = new URLSearchParams(query);
  if (signalId) params.set("signal", signalId);
  else params.delete("signal");
  const next = `${path}${params.toString() ? `?${params}` : ""}`;
  if (next !== window.location.hash) window.history.replaceState(null, "", next);
}

function BoardCard({ signal, ideasById, selected, onOpen }) {
  const ideaVotes = (signal.sources || [])
    .filter((source) => source.source_kind === "community_idea")
    .reduce((sum, source) => sum + Number(ideasById[source.source_id]?.vote_count || 0), 0);
  const ticketCount = (signal.sources || []).filter((source) => source.source_kind === "support_ticket").length;
  return (
    <button
      type="button"
      onClick={() => onOpen(signal.id)}
      aria-current={selected ? "true" : undefined}
      className={`w-full rounded-xl border p-3 text-left transition-colors ${selected ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)]" : "border-[var(--gray-200)] bg-[var(--color-background-primary)] hover:bg-[var(--gray-50)]"}`}
    >
      <p className="line-clamp-2 text-sm font-semibold text-[var(--color-text-primary)]">{signal.title}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-[var(--color-text-secondary)]">
        <Badge variant={signal.signal_kind === "bug" ? "error" : "brand"}>{signalTypeLabel(signal.signal_kind)}</Badge>
        <span>{signal.affected_people} reporter{signal.affected_people === 1 ? "" : "s"}</span>
        {ticketCount > 0 && <span>· {ticketCount} ticket{ticketCount === 1 ? "" : "s"}</span>}
        {ideaVotes > 0 && <span>· +{ideaVotes} votes</span>}
        {signal.item && <Badge variant="info">#{signal.item.issue_number}</Badge>}
        {signal.state === "shipped" && <Badge variant="success">Live</Badge>}
        {signal.state === "told" && <span>· {signal.told_ticket_count ?? 0} told</span>}
      </div>
    </button>
  );
}

export function ProductInboxPanel() {
  const { addToast } = useToast();
  const [signals, setSignals] = useState([]);
  const [ticketsById, setTicketsById] = useState({});
  const [ideas, setIdeas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState(() => signalIdFromHash());
  const [filter, setFilter] = useState("board");
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      const [rows, ideaRows] = await Promise.all([
        listProductAvengersWorkspace(),
        listAdminCommunityPosts("idea").catch(() => []),
      ]);
      const ticketIds = rows.flatMap((row) => (row.sources || []).filter((s) => s.source_kind === "support_ticket").map((s) => s.source_id));
      const tickets = await listReporterTickets(ticketIds);
      setSignals(rows);
      setTicketsById(tickets);
      setIdeas(ideaRows || []);
    } catch (loadError) {
      setError(loadError?.message || "Couldn't load the Product board");
      addToast({ variant: "error", title: "Couldn't load the Product board", description: loadError?.message });
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- load on open, like the other admin pages
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setSignalInHash(selectedId); }, [selectedId]);

  const ideasById = useMemo(() => Object.fromEntries(ideas.map((idea) => [idea.id, idea])), [ideas]);
  const searched = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) return signals;
    return signals.filter((signal) => `${signal.title} ${signal.product_area || ""}`.toLowerCase().includes(text));
  }, [signals, query]);
  const groups = useMemo(() => groupSignals(searched, { showWontDo: filter === "wont_do" }), [searched, filter]);
  const selected = signals.find((signal) => signal.id === selectedId) || null;
  const wontDoCount = signals.filter((signal) => signal.state === "wont_do").length;

  if (loading && signals.length === 0) return <div className="flex min-h-48 items-center justify-center"><Spinner /></div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label="Show"
          options={[{ value: "board", label: "Board" }, { value: "wont_do", label: `Won't do · ${wontDoCount}` }]}
          value={filter}
          onChange={setFilter}
        />
        <SearchInput value={query} onChange={(event) => setQuery(event.target.value)} onClear={() => setQuery("")} placeholder="Search Product items" aria-label="Search Product items" className="min-w-[200px] flex-1" />
        <Button variant="secondary" size="sm" icon={RefreshCw} onClick={() => { setLoading(true); void load(); }}>Refresh</Button>
        <a href="https://github.com/orgs/Mingla-LLC/projects/4" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--color-brand-600)] hover:underline">
          Avengers board <ExternalLink className="h-4 w-4" aria-hidden="true" />
        </a>
      </div>

      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg bg-[var(--color-error-50)] p-3 text-sm text-[var(--color-error-700)]">
          Couldn't load the Product board: {error}
          <Button size="sm" variant="secondary" onClick={() => { setLoading(true); void load(); }}>Try again</Button>
        </div>
      )}

      {!error && signals.length === 0 ? (
        <div className="rounded-2xl border border-[var(--gray-200)] p-6 text-sm text-[var(--color-text-secondary)]">
          Nothing on the board yet. Support sends tickets here with Send to Product, and Brand groups with their Product action.
        </div>
      ) : (
        <div className={`grid gap-4 ${selected ? "xl:grid-cols-[minmax(0,1fr)_minmax(400px,480px)]" : ""}`}>
          <div className={`min-w-0 ${selected ? "hidden xl:block" : ""}`}>
            {filter === "wont_do" ? (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {groups.wont_do.length === 0 ? (
                  <p className="text-sm text-[var(--color-text-tertiary)]">Nothing marked Won't do.</p>
                ) : groups.wont_do.map((signal) => (
                  <BoardCard key={signal.id} signal={signal} ideasById={ideasById} selected={signal.id === selectedId} onOpen={setSelectedId} />
                ))}
              </div>
            ) : (
              <div className="flex gap-3 overflow-x-auto pb-2">
                {BOARD_COLUMNS.map((column) => (
                  <section key={column.id} aria-label={`${column.label} column`} className="flex w-[240px] shrink-0 flex-col gap-2 rounded-2xl bg-[var(--gray-50)] p-2">
                    <h3 className="flex items-center justify-between px-1 text-sm font-semibold text-[var(--color-text-primary)]">
                      {column.label}
                      <span className="text-xs font-medium tabular-nums text-[var(--color-text-tertiary)]">{groups[column.id].length}</span>
                    </h3>
                    {groups[column.id].length === 0 ? (
                      <p className="px-1 py-2 text-xs text-[var(--color-text-tertiary)]">Nothing here.</p>
                    ) : groups[column.id].map((signal) => (
                      <BoardCard key={signal.id} signal={signal} ideasById={ideasById} selected={signal.id === selectedId} onOpen={setSelectedId} />
                    ))}
                  </section>
                ))}
              </div>
            )}
            <p className="mt-2 text-xs text-[var(--color-text-tertiary)]">"+12 votes" means a Community idea is linked; its votes count as reporters.</p>
          </div>
          {selected && (
            <ProductCardPanel
              key={`${selected.id}:${selected.revision}:${selected.review?.revision || 0}:${(selected.drafts || []).map((d) => `${d.id}${d.state}`).join(",")}`}
              signal={selected}
              ticketsById={ticketsById}
              ideasById={ideasById}
              ideas={ideas}
              onClose={() => setSelectedId(null)}
              onChanged={load}
              notify={addToast}
            />
          )}
        </div>
      )}
    </div>
  );
}
