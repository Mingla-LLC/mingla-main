// Issue #3872 — Programs › Gigs. A read-only list of every hired gig and where
// it stands, in plain words, with the shared contract timeline in a drawer.
// Mingla watches; the host and creator run the deal. The second tab holds the
// budget ranges hosts and creators see for each budget level.

import { useEffect, useMemo, useState } from "react";
import { useProgramLoad } from "../hooks/useProgramLoad";
import { RefreshCw } from "lucide-react";
import { PageHeader } from "../components/ui/PageHeader";
import { Tabs } from "../components/ui/Tabs";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Drawer } from "../components/ui/Drawer";
import { SearchInput } from "../components/ui/SearchInput";
import { AlertCard } from "../components/ui/Card";
import { GigTimeline } from "./crm/GigTimeline";
import { BudgetBandsEditor } from "./programs/BudgetBandsEditor";
import { getContractWorkspace, listGigContracts } from "../services/creatorProgramsService";
import {
  contractStateTone,
  contractStateWord,
  dayWord,
  isMissingFunction,
  money,
  programErrorMessage,
  shortDateTime,
} from "../lib/creatorPrograms";

const TABS = [
  { id: "gigs", label: "Gigs" },
  { id: "budgets", label: "Budget ranges" },
];

const STATE_FILTERS = [
  { id: "all", label: "All", match: () => true },
  { id: "active", label: "In progress", match: (s) => !["released", "completed", "declined", "expired", "cancelled", "resolved_release", "resolved_partial", "resolved_refund", "disputed"].includes(s) },
  { id: "disputed", label: "In dispute", match: (s) => s === "disputed" },
  { id: "done", label: "Done", match: (s) => ["released", "completed", "day30", "resolved_release", "resolved_partial", "resolved_refund"].includes(s) },
  { id: "ended", label: "Declined or expired", match: (s) => ["declined", "expired", "cancelled"].includes(s) },
];

function tabFromHash() {
  const query = window.location.hash.split("?")[1] ?? "";
  return new URLSearchParams(query).get("tab") === "budgets" ? "budgets" : "gigs";
}

function GigDrawer({ gig, onClose }) {
  const [workspace, setWorkspace] = useState(null);
  const [error, setError] = useState("");

  // Keyed by contract, so each gig opens with an empty drawer.
  useEffect(() => {
    if (!gig) return undefined;
    let cancelled = false;
    getContractWorkspace(gig.contract_id)
      .then((data) => { if (!cancelled) setWorkspace(data); })
      .catch((cause) => { if (!cancelled) setError(programErrorMessage(cause, "Couldn't load this gig's timeline.")); });
    return () => { cancelled = true; };
  }, [gig]);

  if (!gig) return null;
  const terms = workspace?.terms?.find?.((t) => t.version === workspace?.contract?.current_terms_version);
  const posts = Array.isArray(workspace?.posts) ? workspace.posts : [];
  const removed = posts.filter((p) => p.day30_status === "removed").length;
  return (
    <Drawer
      open={!!gig}
      onClose={onClose}
      title={`${gig.gig_title ?? "Gig"} · ${gig.creator_display_name ?? "Creator"} × ${gig.brand_name ?? "Host"}`}
      footer={gig.state === "disputed" ? (
        <Button className="w-full" variant="secondary" onClick={() => { window.location.hash = "#/program-disputes"; }}>Open disputes</Button>
      ) : null}
    >
      <div className="space-y-5">
        <p className="text-sm text-[var(--color-text-secondary)]">Read-only. Mingla watches; the two parties run the deal.</p>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={contractStateTone(gig.state)} dot>{contractStateWord(gig.state)}</Badge>
          {terms ? <span className="text-sm text-[var(--color-text-primary)]">{money(terms.fee_minor, terms.currency)} fee · terms v{terms.version}</span> : null}
        </div>
        {error ? <AlertCard variant="error" title="Timeline unavailable">{error}</AlertCard> : null}
        {workspace ? <GigTimeline events={workspace.events ?? []} currency={terms?.currency ?? gig.currency ?? null} /> : !error ? <p className="text-sm text-[var(--color-text-secondary)]">Loading the timeline…</p> : null}
        <div className="flex items-center justify-between border-t border-[var(--gray-200)] pt-3 text-sm">
          <span className="font-medium text-[var(--color-text-primary)]">Day-30 check</span>
          <span className="text-[var(--color-text-secondary)]">
            {!posts.length ? "No posts yet" : removed ? `${removed} post${removed === 1 ? "" : "s"} taken down` : posts.every((p) => p.day30_status === "live") ? "Posts still live" : "Scheduled"}
          </span>
        </div>
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">Flags</h3>
          <p className="text-sm text-[var(--color-text-secondary)]">{workspace?.dispute ? "A dispute was opened on this gig." : "None"}</p>
        </div>
      </div>
    </Drawer>
  );
}

