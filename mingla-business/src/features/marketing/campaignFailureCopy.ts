/**
 * #4596 — a failed campaign's reason, in words. Pure, dependency-free.
 */

/**
 * Why a failed campaign did not go out, from its failure_reason. Null means the
 * campaign has no reason on record: the caller keeps its "Failed {date}" line.
 */
export function campaignFailureCopy(reason: string | null | undefined): string | null {
  if (reason === null || reason === undefined || reason.length === 0) return null;
  // Fix pass 2: sends that failed at the provider keep the usual
  // "Failed {date}" wording; only a send that reached nobody says so.
  if (reason === "all_sends_failed") return null;
  if (reason === "no_recipients") return "Not sent: no one in this audience could receive it.";
  if (reason === "form_closed") return "Not sent: form closed";
  return `Not sent: something went wrong (${reason}).`;
}
