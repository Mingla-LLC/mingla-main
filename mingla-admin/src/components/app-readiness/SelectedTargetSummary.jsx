import { countsFor, summaryFor } from "../../lib/adAppReadiness";

export function SelectedTargetSummary({ target, phase, stopped, onCheck, actionRef, offline, errorStatus }) {
  if (!target) return null; const counts = countsFor(target.latest);
  const loading = phase === "checking" || phase === "loading_saved";
  const label = errorStatus === 401 ? "Sign in again" : errorStatus === 403 ? "Return to dashboard" : offline ? "Retry when online" : loading ? "Checking selected target…" : phase === "error" ? "Retry selected target" : target.latest ? "Recheck selected target" : "Check selected target";
  return <section aria-labelledby="selected-target-heading" className="grid min-w-0 gap-4 @[720px]:grid-cols-[minmax(0,1fr)_auto]" aria-busy={loading}>
    <div className="min-w-0"><h4 id="selected-target-heading" className="text-base font-semibold">{target.display_name} · {target.os === "ios" ? "iOS" : "Android"}</h4><p className="mt-1 break-words text-sm text-[var(--color-text-secondary)]">{target.os === "ios" ? "App Store ID" : "Package"} {target.store_identifier} · AppsFlyer app ID {target.appsflyer_app_id}</p><p className="mt-2 text-sm">{stopped ? "The last check was stopped." : summaryFor(target.latest)}</p><p className="mt-1 text-xs text-[var(--color-text-secondary)]">{target.latest ? `${counts.ready} Ready · ${counts.action_required} Action required · ${counts.blocked} Blocked · ${counts.stale} Stale` : "No saved provider evidence."}</p></div>
    <button ref={actionRef} type="button" disabled={loading || offline} onClick={onCheck} className="min-h-11 rounded-lg bg-[var(--color-brand-700)] px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2">{label}</button>
  </section>;
}
