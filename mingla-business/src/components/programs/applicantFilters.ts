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
  const hiredNames = new Set(hiredContracts(contracts).map((row) => row.creator));
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
