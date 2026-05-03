/**
 * Live event ID generator.
 *
 * Format-agnostic per Cycle 2 invariant I-11. Matches the established
 * `b_<ts36>` (brand) and `d_<ts36>` (draft) pattern — same generator
 * approach, different prefix.
 *
 * Per Cycle 6 spec §3.1.2.
 */

const randomSuffix = (): string => Math.random().toString(36).slice(2, 8);

export const generateLiveEventId = (): string =>
  `le_${Date.now().toString(36)}${randomSuffix()}`;
