/* eslint-disable @typescript-eslint/no-require-imports, import/first -- jest doubles are declared before the modules they replace */
/**
 * #4541 R2.10 (T-33) — the app checkout sends the host's questions the way the
 * server's capability rule (C1) expects, and every refusal is explained.
 *
 *   - The create body carries `brandFormStep: 1` (and `brandForm` only with
 *     answers); a cart whose questions read failed sends neither.
 *   - Each refusal in the R2.10 table maps to its own copy, says nothing was
 *     charged, and is handed to the cart's questions block (answers stay).
 *   - The block's state: required holds the button, optional never does, a
 *     failed read holds it, answeredHere sends the marker and no answers.
 *
 * Red on revert of the `brandFormStep` line in nativeCheckoutFlow's body
 * builder, the refusal report, or the mapper rows in checkoutErrorMessages.
 * Runs under app-mobile/jest.issue2774.render.cjs.
 */
const mockInvoke = jest.fn();

jest.mock("../../services/supabase", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
  },
}));
jest.mock("expo-web-browser", () => ({
  openBrowserAsync: jest.fn(),
  openAuthSessionAsync: jest.fn(),
  WebBrowserResultType: { LOCKED: "locked" },
}));
jest.mock("@mingla/payments-native", () => ({
  useStripePaymentSheet: () => ({
    initPaymentSheet: jest.fn(),
    presentPaymentSheet: jest.fn(),
    isPaymentSheetSupported: true,
  }),
}));
jest.mock("@stripe/stripe-react-native", () => ({ initStripe: jest.fn() }));
// The block's file is imported for its pure state function only.
jest.mock("../../components/forms/RsvpFormWebDateInput", () => ({ RsvpFormWebDateInput: () => null }), { virtual: true });
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"));
jest.mock("../../store/appStore", () => ({
  useAppStore: (select: (s: { user: null }) => unknown) => select({ user: null }),
}));

import { clearAllHeldHandoffs, useNativeCheckoutFlow } from "../nativeCheckoutFlow";
import {
  CHECKOUT_FORM_ANSWERS_INVALID_MESSAGE,
  CHECKOUT_FORM_ANSWERS_REQUIRED_MESSAGE,
  CHECKOUT_FORM_CHANGED_MESSAGE,
  CHECKOUT_FORM_CHECK_FAILED_MESSAGE,
  CHECKOUT_FORM_STASH_FAILED_MESSAGE,
  CHECKOUT_UPDATE_APP_MESSAGE,
  nativeCheckoutErrorMessage,
} from "../checkoutErrorMessages";
import {
  checkoutFormRefusalCode,
  clearCheckoutFormRefusal,
  forgetCheckoutAnswers,
  keepCheckoutAnswers,
  readCheckoutAnswers,
  readCheckoutFormRefusal,
} from "../../components/forms/checkoutFormRefusal";
import { checkoutQuestionsState } from "../../components/forms/CheckoutQuestionsBlock";
import type { CheckoutBrandForm } from "../../services/brandFormService";

const EVENT = "11111111-1111-4111-8111-111111111111";
const STANDARD = "22222222-2222-4222-8222-222222222222";
const FORM = "45410000-0000-4000-8000-000000000001";
const VERSION = "45410000-0000-4000-8000-000000000002";
const Q1 = "45410000-0000-4000-8000-0000000000a1";

const buyer = { name: "Buyer", email: "buyer@example.test", phone: "+15555550123" };
const baseInput = {
  checkoutContractVersion: 2 as const,
  purchaseTermsAccepted: true,
  eventId: EVENT,
  buyer,
  lines: [{ ticketTypeId: STANDARD, quantity: 1, paymentPlanChoice: "full" as const }],
};

