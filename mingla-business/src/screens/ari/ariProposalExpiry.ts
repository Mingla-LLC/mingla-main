/**
 * #2830 (D-3) — recognise an Ari approval that timed out.
 *
 * The confirm function answers an expired Ari proposal with a terminal 409
 * `PROPOSAL_EXPIRED`. Older servers answered the same case with a 200
 * `expired_regenerate` body (the Hub re-snap contract), which the chat used to
 * fall through as success: the card vanished and the owner believed the
 * change was saved. Both shapes, and the legacy `EXPIRED` / "status: expired"
 * phrasing, are an expiry here — never a success.
 *
 * Dependency-free on purpose (type-only shape) so it stays cheap to test.
 */

export type AriConfirmResultShape =
  | { kind: "error"; code: string; message: string }
  | { kind: string; code?: undefined; message?: undefined };

export function isAriProposalExpired(result: AriConfirmResultShape): boolean {
  if (result.kind === "expired_regenerate") return true;
  if (result.kind !== "error") return false;
  const message = (result.message ?? "").toLowerCase();
  return (
    result.code === "PROPOSAL_EXPIRED" ||
    result.code === "EXPIRED" ||
    message.includes("status: expired") ||
    message.includes("proposal expired")
  );
}
