/**
 * Issue #1685 [venue-draft-multi] — client id generator for VENUE drafts.
 *
 * Mirrors `src/utils/draftEventId.ts` verbatim in style. The `dv_` prefix is
 * deliberately distinct from the event draft's `d_` and the brand's `b_`, so a
 * venue draft id can never be mistaken for either.
 *
 * CLIENT-ONLY: a venue draft has no server row before submit
 * (I-PROPOSED-1263-CLAIM-ADOPTION-COPY-ON-START), so this id never travels to
 * the database.
 */

const randomSuffix = (): string => Math.random().toString(36).slice(2, 8);

export const generateVenueDraftId = (): string =>
  `dv_${Date.now().toString(36)}${randomSuffix()}`;
