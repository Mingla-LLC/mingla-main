/**
 * Issue #1835 — ADVERSARIAL regression test.
 *
 * Deliberately attacks a DIFFERENT angle from the happy-path suite. That one
 * asks "does the fix do the right thing on the reported inputs?"; this one asks
 * "what input makes the fix hand back the wrong verdict?" — the role/deed
 * divergence trap, hostile error shapes, and the service boundary itself.
 *
 * Attack surfaces:
 *   T-1  role/deed divergence — a `brand_owner` TEAM row on a brand whose
 *        account_id points elsewhere. Gating on `role` (the obvious shortcut)
 *        passes this and re-creates the dead button. `canDeleteBrand` must not.
 *   T-2  identity confusion — same-looking-but-different ids, whitespace, case.
 *   T-3  hostile error shapes that must not crash or misclassify.
 *   T-4  code-less RLS rejection — a path that loses `code` must still be
 *        classified as permission-denied, not dressed up as a retryable glitch.
 *   T-5  the service boundary itself: `softDeleteBrand` must never let a
 *        non-Error escape, which is what made the whole failure invisible.
 */

import { canDeleteBrand } from "../brandDeletePermission";
import {
  BRAND_DELETE_OWNER_ONLY_MESSAGE,
  BRAND_DELETE_UNKNOWN_MESSAGE,
  brandDeleteErrorMessage,
} from "../brandDeleteError";
import {
  isPermissionDeniedError,
  normalizeSupabaseError,
} from "../supabaseErrorMessage";

const OWNER = "3c8c34a8-454b-4d4f-bf9e-87b0c3c8874c";
const ADMIN = "6c61590c-4e8e-4040-bd7c-29870ba6d736";

describe("#1835 T-1 — role must never stand in for the deed", () => {
  it("refuses a caller holding a brand_owner TEAM row on a brand owned by another account", () => {
    // The trap: `Brand.role` is derived from brand_team_members.role, so this
    // shape is reachable after an ownership transfer that left the team row
    // behind. The database checks account_id and would reject.
    const transferredBrand = { accountId: OWNER, role: "owner" as const };
    expect(canDeleteBrand(transferredBrand, ADMIN)).toBe(false);
  });

  it("allows the deed holder even when the team role reads admin", () => {
    const brandWithStaleTeamRow = { accountId: OWNER, role: "admin" as const };
    expect(canDeleteBrand(brandWithStaleTeamRow, OWNER)).toBe(true);
  });
});

describe("#1835 T-2 — identity confusion", () => {
  it("refuses ids that differ only in the final character", () => {
    expect(canDeleteBrand({ accountId: OWNER }, `${OWNER.slice(0, -1)}0`)).toBe(
      false,
    );
  });

  it("refuses a case-flipped uuid (Postgres uuid equality is not what we are emulating here — exact match only)", () => {
    expect(canDeleteBrand({ accountId: OWNER }, OWNER.toUpperCase())).toBe(
      false,
    );
  });

  it("refuses whitespace-only or padded identifiers rather than coercing them", () => {
    expect(canDeleteBrand({ accountId: "   " }, "   ")).toBe(false);
    expect(canDeleteBrand({ accountId: OWNER }, ` ${OWNER} `)).toBe(false);
  });

  it("refuses an empty-string accountId (a falsy value that must not read as a match)", () => {
    expect(canDeleteBrand({ accountId: "" }, "")).toBe(false);
  });
});

