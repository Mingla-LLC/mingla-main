/**
 * #3208 — adversarial suite. A DIFFERENT angle from the happy path on purpose:
 * it does not re-prove the headline behaviours, it attacks the ways they would
 * quietly break.
 *
 *   A. ORDERING — the brand copy legitimately says "Stripe", so the new branch
 *      must be decided BEFORE the "contains 'stripe'" heuristic. Moving it one
 *      line down would show "Stripe couldn't verify" and pass every happy test
 *      that only checks the typed error.
 *   B. NEIGHBOURS — the classifier replaced a live catch block; country-locked,
 *      permission-denied, Stripe and network failures must classify exactly as
 *      before, using the REAL error classes.
 *   C. EXACTNESS — an unrelated code that merely starts the same way must not
 *      be swallowed as "no email".
 *   D. NARROWNESS — the partner service change must leave every OTHER partner
 *      failure's message exactly as it was.
 *   E. CONTRACT DRIFT — the client recognises the code the SERVER actually
 *      emits, and all three email validators (sign-in, Brand Edit, edge) agree
 *      byte for byte and on a hostile corpus.
 *   F. HONESTY — no copy on this path blames the connection or offers a retry.
 *
 * Mocks: transport + analytics only, as in the happy suite.
 */

const mockInvoke = jest.fn();

jest.mock("../supabase", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
  },
}));

jest.mock("../appsFlyerService", () => ({
  logAppsFlyerEvent: jest.fn(),
}));

import * as fs from "fs";
import * as path from "path";

import {
  BRAND_CONTACT_EMAIL_RE,
  validateBrandContactEmail,
} from "../../utils/brandContactEmail";
import { classifyBrandOnboardingStartError } from "../../utils/brandStripeUiState";
import {
  BRAND_EMAIL_REQUIRED_SUB,
  BRAND_EMAIL_REQUIRED_TITLE,
  EdgeFunctionPermissionDeniedError,
  isOrganiserEmailRequiredError,
  ORGANISER_EMAIL_REQUIRED_CODE,
  OrganiserEmailRequiredError,
  PARTNER_EMAIL_REQUIRED_MESSAGE,
} from "../../utils/edgeFunctionErrors";
import {
  BrandStripeCountryLockedError,
  startBrandStripeOnboarding,
} from "../brandStripeService";
import { startPartnerOnboarding } from "../partnerStripeService";
import {
  isWellFormedEmail,
  MissingOrganiserEmailError,
  ORGANISER_EMAIL_RE,
} from "../../../../supabase/functions/_shared/organiserContactEmail";

function functionsHttpError(status: number, payload: unknown): Error {
  const err = new Error("Edge Function returned a non-2xx status code");
  err.name = "FunctionsHttpError";
  (err as Error & { context: unknown }).context = {
    status,
    clone: () => ({
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    }),
  };
  return err;
}

async function brandStartFailure(status: number, payload: unknown): Promise<unknown> {
  mockInvoke.mockResolvedValue({ data: null, error: functionsHttpError(status, payload) });
  return startBrandStripeOnboarding(
    "00000000-0000-0000-0000-000000003208",
    "mingla-business://onboarding-complete",
    "GB",
  ).catch((e: unknown) => e);
}

async function partnerStartFailure(status: number, payload: unknown): Promise<unknown> {
  mockInvoke.mockResolvedValue({ data: null, error: functionsHttpError(status, payload) });
  return startPartnerOnboarding({
    country: "GB",
    returnUrl: "mingla-business://partner-onboarding-complete",
  }).catch((e: unknown) => e);
}

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("A. ordering — email-required is decided before the 'stripe' heuristic", () => {
  it("the brand copy really does contain 'stripe', so the trap is live", () => {
    expect(BRAND_EMAIL_REQUIRED_SUB.toLowerCase()).toContain("stripe");
  });

  it("yet the typed error still classifies email-required, not failed-stripe", () => {
    expect(classifyBrandOnboardingStartError(new OrganiserEmailRequiredError("brand")))
      .toBe("email-required");
  });
});

describe("B. neighbours classify exactly as before, using the real error classes", () => {
  it("country locked", () => {
    const err = new BrandStripeCountryLockedError({
      existingCountry: "GB",
      requestedCountry: "US",
    });
    expect(classifyBrandOnboardingStartError(err)).toBe("country-locked");
  });

  it("country locked arriving through the real service", async () => {
    const thrown = await brandStartFailure(400, {
      error: "country_locked",
      existing_country: "GB",
      requested_country: "US",
    });
    expect(thrown).toBeInstanceOf(BrandStripeCountryLockedError);
    expect(classifyBrandOnboardingStartError(thrown)).toBe("country-locked");
  });

  it("permission denied (#1863) — including through the real service", async () => {
    expect(
      classifyBrandOnboardingStartError(
        new EdgeFunctionPermissionDeniedError("brand-stripe-onboard", "permission_denied"),
      ),
    ).toBe("permission-denied");
    const thrown = await brandStartFailure(403, {
      error: "forbidden",
      detail: "permission_denied",
    });
    expect(classifyBrandOnboardingStartError(thrown)).toBe("permission-denied");
  });

  it("a genuine Stripe rejection — the original #3191 message", async () => {
    const thrown = await brandStartFailure(502, {
      error: "stripe_api_error",
      detail: "Invalid email",
    });
    expect(thrown).not.toBeInstanceOf(OrganiserEmailRequiredError);
    expect(classifyBrandOnboardingStartError(thrown)).toBe("failed-stripe");
  });

  it("a real transport failure stays failed-network", () => {
    expect(classifyBrandOnboardingStartError(new Error("Network request failed")))
      .toBe("failed-network");
    expect(classifyBrandOnboardingStartError("timeout")).toBe("failed-network");
  });

  it("an unrelated 500 stays failed-network", async () => {
    const thrown = await brandStartFailure(500, { error: "internal_error" });
    expect(classifyBrandOnboardingStartError(thrown)).toBe("failed-network");
  });
});

