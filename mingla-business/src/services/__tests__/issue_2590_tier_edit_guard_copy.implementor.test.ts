/**
 * issue #2590 — a deliberate refusal must read like a decision.
 *
 * WHAT WAS WRONG. `business_patch_event_ticket_tiers` refuses with a bounded
 * token. Six of those tokens had no arm in the editor's copy chain, so they
 * fell through to `describeUnmappedEditGuard`, which tells the organiser:
 *
 *   We couldn't save these changes — the server reported
 *   "sold_ticket_mutation_blocked". Contact support and quote that code.
 *
 * Seth hit exactly that trying to correct a sale window on a live event and
 * reported it as "the save clicks but then loads and stays the same". The rule
 * was working as designed; only its explanation was missing.
 *
 * FAILS ON REVERT: delete any entry from the map and its case fails; delete the
 * module's wiring and every case fails at import.
 */
import { describe, expect, test } from "@jest/globals";

import {
  TIER_EDIT_GUARD_MESSAGES,
  tierEditGuardMessage,
} from "../tierEditGuardCopy";

/** How the token actually arrives — inside a longer Postgres error message. */
const raised = (token: string): string =>
  `error returned from database: ${token}`;

describe("issue #2590 — every tier-edit refusal has a usable sentence", () => {
  test.each([
    ["sold_ticket_mutation_blocked", "price"],
    ["ticket_password_setup_required", "password"],
    ["payout_not_ready", "bank account"],
    ["stale_event_revision", "reload"],
    ["ticket_lifecycle_mismatch", "reload"],
    ["draft_ticket_projection_conflict", "publish"],
  ])("%s names the cause", (token, needle) => {
    const message = tierEditGuardMessage(raised(token));
    expect(message).not.toBeNull();
    expect((message as string).toLowerCase()).toContain(needle);
  });

  test("the sold-ticket sentence names exactly what is still frozen", () => {
    // After this issue the guard fires ONLY for these three. A sentence that
    // still implied a general lock would send an organiser to support for a
    // change they are now allowed to make.
    const message = (
      tierEditGuardMessage(raised("sold_ticket_mutation_blocked")) as string
    ).toLowerCase();
    expect(message).toContain("price");
    expect(message).toContain("free");
    expect(message).toContain("capacity");
  });

  test("and says the sale window is NOT frozen, because that is the fix", () => {
    const message = (
      tierEditGuardMessage(raised("sold_ticket_mutation_blocked")) as string
    ).toLowerCase();
    expect(message).toContain("when sales run");
  });

  test("an unknown token returns null so the existing fallback still runs", () => {
    // Deliberately NOT a generic string. A module that answered for everything
    // would swallow the next unmapped refusal exactly as these six were
    // swallowed, and nobody would notice.
    expect(tierEditGuardMessage(raised("some_future_token"))).toBeNull();
    expect(tierEditGuardMessage("")).toBeNull();
    expect(tierEditGuardMessage(null)).toBeNull();
    expect(tierEditGuardMessage(undefined)).toBeNull();
  });

  test("every sentence is distinct", () => {
    expect(new Set(TIER_EDIT_GUARD_MESSAGES).size).toBe(
      TIER_EDIT_GUARD_MESSAGES.length,
    );
  });
});
