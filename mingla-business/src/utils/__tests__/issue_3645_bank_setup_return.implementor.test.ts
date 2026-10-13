/**
 * issue #3645 — one validated return target for bank setup.
 *
 * A host stopped at Publish taps "Connect bank" and must land back on the
 * creator screen they left. The target travels as a route param, so it is
 * untrusted input: this suite pins that only a closed list of creator routes
 * is ever accepted, that the accepted value is REBUILT (never echoed), and that
 * the brand-creation funnel's own return is untouched.
 */

import { describe, expect, test } from "@jest/globals";

import {
  BANK_SETUP_RETURN_PARAM,
  bankSetupRouteWithReturn,
  buildBankSetupReturnPath,
  buildBankSetupWebReturnUrl,
  resolveExperienceWizardInitialStep,
  resolveTripWizardInitialStep,
  sanitizeBankSetupReturnPath,
  withBankSetupReturn,
} from "../bankSetupReturn";
import {
  buildBankConnectWebReturnUrl,
  startStripeWebBankConnect,
} from "../bankConnectFunnel";

const UUID = "3f2b7c1e-9a4d-4e6f-8b21-0c5d7e9a1b23";

describe("#3645 buildBankSetupReturnPath — the four creators", () => {
  test("each creator's edit screen, with and without a step", () => {
    expect(buildBankSetupReturnPath({ kind: "event", id: UUID, step: 7 })).toBe(
      `/event/${UUID}/edit?step=7`,
    );
    expect(buildBankSetupReturnPath({ kind: "rsvp", id: UUID, step: 0 })).toBe(
      `/rsvp/${UUID}/edit?step=0`,
    );
    expect(buildBankSetupReturnPath({ kind: "trip", id: UUID, step: 8 })).toBe(
      `/trip/${UUID}/edit?step=8`,
    );
    expect(buildBankSetupReturnPath({ kind: "experience", id: UUID })).toBe(
      `/experience/${UUID}/edit`,
    );
  });

  test("a client-only draft id (d_…) is a valid id", () => {
    expect(
      buildBankSetupReturnPath({ kind: "event", id: "d_lz4k2p9", step: 3 }),
    ).toBe("/event/d_lz4k2p9/edit?step=3");
  });

  test("preview exists for event and RSVP only, and carries no step", () => {
    expect(
      buildBankSetupReturnPath({ kind: "event", id: UUID, screen: "preview", step: 4 }),
    ).toBe(`/event/${UUID}/preview`);
    expect(
      buildBankSetupReturnPath({ kind: "trip", id: UUID, screen: "preview" }),
    ).toBeNull();
    expect(
      buildBankSetupReturnPath({ kind: "experience", id: UUID, screen: "preview" }),
    ).toBeNull();
  });

  test("an id or step that could smuggle anything is refused or dropped", () => {
    for (const id of ["", "a/b", "../x", "a b", "a?b", "a#b", "a%2Fb", "x".repeat(65)]) {
      expect(buildBankSetupReturnPath({ kind: "event", id })).toBeNull();
    }
    for (const step of [-1, 21, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(buildBankSetupReturnPath({ kind: "event", id: UUID, step })).toBe(
        `/event/${UUID}/edit`,
      );
    }
    expect(
      buildBankSetupReturnPath({
        kind: "venue" as unknown as "event",
        id: UUID,
      }),
    ).toBeNull();
  });
});

describe("#3645 sanitizeBankSetupReturnPath — untrusted route param", () => {
  test("round-trips every path the builder can produce", () => {
    const built = [
      buildBankSetupReturnPath({ kind: "event", id: UUID, step: 7 }),
      buildBankSetupReturnPath({ kind: "rsvp", id: UUID, step: 6 }),
      buildBankSetupReturnPath({ kind: "trip", id: UUID, step: 8 }),
      buildBankSetupReturnPath({ kind: "experience", id: UUID, step: 5 }),
      buildBankSetupReturnPath({ kind: "event", id: UUID, screen: "preview" }),
      buildBankSetupReturnPath({ kind: "rsvp", id: "d_abc123" }),
    ];
    for (const path of built) {
      expect(path).not.toBeNull();
      expect(sanitizeBankSetupReturnPath(path)).toBe(path);
    }
  });

  test("expo-router hands arrays for repeated params: the first is read", () => {
    expect(
      sanitizeBankSetupReturnPath([`/trip/${UUID}/edit?step=8`, "https://evil.example"]),
    ).toBe(`/trip/${UUID}/edit?step=8`);
  });

  test.each([
    ["absolute URL", "https://evil.example/event/x/edit"],
    ["protocol-relative", "//evil.example/event/x/edit"],
    ["scheme", "javascript:alert(1)"],
    ["app scheme", "mingla-business://event/x/edit"],
    ["backslash", "/\\evil.example/event/x/edit"],
    ["encoded slash", `/event/${UUID}%2F..%2F..%2Fbrand/edit`],
    ["path traversal", `/event/../brand/${UUID}/edit`],
    ["fragment", `/event/${UUID}/edit#x`],
    ["unknown route", `/brand/${UUID}/payments`],
    ["unknown screen", `/event/${UUID}/orders`],
    ["checkout route", `/checkout/${UUID}`],
    ["extra segment", `/event/${UUID}/edit/extra`],
    ["no leading slash", `event/${UUID}/edit`],
    ["unknown query key", `/event/${UUID}/edit?mode=edit-published`],
    ["second param", `/event/${UUID}/edit?step=1&next=https://evil.example`],
    ["step out of range", `/event/${UUID}/edit?step=99`],
    ["step not a number", `/event/${UUID}/edit?step=abc`],
    ["empty step", `/event/${UUID}/edit?step=`],
    ["step on preview", `/event/${UUID}/preview?step=1`],
    ["trip preview", `/trip/${UUID}/preview`],
    ["whitespace", `/event/${UUID}/edit `],
    ["newline", `/event/${UUID}/edit\n`],
    ["an email in the query", `/event/${UUID}/edit?email=a@b.co`],
    ["empty", ""],
    ["too long", `/event/${"a".repeat(200)}/edit`],
  ])("refuses %s", (_label, raw) => {
    expect(sanitizeBankSetupReturnPath(raw)).toBeNull();
  });

  test.each([[undefined], [null], [42], [{}], [[]], [[42]]])(
    "refuses a non-string (%p)",
    (raw) => {
      expect(sanitizeBankSetupReturnPath(raw)).toBeNull();
    },
  );
});

describe("#3645 withBankSetupReturn / bankSetupRouteWithReturn", () => {
  test("appends the encoded target under the one param name", () => {
    const route = bankSetupRouteWithReturn("brand-1", {
      kind: "trip",
      id: UUID,
      step: 8,
    });
    expect(route).toBe(
      `/brand/brand-1/payments/onboard?${BANK_SETUP_RETURN_PARAM}=${encodeURIComponent(
        `/trip/${UUID}/edit?step=8`,
      )}`,
    );
    // What the route reads back out is the same path.
    const value = decodeURIComponent(route.split(`${BANK_SETUP_RETURN_PARAM}=`)[1]);
    expect(sanitizeBankSetupReturnPath(value)).toBe(`/trip/${UUID}/edit?step=8`);
  });

  test("joins with & when the route already has a query", () => {
    expect(
      withBankSetupReturn("/brand/b/connect?provider=card", `/rsvp/${UUID}/edit?step=6`),
    ).toBe(
      `/brand/b/connect?provider=card&resume=${encodeURIComponent(`/rsvp/${UUID}/edit?step=6`)}`,
    );
  });

  test("an unusable target leaves the route exactly as it was", () => {
    expect(withBankSetupReturn("/brand/b/payments/onboard", null)).toBe(
      "/brand/b/payments/onboard",
    );
    expect(
      withBankSetupReturn("/brand/b/payments/onboard", "https://evil.example"),
    ).toBe("/brand/b/payments/onboard");
    expect(bankSetupRouteWithReturn("b", null)).toBe("/brand/b/payments/onboard");
    expect(bankSetupRouteWithReturn("b", { kind: "event", id: "a/b" })).toBe(
      "/brand/b/payments/onboard",
    );
  });
});

describe("#3645 buildBankSetupWebReturnUrl — hosted setup's way back", () => {
  test("joins a sanitised path onto the page's own HTTPS origin", () => {
    expect(
      buildBankSetupWebReturnUrl("https://host.usemingla.com", `/event/${UUID}/edit?step=7`),
    ).toBe(`https://host.usemingla.com/event/${UUID}/edit?step=7`);
  });

  test("never leaves the origin and never returns over plain HTTP", () => {
    expect(
      buildBankSetupWebReturnUrl("https://host.usemingla.com", "//evil.example/x"),
    ).toBeNull();
    expect(
      buildBankSetupWebReturnUrl("https://host.usemingla.com", "https://evil.example/event/x/edit"),
    ).toBeNull();
    expect(
      buildBankSetupWebReturnUrl("http://host.usemingla.com", `/event/${UUID}/edit`),
    ).toBeNull();
    expect(buildBankSetupWebReturnUrl("not a url", `/event/${UUID}/edit`)).toBeNull();
    expect(buildBankSetupWebReturnUrl("https://host.usemingla.com", null)).toBeNull();
  });
});

describe("#3645 buildBankConnectWebReturnUrl — creator return vs the two existing ones", () => {
  const ORIGIN = "https://host.usemingla.com";

  test("no return path: the payments page, exactly as before", () => {
    expect(buildBankConnectWebReturnUrl(ORIGIN, "brand-1")).toBe(
      `${ORIGIN}/brand/brand-1/payments`,
    );
    expect(buildBankConnectWebReturnUrl(ORIGIN, "brand-1", "payments", null)).toBe(
      `${ORIGIN}/brand/brand-1/payments`,
    );
  });

  test("a valid creator path replaces the payments page", () => {
    expect(
      buildBankConnectWebReturnUrl(ORIGIN, "brand-1", "payments", `/rsvp/${UUID}/edit?step=6`),
    ).toBe(`${ORIGIN}/rsvp/${UUID}/edit?step=6`);
  });

  test("a hostile path falls back to the payments page", () => {
    expect(
      buildBankConnectWebReturnUrl(ORIGIN, "brand-1", "payments", "//evil.example"),
    ).toBe(`${ORIGIN}/brand/brand-1/payments`);
  });

  test("the brand-creation funnel keeps its own return even when a path is passed", () => {
    expect(buildBankConnectWebReturnUrl(ORIGIN, "brand-1", "brand-create")).toBe(
      `${ORIGIN}/brand/new?resume_brand=brand-1`,
    );
    expect(
      buildBankConnectWebReturnUrl(ORIGIN, "brand-1", "brand-create", `/event/${UUID}/edit`),
    ).toBe(`${ORIGIN}/brand/new?resume_brand=brand-1`);
  });

  test("startStripeWebBankConnect mints with the creator return URL", async () => {
    const minted: string[] = [];
    await startStripeWebBankConnect({
      brandId: "brand-1",
      userId: "user-1",
      country: "US",
      origin: ORIGIN,
      tosVersion: "1.0",
      acceptTerms: async () => undefined,
      mintOnboarding: async (input) => {
        minted.push(input.returnUrl);
        return { onboarding_url: `${ORIGIN}/connect-onboarding?session=s_1` };
      },
      assign: () => undefined,
      returnPath: `/experience/${UUID}/edit?step=7`,
    });
    expect(minted).toEqual([`${ORIGIN}/experience/${UUID}/edit?step=7`]);
  });

  test("startStripeWebBankConnect without a return path is unchanged", async () => {
    const minted: string[] = [];
    await startStripeWebBankConnect({
      brandId: "brand-1",
      userId: "user-1",
      country: "US",
      origin: ORIGIN,
      tosVersion: "1.0",
      acceptTerms: async () => undefined,
      mintOnboarding: async (input) => {
        minted.push(input.returnUrl);
        return { onboarding_url: `${ORIGIN}/connect-onboarding?session=s_1` };
      },
      assign: () => undefined,
    });
    expect(minted).toEqual([`${ORIGIN}/brand/brand-1/payments`]);
  });
});

// ---------------------------------------------------------------------------
// Which step a creator may open on after a full-page return.
// ---------------------------------------------------------------------------
describe("#3645 resolveTripWizardInitialStep", () => {
  test("Review (8) and the six authoring steps open directly", () => {
    for (const step of [1, 2, 3, 4, 5, 6, 8]) {
      expect(resolveTripWizardInitialStep(step)).toBe(step);
    }
  });

  test("the Invite step (7) and anything unknown start at step 1", () => {
    for (const step of [7, 0, 9, -1, 2.5, Number.NaN, undefined]) {
      expect(resolveTripWizardInitialStep(step)).toBe(1);
    }
  });
});

describe("#3645 resolveExperienceWizardInitialStep", () => {
  test("steps 1-5 open directly", () => {
    for (const step of [1, 2, 3, 4, 5] as const) {
      expect(resolveExperienceWizardInitialStep(step)).toEqual({
        start: step,
        resumeReview: false,
      });
    }
  });

  test("Review (7) opens on Cover and resumes Review once invites are known", () => {
    expect(resolveExperienceWizardInitialStep(7)).toEqual({
      start: 5,
      resumeReview: true,
    });
  });

  test("the Invite step (6) and anything unknown start at step 1", () => {
    for (const step of [6, 0, 8, -3, 1.5, Number.NaN, undefined]) {
      expect(resolveExperienceWizardInitialStep(step)).toEqual({
        start: 1,
        resumeReview: false,
      });
    }
  });
});
