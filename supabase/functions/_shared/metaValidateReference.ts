// toward #3697: Meta ad-set validate-only must use a campaign whose persisted
// ad sets all share the requested optimization goal. A CBO lowest-cost campaign
// cannot accept an ad set with a different goal, so "most recent campaign" is
// not a safe validation reference.

export interface MetaValidateReferenceCandidate {
  external_campaign_id?: unknown;
  ad_sets?: unknown;
}

const persistedGoals = (
  candidate: MetaValidateReferenceCandidate,
): string[] => {
  if (!Array.isArray(candidate.ad_sets)) return [];
  return candidate.ad_sets
    .map((row) => {
      if (row === null || typeof row !== "object") return null;
      const value = (row as Record<string, unknown>).optimization_goal;
      return typeof value === "string" && value.length > 0 ? value : null;
    })
    .filter((value): value is string => value !== null);
};

/** Candidates must already be ordered newest first. */
export const compatibleMetaValidateReference = (
  candidates: MetaValidateReferenceCandidate[],
  requestedOptimizationGoal: string,
): string | null => {
  for (const candidate of candidates) {
    const externalId = candidate.external_campaign_id;
    if (typeof externalId !== "string" || externalId.length === 0) continue;
    const goals = persistedGoals(candidate);
    if (
      goals.length > 0 &&
      goals.every((goal) => goal === requestedOptimizationGoal)
    ) {
      return externalId;
    }
  }
  return null;
};
