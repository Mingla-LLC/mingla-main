import {
  evidence,
  type SafeEvidence,
  type TargetRow,
} from "../adAppReadiness.ts";

export type AppsFlyerMeasurementReader = (
  target: TargetRow,
  signal: AbortSignal,
) => Promise<{ partnerActive: boolean; installEventMapped: boolean } | null>;

const noConfiguredReadApi: AppsFlyerMeasurementReader = () =>
  Promise.resolve(null);

export async function verifyAppsflyer(
  target: TargetRow,
  signal: AbortSignal,
  checkedAt: string,
  readMeasurement: AppsFlyerMeasurementReader = noConfiguredReadApi,
): Promise<SafeEvidence> {
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  const result = await readMeasurement(target, signal);
  if (!result) {
    return evidence(
      "action_required",
      "AppsFlyer partner activation and install-event mapping are not verifiable through a configured read API.",
      checkedAt,
      "canonical_registry",
      target.appsflyer_app_id,
    );
  }
  return result.partnerActive && result.installEventMapped
    ? evidence(
      "proven",
      "AppsFlyer confirms partner activation and install-event mapping for the exact app target.",
      checkedAt,
      "appsflyer_api",
      target.appsflyer_app_id,
    )
    : evidence(
      "action_required",
      "AppsFlyer partner activation or install-event mapping is incomplete.",
      checkedAt,
      "appsflyer_api",
      target.appsflyer_app_id,
    );
}
