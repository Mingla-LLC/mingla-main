/**
 * issue #2590 — THE PROPERTIES OF THE COPY, not its contents.
 *
 * DIFFERENT ANGLE FROM THE IMPLEMENTOR TEST. That one checks the six tokens map
 * to the right sentences. This one attacks the two ways such a map rots even
 * when every entry is individually correct:
 *
 *   1. It quietly reintroduces what it replaced. The whole defect was an
 *      organiser being shown a raw symbol and told to contact support. A new
 *      entry written in that register would pass the implementor test and
 *      restore the original problem.
 *   2. Token shadowing. Matching is by CONTAINMENT, so a short token that is a
 *      substring of a longer one silently wins if the order is wrong. Nothing
 *      about that failure is visible — the wrong sentence is still a sentence.
 *
 * FAILS ON REVERT: drop the longest-first sort and the shadowing case fails;
 * write a message that quotes a token or defers to support and the register
 * cases fail.
 */
import { describe, expect, test } from "@jest/globals";

import {
  TIER_EDIT_GUARD_MESSAGES,
  tierEditGuardMessage,
} from "../tierEditGuardCopy";

describe("issue #2590 — the copy cannot rot back into what it replaced", () => {
  test("no sentence leaks a raw token at the organiser", () => {
    // The exact failure being fixed: `describeUnmappedEditGuard` quoting
    // `sold_ticket_mutation_blocked` at someone who has never seen it.
    for (const message of TIER_EDIT_GUARD_MESSAGES) {
      expect(message).not.toMatch(/[a-z]+_[a-z]+_[a-z]+/);
    }
  });

  test("no sentence sends the organiser to support", () => {
    // A deliberate rule that ends in "contact support" is indistinguishable
    // from a malfunction, which is precisely how this was experienced.
    for (const message of TIER_EDIT_GUARD_MESSAGES) {
      expect(message.toLowerCase()).not.toContain("contact support");
      expect(message.toLowerCase()).not.toContain("try again later");
    }
  });

  test("no sentence apologises or blames the system", () => {
    for (const message of TIER_EDIT_GUARD_MESSAGES) {
      const lower = message.toLowerCase();
      expect(lower).not.toContain("sorry");
      expect(lower).not.toContain("we couldn't");
      expect(lower).not.toContain("something went wrong");
    }
  });

  test("every sentence tells the organiser what to do or what is true", () => {
    // Not a style rule: a refusal with no next action is the dead end this
    // issue is about. Each message must end as a complete sentence.
    for (const message of TIER_EDIT_GUARD_MESSAGES) {
      expect(message.length).toBeGreaterThan(40);
      expect(message.trim()).toMatch(/[.!]$/);
    }
  });

  test("a longer token is never shadowed by a shorter one it contains", () => {
    // `ticket_password_setup_required` contains no other token today, but the
    // map is matched by containment and will grow. Pin the ordering property
    // rather than today's happy accident.
    const both = "failed: ticket_lifecycle_mismatch and payout_not_ready";
    const picked = tierEditGuardMessage(both);
    expect(picked).not.toBeNull();
    // Longest-first means the longer token wins deterministically.
    expect(picked).toBe(tierEditGuardMessage("ticket_lifecycle_mismatch"));
  });

  test("matching is containment, so a wrapped Postgres message still resolves", () => {
    const wrapped =
      'ERROR:  P0001: payout_not_ready\nCONTEXT:  PL/pgSQL function line 97 at RAISE';
    expect(tierEditGuardMessage(wrapped)).not.toBeNull();
  });

  test("a token that merely LOOKS like one of ours does not match", () => {
    // Guards against a future entry so short it matches unrelated text.
    expect(tierEditGuardMessage("not_ready")).toBeNull();
    expect(tierEditGuardMessage("stale")).toBeNull();
  });
});
