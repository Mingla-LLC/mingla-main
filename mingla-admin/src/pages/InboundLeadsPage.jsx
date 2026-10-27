// Issue #4130 (Wave 4a) — Inbound leads (#/inbound): businesses that came to
// us. Beta form requests and web free-tool leads in one list.
//
//   - Tool runs by signed-in hosts inside the Business app are product usage,
//     not leads: the server never lists or counts them (admin_inbound_leads).
//   - "No new lead in N days" warns when leads stop coming.
//   - Staff and test rows are hidden; a switch shows them, marked.
//   - Add to Hosts asks first, then uses the existing pipeline paths: a beta
//     lead through crm_beta_lead_to_host, a tool lead as a new host card with
//     its email as a contact detail. A lead already in Hosts opens its card.
//   - Competitor Ops (it was a tab of Tool leads) moves to Settings
//     (Wave 4b renders it; pages/ToolLeadsPage.jsx exports it).
// A failed load is an error with Retry, never an empty list or zeros.
import { useCallback, useMemo, useState } from "react";
import { UserPlus } from "lucide-react";
import { PageHeader } from "../components/ui/PageHeader";
import { AlertCard, SectionCard } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Skeleton } from "../components/ui/Skeleton";
import { Toggle } from "../components/ui/Input";
import { LoadError } from "../components/ui/LoadError";
import { Modal, ModalBody, ModalFooter } from "../components/ui/Modal";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { canOpenPage } from "../lib/access";
import { errorWords } from "../lib/crmModel";
import { formatDate } from "../lib/formatters";
import { leadView, quietWarning, toolLeadHostFields } from "../lib/inboundLeads";
import { getToolLead, listInboundLeads } from "../services/dashboardService";
import { betaLeadToHost, createRecord, newRequestKey } from "../services/crmService";
import { useServerRead } from "../hooks/useServerRead";

const hostHash = (id) => `#/outreach?tab=hosts&card=${encodeURIComponent(id)}`;

function Kpi({ label, value, note, tone }) {
  return (
    <div className="flex min-h-[92px] min-w-0 flex-col justify-center rounded-xl border border-[var(--gray-200)] border-l-[3px] border-l-[var(--color-brand-500)] bg-[var(--color-background-primary)] p-4">
      <span className="text-[13px] text-[var(--color-text-secondary)]">{label}</span>
      <span className={`text-[26px] font-bold leading-tight tabular-nums ${tone === "bad" ? "text-[var(--color-error-700)]" : "text-[var(--color-text-primary)]"}`}>{value}</span>
      {note ? <span className={`mt-1 text-xs ${tone === "bad" ? "text-[var(--color-error-700)]" : "text-[var(--color-text-tertiary)]"}`}>{note}</span> : null}
    </div>
  );
}

