// Issue #3872 — Programs › Disputes. Only disputes the two parties could not
// settle reach Mingla. Each one opens an evidence pack (terms, locked script,
// delivered video, offers made, statement, timeline) and three outcomes:
// release the fee, refund part of it, or refund it all. The decision is
// recorded by gig_dispute_admin_decide (through gig-dispute-resolve, which
// then moves the money). Silence never decides money.

import { useState } from "react";
import { useProgramLoad } from "../hooks/useProgramLoad";
import { RefreshCw } from "lucide-react";
import { PageHeader } from "../components/ui/PageHeader";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Input, Textarea } from "../components/ui/Input";
import { AlertCard, SectionCard } from "../components/ui/Card";
import { Modal, ModalBody, ModalFooter } from "../components/ui/Modal";
import { useToast } from "../context/ToastContext";
import { GigTimeline } from "./crm/GigTimeline";
import { decideDispute, getContractWorkspace, getGigQueue } from "../services/creatorProgramsService";
import {
  dayWord,
  deliverablesSummary,
  disputeReasonWord,
  money,
  programErrorMessage,
  refundPercentToBps,
} from "../lib/creatorPrograms";

const OUTCOME_COPY = {
  release: { label: "Release fee", confirm: "Release the full fee to the creator?" },
  partial_refund: { label: "Partial refund", confirm: "Refund part of the fee to the host and release the rest?" },
  full_refund: { label: "Full refund", confirm: "Refund the whole fee to the host?" },
};

function EvidenceRow({ label, value }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-0.5 border-b border-[var(--gray-100)] py-2.5 last:border-b-0">
      <dt className="text-sm text-[var(--color-text-secondary)]">{label}</dt>
      <dd className="text-right text-sm text-[var(--color-text-primary)]">{value}</dd>
    </div>
  );
}

function offersLine(offers) {
  if (!Array.isArray(offers) || !offers.length) return "No offers made";
  return offers
    .map((o) => {
      const who = o.offered_by === "host" ? "Host" : "Creator";
      const pct = Number(o.refund_bps) / 100;
      const what = pct <= 0 ? "release the fee" : pct >= 100 ? "full refund" : `${pct}% refund`;
      const state = o.status === "declined" ? " (declined)" : o.status === "expired" ? " (expired)" : o.status === "accepted" ? " (accepted)" : "";
      return `${who}: ${what}${state}`;
    })
    .join(" · ");
}

function EvidencePack({ dispute, workspace }) {
  const terms = Array.isArray(workspace?.terms) ? workspace.terms : [];
  const current = terms.find((t) => t.version === workspace?.contract?.current_terms_version) ?? terms[terms.length - 1];
  const scripts = Array.isArray(workspace?.scripts) ? workspace.scripts : [];
  const locked = [...scripts].reverse().find((s) => s.locked_at);
  const beats = Array.isArray(locked?.body?.beats) ? locked.body.beats.length : null;
  const deliveries = Array.isArray(workspace?.deliveries) ? workspace.deliveries : [];
  const lastDelivery = deliveries[deliveries.length - 1];
  return (
    <dl>
      <EvidenceRow
        label="Terms"
        value={current ? `v${current.version} · ${money(current.fee_minor, current.currency)}${deliverablesSummary(current.deliverables) ? ` · ${deliverablesSummary(current.deliverables)}` : ""}` : "No terms on file"}
      />
      <EvidenceRow label="Locked script" value={locked ? `Version ${locked.version}${beats != null ? ` · ${beats} beat${beats === 1 ? "" : "s"}` : ""}${locked.locked_by === "auto" ? " · approved automatically" : ""}` : "No script was approved"} />
      <EvidenceRow label="Delivered video" value={lastDelivery ? (lastDelivery.round === 0 ? "First upload" : `Fixed upload ${lastDelivery.round} of 2`) : "Nothing delivered"} />
      <EvidenceRow label="Fixes used" value={`${workspace?.contract?.fix_rounds_used ?? 0} of 2`} />
      <EvidenceRow label="Offers" value={offersLine(workspace?.dispute?.offers)} />
      <EvidenceRow label="Opened by" value={`${dispute.opened_by === "host" ? "Host" : "Creator"} · ${disputeReasonWord(dispute.reason)}`} />
    </dl>
  );
}

