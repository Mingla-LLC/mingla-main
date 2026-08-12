import { useState } from "react";
import { ACTION_COPY, primaryEvidenceName, VERDICT_COPY } from "../../lib/adAppReadiness";
import { openExternal } from "../../lib/openExternal";
import { ReadinessEvidence } from "./ReadinessEvidence";
export function ProviderReadinessRow({ result, staleAt, onEvent }) {
  const [open,setOpen] = useState(false); const label = result.provider[0].toUpperCase() + result.provider.slice(1);
  const action = result.action_code && ACTION_COPY[result.action_code];
  if (result.verdict === "needs_check") return <section aria-labelledby={`provider-${result.provider}`} className="min-w-0 p-4"><div className="flex min-w-0 flex-wrap items-center justify-between gap-3"><h5 id={`provider-${result.provider}`} className="text-sm font-semibold">{label}</h5><span className="rounded-full border border-[var(--gray-300)] px-2 py-0.5 text-xs font-medium">Needs check</span></div><p className="mt-2 text-sm text-[var(--color-text-secondary)]">No saved provider evidence.</p></section>;
  const primary = result.evidence[primaryEvidenceName(result.reason_code)];
  const toggle = () => { const next=!open; setOpen(next); onEvent?.("detail_toggled", result); };
  return <section aria-labelledby={`provider-${result.provider}`} className="@container min-w-0 p-4">
    <div className="grid min-w-0 gap-4 @[720px]:grid-cols-[minmax(136px,180px)_minmax(0,1fr)_auto]">
      <div className="flex flex-wrap items-start gap-2"><h5 id={`provider-${result.provider}`} className="text-sm font-semibold">{label}</h5><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${result.verdict === "ready" ? "bg-[var(--color-success-50)] text-[var(--color-success-700)]" : result.verdict === "action_required" ? "bg-[var(--color-warning-50)] text-[var(--color-warning-700)]" : result.verdict === "blocked" ? "bg-[var(--color-error-50)] text-[var(--color-error-700)]" : "border border-[var(--gray-300)]"}`}>{VERDICT_COPY[result.verdict]}</span></div>
      <div className="min-w-0"><p className="break-words text-sm leading-5">{primary.summary}</p>{result.verdict !== "ready" && <p className="mt-1 text-xs font-medium">Owner: {result.owner_label}</p>}<p className="mt-1 break-words font-mono text-xs text-[var(--color-text-secondary)]">{result.reason_code}</p></div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">{action && result.action_href && <button type="button" onClick={() => {onEvent?.("action_opened", result);openExternal(result.action_href);}} className="min-h-11 rounded-lg border border-[var(--gray-300)] px-3 text-sm font-medium" aria-label={`${action} (opens in a new tab)`}>{action}</button>}{action && !result.action_href && <span className="text-xs text-[var(--color-text-secondary)]">Use the selected-target action above.</span>}<button type="button" aria-expanded={open} aria-controls={`evidence-${result.provider}`} onClick={toggle} className="min-h-11 rounded-lg px-3 text-sm font-medium text-[var(--color-brand-700)] focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)]">{open ? "Hide evidence" : "View evidence"}</button></div>
    </div>{open && <ReadinessEvidence provider={result.provider} evidence={result.evidence} staleAt={staleAt} verdict={result.verdict} />}
  </section>;
}
