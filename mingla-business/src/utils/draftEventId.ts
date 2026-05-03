/**
 * ID generators for draft events + tickets.
 *
 * Format-agnostic per Cycle 2 invariant I-11. Matches the established
 * `b_<ts36>` pattern from currentBrandStore — same generator approach,
 * different prefix.
 *
 * Per Cycle 3 spec §3.3.
 */

const randomSuffix = (): string => Math.random().toString(36).slice(2, 8);

export const generateDraftId = (): string =>
  `d_${Date.now().toString(36)}${randomSuffix()}`;

export const generateTicketId = (): string =>
  `t_${Date.now().toString(36)}${randomSuffix()}`;
