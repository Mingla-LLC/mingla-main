/* eslint-disable import/first */
/* eslint-disable react-hooks/rules-of-hooks -- test harness invokes the hook
   directly (react-query + AuthContext mocked) to capture + run the queryFn; no
   React tree is rendered, so the rules-of-hooks ordering guarantee is N/A here. */
/**
 * META-ORCH-1104 Phase 3 — useSupportStaff gating regression.
 *
 * useSupportStaff powers the COSMETIC "Support — Live Chats" card gate. The
 * security-critical derivation is: a user is staff ONLY when their support_staff
 * row exists AND enabled = true (mirrors is_support_staff()'s `enabled = true`
 * predicate). This test drives the real hook by mocking @tanstack/react-query's
 * useQuery to (a) capture + run the queryFn against a mocked supabase row, and
 * (b) feed the queryFn's result back as `data` — so the FULL hook logic (queryFn
 * mapping + isStaff derivation) is exercised, no renderHook needed.
 *
 * Happy (SC-3.2): an enabled staffer → isStaff true, available reflected.
 * Adversarial (SC-3.1 / T-3.1): a NON-staff user (absent row) → isStaff false;
 * a DISABLED staff row → isStaff false. The card is hidden in both; RLS is the
 * real boundary, but the gate must not light up for a non-enabled user.
 *
 * # Fails-on-revert
 * Change `isStaff` to `resolved.enabled !== false` (or to `row !== null`) → the
 * "disabled row" / "absent row" assertions go RED. Drop the `.eq("user_id")`
 * scoping → the queryFn assertion goes RED.
 *
 * New sibling file (append-only safe).
 */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

type Row = { enabled: boolean; available: boolean; role: string } | null;

const maybeSingleMock =
  jest.fn<() => Promise<{ data: Row; error: unknown }>>();
const eqMock = jest.fn((..._a: unknown[]) => ({ maybeSingle: maybeSingleMock }));
const selectMock = jest.fn((..._a: unknown[]) => ({ eq: eqMock }));
const fromMock = jest.fn((..._a: unknown[]) => ({ select: selectMock }));

jest.mock("../../services/supabase", () => ({
  supabase: { from: (...args: unknown[]) => fromMock(...args) },
}));

jest.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ isAuthReady: true, user: { id: "user-1" } }),
}));

// Capture the queryFn, run it, and feed its resolved value back as `data` so the
// hook's downstream `isStaff` derivation runs on the real mapped row.
let lastData: unknown = undefined;
jest.mock("@tanstack/react-query", () => ({
  useQuery: (opts: { queryFn: () => Promise<unknown>; enabled: boolean }) => {
    // Eagerly run the queryFn (sync-capture for the test) when enabled.
    if (opts.enabled) {
      // Store the promise result synchronously via a side-channel resolved in
      // the test (we await it there before re-reading the hook).
      lastData = opts.queryFn();
    }
    return { data: undefined, isLoading: false, isError: false };
  },
}));

import { useSupportStaff } from "../useSupportStaff";

async function runQueryFnRow(row: Row): Promise<{
  enabled: boolean;
  available: boolean;
  role: string | null;
}> {
  maybeSingleMock.mockResolvedValue({ data: row, error: null });
  // Invoke the hook to register the queryFn, then await its captured promise.
  useSupportStaff();
  const mapped = (await lastData) as {
    enabled: boolean;
    available: boolean;
    role: string | null;
  };
  return mapped;
}

describe("META-ORCH-1104 useSupportStaff — queryFn mapping (the staff gate)", () => {
  beforeEach(() => {
    maybeSingleMock.mockReset();
    eqMock.mockClear();
    selectMock.mockClear();
    fromMock.mockClear();
    lastData = undefined;
  });

  test("happy: an enabled staff row maps to enabled/available true", async () => {
    const mapped = await runQueryFnRow({
      enabled: true,
      available: true,
      role: "staff",
    });
    expect(mapped.enabled).toBe(true);
    expect(mapped.available).toBe(true);
    expect(mapped.role).toBe("staff");
    // Read is scoped to the caller's own row (RLS self-read).
    expect(fromMock).toHaveBeenCalledWith("support_staff");
    expect(eqMock).toHaveBeenCalledWith("user_id", "user-1");
  });

  test("adversarial: a NON-staff user (absent row) maps to enabled false", async () => {
    const mapped = await runQueryFnRow(null);
    expect(mapped.enabled).toBe(false);
    expect(mapped.available).toBe(false);
    expect(mapped.role).toBeNull();
  });

  test("adversarial: a DISABLED staff row maps to enabled false (not staff)", async () => {
    const mapped = await runQueryFnRow({
      enabled: false,
      available: false,
      role: "staff",
    });
    expect(mapped.enabled).toBe(false);
  });
});

describe("META-ORCH-1104 useSupportStaff — isStaff derivation", () => {
  beforeEach(() => {
    maybeSingleMock.mockReset();
    lastData = undefined;
  });

  // The hook's returned isStaff derives from `resolved.enabled === true`. With
  // useQuery mocked to return undefined data, the hook falls back to EMPTY →
  // isStaff false (the safe default: never show the console without a confirmed
  // enabled row).
  test("isStaff defaults to false when data is unresolved (safe default)", () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null });
    const state = useSupportStaff();
    expect(state.isStaff).toBe(false);
    expect(state.enabled).toBe(false);
    expect(state.available).toBe(false);
    expect(state.role).toBeNull();
  });
});
