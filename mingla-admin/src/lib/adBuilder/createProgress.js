/**
 * ISSUE-1009 [partial-failure retry lockout] — derive completion from the
 * current create-call truth: destinations × creative-buildable platforms.
 *
 * `summary.channels` is intentionally not used here. Review may still display a
 * funded channel that creative validation excluded, while runCreate skips that
 * platform by design. Counting it would make completion impossible.
 */

function createResultKey(platform, destination, multiDestination) {
  if (!multiDestination) return platform;
  return `${platform}::${destination.page_type}:${destination.id}`;
}

/**
 * Return the exact result keys runCreate expects for the current plan.
 *
 * A single destination keeps the legacy bare-platform keys. Multiple
 * destinations use the existing platform::page_type:id composite keys.
 */
export function expectedCreateResultKeys({
  destinations = [],
  buildablePlatforms = [],
} = {}) {
  const multiDestination = destinations.length > 1;
  const keys = [];

  for (const destination of destinations) {
    for (const platform of buildablePlatforms) {
      keys.push(createResultKey(platform, destination, multiDestination));
    }
  }

  return keys;
}

/**
 * Completion means every non-empty current expected pair has a real campaign.
 * Validation, no-dry-run, error, missing, unknown, and foreign result entries
 * never count as a successful create.
 */
export function areAllExpectedCreatePairsSuccessful({
  destinations = [],
  buildablePlatforms = [],
  createResults = null,
} = {}) {
  const expectedKeys = expectedCreateResultKeys({ destinations, buildablePlatforms });
  return expectedKeys.length > 0 &&
    expectedKeys.every((key) => Boolean(createResults?.[key]?.campaign));
}