describe("C. exactness — look-alike codes are not swallowed", () => {
  it("a code that only starts the same way is NOT email-required", async () => {
    const thrown = await brandStartFailure(422, {
      error: "organiser_email_required_v2",
      detail: "something else entirely",
    });
    expect(thrown).not.toBeInstanceOf(OrganiserEmailRequiredError);
    expect(classifyBrandOnboardingStartError(thrown)).not.toBe("email-required");
  });

  it("the predicate matches only the exact code", () => {
    expect(isOrganiserEmailRequiredError({ code: "organiser_email" })).toBe(false);
    expect(isOrganiserEmailRequiredError({ error: "organiser_email_required_v2" })).toBe(false);
    expect(isOrganiserEmailRequiredError(null)).toBe(false);
    expect(isOrganiserEmailRequiredError("organiser_email_required")).toBe(false);
  });

  it("an untyped carrier of the exact code is still recognised (bypass-proof)", () => {
    expect(isOrganiserEmailRequiredError({ error: ORGANISER_EMAIL_REQUIRED_CODE })).toBe(true);
    const bare = Object.assign(new Error("x"), { code: ORGANISER_EMAIL_REQUIRED_CODE });
    expect(classifyBrandOnboardingStartError(bare)).toBe("email-required");
  });
});

describe("D. narrowness — every other partner failure is untouched", () => {
  it("a partner Stripe failure keeps its original message", async () => {
    const thrown = await partnerStartFailure(502, {
      error: "stripe_api_error",
      detail: "Invalid email",
    });
    expect(thrown).not.toBeInstanceOf(OrganiserEmailRequiredError);
    expect((thrown as Error).message).toBe(
      "Edge Function returned a non-2xx status code",
    );
  });

  it("a partner permission denial keeps its original message", async () => {
    const thrown = await partnerStartFailure(403, {
      error: "forbidden",
      detail: "permission_denied",
    });
    expect(thrown).not.toBeInstanceOf(OrganiserEmailRequiredError);
    expect((thrown as Error).message).toBe(
      "Edge Function returned a non-2xx status code",
    );
  });
});

describe("E. contract drift — server, client and all three validators agree", () => {
  it("the client recognises the code the SERVER actually emits", () => {
    // If the edge function ever renames its code, the client would silently
    // stop recognising it and #3208 would regress to "check your connection".
    expect(new MissingOrganiserEmailError().code).toBe(ORGANISER_EMAIL_REQUIRED_CODE);
  });

  it("sign-in, Brand Edit and the edge function share one pattern, byte for byte", () => {
    const authSource = fs.readFileSync(
      path.join(__dirname, "../../context/AuthContext.tsx"),
      "utf8",
    );
    const literal = authSource.match(/const emailRegex = \/(.+)\/;/);
    expect(literal).not.toBeNull();
    const signIn = (literal as RegExpMatchArray)[1];
    expect(BRAND_CONTACT_EMAIL_RE.source).toBe(signIn);
    expect(ORGANISER_EMAIL_RE.source).toBe(signIn);
  });

  it("Brand Edit and the edge function agree on a hostile corpus, trim included", () => {
    const corpus: unknown[] = [
      "seth@usemingla.com",
      "  seth@usemingla.com  ",
      "o'brien+tag@sub.example.co.uk",
      "61 Wythe Ave, Brooklyn, NY 11249",
      "a@b",
      "a b@c.co",
      "@b.co",
      "seth@usemingla",
      "seth@@usemingla.com",
      "\tseth@usemingla.com\n",
    ];
    for (const value of corpus) {
      const brandEditAccepts = validateBrandContactEmail(value) === null;
      expect({ value, accepts: brandEditAccepts }).toEqual({
        value,
        accepts: isWellFormedEmail(value),
      });
    }
  });

  it("a non-string never slips through as 'blank'", () => {
    expect(validateBrandContactEmail(123)).not.toBeNull();
    expect(validateBrandContactEmail({ email: "a@b.co" })).not.toBeNull();
  });
});

describe("F. honesty — nothing on this path blames the connection or offers a retry", () => {
  const LIES = [/connection/i, /network/i, /try again in a moment/i, /couldn't reach/i, /couldn.t verify/i];

  it.each([
    ["brand title", BRAND_EMAIL_REQUIRED_TITLE],
    ["brand sub", BRAND_EMAIL_REQUIRED_SUB],
    ["partner message", PARTNER_EMAIL_REQUIRED_MESSAGE],
  ])("%s", (_label, copy) => {
    for (const lie of LIES) expect(copy).not.toMatch(lie);
  });

  it("the partner copy gives the only real way out", () => {
    expect(PARTNER_EMAIL_REQUIRED_MESSAGE).toContain("support@usemingla.com");
  });
});
