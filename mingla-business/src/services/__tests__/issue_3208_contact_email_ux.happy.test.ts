/**
 * #3208 — implementor happy-path suite.
 *
 * The four behaviours the issue asks for, each through SHIPPED code:
 *   1. Brand Edit's contact-email rule (the validator the Save handler calls).
 *   2. `brand-stripe-onboard`'s 422 `organiser_email_required` reaches the UI
 *      as a typed error with honest copy — via the REAL service and the REAL
 *      FunctionsHttpError shape, not a hand-built Error.
 *   3. That real error is classified `email-required`, not `failed-network`.
 *   4. The partner service turns the same 422 into honest inline copy.
 *
 * Runs under the default node/ts-jest config: no render, no RTL. The only
 * mocks are the transport (`services/supabase`) and the analytics side effect
 * that pulls `react-native` at import time — mocking anything else would make
 * this suite assert on its own fixtures.
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

import {
  BRAND_CONTACT_EMAIL_INVALID,
  validateBrandContactEmail,
} from "../../utils/brandContactEmail";
import { classifyBrandOnboardingStartError } from "../../utils/brandStripeUiState";
import {
  BRAND_EMAIL_REQUIRED_SUB,
  OrganiserEmailRequiredError,
  PARTNER_EMAIL_REQUIRED_MESSAGE,
} from "../../utils/edgeFunctionErrors";
import { startBrandStripeOnboarding } from "../brandStripeService";
import { startPartnerOnboarding } from "../partnerStripeService";

/** The genuine `FunctionsHttpError` shape `supabase.functions.invoke` returns. */
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

/** Exactly what `brand-stripe-onboard` / `partner-stripe-onboard` return. */
const EMAIL_REQUIRED_PAYLOAD = {
  error: "organiser_email_required",
  detail:
    "No valid organiser email: the brand's contact email is not a well-formed address and the session carries no verified email.",
};

/** The value actually stored on Lantern Room in production on 2026-09-11. */
const PRODUCTION_BAD_EMAIL = "61 Wythe Ave, Brooklyn, NY 11249";

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("#3208 — Brand Edit contact-email rule", () => {
  it("lets an optional blank field save", () => {
    expect(validateBrandContactEmail(undefined)).toBeNull();
    expect(validateBrandContactEmail(null)).toBeNull();
    expect(validateBrandContactEmail("")).toBeNull();
    expect(validateBrandContactEmail("   ")).toBeNull();
  });

  it("lets a real address save", () => {
    expect(validateBrandContactEmail("seth@usemingla.com")).toBeNull();
  });

  it("refuses the production street address with copy that names both ways out", () => {
    expect(validateBrandContactEmail(PRODUCTION_BAD_EMAIL)).toBe(
      BRAND_CONTACT_EMAIL_INVALID,
    );
    expect(BRAND_CONTACT_EMAIL_INVALID).toMatch(/fix it/i);
    expect(BRAND_CONTACT_EMAIL_INVALID).toMatch(/clear it/i);
  });
});

describe("#3208 — brand set-up-payments: no usable email", () => {
  it("the real service turns the 422 into a typed, brand-surface error", async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: functionsHttpError(422, EMAIL_REQUIRED_PAYLOAD),
    });
    const thrown = await startBrandStripeOnboarding(
      "e005238f-5410-4df1-9250-ee32a72445bd",
      "mingla-business://onboarding-complete",
      "US",
    ).catch((e: unknown) => e);

    expect(thrown).toBeInstanceOf(OrganiserEmailRequiredError);
    expect((thrown as OrganiserEmailRequiredError).surface).toBe("brand");
    expect((thrown as OrganiserEmailRequiredError).message).toBe(
      BRAND_EMAIL_REQUIRED_SUB,
    );
  });

  it("that real error is classified email-required — never failed-network", async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: functionsHttpError(422, EMAIL_REQUIRED_PAYLOAD),
    });
    const thrown = await startBrandStripeOnboarding(
      "e005238f-5410-4df1-9250-ee32a72445bd",
      "mingla-business://onboarding-complete",
      "US",
    ).catch((e: unknown) => e);

    expect(classifyBrandOnboardingStartError(thrown)).toBe("email-required");
  });
});

describe("#3208 — partner set-up-payments: no usable email", () => {
  it("the real partner service throws honest inline copy instead of the transport message", async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: functionsHttpError(422, EMAIL_REQUIRED_PAYLOAD),
    });
    const thrown = await startPartnerOnboarding({
      country: "US",
      returnUrl: "mingla-business://partner-onboarding-complete",
    }).catch((e: unknown) => e);

    expect(thrown).toBeInstanceOf(OrganiserEmailRequiredError);
    expect((thrown as OrganiserEmailRequiredError).surface).toBe("partner");
    // `app/partner/earnings.tsx` renders `error.message` verbatim, so the
    // message IS what the partner reads.
    expect((thrown as Error).message).toBe(PARTNER_EMAIL_REQUIRED_MESSAGE);
    expect((thrown as Error).message).not.toMatch(/non-2xx/i);
  });
});