export function ProgramDisputesPage() {
  const { addToast } = useToast();
  const [selected, setSelected] = useState(null);
  const [workspace, setWorkspace] = useState(null);
  const [workspaceError, setWorkspaceError] = useState("");
  const [refundPercent, setRefundPercent] = useState("50");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(null);
  const [deciding, setDeciding] = useState(false);
  const [decideError, setDecideError] = useState("");

  const queue = useProgramLoad(getGigQueue);
  const disputes = queue.data?.disputes ?? [];
  const loading = queue.loading;
  const error = queue.error ? programErrorMessage(queue.error, "Couldn't load disputes. Try again.") : "";
  const refresh = queue.reload;

  const open = async (item) => {
    setSelected(item);
    setWorkspace(null);
    setWorkspaceError("");
    setNote("");
    setDecideError("");
    try {
      setWorkspace(await getContractWorkspace(item.contract_id));
    } catch (cause) {
      setWorkspaceError(programErrorMessage(cause, "Couldn't load the evidence for this dispute."));
    }
  };

  const refundBps = refundPercentToBps(refundPercent);
  const ask = (outcome) => {
    setDecideError("");
    if (outcome === "partial_refund" && refundBps == null) {
      setDecideError("Enter a refund between 1% and 99%.");
      return;
    }
    setPending(outcome);
  };

  const confirm = async () => {
    setDeciding(true);
    try {
      await decideDispute({ disputeId: selected.id, outcome: pending, refundBps, note });
      addToast({ variant: "success", title: "Decision recorded. The money moves next." });
      setPending(null);
      setSelected(null);
      setWorkspace(null);
      refresh();
    } catch (cause) {
      setPending(null);
      setDecideError(programErrorMessage(cause));
    } finally {
      setDeciding(false);
    }
  };

  const currentTerms = workspace?.terms?.find?.((t) => t.version === workspace?.contract?.current_terms_version);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Disputes"
        description="Only disputes the host and creator couldn't settle come here. Decide from the written terms and the locked script."
        actions={<Button variant="secondary" icon={RefreshCw} onClick={refresh} loading={loading}>Refresh</Button>}
      />
      {error ? <AlertCard variant="error" title="Couldn't load disputes">{error}</AlertCard> : null}

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label="Escalated disputes">
        {disputes.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => void open(item)}
            className={`cursor-pointer rounded-xl border bg-[var(--color-background-primary)] p-4 text-left shadow-[var(--shadow-sm)] transition-colors hover:border-[var(--color-brand-300)] ${selected?.id === item.id ? "border-[var(--color-brand-500)]" : "border-[var(--gray-200)]"}`}
          >
            <p className="font-semibold text-[var(--color-text-primary)]">{item.gig_title}</p>
            <p className="text-sm text-[var(--color-text-secondary)]">{item.creator_name} · {disputeReasonWord(item.reason)}</p>
            {item.settle_by ? <Badge variant="warning" className="mt-2">Decide by {dayWord(item.settle_by)}</Badge> : null}
          </button>
        ))}
        {!disputes.length && !loading ? <p className="text-sm text-[var(--color-text-secondary)]">No disputes need Mingla right now.</p> : null}
      </section>

      {selected ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <SectionCard title={`${selected.gig_title} · ${disputeReasonWord(selected.reason)}`} subtitle={selected.settle_by ? `Decide by ${dayWord(selected.settle_by)}` : undefined}>
            <div className="space-y-5">
              <blockquote className="border-l-2 border-[var(--gray-300)] pl-3 text-sm text-[var(--color-text-primary)]">{selected.statement}</blockquote>
              {workspaceError ? <AlertCard variant="error" title="Evidence unavailable">{workspaceError}</AlertCard> : null}
              {workspace ? (
                <>
                  <div>
                    <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">Evidence pack</h3>
                    <EvidencePack dispute={selected} workspace={workspace} />
                  </div>
                  <div>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">Timeline</h3>
                    <GigTimeline events={workspace.events ?? []} currency={currentTerms?.currency ?? null} />
                  </div>
                </>
              ) : !workspaceError ? <p className="text-sm text-[var(--color-text-secondary)]">Loading the evidence…</p> : null}
            </div>
          </SectionCard>

          <SectionCard title="Decision" subtitle="Decisions follow the written terms and the locked script only.">
            <div className="space-y-4">
              <Input
                label="Refund to the host for a partial refund (%)"
                inputMode="decimal"
                value={refundPercent}
                onChange={(e) => { setRefundPercent(e.target.value); setDecideError(""); }}
                helper={currentTerms && refundBps != null ? `${money(Math.round(currentTerms.fee_minor * refundBps / 10000), currentTerms.currency)} back to the host` : "Between 1% and 99%."}
              />
              <Textarea label="Note to both sides (optional)" className="font-sans" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
              {decideError ? <p role="alert" className="text-sm text-[var(--color-error-700)]">{decideError}</p> : null}
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => ask("release")} disabled={!workspace}>Release fee</Button>
                <Button variant="secondary" onClick={() => ask("partial_refund")} disabled={!workspace}>Partial refund</Button>
                <Button variant="secondary" onClick={() => ask("full_refund")} disabled={!workspace}>Full refund</Button>
              </div>
            </div>
          </SectionCard>
        </div>
      ) : null}

      <Modal open={!!pending} onClose={() => !deciding && setPending(null)} title={pending ? OUTCOME_COPY[pending].label : ""} destructive={pending === "full_refund"}>
        <ModalBody>
          <p className="text-sm text-[var(--color-text-primary)]">{pending ? OUTCOME_COPY[pending].confirm : ""}</p>
          {pending === "partial_refund" && currentTerms && refundBps != null ? (
            <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
              {money(Math.round(currentTerms.fee_minor * refundBps / 10000), currentTerms.currency)} goes back to the host; the rest goes to the creator.
            </p>
          ) : null}
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">This can't be undone.</p>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setPending(null)} disabled={deciding}>Cancel</Button>
          <Button variant={pending === "full_refund" ? "danger" : "primary"} loading={deciding} onClick={() => void confirm()}>
            {pending ? OUTCOME_COPY[pending].label : "Confirm"}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
