// #3872 — applicant sorting on a gig. Round 2 (approved M-gig): Best match,
// Top rated, Lowest price; a creator already hired on the gig shows only
// under Hired, never under Interested.
import type {
  GigApplicant,
  HostContractSummary,
} from "../../services/creatorGigsService";

export type ApplicantFilter = "best" | "rated" | "price";

export const APPLICANT_FILTERS: ReadonlyArray<readonly [ApplicantFilter, string]> = [
  ["best", "Best match"],
  ["rated", "Top rated"],
  ["price", "Lowest price"],
];

/** #4430 Q1: dispute decisions end a hire; the host may offer again. */
const ENDED_DISPUTE_STATES: readonly string[] = ["resolved_release", "resolved_partial", "resolved_refund"];

/** Contracts that count as hired (an unpaid offer is not a hire yet). */
export function hiredContracts(
  contracts: readonly HostContractSummary[],
): HostContractSummary[] {
  return contracts.filter(
    (row) =>
      !row.payment_pending &&
      !["declined", "expired", "cancelled"].includes(row.state),
  );
}

/**
 * The Interested list: open interest only, never someone hired on this gig
 * (the server leaves them out; this keeps an older answer honest too).
 */
export function interestedApplicants(
  items: readonly GigApplicant[],
  contracts: readonly HostContractSummary[],
  filter: ApplicantFilter,
): GigApplicant[] {
  // #4430 Q1: a creator whose hire on this gig ended (a settled dispute
  // included) is offerable again, so only a live or completed hire hides them.
  const hiredNames = new Set(
    hiredContracts(contracts)
      .filter((row) => !ENDED_DISPUTE_STATES.includes(row.state))
      .map((row) => row.creator),
  );
  const visible = items.filter(
    (item) =>
      item.status !== "passed" &&
      item.status !== "hired" &&
      !hiredNames.has(item.display_name),
  );
  if (filter === "rated")
    return [...visible].sort(
      (a, b) => (b.rating ?? 0) - (a.rating ?? 0) || b.completed - a.completed,
    );
  if (filter === "price")
    return [...visible].sort((a, b) => a.quote_minor - b.quote_minor);
  return visible;
}
