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

// The step module's pure helpers are tested; its UI imports are stubbed.
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("../../components/ui/Button", () => ({ Button: () => null }));
jest.mock("../../components/checkout/intake/businessFormPrimitives", () => ({ businessFormPrimitives: {} }));

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
import { checkoutFormRefusalCopy, CHECKOUT_FORM_COPY } from "../../components/checkout/intake/checkoutFormCopy";
import { formRefusalOf, questionsParamRefusal } from "../checkoutFormMarker";
import { paidCheckoutErrorMessage, PAID_CHECKOUT_FAILED_MESSAGE } from "../ticketCheckoutService";
import { freeCheckoutErrorMessage, FREE_CHECKOUT_FAILED_MESSAGE } from "../checkoutErrorCopy";
import {
  canContinueStep,
  markPurchaseHandedOff,
  probeOf,
  purchaseHandedOff,
} from "../../components/checkout/intake/CheckoutQuestionsStep";
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

  it("reads through the checkout credential read and throws on an error so the step can retry", async () => {
    invoke.mockResolvedValueOnce({ data: { ok: true, form: { active: false } }, error: null });
    await expect(fetchCheckoutForm("e1")).resolves.toBeNull();
    expect(invoke).toHaveBeenLastCalledWith("brand-form-submit", { body: { op: "checkout_form", eventId: "e1" } });
    invoke.mockResolvedValueOnce({ data: null, error: { message: "down" } });
    await expect(fetchCheckoutForm("e1")).rejects.toThrow("checkout_form_read_failed");
    expect(rpc).not.toHaveBeenCalled();
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

// ── Wave 5 review fixes ─────────────────────────────────────────────────────
describe("#4514 W5 fix 1: the Details probe uses the buyer's checkout credential", () => {
  const base = { active: true, formId: ANSWERS.formId, versionId: ANSWERS.versionId, name: "Diet", definition: DEF, brand: { displayName: "B" } };

  it("sends the private ticket link, and a private page the buyer can see gives the step", async () => {
    invoke.mockResolvedValueOnce({ data: { ok: true, form: { ...base, mode: "required_step" } }, error: null });
    const form = await fetchCheckoutForm("e9", "AbCdEfGhIjKlMnOpQrStUv");
    expect(invoke).toHaveBeenLastCalledWith("brand-form-submit", {
      body: { op: "checkout_form", eventId: "e9", ticketLinkToken: "AbCdEfGhIjKlMnOpQrStUv" },
    });
    expect(probeOf("success", form)).toBe("required");
  });

  it("no credential: the server shows no form, so no step and no refusal is expected", async () => {
    invoke.mockResolvedValueOnce({ data: { ok: true, form: { active: false } }, error: null });
    expect(probeOf("success", await fetchCheckoutForm("e9"))).toBe("none");
  });

  it("OP-5 (fix 5): a signed-in buyer who already answered gets no Questions step", () => {
    expect(parseCheckoutForm({ ...base, mode: "required_step", answered: true })).toBeNull();
    expect(probeOf("success", parseCheckoutForm({ ...base, mode: "required_step", answered: true }))).toBe("none");
  });
});

describe("#4514 W5 fix 2: no dead end", () => {
  it("a server failure of the check or the stash never reopens the Questions step", () => {
    expect(formRefusalOf("brand_form_check_failed")).toBeNull();
    expect(formRefusalOf("brand_form_stash_failed")).toBeNull();
    expect(formRefusalOf("form_answers_required")).toBe("form_answers_required");
    expect(formRefusalOf("form_changed")).toBe("form_changed");
    expect(formRefusalOf(undefined)).toBeNull();
  });

  it("they show the normal retryable checkout error, paid and free", () => {
    for (const code of ["brand_form_check_failed", "brand_form_stash_failed"]) {
      const err = Object.assign(new Error("Edge Function returned a non-2xx status code"), { code, status: 409 });
      expect(paidCheckoutErrorMessage(err)).toBe(PAID_CHECKOUT_FAILED_MESSAGE);
      expect(freeCheckoutErrorMessage(err)).toBe(FREE_CHECKOUT_FAILED_MESSAGE);
    }
  });

  it("with no form to show, Continue is on; a form on screen still gates required answers", () => {
    expect(canContinueStep({ submitting: false, loading: false, form: null, missing: true })).toBe(true);
    const required = parseCheckoutForm({ active: true, mode: "required_step", formId: "f", versionId: "v", definition: DEF, brand: {} });
    expect(canContinueStep({ submitting: false, loading: false, form: required, missing: true })).toBe(false);
    expect(canContinueStep({ submitting: false, loading: false, form: required, missing: false })).toBe(true);
    expect(canContinueStep({ submitting: true, loading: false, form: null, missing: false })).toBe(false);
  });

  it("a refusal with no form offers Try again that re-reads the form, and Continue stays on", () => {
    const root = path.resolve(__dirname, "../../..");
    const step = fs.readFileSync(path.join(root, "src/components/checkout/intake/CheckoutQuestionsStep.tsx"), "utf8");
    expect(step).toMatch(/loadFailed \|\| refusedWithoutForm \? \(\s*<Button\s+label=\{CHECKOUT_FORM_COPY\.tryAgain\}[\s\S]*?onPress=\{\(\) => void refetch\(\)\}/);
    expect(step).toContain("const canContinue = canContinueStep({ submitting, loading, form, missing });");
    expect(CHECKOUT_FORM_COPY.noFormRefused).toMatch(/Nothing was charged\. Try again\./);
  });
});

describe("#4514 W5 fix 7: payment sends the real refusal code back to the step", () => {
  it("maps the questions param to the real code, and an old link to required", () => {
    expect(questionsParamRefusal("form_changed")).toBe("form_changed");
    expect(questionsParamRefusal("form_answers_invalid")).toBe("form_answers_invalid");
    expect(questionsParamRefusal("1")).toBe("form_answers_required");
    expect(questionsParamRefusal("brand_form_stash_failed")).toBeNull();
    expect(questionsParamRefusal(undefined)).toBeNull();
  });
});

describe("#4514 W5 fix 4: the after-purchase redirect happens once per checkout session", () => {
  it("a session handed off once is not handed off again (Later works)", () => {
    expect(purchaseHandedOff("sess-1")).toBe(false);
    markPurchaseHandedOff("sess-1");
    expect(purchaseHandedOff("sess-1")).toBe(true);
    expect(purchaseHandedOff("sess-2")).toBe(false);
  });

  it("the flag is in sessionStorage, so a fresh load of the confirm page does not redirect", () => {
    const store = new Map<string, string>();
    const g = globalThis as unknown as { sessionStorage?: Storage };
    const prev = g.sessionStorage;
    g.sessionStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    } as unknown as Storage;
    try {
      markPurchaseHandedOff("sess-3");
      expect(store.get("mingla.formPurchaseHandedOff.sess-3")).toBe("1");
      store.set("mingla.formPurchaseHandedOff.sess-4", "1");
      expect(purchaseHandedOff("sess-4")).toBe(true);
    } finally {
      g.sessionStorage = prev;
    }
  });
});
