/* eslint-disable @typescript-eslint/no-require-imports, import/first -- jest doubles are declared before the modules they replace */
/**
 * #4541 R2.10 (decision pending with Seth) — a questions read that keeps
 * failing must not block every purchase in the app.
 *
 * `CHECKOUT_FORM_READ_FAILURE_BLOCKS_PAY` (CheckoutQuestionsBlock.tsx) is the
 * one-line switch:
 *   - false (default): after the first read fails and ONE Try again also
 *     fails, "Continue to Payment" goes on, the cart gets NO capability marker
 *     (the server records the order "not asked", never answered), and the
 *     block reads "Questions couldn't load. You can book now and answer
 *     later." with Try again still there. A later read that succeeds puts the
 *     normal rules back (a required form holds the button again).
 *   - true: the button stays off (the old rule, "Back to event").
 * Both values are covered through the pure state; the default is also driven
 * through the mounted block with a failing service.
 *
 * Red on revert of the switch's branch in `checkoutQuestionsState`, the block's
 * "book later" copy, or Try again staying available.
 * Runs under app-mobile/jest.issue2774.render.cjs.
 */
import React from "react";

const TestRenderer = require("react-test-renderer") as typeof import("react-test-renderer");
const { act } = TestRenderer;
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });

jest.mock("react-i18next", () => {
  const forms = jest.requireActual("../../../i18n/locales/en/forms.json");
  const t = (key: string, options: Record<string, unknown> = {}): string => {
    const value = forms[key];
    if (typeof value !== "string") return key;
    return value.replace(/{{\s*(\w+)\s*}}/g, (m: string, name: string) => (name in options ? String(options[name]) : m));
  };
  return { initReactI18next: { type: "3rdParty", init: () => undefined }, useTranslation: () => ({ t, i18n: { language: "en" } }) };
});
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"));
jest.mock("../../../services/supabase", () => ({ supabase: { rpc: jest.fn(), functions: { invoke: jest.fn() } } }));
jest.mock("../RsvpFormWebDateInput", () => ({ RsvpFormWebDateInput: () => null }), { virtual: true });
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../../store/appStore", () => ({
  useAppStore: (select: (s: { user: { id: string } }) => unknown) => select({ user: { id: "user-a" } }),
}));
const mockFetchCheckoutForm = jest.fn();
jest.mock("../../../services/brandFormService", () => ({
  ...jest.requireActual("../../../services/brandFormService"),
  fetchCheckoutForm: (...args: unknown[]) => mockFetchCheckoutForm(...args),
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  CHECKOUT_FORM_READ_FAILURE_BLOCKS_PAY,
  CheckoutQuestionsBlock,
  checkoutQuestionsState,
  forgetCheckoutAnswers,
  type CheckoutQuestionsState,
} from "../CheckoutQuestionsBlock";
import { BrandFormError, type CheckoutBrandForm } from "../../../services/brandFormService";

const forms = require("../../../i18n/locales/en/forms.json") as Record<string, string>;

const EVENT = "45410000-0000-4000-8000-0000000000e9";
const FORM = "45410000-0000-4000-8000-0000000000f9";
const VERSION = "45410000-0000-4000-8000-0000000000c9";
const Q1 = "45410000-0000-4000-8000-0000000000a9";
const hints = { loading: "Loading questions…", load: "Load the questions to continue", answer: "Answer the required questions to continue" };
const requiredForm: CheckoutBrandForm = {
  mode: "required_step",
  formId: FORM,
  versionId: VERSION,
  name: "Guest details",
  definition: { questions: [{ id: Q1, position: 1, type: "short_text", label: "Diet", required: true }] },
  doorFullAnswers: false,
  brand: { displayName: "Harmattan Club" },
  answeredHere: false,
  prefill: null,
} as unknown as CheckoutBrandForm;

const flush = async (): Promise<void> => {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
};
const node = (root: import("react-test-renderer").ReactTestRenderer, id: string) =>
  root.root.findAll((n) => n.props.testID === id && typeof n.type !== "string")[0];
const textOf = (root: import("react-test-renderer").ReactTestRenderer): string => JSON.stringify(root.toJSON());

beforeEach(() => {
  mockFetchCheckoutForm.mockReset();
  forgetCheckoutAnswers();
});

describe("#4541 R2.10 a failed questions read — the switch", () => {
  it("defaults to letting the buyer continue", () => {
    expect(CHECKOUT_FORM_READ_FAILURE_BLOCKS_PAY).toBe(false);
  });

  it("false: the first failure holds the button; after one failed Try again the buyer may continue with no marker", () => {
    expect(checkoutQuestionsState({ status: "error", form: undefined, answers: {}, hints, failedRetries: 0, failureBlocksPay: false }))
      .toEqual({ ready: false, hint: hints.load });
    expect(checkoutQuestionsState({ status: "error", form: undefined, answers: {}, hints, failedRetries: 1, failureBlocksPay: false }))
      .toEqual({ ready: true, hint: null });
    // The default reads the switch.
    expect(checkoutQuestionsState({ status: "error", form: undefined, answers: {}, hints, failedRetries: 1 }))
      .toEqual({ ready: true, hint: null });
  });

  it("true: the button stays off however many times the read fails", () => {
    for (const failedRetries of [0, 1, 3]) {
      expect(checkoutQuestionsState({ status: "error", form: undefined, answers: {}, hints, failedRetries, failureBlocksPay: true }))
        .toEqual({ ready: false, hint: hints.load });
    }
  });

  it("either value: a read that succeeded keeps the rules (required holds the button, marker sent)", () => {
    for (const failureBlocksPay of [false, true]) {
      expect(checkoutQuestionsState({ status: "success", form: requiredForm, answers: {}, hints, failedRetries: 2, failureBlocksPay }))
        .toEqual({ ready: false, hint: hints.answer, brandFormStep: 1 });
    }
  });
});

describe("#4541 R2.10 a failed questions read — the mounted block (default)", () => {
  it("fails, Try again fails, then 'book now and answer later' with Try again still there; a later success restores the rules", async () => {
    mockFetchCheckoutForm.mockRejectedValue(new BrandFormError("forbidden", 403));
    const states: CheckoutQuestionsState[] = [];
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let root!: import("react-test-renderer").ReactTestRenderer;
    await act(async () => {
      root = TestRenderer.create(
        <QueryClientProvider client={client}>
          <CheckoutQuestionsBlock
            eventId={EVENT}
            enabled
            disabled={false}
            highlight={false}
            onStateChange={(s) => states.push(s)}
            onBackToEvent={() => undefined}
          />
        </QueryClientProvider>,
      );
    });
    await flush();
    expect(node(root, "checkout-questions-failed")).toBeDefined();
    expect(textOf(root)).toContain(forms.checkoutLoadToContinue);
    expect(states.at(-1)).toEqual({ ready: false, hint: forms.checkoutLoadToContinue });

    // The one retry also fails: the buyer may book, with no marker.
    await act(async () => {
      node(root, "checkout-questions-retry").props.onPress();
    });
    await flush();
    expect(textOf(root)).toContain(forms.checkoutBookLater);
    expect(forms.checkoutBookLater).toBe("Questions couldn't load. You can book now and answer later.");
    expect(textOf(root)).toContain(forms.tryAgain);
    expect(textOf(root)).not.toContain(forms.backToEvent);
    expect(states.at(-1)).toEqual({ ready: true, hint: null });
    expect(states.at(-1)?.brandFormStep).toBeUndefined();

    // Try again is still live: a read that now succeeds puts the normal rules
    // back (here "no form", so the marker returns; a required form holding the
    // button again is the pure case above).
    mockFetchCheckoutForm.mockResolvedValue(null);
    await act(async () => {
      node(root, "checkout-questions-retry").props.onPress();
    });
    await flush();
    expect(node(root, "checkout-questions-failed")).toBeUndefined();
    expect(states.at(-1)).toEqual({ ready: true, hint: null, brandFormStep: 1 });
    act(() => root.unmount());
  });
});

describe("#4541 the cart is held until the questions block reports (no fast-tap pay)", () => {
  const fs = require("node:fs") as typeof import("node:fs");
  const path = require("node:path") as typeof import("node:path");
  const cart = fs.readFileSync(path.join(__dirname, "..", "..", "expandedCard", "TicketCartSheet.tsx"), "utf8");

  it("the cart starts with no report and an active block holds Continue until one arrives", () => {
    expect(cart).toMatch(/useState<CheckoutQuestionsState \| null>\(null\)/);
    expect(cart).toMatch(/questionsReady = !questionsActive \|\| \(formQuestions !== null && formQuestions\.ready\)/);
    expect(cart).not.toMatch(/useState<CheckoutQuestionsState>\(\{ ready: true/);
    // A block that went away reports afresh next time.
    expect(cart).toMatch(/if \(!questionsActive\) setFormQuestions\(null\);/);
  });

  it("the block reports on mount (loading, not ready) and then 'no form' (ready with the marker)", async () => {
    let resolveRead: (v: null) => void = () => undefined;
    mockFetchCheckoutForm.mockImplementation(() => new Promise<null>((r) => { resolveRead = r; }));
    const states: CheckoutQuestionsState[] = [];
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let root!: import("react-test-renderer").ReactTestRenderer;
    await act(async () => {
      root = TestRenderer.create(
        <QueryClientProvider client={client}>
          <CheckoutQuestionsBlock
            eventId={EVENT}
            enabled
            disabled={false}
            highlight={false}
            onStateChange={(s) => states.push(s)}
            onBackToEvent={() => undefined}
          />
        </QueryClientProvider>,
      );
    });
    expect(states[0]).toEqual({ ready: false, hint: forms.checkoutLoading });
    await act(async () => {
      resolveRead(null);
    });
    await flush();
    expect(states.at(-1)).toEqual({ ready: true, hint: null, brandFormStep: 1 });
    act(() => root.unmount());
  });
});
