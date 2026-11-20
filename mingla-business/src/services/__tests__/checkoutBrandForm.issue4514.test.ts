/**
 * #4514 wave 5 — the buyer checkout's brand form wiring (BUILD CONTRACT v2
 * §5.4, §5.5, C1).
 *
 * - The create body always carries the capability marker and lifts the
 *   Questions step's answers out of `buyer` (the server reads them top-level).
 * - The public read maps to a step only for a live on-page form.
 * - The routes put the step between Details and Payment with their own step
 *   names, load it only through the forms lazy owner, and never call useAuth.
 *
 * FAILS-ON-REVERT: dropping the marker from checkoutBrandFormFields, sending the
 * answers inside `buyer`, or wiring a route's Continue straight to the final
 * submit turns a case below red.
 */
const invoke = jest.fn();
const rpc = jest.fn();
jest.mock("../supabase", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    rpc: (...a: unknown[]) => rpc(...a),
  },
}));

// The renderers need native modules jest does not load; the rules are pure.
jest.mock("@mingla/form-rendering", () =>
  jest.requireActual("../../../../packages/form-rendering/brandFormRules"),
);

import * as fs from "fs";
import * as path from "path";

import {
  BRAND_FORM_CHECKOUT_STEP,
  buyerWithoutBrandForm,
  checkoutBrandFormFields,
} from "../ticketCheckoutService";
import {
  fetchCheckoutForm,
  parseCheckoutForm,
  requestPurchaseFormLink,
} from "../checkoutBrandFormService";
import { checkoutFormRefusalCopy, CHECKOUT_FORM_COPY } from "../../components/forms/brandFormsCopy";
import type { BuyerDetails } from "../../components/checkout/CartContext";

const ANSWERS = {
  formId: "45140000-0000-4000-8000-000000000f01",
  versionId: "45140000-0000-4000-8000-000000000f02",
  answers: { q1: "yes" },
};
const BUYER: BuyerDetails = { name: "Ann", email: "a@example.test", phone: "+12025550101", marketingOptIn: true };
const DEF = { schema: "mingla.brand_form.v1", title: "T", questions: [{ id: "q1", position: 0, type: "short_text", label: "Q", required: true }] };

describe("#4514 W5 the create body", () => {
  it("always sends the capability marker, and the answers only when the step collected them", () => {
    expect(BRAND_FORM_CHECKOUT_STEP).toBe(1);
    expect(checkoutBrandFormFields(BUYER)).toEqual({ brandFormStep: 1 });
    expect(checkoutBrandFormFields({ ...BUYER, brandForm: null })).toEqual({ brandFormStep: 1 });
    expect(checkoutBrandFormFields({ ...BUYER, brandForm: ANSWERS })).toEqual({
      brandFormStep: 1,
      brandForm: ANSWERS,
    });
  });

  it("never sends the answers inside buyer", () => {
    const out = buyerWithoutBrandForm({ ...BUYER, brandForm: ANSWERS });
    expect(out).toEqual(BUYER);
    expect("brandForm" in out).toBe(false);
  });
});

