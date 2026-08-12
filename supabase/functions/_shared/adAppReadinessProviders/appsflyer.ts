import { evidence, type TargetRow } from "../adAppReadiness.ts";
export async function verifyAppsflyer(
  target: TargetRow,
  signal: AbortSignal,
  checkedAt: string,
) {
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  return await Promise.resolve(evidence(
    "proven",
    `Canonical AppsFlyer app ${target.appsflyer_app_id} is registered for this target.`,
    checkedAt,
    "canonical_registry",
    target.appsflyer_app_id,
  ));
}
