import { describe, expect, test } from "@jest/globals";
import type { User } from "@supabase/supabase-js";

import {
  computeConfirmMatches,
  resolveUserEmail,
} from "../resolveUserEmail";

// ORCH-1110 §7/§9 — gate logic for delete.tsx Step 3.
//
// T-G1 (happy, fails-on-revert): with auth.users.email blank but a resolvable
//   real email, a case-insensitive match enables delete AND the resolved email
//   is what gets displayed. Reverting the fix (user.email ?? "" comparison)
//   makes the resolved email blank -> match returns false -> this FAILS.
// T-A1 (adversarial): empty/whitespace input NEVER enables delete (closes the
//   old "" === "" mis-enable).
// T-A2 (adversarial, different angle): when no email is resolvable, the keyword
//   path keeps the account deletable.

describe("delete-account gate — computeConfirmMatches (ORCH-1110)", () => {
  test("T-G1 happy: blank auth email but resolvable real email matches case-insensitively", () => {
    // Simulate the real trapped account: auth.users.email serialized as "",
    // real email carried in user_metadata/identity.
    const user = {
      id: "332e1733-af2b-49ca-8014-87d56f1b735e",
      email: "",
      user_metadata: { email: "a@b.com" },
      identities: [{ identity_data: { email: "a@b.com" } }],
    } as unknown as User;

    const resolved = resolveUserEmail(user);
    // The resolved email is what the "YOUR EMAIL" box displays (SC-1).
    expect(resolved).toBe("a@b.com");

    const mode = resolved === null ? "keyword" : "email";
    // Typed with different casing still matches (SC-2).
    expect(computeConfirmMatches(mode, resolved, "A@B.COM")).toBe(true);
  });

  test("T-A1 adversarial: empty input never enables (email mode)", () => {
    expect(computeConfirmMatches("email", "a@b.com", "")).toBe(false);
    expect(computeConfirmMatches("email", "a@b.com", "   ")).toBe(false);
  });

  test("T-A1 adversarial: empty input never enables (keyword mode)", () => {
    expect(computeConfirmMatches("keyword", null, "")).toBe(false);
    expect(computeConfirmMatches("keyword", null, "   ")).toBe(false);
  });

  test("T-A2 adversarial: no resolvable email -> keyword DELETE keeps account deletable", () => {
    const user = {
      id: "u-no-email",
      email: "",
      user_metadata: {},
      identities: [],
    } as unknown as User;

    const resolved = resolveUserEmail(user);
    expect(resolved).toBeNull();

    const mode = resolved === null ? "keyword" : "email";
    expect(mode).toBe("keyword");
    // Case-insensitive DELETE enables.
    expect(computeConfirmMatches(mode, resolved, "delete")).toBe(true);
    expect(computeConfirmMatches(mode, resolved, "DELETE")).toBe(true);
    // Anything else stays disabled.
    expect(computeConfirmMatches(mode, resolved, "a@b.com")).toBe(false);
  });

  test("email mode: wrong email stays disabled", () => {
    expect(computeConfirmMatches("email", "a@b.com", "c@d.com")).toBe(false);
  });

  test("email mode: null resolvedEmail never matches (defensive)", () => {
    expect(computeConfirmMatches("email", null, "anything")).toBe(false);
  });
});
