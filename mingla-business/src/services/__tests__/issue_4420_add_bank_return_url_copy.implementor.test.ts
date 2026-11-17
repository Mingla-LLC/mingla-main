/**
 * #4420 — "Add your bank" showed the raw `validation_error:
 * return_url_invalid_scheme`. `brand-stripe-onboard` refuses a return address
 * that is not on the Host web address it is configured for; the service turned
 * that body into `error: detail` text, which the screen rendered as-is.
 *
 * Drives the REAL `startBrandStripeOnboarding` with the genuine
 * FunctionsHttpError shape. Only the transport and the analytics side effect
 * are mocked.
 *
 * FAILS-ON-REVERT: restore src/services/brandStripeService.ts from origin/main
 * and RU-1 / RU-2 go red.
 */

const mockInvoke = jest.fn();

jest.mock("../supabase", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
  },
}));
jest.mock("../appsFlyerService", () => ({ logAppsFlyerEvent: jest.fn() }));

import {
  startBrandStripeOnboarding,
  UNTRUSTED_WEB_ADDRESS_MESSAGE,
} from "../brandStripeService";

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

const startWith = async (payload: unknown, status = 400): Promise<Error> => {
  mockInvoke.mockResolvedValueOnce({ data: null, error: functionsHttpError(status, payload) });
  try {
    await startBrandStripeOnboarding("8c1a3a64-0b1c-4b8e-9a40-5f2b1c3d4e5f", "http://localhost:8197/brand/x/payments", "GB");
  } catch (err) {
    return err as Error;
  }
  throw new Error("expected startBrandStripeOnboarding to throw");
};

beforeEach(() => mockInvoke.mockReset());

describe("#4420 Add your bank never shows a raw return-address code", () => {
  test("RU-1 return_url_invalid_scheme reads as host copy", async () => {
    const err = await startWith({ error: "validation_error", detail: "return_url_invalid_scheme" });
    expect(err.message).toBe(UNTRUSTED_WEB_ADDRESS_MESSAGE);
    expect(err.message).not.toMatch(/validation_error|return_url|_/);
  });

  test("RU-2 an unrecognised web-address override reads the same way", async () => {
    const err = await startWith({
      error: "validation_error",
      detail: "business_web_origin_override_unrecognized",
    });
    expect(err.message).toBe(UNTRUSTED_WEB_ADDRESS_MESSAGE);
  });

  test("RU-3 other validation details keep their existing message", async () => {
    const err = await startWith({ error: "validation_error", detail: "brand_id_invalid_uuid" });
    expect(err.message).toBe("validation_error: brand_id_invalid_uuid");
  });
});
