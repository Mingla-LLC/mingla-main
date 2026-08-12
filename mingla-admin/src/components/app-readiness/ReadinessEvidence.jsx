import { DIMENSION_ORDER } from "../../lib/adAppReadiness";
const LABELS = { payer: "Corporate payer", identity: "Public identity", binding: "Native app binding", measurement: "Measurement", funding: "Funding" };
export function ReadinessEvidence({ provider, evidence }) {
  return <dl id={`evidence-${provider}`} className="grid min-w-0 grid-cols-1 gap-4 border-t border-[var(--gray-200)] pt-4 @[640px]:grid-cols-2 @[1024px]:grid-cols-3">
    {DIMENSION_ORDER.map((name) => <div key={name} className="min-w-0"><dt className="text-[13px] font-medium">{LABELS[name]}</dt><dd className="mt-1 text-[13px] leading-5"><span className="font-medium">{evidence[name].status === "not_applicable" ? "Not applicable" : evidence[name].status === "action_required" ? "Action required" : evidence[name].status[0].toUpperCase() + evidence[name].status.slice(1)}</span> · {evidence[name].summary}{evidence[name].safe_id && <span className="mt-1 block overflow-anywhere font-mono text-xs">{evidence[name].safe_id}</span>}</dd></div>)}
    <div className="min-w-0"><dt className="text-[13px] font-medium">Freshness</dt><dd className="mt-1 text-[13px] leading-5">Checked {new Date(evidence.payer.source_checked_at).toLocaleString()} · {evidence.payer.source_class.replaceAll("_", " ")}</dd></div>
  </dl>;
}