function GigsList() {
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState("all");
  const [selected, setSelected] = useState(null);

  const list = useProgramLoad(listGigContracts);
  const rows = useMemo(() => list.data ?? [], [list.data]);
  const loading = list.loading;
  const missing = isMissingFunction(list.error);
  const error = list.error && !missing ? programErrorMessage(list.error, "Couldn't load gigs. Try again.") : "";
  const refresh = list.reload;

  const shown = useMemo(() => {
    const filter = STATE_FILTERS.find((f) => f.id === stateFilter) ?? STATE_FILTERS[0];
    const q = search.trim().toLowerCase();
    return rows.filter((row) => filter.match(row.state) && (!q || [row.gig_title, row.creator_display_name, row.brand_name, row.city].some((v) => String(v ?? "").toLowerCase().includes(q))));
  }, [rows, search, stateFilter]);

  if (missing) {
    return (
      <AlertCard variant="info" title="The gigs list isn't available yet">
        This list needs a server update that hasn't shipped. Disputes still open from the Disputes page.
      </AlertCard>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput className="w-full sm:w-72" value={search} onChange={(e) => setSearch(e.target.value)} onClear={() => setSearch("")} placeholder="Search gig, creator, host or city" />
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by state">
          {STATE_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={stateFilter === f.id}
              onClick={() => setStateFilter(f.id)}
              className={`min-h-9 cursor-pointer rounded-full border px-3 text-xs font-medium ${stateFilter === f.id ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)]" : "border-[var(--gray-300)] text-[var(--color-text-secondary)]"}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <Button variant="secondary" size="sm" icon={RefreshCw} onClick={refresh} loading={loading}>Refresh</Button>
      </div>
      {error ? <AlertCard variant="error" title="Couldn't load gigs">{error}</AlertCard> : null}
      <div className="admin-control-scroll overflow-x-auto rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)]">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-[var(--gray-50)] text-left text-xs uppercase tracking-wider text-[var(--color-text-tertiary)]">
            <tr>
              <th scope="col" className="px-4 py-2.5 font-semibold">Gig</th>
              <th scope="col" className="px-4 py-2.5 font-semibold">Creator</th>
              <th scope="col" className="px-4 py-2.5 font-semibold">Where it stands</th>
              <th scope="col" className="px-4 py-2.5 font-semibold">Fee</th>
              <th scope="col" className="px-4 py-2.5 font-semibold">Next date</th>
              <th scope="col" className="px-4 py-2.5 font-semibold">Updated</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.contract_id} className="border-t border-[var(--gray-200)] hover:bg-[var(--gray-50)]">
                <td className="px-4 py-3">
                  <button type="button" onClick={() => setSelected(row)} className="cursor-pointer text-left font-medium text-[var(--color-text-primary)] hover:underline">
                    {row.gig_title ?? "Untitled gig"}
                  </button>
                  <p className="text-xs text-[var(--color-text-tertiary)]">{[row.brand_name, row.city].filter(Boolean).join(" · ")}</p>
                </td>
                <td className="px-4 py-3 text-[var(--color-text-primary)]">{row.creator_display_name ?? "—"}</td>
                <td className="px-4 py-3"><Badge variant={contractStateTone(row.state)} dot>{contractStateWord(row.state)}</Badge></td>
                <td className="px-4 py-3 text-[var(--color-text-primary)]">{row.fee_minor != null ? money(row.fee_minor, row.currency) : "—"}</td>
                <td className="px-4 py-3 text-[var(--color-text-secondary)]">{row.due_at ? dayWord(row.due_at) : "—"}</td>
                <td className="px-4 py-3 text-[var(--color-text-secondary)]">{shortDateTime(row.updated_at) || "—"}</td>
              </tr>
            ))}
            {!shown.length && !loading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-[var(--color-text-secondary)]">{rows.length ? "No gigs match." : "No gigs yet."}</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <GigDrawer key={selected?.contract_id ?? "none"} gig={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

export function ProgramGigsPage() {
  const [tab, setTab] = useState(tabFromHash);
  const changeTab = (next) => {
    setTab(next);
    window.history.replaceState(null, "", next === "budgets" ? "#/program-gigs?tab=budgets" : "#/program-gigs");
  };
  return (
    <div className="space-y-6">
      <PageHeader
        title="Gigs"
        description="Every hired gig and where it stands. Read-only: the host and creator run the deal."
        tabs={<Tabs tabs={TABS} activeTab={tab} onChange={changeTab} />}
      />
      {tab === "budgets" ? <BudgetBandsEditor /> : <GigsList />}
    </div>
  );
}
