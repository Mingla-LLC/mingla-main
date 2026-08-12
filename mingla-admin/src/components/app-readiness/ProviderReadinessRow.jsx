import { useState } from "react";
import { ACTION_COPY, VERDICT_COPY } from "../../lib/adAppReadiness";
import { ReadinessEvidence } from "./ReadinessEvidence";
export function ProviderReadinessRow({ result, onEvent }) {
  const [open,setOpen] = useState(false); const label = result.provider[0].toUpperCase() + result.provider.slice(1);
  const action = result.action_code && ACTION_COPY[result.action_code];
  const toggle = () => { const next=!open; setOpen(next); onEvent?.("detail_toggled", result); };
  return <section aria-labelledby={`provider-${result.provider}`} className="@container min-w-0 p-4">
    <div className="grid min-w-0 gap-4 @[720px]:grid-cols-[minmax(136px,180px)_minmax(0,1fr)_auto]">
      <div className="flex flex-wrap items-start gap-2"><h5 id={`provider-${result.provider}`} className="text-sm font-semibold">{label}</h5><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${result.verdict === "ready" ? "bg-[var(--color-success-50)] text-[var(--color-success-700)]" : result.verdict === "action_required" ? "bg-[var(--color-warning-50)] text-[var(--color-warning-700)]" : result.verdict === "blocked" ? "bg-[var(--color-error-50)] text-[var(--color-error-700)]" : "border border-[var(--gray-300)]"}`}>{VERDICT_COPY[result.verdict]}</span></div>
      <div className="min-w-0"><p className="break-words text-sm leading-5">{result.evidence.binding.summary}</p>{result.verdict !== "ready" && <p className="mt-1 text-xs font-medium">Owner: {result.owner_label}</p>}<p className="mt-1 break-words font-mono text-xs text-[var(--color-text-secondary)]">{result.reason_code}</p></div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">{action && <button type="button" onClick={() => {onEvent?.("action_opened", result);if(result.action_href)window.open(result.action_href,"_blank","noopener,noreferrer");}} className="min-h-11 rounded-lg border border-[var(--gray-300)] px-3 text-sm font-medium">{action}</button>}<button type="button" aria-expanded={open} aria-controls={`evidence-${result.provider}`} onClick={toggle} className="min-h-11 rounded-lg px-3 text-sm font-medium text-[var(--color-brand-700)] focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)]">{open ? "Hide evidence" : "View evidence"}</button></div>
    </div>{open && <ReadinessEvidence provider={result.provider} evidence={result.evidence} />}
  </section>;
}
