/**
 * issue #2590 — plain sentences for the tier-edit refusals a server can return.
 *
 * WHY THIS EXISTS. `business_patch_event_ticket_tiers` refuses with a bounded
 * token. Six of those tokens had no arm in the editor's copy chain, so they
 * fell through to `describeUnmappedEditGuard`, which tells the organiser:
 *
 *   We couldn't save these changes — the server reported
 *   "sold_ticket_mutation_blocked". Contact support and quote that code.
 *
 * That is not nothing, but it is not usable either. It names a symbol the
 * organiser has never seen, offers no action, and reads as a malfunction rather
 * than a deliberate rule. Seth hit exactly this trying to correct a sale window
 * and reported it as "the save clicks but then loads and stays the same".
 *
 * A refusal the product MEANT to make should read like a decision, not a fault.
 * Every sentence here names the cause and the next action, in that order, and
 * none of them apologise or mention a code.
 */

/** The tier-edit refusals that reach an organiser, mapped to what to tell them. */
const TIER_EDIT_GUARD_COPY: Readonly<Record<string, string>> = Object.assign(
  Object.create(null) as Record<string, string>,
  {
    // The one Seth hit. After #2590 this fires only for price, free/paid, or a
    // capacity below what is already issued — so the sentence names those three
    // rather than describing a general lock.
    sold_ticket_mutation_blocked:
      "Tickets have already sold for this tier, so its price, its free/paid setting, and any capacity below the number already issued are fixed. Everything else — including when sales run — can still be changed.",

    // Turning password protection on without a password to check against.
    ticket_password_setup_required:
      "Set a password of at least 4 characters before turning password protection on.",

    // A paid tier on a brand that cannot receive money yet.
    payout_not_ready:
      "Add a bank account in Brand › Payments before selling paid tickets. Free tiers can be published now.",

    // Someone else changed the event between load and save.
    stale_event_revision:
      "Someone else edited this event while you had it open. Reload to see their changes, then make yours again.",

    // The tier changed underneath this edit.
    ticket_lifecycle_mismatch:
      "This ticket tier changed while you were editing it. Reload the event and try again.",

    // Unpublished ticket changes are pending on the draft.
    draft_ticket_projection_conflict:
      "This event has ticket changes that were never published. Publish or discard them before editing tiers here.",
  },
);

/**
 * Longest token first, so a short token that is a substring of a longer one can
 * never shadow it. The refusal arrives inside a longer Postgres error message,
 * so matching is by containment, not equality.
 */
const TOKENS_LONGEST_FIRST: readonly string[] = Object.keys(TIER_EDIT_GUARD_COPY)
  .sort((a, b) => b.length - a.length);

/** Every sentence this module can produce — for tests, and for copy review. */
export const TIER_EDIT_GUARD_MESSAGES: readonly string[] = Object.values(
  TIER_EDIT_GUARD_COPY,
);

/**
 * The organiser-facing sentence for a tier-edit refusal, or `null` when this
 * module has nothing better to say than the existing chain.
 *
 * Returning `null` rather than a generic string is deliberate: the caller
 * already has a fallback, and a module that answers for everything would
 * quietly swallow a refusal it has never seen — which is how the six above went
 * unnoticed in the first place.
 */
export const tierEditGuardMessage = (
  raw: string | null | undefined,
): string | null => {
  if (typeof raw !== "string" || raw.length === 0) return null;
  for (const token of TOKENS_LONGEST_FIRST) {
    if (raw.includes(token)) return TIER_EDIT_GUARD_COPY[token] ?? null;
  }
  return null;
};
