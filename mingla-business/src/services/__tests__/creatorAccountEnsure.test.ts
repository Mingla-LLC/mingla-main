import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import type { User } from "@supabase/supabase-js";

import { ensureCreatorAccount } from "../creatorAccount";
import { supabase } from "../supabase";

jest.mock("../supabase", () => ({
  supabase: {
    from: jest.fn(),
  },
}));

describe("ensureCreatorAccount — seed-only contract (ORCH-0786 follow-up)", () => {
  const upsertMock = jest.fn() as jest.MockedFunction<
    (row: unknown, options: unknown) => Promise<{ error: { message: string } | null }>
  >;
  const fromMock = supabase.from as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    upsertMock.mockResolvedValue({ error: null });
    fromMock.mockReturnValue({ upsert: upsertMock });
  });

  const makeUser = (overrides: Partial<User> = {}): User =>
    ({
      id: "b17e3e15-218d-475b-8c80-32d4948d6905",
      email: "creator@example.com",
      user_metadata: {
        full_name: "Jane Creator",
        avatar_url: "https://lh3.googleusercontent.com/a/zzz=s96-c",
      },
      ...overrides,
    }) as User;

  test("T-25 issues an INSERT ... ON CONFLICT DO NOTHING (ignoreDuplicates: true)", async () => {
    await ensureCreatorAccount(makeUser());

    expect(fromMock).toHaveBeenCalledWith("creator_accounts");
    const [, options] = upsertMock.mock.calls[0] ?? [];
    expect(options).toEqual({ onConflict: "id", ignoreDuplicates: true });
  });

  test("T-26 seeds row with OAuth claims (display_name + avatar_url + email)", async () => {
    await ensureCreatorAccount(makeUser());

    const [row] = upsertMock.mock.calls[0] ?? [];
    expect(row).toEqual({
      id: "b17e3e15-218d-475b-8c80-32d4948d6905",
      email: "creator@example.com",
      display_name: "Jane Creator",
      avatar_url: "https://lh3.googleusercontent.com/a/zzz=s96-c",
    });
  });

  test("T-27 throws when the upsert errors (no silent failures, Const #3)", async () => {
    upsertMock.mockResolvedValueOnce({ error: { message: "rls denied" } });

    await expect(ensureCreatorAccount(makeUser())).rejects.toMatchObject({
      message: "rls denied",
    });
  });

  test("T-28 falls back to email-local-part display_name when OAuth metadata missing", async () => {
    await ensureCreatorAccount(
      makeUser({
        user_metadata: {},
        email: "newuser@example.com",
      } as Partial<User>),
    );

    const [row] = upsertMock.mock.calls[0] ?? [];
    expect(row).toMatchObject({ display_name: "newuser", avatar_url: null });
  });

  // ORCH-1110: never persist the empty string. auth.users.email NULL is
  // serialized as "" on User.email; the seed must resolve the real email
  // from user_metadata/identity, or write NULL — never "".
  test("T-P1 seeds resolved real email when auth email is blank but metadata has it", async () => {
    await ensureCreatorAccount(
      makeUser({
        email: "",
        user_metadata: { email: "a@b.com" },
      } as Partial<User>),
    );

    const [row] = upsertMock.mock.calls[0] ?? [];
    expect((row as { email: string | null }).email).toBe("a@b.com");
  });

  test("T-P2 seeds NULL (never empty string) when no real email anywhere", async () => {
    await ensureCreatorAccount(
      makeUser({
        email: "",
        user_metadata: {},
        identities: [],
      } as unknown as Partial<User>),
    );

    const [row] = upsertMock.mock.calls[0] ?? [];
    expect((row as { email: string | null }).email).toBeNull();
  });

  test("T-P3 seeds real user.email unchanged when present", async () => {
    await ensureCreatorAccount(
      makeUser({ email: "x@y.com", user_metadata: {} } as Partial<User>),
    );

    const [row] = upsertMock.mock.calls[0] ?? [];
    expect((row as { email: string | null }).email).toBe("x@y.com");
  });
});
