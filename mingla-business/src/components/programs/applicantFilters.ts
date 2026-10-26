// #3872 — applicant filters on a gig (Best match / Within budget / Top rated).
import type { GigApplicant } from "../../services/creatorGigsService";

export type ApplicantFilter = "best" | "budget" | "rated";

export function sortApplicants(items: readonly GigApplicant[], filter: ApplicantFilter, maxMinor: number | null): GigApplicant[] {
  const visible = items.filter((item) => item.status !== "passed");
  if (filter === "budget" && maxMinor !== null) return visible.filter((item) => item.quote_minor <= maxMinor);
  if (filter === "rated") return [...visible].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || b.completed - a.completed);
  return visible;
}
