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
 * FAILS-ON-REVERT: dropping the marker from the create body, sending the
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
jest.mock("../../components/buyer/BuyerConnectionNotice", () => ({ BuyerConnectionNotice: () => null }));

import * as fs from "fs";
import * as path from "path";

import * as ts from "typescript";
import {
  checkoutFormReadFailure,
  fetchCheckoutForm,
  parseCheckoutForm,
  requestPurchaseFormLink,
} from "../checkoutBrandFormService";
import { checkoutFormRefusalCopy, CHECKOUT_FORM_COPY } from "../../components/checkout/intake/checkoutFormCopy";
import {
  answersForForm,
  canContinueStep,
  markPurchaseHandedOff,
  recoveryAction,
  probeOf,
  purchaseHandedOff,
} from "../../components/checkout/intake/CheckoutQuestionsStep";
import type { BuyerDetails } from "../../components/checkout/CartContext";
import { isConnectionFailure } from "../connectionFailure";

const ANSWERS = {
  formId: "45140000-0000-4000-8000-000000000f01",
  versionId: "45140000-0000-4000-8000-000000000f02",
  answers: { q1: "yes" },
};
const BUYER: BuyerDetails = { name: "Ann", email: "a@example.test", phone: "+12025550101", marketingOptIn: true };
const DEF = { schema: "mingla.brand_form.v1", title: "T", questions: [{ id: "q1", position: 0, type: "short_text", label: "Q", required: true }] };

const ROOT = path.resolve(__dirname, "../../..");
const readSrc = (p: string): string => fs.readFileSync(path.join(ROOT, p), "utf8");

describe("#4514 W5 the create body", () => {
  // Inline on purpose (the eager bundle budget): the marker and the lift of the
  // answers out of `buyer` are the only brand form code on the eager path.
  const svc = readSrc("src/services/ticketCheckoutService.ts");
  it("always sends the capability marker, and the answers top-level", () => {
    expect(svc).toMatch(/buyer: \{ \.\.\.input\.buyer, brandForm: undefined \},\s*\n\s*brandFormStep: 1,\s*\n\s*brandForm: input\.buyer\.brandForm,/);
    // An undefined key never reaches the wire: the answers are not inside buyer.
    const wire = JSON.parse(JSON.stringify({ buyer: { ...BUYER, brandForm: undefined }, brandFormStep: 1, brandForm: ANSWERS }));
    expect(wire).toEqual({ buyer: BUYER, brandFormStep: 1, brandForm: ANSWERS });
    expect("brandForm" in wire.buyer).toBe(false);
    expect(svc).not.toMatch(/buyer: input\.buyer\b/);
  });

  it("keeps no forms module on the eager path", () => {
    expect(svc).not.toMatch(/from "[^"]*(brandFormsCopy|checkoutFormMarker|brandFormKeys|intake\/)/);
  });
});

/** The refusal helpers each route carries inline, compiled and run as written. */
function routeHelpers(file: string): {
  formRefusalOf: (c: unknown) => string | null;
  questionsParamRefusal?: (c: unknown) => string | null;
  BRAND_FORM_SERVER_FAILURE: RegExp;
} {
  const src = readSrc(file);
  const start = src.indexOf("const FORM_REFUSAL = ");
  const end = src.indexOf("\n", src.indexOf("const BRAND_FORM_SERVER_FAILURE = "));
  expect(start).toBeGreaterThan(-1);
  const js = ts.transpileModule(src.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2019 } }).outputText;
  const names = ["formRefusalOf", "BRAND_FORM_SERVER_FAILURE"].concat(js.includes("questionsParamRefusal") ? ["questionsParamRefusal"] : []);
  // eslint-disable-next-line no-new-func
  return new Function(`${js}; return { ${names.join(", ")} };`)() as ReturnType<typeof routeHelpers>;
}

