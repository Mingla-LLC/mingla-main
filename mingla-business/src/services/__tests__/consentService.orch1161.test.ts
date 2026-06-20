/**
 * META-ORCH-1161 Sub-A.2 (consent-capture slice) — happy-path regression test.
 *
 * The implementor-owned happy path proves the load-bearing legal contract:
 *   1. A checkout consent grant sends the EXACT §1b disclosure string VERBATIM
 *      (the legal burden-of-proof artifact, DEC-186 / SPEC §8.1) to the shared
 *      `record-consent` edge fn, with source='checkout' + both contacts + the
 *      pinned disclosure version.
 *   2. The Pay/Continue button is DISABLED until the bundled consent box is
 *      checked AND fields are valid (DESIGN §S3.4 — never proceed unconsented).
 *
 * fails-on-revert:
 *   - delete the `disclosureText: input.disclosureText` line in consentService →
 *     the verbatim assertion fails.
 *   - delete the `!params.termsAccepted` term in isContinueDisabled
 *     (checkoutConsentGate.ts) → the "disabled until checked" assertion fails.
 */

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

import { recordConsent } from "../consentService";
import { supabase } from "../supabase";
import {
  CONSENT_DISCLOSURE_TEXT,
  DISCLOSURE_VERSION,
} from "../../constants/consentDisclosure";
import { isContinueDisabled } from "../../components/checkout/checkoutConsentGate";

jest.mock("../supabase", () => ({
  supabase: {
    functions: {
      invoke: jest.fn(),
    },
  },
}));

const invokeMock = supabase.functions.invoke as unknown as jest.Mock<
  (...args: unknown[]) => Promise<{ data: unknown; error: unknown }>
>;

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue({
    data: { ok: true, inserted: 4, deduped: 0 },
    error: null,
  });
});

describe("META-ORCH-1161 Sub-A.2 — consent capture (checkout)", () => {
  test("records the EXACT §1b disclosure VERBATIM with source='checkout' + both contacts", async () => {
    const result = await recordConsent({
      source: "checkout",
      disclosureText: CONSENT_DISCLOSURE_TEXT,
      disclosureVersion: DISCLOSURE_VERSION,
      phone: "+14155550123",
      email: "Buyer@Example.com",
      countryCode: "US",
      userId: null,
    });

    expect(result.ok).toBe(true);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [fnName, opts] = invokeMock.mock.calls[0] as [
      string,
      { body: Record<string, unknown> },
    ];
    expect(fnName).toBe("record-consent");
    // The disclosure string is the legal artifact — it must pass through VERBATIM,
    // not paraphrased or truncated.
    expect(opts.body.disclosureText).toBe(CONSENT_DISCLOSURE_TEXT);
    // Sanity: the verbatim string carries the TCPA-mitigating sentence + STOP/HELP.
    expect(opts.body.disclosureText).toContain(
      "Consent to texts is not a condition of any purchase.",
    );
    expect(opts.body.disclosureText).toContain("Msg & data rates may apply.");
    expect(opts.body.source).toBe("checkout");
    expect(opts.body.phone).toBe("+14155550123");
    expect(opts.body.email).toBe("Buyer@Example.com");
    expect(opts.body.countryCode).toBe("US");
    expect(opts.body.disclosureVersion).toBe(DISCLOSURE_VERSION);
  });

  test("returns ok=false (does NOT throw) when the edge fn errors — checkout must not deadlock", async () => {
    invokeMock.mockResolvedValueOnce({
      data: null,
      error: { message: "boom" },
    });
    const result = await recordConsent({
      source: "checkout",
      disclosureText: CONSENT_DISCLOSURE_TEXT,
      disclosureVersion: DISCLOSURE_VERSION,
      phone: "+14155550123",
      email: "buyer@example.com",
      countryCode: "US",
    });
    expect(result.ok).toBe(false);
  });

  test("Pay/Continue is DISABLED until the bundled consent box is checked", () => {
    // Fields valid, box UNCHECKED → disabled (the gate).
    expect(
      isContinueDisabled({
        fieldsValid: true,
        termsAccepted: false,
        submitting: false,
      }),
    ).toBe(true);

    // Fields valid, box CHECKED → enabled.
    expect(
      isContinueDisabled({
        fieldsValid: true,
        termsAccepted: true,
        submitting: false,
      }),
    ).toBe(false);

    // Box checked but fields invalid → still disabled.
    expect(
      isContinueDisabled({
        fieldsValid: false,
        termsAccepted: true,
        submitting: false,
      }),
    ).toBe(true);

    // Submitting always disables (no double-submit).
    expect(
      isContinueDisabled({
        fieldsValid: true,
        termsAccepted: true,
        submitting: true,
      }),
    ).toBe(true);
  });
});
