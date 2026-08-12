import { PROVIDER_ORDER, uncheckedResult } from "../../lib/adAppReadiness";
import { ProviderReadinessRow } from "./ProviderReadinessRow";
export function ProviderReadinessList({ latest, onEvent }) {
  const rows = latest?.results ?? PROVIDER_ORDER.map(uncheckedResult);
  return <section aria-labelledby="provider-readiness-heading"><h4 id="provider-readiness-heading" className="mb-3 text-base font-semibold">Provider readiness</h4><div className="divide-y divide-[var(--gray-200)] rounded-lg border border-[var(--gray-200)]">{rows.map((result) => <ProviderReadinessRow key={result.provider} result={result} staleAt={latest?.stale_at} onEvent={onEvent} />)}</div></section>;
}