const ROUTES = [
  "app/checkout/[eventId]/buyer.tsx",
  "app/checkout-experience/[experienceEventId]/buyer.tsx",
  "app/checkout/[eventId]/payment.tsx",
  "app/checkout-experience/[experienceEventId]/payment.tsx",
] as const;

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

  // Wave 7 (OP-5 UX, the approved contract §5.4 "A guest who answered before
  // sees their answers filled in"): the step is NOT skipped; it opens prefilled.
  it("OP-5 (wave 7): a signed-in buyer who already answered gets the step, prefilled with their own answers", () => {
    const answered = {
      ...base,
      mode: "required_step",
      answered: true,
      prefill: { answers: { q1: "Vegan", q9: { bad: true }, q7: ["a", "b"] }, versionId: "v-old" },
    };
    const form = parseCheckoutForm(answered);
    expect(form).not.toBeNull();
    expect(probeOf("success", form)).toBe("required");
    expect(form?.prefill).toEqual({ answers: { q1: "Vegan", q7: ["a", "b"] }, versionId: "v-old" });
    // Only questions of the live version are filled; nothing typed yet means the prefill.
    expect(answersForForm(form!, null)).toEqual({ q1: "Vegan" });
    // What the buyer types wins over the prefill.
    expect(answersForForm(form!, { formId: ANSWERS.formId, versionId: ANSWERS.versionId, answers: { q1: "Halal" } })).toEqual({ q1: "Halal" });
    // A buyer who has not answered gets no prefill.
    expect(parseCheckoutForm({ ...base, mode: "required_step" })?.prefill).toBeNull();
    expect(parseCheckoutForm({ ...base, mode: "required_step", prefill: answered.prefill })?.prefill).toBeNull();
  });
});