describe("#1835 T-3 — hostile error shapes must not crash or misclassify", () => {
  const hostile: unknown[] = [
    null,
    undefined,
    0,
    false,
    "",
    [],
    { message: null },
    { message: 42 },
    { code: 42501 }, // numeric code, not the string PostgREST sends
    Object.create(null) as object,
  ];

  it.each(hostile.map((value, i) => [i, value]))(
    "case %i returns safe copy without throwing",
    (_i, value) => {
      expect(() => brandDeleteErrorMessage(value)).not.toThrow();
      expect(brandDeleteErrorMessage(value)).toBe(BRAND_DELETE_UNKNOWN_MESSAGE);
    },
  );

  it("normalises every hostile shape to a real Error with a non-empty message", () => {
    for (const value of hostile) {
      const normalized = normalizeSupabaseError(value, "fallback");
      expect(normalized instanceof Error).toBe(true);
      expect(typeof normalized.message).toBe("string");
      expect(normalized.message.length).toBeGreaterThan(0);
    }
  });

  it("does not mutate the caller's object", () => {
    const raw = { message: "boom", code: "42501" };
    const snapshot = { ...raw };
    normalizeSupabaseError(raw, "fallback");
    expect(raw).toEqual(snapshot);
  });
});

describe("#1835 T-4 — a code-less RLS rejection is still a refusal", () => {
  it("classifies on the message when the code is absent", () => {
    const codeless = {
      message: 'new row violates row-level security policy for table "brands"',
    };
    expect(isPermissionDeniedError(codeless)).toBe(true);
    expect(brandDeleteErrorMessage(codeless)).toBe(
      BRAND_DELETE_OWNER_ONLY_MESSAGE,
    );
  });

  it("classifies a bare permission-denied message", () => {
    expect(
      brandDeleteErrorMessage(new Error("permission denied for table brands")),
    ).toBe(BRAND_DELETE_OWNER_ONLY_MESSAGE);
  });

  it("does not classify an unrelated failure as a permission problem", () => {
    expect(isPermissionDeniedError({ message: "connection reset" })).toBe(false);
  });
});

describe("#1835 T-5 — nothing non-Error may escape softDeleteBrand", () => {
  const brandId = "1268194d-52bc-4c47-bd04-20e6aeb8c910";

  afterEach(() => {
    jest.resetModules();
  });

  async function loadServiceWithUpdateError(
    updateError: unknown,
  ): Promise<(id: string) => Promise<unknown>> {
    jest.doMock("../../services/supabase", () => ({
      supabase: {
        from: (table: string) => {
          if (table === "events") {
            // Step 1 — blocking-event count: none, so we reach the UPDATE.
            const countChain = {
              select: () => countChain,
              eq: () => countChain,
              in: () => countChain,
              is: () => countChain,
              gt: () => Promise.resolve({ count: 0, error: null }),
            };
            return countChain;
          }
          // Step 2 — the UPDATE that the database refuses.
          const updateChain = {
            update: () => updateChain,
            eq: () => updateChain,
            is: () => updateChain,
            select: () => Promise.resolve({ data: null, error: updateError }),
          };
          return updateChain;
        },
      },
    }));
    const mod = await import("../../services/brandsService");
    return mod.softDeleteBrand as (id: string) => Promise<unknown>;
  }

  it("rethrows the plain PostgREST rejection as a real Error carrying its code", async () => {
    const softDeleteBrand = await loadServiceWithUpdateError({
      code: "42501",
      message: 'new row violates row-level security policy for table "brands"',
      details: null,
      hint: null,
    });

    let caught: unknown;
    try {
      await softDeleteBrand(brandId);
    } catch (error) {
      caught = error;
    }

    // Pre-fix this was a plain object, so every `instanceof Error` consumer
    // downstream silently discarded the reason.
    expect(caught instanceof Error).toBe(true);
    expect((caught as { code?: string }).code).toBe("42501");
    expect(brandDeleteErrorMessage(caught)).toBe(
      BRAND_DELETE_OWNER_ONLY_MESSAGE,
    );
  });

  it("still produces a real Error when the rejection carries no message at all", async () => {
    const softDeleteBrand = await loadServiceWithUpdateError({ code: "XX000" });

    let caught: unknown;
    try {
      await softDeleteBrand(brandId);
    } catch (error) {
      caught = error;
    }

    expect(caught instanceof Error).toBe(true);
    expect((caught as Error).message.length).toBeGreaterThan(0);
  });
});
