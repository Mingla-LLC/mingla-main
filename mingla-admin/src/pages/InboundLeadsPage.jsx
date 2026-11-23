// Issue #4452 A1.8 — Leads (#/inbound): every lead in one list — forms, Book a
// call, free tools and beta — labelled, filterable and emailable. It replaced
// the #4130 Inbound leads page; the id stays so old links keep working
// (#/leads, #/beta-leads and #/tool-leads redirect here).
//
//   - One row per person (public.leads, fed by triggers on every source).
//   - Full emails show to leads_can_view() members: emailing and replying
//     need them (this replaces the old "never shows an email" rule).
//   - Filters live in the address except the search text, which stays in
//     component state (never in a URL).
//   - "No new lead in N days" still warns when leads stop coming.
// A failed load is an error with Retry, never an empty list or zeros.
import { useCallback, useState } from "react";
import { PageHeader } from "../components/ui/PageHeader";
import { AlertCard } from "../components/ui/Card";
import { LeadsList } from "../components/leads/LeadsList";
import { DemosToLink } from "../components/leads/DemosToLink";
import { useAuth } from "../context/AuthContext";
import { canOpenPage } from "../lib/access";
import { useHashQuery } from "../hooks/useHashQuery";
import { formatDate } from "../lib/formatters";
import { quietWarning } from "../lib/inboundLeads";

export function InboundLeadsPage() {
  const [search, setSearch] = useHashQuery("inbound");
  const [quiet, setQuiet] = useState(null);
  const { access } = useAuth();
  const canLinkDemos = canOpenPage(access, "hosts");
  const onCan = useCallback((_can, page) => {
    // The quiet-leads warning reads as_of and the newest last_seen_at.
    const rows = Array.isArray(page?.rows) ? page.rows : [];
    const newest = rows.reduce((m, r) => (r.last_seen_at && (!m || r.last_seen_at > m) ? r.last_seen_at : m), null);
    setQuiet(quietWarning({ last_lead_at: newest }, page?.as_of ? new Date(page.as_of) : new Date()));
  }, []);
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title="Leads"
        description="Every lead in one list: forms, calls, free tools and beta. Labelled, filterable, emailable."
      />
      {quiet && !search && (
        <AlertCard variant="warning" title={quiet.days == null ? "No lead has arrived yet." : `No new lead in ${quiet.days} days.`}>
          {quiet.lastAt ? `The last one arrived on ${formatDate(quiet.lastAt)}. ` : ""}Check the forms and free tools are still reachable and promoted.
        </AlertCard>
      )}
      {/* #4571 W4: booked demos waiting for a host card (people with Hosts and Creators). */}
      {canLinkDemos && <DemosToLink />}
      <LeadsList search={search} onSearch={(next) => setSearch(next, { replace: true })} onCan={onCan} />
    </div>
  );
}