describe("#4514 W5 the page's form", () => {
  it("maps a live required or optional form, and nothing else", () => {
    const base = { active: true, formId: ANSWERS.formId, versionId: ANSWERS.versionId, name: "Diet", definition: DEF, brand: { displayName: "Brand A" } };
    expect(parseCheckoutForm({ ...base, mode: "required_step" })?.mode).toBe("required_step");
    expect(parseCheckoutForm({ ...base, mode: "optional_on_page" })?.brand.displayName).toBe("Brand A");
    expect(parseCheckoutForm({ ...base, mode: "after_purchase", definition: null, versionId: null })?.mode).toBe("after_purchase");
    expect(parseCheckoutForm({ active: false, switchedOff: true })).toBeNull();
    expect(parseCheckoutForm({ ...base, mode: "required_step", definition: null })).toBeNull();
    expect(parseCheckoutForm({ ...base, mode: "something" })).toBeNull();
  });

  it("reads the public RPC and throws on an error so the step can retry", async () => {
    rpc.mockResolvedValueOnce({ data: { active: false }, error: null });
    await expect(fetchCheckoutForm("e1")).resolves.toBeNull();
    expect(rpc).toHaveBeenCalledWith("public_brand_form_for_event", { p_event_id: "e1" });
    rpc.mockResolvedValueOnce({ data: null, error: { message: "down" } });
    await expect(fetchCheckoutForm("e1")).rejects.toThrow("checkout_form_read_failed");
  });

  it("asks for the after-purchase link with the session's possession proof", async () => {
    invoke.mockResolvedValueOnce({ data: { ok: true, outcome: "link", formId: "f", token: "t" }, error: null });
    await expect(requestPurchaseFormLink({ checkoutSessionId: "s", buyerStatusToken: "b" })).resolves.toEqual({
      outcome: "link",
      formId: "f",
      token: "t",
    });
    expect(invoke).toHaveBeenCalledWith("brand-form-submit", {
      body: { op: "purchase_link", checkoutSessionId: "s", buyerStatusToken: "b" },
    });
    invoke.mockResolvedValueOnce({ data: { ok: true, outcome: "none" }, error: null });
    await expect(requestPurchaseFormLink({ checkoutSessionId: "s", buyerStatusToken: "b" })).resolves.toEqual({ outcome: "none" });
  });

  it("explains every refusal and never says money moved", () => {
    for (const code of ["form_answers_required", "form_answers_invalid", "form_changed", "brand_form_stash_failed"]) {
      expect(checkoutFormRefusalCopy(code)).toMatch(/Nothing was charged/);
    }
    expect(checkoutFormRefusalCopy(null)).toBeNull();
    expect(CHECKOUT_FORM_COPY.needsAnswers).toBe("Answer the required questions to continue");
  });
});

describe("#4514 W5 the routes", () => {
  const root = path.resolve(__dirname, "../../..");
  const read = (p: string): string => fs.readFileSync(path.join(root, p), "utf8");
  const buyers = [
    ["app/checkout/[eventId]/buyer.tsx", '["Tickets", "Details", "Questions", "Payment"]'],
    ["app/checkout-experience/[experienceEventId]/buyer.tsx", '["Your spot", "Details", "Questions", "Payment"]'],
  ] as const;

  it.each(buyers)("%s: Questions sits between Details and Payment with its own step names", (file, names) => {
    const src = read(file);
    expect(src).toContain(`const FORM_STEP_NAMES = ${names} as const;`);
    expect(src).toContain("onPress={handleDetailsContinue}");
    expect(src).not.toContain("onPress={handleContinue}");
    expect(src).toContain("stepNames={FORM_STEP_NAMES}");
    // The trip names stay the CheckoutHeader default; this flow passes its own.
    expect(src).toMatch(/totalSteps=\{4\}\s*\n\s*stepNames=\{FORM_STEP_NAMES\}/);
  });

  it.each([
    ...buyers.map(([f]) => f),
    "app/checkout/[eventId]/confirm.tsx",
    "app/checkout-experience/[experienceEventId]/confirm.tsx",
  ])("%s: the forms code loads only through the one lazy owner, and never useAuth", (file) => {
    const src = read(file);
    expect(src).toMatch(/React\.lazy\(\(\) =>\s*import\("\.\.\/\.\.\/\.\.\/src\/components\/checkout\/intake\/formRenderingPrimitives"\)/);
    expect(src).not.toMatch(/from "[^"]*CheckoutQuestionsStep"/);
    expect(src).not.toMatch(/\buseAuth\(/);
  });

  it("the step module adds no lazy import of its own", () => {
    const step = read("src/components/checkout/intake/CheckoutQuestionsStep.tsx");
    expect(step).not.toMatch(/React\.lazy|import\(/);
    expect(step).not.toMatch(/\buseAuth\(/);
  });
});