describe("#4514 W5 fix 2: no dead end", () => {
  it.each(ROUTES)("%s: a server failure of the check or the stash never reopens the Questions step", (file) => {
    const h = routeHelpers(file);
    expect(h.formRefusalOf("brand_form_check_failed")).toBeNull();
    expect(h.formRefusalOf("brand_form_stash_failed")).toBeNull();
    expect(h.formRefusalOf("form_answers_required")).toBe("form_answers_required");
    expect(h.formRefusalOf("form_answers_invalid")).toBe("form_answers_invalid");
    expect(h.formRefusalOf("form_changed")).toBe("form_changed");
    expect(h.formRefusalOf(undefined)).toBeNull();
    expect(h.BRAND_FORM_SERVER_FAILURE.test("brand_form_check_failed")).toBe(true);
    expect(h.BRAND_FORM_SERVER_FAILURE.test("brand_form_stash_failed")).toBe(true);
    expect(h.BRAND_FORM_SERVER_FAILURE.test("form_answers_required")).toBe(false);
  });

  it.each(ROUTES)("%s: those failures show the normal retryable checkout error", (file) => {
    const src = readSrc(file);
    const msg = file.includes("payment") ? "PAID_CHECKOUT_FAILED_MESSAGE" : "FREE_CHECKOUT_FAILED_MESSAGE";
    // A ternary (payment) or an early-return arm (the free rails keep #2337's
    // exact `setSubmitError(freeCheckoutErrorMessage(error))` line).
    expect(src).toMatch(new RegExp(`BRAND_FORM_SERVER_FAILURE\\.test\\([\\s\\S]{0,120}\\)\\s*(\\?|\\)\\s*\\{)[\\s\\S]{0,200}?${msg}`));
    expect(src).not.toMatch(/brand_form_\\w\+\)\$/);
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
    expect(step).toMatch(/recovery === "try_again" \? \(\s*<Button\s+label=\{CHECKOUT_FORM_COPY\.tryAgain\}[\s\S]*?onPress=\{retry\}/);
    expect(step).toMatch(/const retry = useCallback\(\(\): void => \{\s*void refetch\(\)/);
    expect(step).toContain("const canContinue = canContinueStep({ submitting, loading, form, missing });");
    expect(CHECKOUT_FORM_COPY.noFormRefused).toMatch(/Nothing was charged\. Try again\./);
  });

  // Wave 7 (P3-C): one failed Try again is enough; then the way out, never a loop.
  it("after one failed Try again the step offers Back to event instead of another Try again", () => {
    expect(recoveryAction({ failing: true, loading: false, failedRetries: 0, canGoBack: true })).toBe("try_again");
    expect(recoveryAction({ failing: true, loading: false, failedRetries: 1, canGoBack: true })).toBe("back_to_event");
    expect(recoveryAction({ failing: true, loading: false, failedRetries: 3, canGoBack: true })).toBe("back_to_event");
    expect(recoveryAction({ failing: true, loading: true, failedRetries: 1, canGoBack: true })).toBe("none");
    expect(recoveryAction({ failing: false, loading: false, failedRetries: 1, canGoBack: true })).toBe("none");
    expect(CHECKOUT_FORM_COPY.backToEvent).toBe("Back to event");
    expect(CHECKOUT_FORM_COPY.retryFailed).not.toMatch(/Try again/);
    for (const file of ["app/checkout/[eventId]/buyer.tsx", "app/checkout-experience/[experienceEventId]/buyer.tsx"]) {
      expect(readSrc(file)).toContain("onBackToEvent={handleBackToEvent}");
    }
  });
});

describe("#4514 W5 fix 7: payment sends the real refusal code back to the step", () => {
  it.each(ROUTES.slice(0, 2))("%s maps the questions param to the real code, and an old link to required", (file) => {
    const q = routeHelpers(file).questionsParamRefusal!;
    expect(q("form_changed")).toBe("form_changed");
    expect(q("form_answers_invalid")).toBe("form_answers_invalid");
    expect(q("1")).toBe("form_answers_required");
    expect(q("brand_form_stash_failed")).toBeNull();
    expect(q(undefined)).toBeNull();
  });

  it.each(ROUTES.slice(2))("%s sends the real code back (and keeps a ticket link)", (file) => {
    const src = readSrc(file);
    expect(src).toMatch(/buyer\?questions=\$\{formCode\}/);
    if (file.startsWith("app/checkout/")) expect(src).toContain("&ticketLink=${encodeURIComponent(ticketLinkToken)}");
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

// ── #4518 merge: a failed form read uses the one buyer connection notice ─────
describe("#4514 x #4518: the Questions step's load failure is the one connection notice", () => {
  const stepSrc = (): string =>
    fs.readFileSync(
      path.join(path.resolve(__dirname, "../../.."), "src/components/checkout/intake/CheckoutQuestionsStep.tsx"),
      "utf8",
    );

  it("renders BuyerConnectionNotice on a failed read, retrying with a re-read, and no copy of its own", () => {
    const step = stepSrc();
    expect(step).toMatch(/import \{ BuyerConnectionNotice \} from "\.\.\/\.\.\/buyer\/BuyerConnectionNotice";/);
    expect(step).toMatch(/\{loadFailed \? \(\s*<BuyerConnectionNotice[\s\S]*?onRetry=\{retryConnection\}[\s\S]*?onBack=\{onBackToEvent\}/);
    expect(step).toContain("const retryConnection = useCallback((): Promise<unknown> => refetch(), [refetch]);");
    // The branch's own load-failure line is gone; the refusal path keeps its words.
    expect(step).not.toContain("CHECKOUT_FORM_COPY.loadFailed");
    expect((CHECKOUT_FORM_COPY as Record<string, unknown>).loadFailed).toBeUndefined();
    expect(step).toContain("CHECKOUT_FORM_COPY.noFormRefused");
  });

  it("keeps the transport error as the cause, so a dropped connection reads as one", async () => {
    const fetchFailed = Object.assign(new Error("Failed to send a request to the Edge Function"), {
      name: "FunctionsFetchError",
    });
    invoke.mockResolvedValueOnce({ data: null, error: fetchFailed });
    const thrown = await fetchCheckoutForm("e1").catch((e: unknown) => e);
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe("checkout_form_read_failed");
    expect(isConnectionFailure(checkoutFormReadFailure(thrown))).toBe(true);

    const serverSaidNo = Object.assign(new Error("Edge Function returned a non-2xx status code"), {
      name: "FunctionsHttpError",
      status: 500,
    });
    invoke.mockResolvedValueOnce({ data: null, error: serverSaidNo });
    const thrown2 = await fetchCheckoutForm("e1").catch((e: unknown) => e);
    expect(isConnectionFailure(checkoutFormReadFailure(thrown2))).toBe(false);
  });
});