/** A refused create: supabase-js puts the Response on `error.context`. */
function refusal(status: number, body: Record<string, unknown>) {
  return {
    data: null,
    error: {
      context: {
        status,
        text: async () => JSON.stringify(body),
      },
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  clearAllHeldHandoffs();
  clearCheckoutFormRefusal(EVENT);
  mockInvoke.mockResolvedValue(refusal(409, { error: "checkout_in_progress" }));
});

describe("#4541 T-33 — the create body", () => {
  it("sends the capability marker and the answers", async () => {
    await useNativeCheckoutFlow()({
      ...baseInput,
      brandFormStep: 1,
      brandForm: { formId: FORM, versionId: VERSION, answers: { [Q1]: "Vegan" } },
    });
    const body = mockInvoke.mock.calls[0][1].body;
    expect(mockInvoke.mock.calls[0][0]).toBe("ticket-checkout-create");
    expect(body.brandFormStep).toBe(1);
    expect(body.brandForm).toEqual({ formId: FORM, versionId: VERSION, answers: { [Q1]: "Vegan" } });
  });

  it("sends the marker alone when there are no answers (no form, optional skipped, answered here)", async () => {
    await useNativeCheckoutFlow()({ ...baseInput, brandFormStep: 1 });
    const body = mockInvoke.mock.calls[0][1].body;
    expect(body.brandFormStep).toBe(1);
    expect(body).not.toHaveProperty("brandForm");
  });

  it("sends neither when the questions read failed (the order completes 'to answer')", async () => {
    await useNativeCheckoutFlow()({ ...baseInput });
    const body = mockInvoke.mock.calls[0][1].body;
    expect(body).not.toHaveProperty("brandFormStep");
    expect(body).not.toHaveProperty("brandForm");
  });
});

describe("#4541 T-33 — refusals keep the answers and say nothing was charged", () => {
  const rows: [string, number, Record<string, unknown>, string][] = [
    ["form_answers_required", 422, { error: "form_answers_required" }, CHECKOUT_FORM_ANSWERS_REQUIRED_MESSAGE],
    ["form_answers_invalid", 422, { error: "form_answers_invalid", errors: [{ questionId: Q1, code: "too_long" }] }, CHECKOUT_FORM_ANSWERS_INVALID_MESSAGE],
    ["form_changed", 409, { error: "form_changed" }, CHECKOUT_FORM_CHANGED_MESSAGE],
    ["brand_form_check_failed", 409, { error: "brand_form_check_failed" }, CHECKOUT_FORM_CHECK_FAILED_MESSAGE],
    ["brand_form_stash_failed", 409, { error: "brand_form_stash_failed" }, CHECKOUT_FORM_STASH_FAILED_MESSAGE],
  ];

  it.each(rows)("%s maps to its own copy and reaches the questions block", async (code, status, body, copy) => {
    mockInvoke.mockResolvedValueOnce(refusal(status, body));
    const result = await useNativeCheckoutFlow()({ ...baseInput, brandFormStep: 1 });
    expect(result.outcome).toBe("failed");
    expect(result.outcome === "failed" ? result.message : "").toBe(copy);
    expect(copy).toMatch(/not been charged/i);
    const seen = readCheckoutFormRefusal(EVENT);
    expect(seen?.code).toBe(code);
    if (code === "form_answers_invalid") expect(seen?.errors).toEqual({ [Q1]: "too_long" });
  });

  it("brand_form_step_invalid asks for an app update and is reported", async () => {
    mockInvoke.mockResolvedValueOnce(refusal(400, { error: "invalid_request", detail: "brand_form_step_invalid" }));
    const result = await useNativeCheckoutFlow()({ ...baseInput, brandFormStep: 1 });
    expect(result.outcome === "failed" ? result.message : "").toBe(CHECKOUT_UPDATE_APP_MESSAGE);
    expect(readCheckoutFormRefusal(EVENT)?.code).toBe("brand_form_step_invalid");
  });

  it("other refusals are not form refusals", async () => {
    await useNativeCheckoutFlow()({ ...baseInput, brandFormStep: 1 });
    expect(readCheckoutFormRefusal(EVENT)).toBeNull();
    expect(checkoutFormRefusalCode("checkout_in_progress", null)).toBeNull();
  });

  it("a booking clears this event's typed answers and refusal (other events keep theirs)", async () => {
    const OTHER = "33333333-3333-4333-8333-333333333333";
    mockInvoke.mockResolvedValueOnce(refusal(409, { error: "form_changed" }));
    await useNativeCheckoutFlow()({ ...baseInput, brandFormStep: 1 });
    expect(readCheckoutFormRefusal(EVENT)?.code).toBe("form_changed");
    keepCheckoutAnswers(EVENT, FORM, { [Q1]: "Vegan" });
    keepCheckoutAnswers(OTHER, FORM, { [Q1]: "Halal" });
    mockInvoke.mockResolvedValueOnce({ data: { kind: "free_completed", orderId: "order-1" }, error: null });
    const result = await useNativeCheckoutFlow()({ ...baseInput, brandFormStep: 1 });
    expect(result.outcome).toBe("succeeded");
    expect(readCheckoutAnswers(EVENT)).toBeUndefined();
    expect(readCheckoutFormRefusal(EVENT)).toBeNull();
    expect(readCheckoutAnswers(OTHER)?.answers).toEqual({ [Q1]: "Halal" });
    forgetCheckoutAnswers();
  });

  it("a refused checkout keeps the typed answers", async () => {
    keepCheckoutAnswers(EVENT, FORM, { [Q1]: "Vegan" });
    mockInvoke.mockResolvedValueOnce(refusal(422, { error: "form_answers_required" }));
    await useNativeCheckoutFlow()({ ...baseInput, brandFormStep: 1 });
    expect(readCheckoutAnswers(EVENT)?.answers).toEqual({ [Q1]: "Vegan" });
    forgetCheckoutAnswers();
  });

  it("a 5xx with a form token stays the generic copy (the 409 catch-all is never reached first)", () => {
    expect(nativeCheckoutErrorMessage("form_changed", 409)).toBe(CHECKOUT_FORM_CHANGED_MESSAGE);
    expect(nativeCheckoutErrorMessage("brand_form_stash_failed", 500)).not.toBe(CHECKOUT_FORM_STASH_FAILED_MESSAGE);
  });
});

describe("#4541 T-33 — the questions block's state (CTA rules)", () => {
  const hints = { loading: "Loading questions…", load: "Load the questions to continue", answer: "Answer the required questions to continue" };
  const form = (over: Partial<CheckoutBrandForm>): CheckoutBrandForm => ({
    mode: "required_step",
    formId: FORM,
    versionId: VERSION,
    name: "Guest details",
    definition: { questions: [{ id: Q1, position: 1, type: "short_text", label: "Diet", required: true }] },
    doorFullAnswers: false,
    brand: { displayName: "Harmattan Club" },
    answeredHere: false,
    prefill: null,
    ...over,
  });

  it("required, loading: off with the loading line, no marker", () => {
    expect(checkoutQuestionsState({ status: "pending", form: undefined, answers: {}, hints }))
      .toEqual({ ready: false, hint: hints.loading });
  });
  it("required, unanswered: off, marker, no answers", () => {
    expect(checkoutQuestionsState({ status: "success", form: form({}), answers: {}, hints }))
      .toEqual({ ready: false, hint: hints.answer, brandFormStep: 1 });
  });
  it("required, answered: on with marker and answers", () => {
    expect(checkoutQuestionsState({ status: "success", form: form({}), answers: { [Q1]: "Vegan" }, hints }))
      .toEqual({ ready: true, hint: null, brandFormStep: 1, brandForm: { formId: FORM, versionId: VERSION, answers: { [Q1]: "Vegan" } } });
  });
  it("failed read (Q1): off with 'Load the questions to continue', no marker", () => {
    expect(checkoutQuestionsState({ status: "error", form: undefined, answers: {}, hints }))
      .toEqual({ ready: false, hint: hints.load });
  });
  it("optional: always on", () => {
    expect(checkoutQuestionsState({ status: "success", form: form({ mode: "optional_on_page" }), answers: {}, hints }).ready).toBe(true);
  });
  it("answeredHere: on, marker, never answers", () => {
    expect(checkoutQuestionsState({ status: "success", form: form({ answeredHere: true }), answers: { [Q1]: "x" }, hints }))
      .toEqual({ ready: true, hint: null, brandFormStep: 1 });
  });
  it("no form at all: on with the marker", () => {
    expect(checkoutQuestionsState({ status: "success", form: null, answers: {}, hints }))
      .toEqual({ ready: true, hint: null, brandFormStep: 1 });
  });
});
