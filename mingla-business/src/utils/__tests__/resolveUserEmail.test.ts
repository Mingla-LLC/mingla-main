import { describe, expect, test } from "@jest/globals";
import type { User } from "@supabase/supabase-js";

import { resolveUserEmail } from "../resolveUserEmail";

// ORCH-1110 §7 T-R1..T-R3 — resolver treats "" / whitespace as ABSENT and
// falls back to user_metadata.email then identity email.
const makeUser = (overrides: Partial<User>): User =>
  ({ id: "u1", ...overrides }) as User;

describe("resolveUserEmail (ORCH-1110)", () => {
  test("T-R1: empty user.email, metadata email present -> metadata email", () => {
    const user = makeUser({
      email: "",
      user_metadata: { email: "M@x.com" },
    } as Partial<User>);
    expect(resolveUserEmail(user)).toBe("M@x.com");
  });

  test("T-R2: empty everywhere -> null", () => {
    const user = makeUser({
      email: "  ",
      user_metadata: {},
      identities: [{ identity_data: { email: "" } }],
    } as unknown as Partial<User>);
    expect(resolveUserEmail(user)).toBeNull();
  });

  test("T-R3: only identity email -> identity email", () => {
    const user = makeUser({
      email: undefined,
      identities: [{ identity_data: { email: "i@x.com" } }],
    } as unknown as Partial<User>);
    expect(resolveUserEmail(user)).toBe("i@x.com");
  });

  test("real user.email wins and is trimmed", () => {
    const user = makeUser({
      email: "  x@y.com ",
      user_metadata: { email: "other@z.com" },
    } as Partial<User>);
    expect(resolveUserEmail(user)).toBe("x@y.com");
  });

  test("null user -> null", () => {
    expect(resolveUserEmail(null)).toBeNull();
  });

  test("first identity with a real email wins (skips empty ones)", () => {
    const user = makeUser({
      email: "",
      user_metadata: {},
      identities: [
        { identity_data: { email: "" } },
        { identity_data: { email: "second@id.com" } },
      ],
    } as unknown as Partial<User>);
    expect(resolveUserEmail(user)).toBe("second@id.com");
  });
});