export function InboundLeadsPage() {
  const { access } = useAuth();
  const { addToast } = useToast();
  const canAddHosts = canOpenPage(access, "hosts");
  const [showTest, setShowTest] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");

  const loadLeads = useCallback(() => listInboundLeads(showTest), [showTest]);
  const state = useServerRead(loadLeads);
  const load = state.retry;

  const data = state.data;
  const summary = data?.summary || null;
  const rows = useMemo(() => (Array.isArray(data?.rows) ? data.rows.map(leadView) : []), [data]);
  const quiet = quietWarning(summary);
  const seesTools = !!data?.can_see?.tools;

  const addToHosts = async () => {
    const lead = confirm;
    if (!lead) return;
    setAdding(true);
    setAddError("");
    try {
      let record;
      let duplicate = false;
      if (lead.raw.source === "beta") {
        const res = await betaLeadToHost(lead.id);
        record = res?.record || null;
        duplicate = res?.status === "duplicate" || res?.status === "exists";
      } else {
        const detail = await getToolLead(lead.id);
        const fields = toolLeadHostFields(lead, Array.isArray(detail) ? detail[0] : detail);
        const res = await createRecord("hosts", fields, newRequestKey());
        record = res?.status === "duplicate" ? res.existing : res?.record;
        duplicate = res?.status === "duplicate";
      }
      if (!record?.id) throw new Error("The server did not return the host card.");
      setConfirm(null);
      addToast({
        variant: duplicate ? "info" : "success",
        title: duplicate ? `${record.name || lead.business} is already in Hosts` : `${lead.business} added to Hosts at Prospect`,
        action: { label: "Open host", onClick: () => { window.location.hash = hostHash(record.id); } },
      });
      load();
    } catch (err) {
      setAddError(errorWords(err));
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title="Inbound leads"
        description="Businesses that came to us: free-tool users on the website and early-access requests."
      />

      {state.status === "error" && !state.data ? (
        <LoadError title="Couldn’t load inbound leads" message={state.error?.message} onRetry={load} />
      ) : !state.data ? (
        <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading inbound leads">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} height={92} rounded="xl" />)}
          </div>
          <Skeleton height={240} rounded="xl" />
        </div>
      ) : (
        <>
          {state.status === "error" && (
            <LoadError title="Couldn’t refresh inbound leads" message={state.error?.message} onRetry={load} />
          )}
          {quiet && (
            <AlertCard variant="warning" title={quiet.days == null ? "No inbound lead has arrived yet." : `No new lead in ${quiet.days} days.`}>
              {quiet.lastAt ? `The last one arrived on ${formatDate(quiet.lastAt)}. ` : ""}Check the free tools are still reachable and promoted.
            </AlertCard>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi
              label="Leads, all time"
              value={Number(summary?.total || 0).toLocaleString()}
              note={seesTools ? `${Number(summary?.tools || 0)} tool · ${Number(summary?.beta || 0)} beta` : `${Number(summary?.beta || 0)} beta`}
            />
            <Kpi label="With an email" value={Number(summary?.with_email || 0).toLocaleString()} />
            <Kpi
              label="Added to Hosts"
              value={Number(summary?.in_hosts || 0).toLocaleString()}
              note={Number(summary?.total || 0) > 0 && Number(summary?.in_hosts || 0) === 0 ? "None converted yet" : undefined}
              tone={Number(summary?.total || 0) > 0 && Number(summary?.in_hosts || 0) === 0 ? "bad" : undefined}
            />
            <Kpi
              label="Last 30 days"
              value={Number(summary?.last_30_days || 0).toLocaleString()}
              tone={Number(summary?.last_30_days || 0) === 0 ? "bad" : undefined}
            />
          </div>

          <SectionCard
            title="Leads"
            subtitle="Newest first"
            action={
              Number(summary?.test_hidden || 0) > 0 || showTest ? (
                <Toggle label={`Show staff and test rows (${Number(summary?.test_hidden || 0)})`} checked={showTest} onChange={setShowTest} />
              ) : null
            }
            noPadding
          >
            {rows.length === 0 ? (
              <p className="p-5 text-sm text-[var(--color-text-secondary)]">
                No inbound leads yet. Early-access requests and free-tool users on the website show here.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <caption className="sr-only">Inbound leads, newest first</caption>
                  <thead>
                    <tr className="border-b border-[var(--gray-200)] text-left text-xs uppercase tracking-wide text-[var(--color-text-tertiary)]">
                      <th scope="col" className="px-4 py-2.5 font-semibold sm:px-5">Received</th>
                      <th scope="col" className="px-3 py-2.5 font-semibold">Source</th>
                      <th scope="col" className="px-3 py-2.5 font-semibold">Business</th>
                      <th scope="col" className="px-3 py-2.5 font-semibold">Tool</th>
                      <th scope="col" className="px-3 py-2.5 font-semibold">City</th>
                      <th scope="col" className="px-3 py-2.5 font-semibold">Email</th>
                      <th scope="col" className="px-3 py-2.5 font-semibold">In Hosts?</th>
                      <th scope="col" className="px-4 py-2.5 sm:px-5"><span className="sr-only">Action</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((lead, i) => {
                      const raw = data.rows[i];
                      return (
                        <tr key={`${raw.source}-${lead.id}`} data-lead-source={raw.source} className="border-b border-[var(--gray-100)] last:border-b-0">
                          <td className="whitespace-nowrap px-4 py-2.5 text-[var(--color-text-secondary)] sm:px-5">{formatDate(raw.created_at)}</td>
                          <td className="px-3 py-2.5">
                            {lead.source}
                            {lead.isTest && <span className="ml-2"><Badge variant="outline">Test</Badge></span>}
                          </td>
                          <td className="px-3 py-2.5 font-medium text-[var(--color-text-primary)]">{lead.business || <span className="font-normal text-[var(--color-text-tertiary)]">No business name</span>}</td>
                          <td className="px-3 py-2.5 text-[var(--color-text-secondary)]">{lead.tool || "–"}</td>
                          <td className="px-3 py-2.5 text-[var(--color-text-secondary)]">{lead.city || "–"}</td>
                          <td className="px-3 py-2.5">{lead.hasEmail ? <span aria-label="Has an email">✓</span> : <span className="text-[var(--color-text-tertiary)]">No</span>}</td>
                          <td className="px-3 py-2.5">
                            {lead.host ? (
                              <a href={hostHash(lead.host.id)} className="font-medium text-[var(--color-brand-700)] hover:underline">Yes, open</a>
                            ) : (
                              <Badge variant="default">No</Badge>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right sm:px-5">
                            {canAddHosts && lead.canAdd && !lead.isTest ? (
                              <Button variant="secondary" size="sm" icon={UserPlus} onClick={() => { setAddError(""); setConfirm({ ...lead, raw }); }}>
                                Add to Hosts
                              </Button>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="border-t border-[var(--gray-200)] px-4 py-3 text-xs text-[var(--color-text-tertiary)] sm:px-5">
              Tool runs by signed-in hosts inside the app are product usage, so they are not counted here. Competitor Ops moved to Settings.
              {data?.truncated ? " Showing the newest 500." : ""}
            </p>
          </SectionCard>
        </>
      )}

      <Modal open={!!confirm} onClose={adding ? () => {} : () => setConfirm(null)} title="Add to Hosts" size="sm">
        <ModalBody>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Add <span className="font-semibold text-[var(--color-text-primary)]">{confirm?.business}</span> to Hosts at Prospect?
            {confirm?.raw?.source === "tool" && confirm?.hasEmail ? " Their email goes on the card as a contact detail." : ""}
            {" "}If it is already in Hosts, nothing new is made and you can open that card.
          </p>
          {addError && <p role="alert" className="mt-3 text-sm text-[var(--color-error-700)]">{addError}</p>}
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" className="min-h-11" disabled={adding} onClick={() => setConfirm(null)}>Cancel</Button>
          <Button className="min-h-11" loading={adding} onClick={addToHosts}>Add to Hosts</Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
