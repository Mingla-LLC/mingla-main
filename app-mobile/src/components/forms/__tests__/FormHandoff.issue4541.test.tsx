/* eslint-disable @typescript-eslint/no-require-imports, import/first -- jest doubles are declared before the modules they replace */
/**
 * #4541 R2.8 (T-31) — "You're in. One more thing." in the cart's success panel
 * and the "One more thing from {brand}" row on the sent-ticket sheet.
 *
 *   - Shown only for an unanswered, live "After they purchase" form on this
 *     order; never for a page form or an answered one.
 *   - Shown once per order (`mingla_form_handoff_seen_v1:order:{id}`).
 *   - Answer now closes the sheet first (it lands on the purchase page), then
 *     pushes the form over it; Later hides the block and leaves the card.
 *   - The cart mounts the block after the success line and before the share
 *     card, and only for a booking attached to this account; the sent sheet
 *     gets the row; trips get no questions block in the cart.
 *
 * Red on revert of the seen-once key, the mode/answered filter or the
 * close-then-push order. Runs under app-mobile/jest.issue2774.render.cjs.
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
const mockCalls: string[] = [];
const mockPush = jest.fn((path: string) => mockCalls.push(`push:${path}`));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("../../../store/appStore", () => ({
  useAppStore: (select: (s: { user: { id: string } }) => unknown) => select({ user: { id: "user-a" } }),
}));
const mockPending = jest.fn();
jest.mock("../../../services/brandFormService", () => ({
  ...jest.requireActual("../../../services/brandFormService"),
  fetchMyPendingBrandForms: () => mockPending(),
}));

import AsyncStorage from "@react-native-async-storage/async-storage";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FormHandoffBlock, handoffRow, handoffSeenKey } from "../FormHandoffBlock";
import type { PendingBrandForm } from "../../../services/brandFormService";

const forms = require("../../../i18n/locales/en/forms.json") as Record<string, string>;
const fs = require("node:fs") as typeof import("node:fs");
const path = require("node:path") as typeof import("node:path");

const FORM = "45410000-0000-4000-8000-000000000004";
const EVENT = "45410000-0000-4000-8000-0000000000e1";
const ORDER = "45410000-0000-4000-8000-0000000000a1";

const row = (over: Partial<PendingBrandForm> = {}): PendingBrandForm => ({
  eventId: EVENT, eventTitle: "Detty", eventStatus: "scheduled", subject: { kind: "order", id: ORDER },
  mode: "after_purchase", required: false, formId: FORM, formName: "Guest details", formStatus: "live",
  answered: false, answeredSource: null, brand: { displayName: "Harmattan Club" }, ...over,
});

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
};
async function render(variant: "block" | "row", onBeforeAnswer: () => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let root!: import("react-test-renderer").ReactTestRenderer;
  await act(async () => {
    root = TestRenderer.create(
      <QueryClientProvider client={client}>
        <FormHandoffBlock kind="order" subjectId={ORDER} from="purchase" onBeforeAnswer={onBeforeAnswer} variant={variant} />
      </QueryClientProvider>,
    );
  });
  await flush();
  return root;
}
const node = (root: import("react-test-renderer").ReactTestRenderer, id: string) =>
  root.root.findAll((n) => n.props.testID === id && typeof n.type !== "string")[0];

beforeEach(async () => {
  mockCalls.length = 0;
  mockPush.mockClear();
  mockPending.mockReset();
  await AsyncStorage.clear();
});

describe("#4541 T-31 — which orders get a hand-off", () => {
  it("only an unanswered, live after-purchase form for this order", () => {
    expect(handoffRow([row()], "order", ORDER)).not.toBeNull();
    expect(handoffRow([row({ mode: "required_step" })], "order", ORDER)).toBeNull();
    expect(handoffRow([row({ mode: "optional_on_page" })], "order", ORDER)).toBeNull();
    expect(handoffRow([row({ answered: true })], "order", ORDER)).toBeNull();
    expect(handoffRow([row({ formStatus: "closed" })], "order", ORDER)).toBeNull();
    expect(handoffRow([row()], "order", "other")).toBeNull();
  });
});

describe("#4541 T-31 — the success panel block", () => {
  it("shows the copy, then Answer now closes the sheet before pushing the form", async () => {
    mockPending.mockResolvedValue([row()]);
    const close = jest.fn(() => mockCalls.push("close"));
    const root = await render("block", close);
    const json = JSON.stringify(root.toJSON());
    expect(json).toContain(forms.handoffTitle);
    expect(json).toContain("A few questions from Harmattan Club. About a minute. Your ticket is ready either way.");
    await act(async () => {
      node(root, "form-handoff-answer").props.onPress();
    });
    expect(mockCalls).toEqual(["close", `push:/form/${FORM}?event=${EVENT}&as=order&sid=${ORDER}&from=purchase`]);
  });

  it("shows once per order", async () => {
    mockPending.mockResolvedValue([row()]);
    await render("block", jest.fn());
    expect(await AsyncStorage.getItem(handoffSeenKey("order", ORDER))).not.toBeNull();
    const again = await render("block", jest.fn());
    expect(again.toJSON()).toBeNull();
  });

  it("Later hides the block without opening anything", async () => {
    mockPending.mockResolvedValue([row()]);
    const close = jest.fn();
    const root = await render("block", close);
    await act(async () => {
      node(root, "form-handoff-later").props.onPress();
    });
    expect(root.toJSON()).toBeNull();
    expect(close).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("nothing for an answered order", async () => {
    mockPending.mockResolvedValue([row({ answered: true })]);
    expect((await render("block", jest.fn())).toJSON()).toBeNull();
  });
});

describe("#4541 T-31 — the sent-ticket row", () => {
  it("reads One more thing from {brand} and opens the form", async () => {
    mockPending.mockResolvedValue([row()]);
    const done = jest.fn(() => mockCalls.push("close"));
    const root = await render("row", done);
    expect(JSON.stringify(root.toJSON())).toContain("One more thing from Harmattan Club");
    await act(async () => {
      node(root, "form-handoff-row").props.onPress();
    });
    expect(mockCalls[0]).toBe("close");
    expect(mockCalls[1]).toBe(`push:/form/${FORM}?event=${EVENT}&as=order&sid=${ORDER}&from=purchase`);
  });
});

describe("#4541 T-31 — mounts", () => {
  const src = path.join(__dirname, "..", "..", "..");
  const cart = fs.readFileSync(path.join(src, "components", "expandedCard", "TicketCartSheet.tsx"), "utf8");
  it("the cart's success panel mounts the block after the success line and before the share card", () => {
    const line = cart.indexOf("Your booking is confirmed and your tickets are ready.");
    const block = cart.indexOf("<FormHandoffBlock");
    const footer = cart.indexOf('terminalOutcome.outcome === "succeeded" ? successFooter : null');
    expect(line).toBeGreaterThan(0);
    expect(block).toBeGreaterThan(line);
    expect(footer).toBeGreaterThan(block);
    expect(cart).toContain("terminalOutcome.attachedToAccount !== false");
  });

  it("the cart asks questions only when the screen says so (events and experiences, never trips)", () => {
    expect(cart).toContain("brandFormQuestions = false");
    const event = fs.readFileSync(path.join(src, "screens", "Event", "ConsumerEventDetailScreen.tsx"), "utf8");
    const experience = fs.readFileSync(path.join(src, "screens", "Experience", "ConsumerExperienceDetailScreen.tsx"), "utf8");
    const trip = fs.readFileSync(path.join(src, "screens", "Trip", "ConsumerTripDetailScreen.tsx"), "utf8");
    expect(event).toMatch(/<TicketCartSheet[\s\S]{0,80}brandFormQuestions/);
    expect(experience).toMatch(/<TicketCartSheet[\s\S]{0,80}brandFormQuestions/);
    expect(trip).not.toContain("brandFormQuestions");
    expect(event).toContain("payload.brandFormStep === 1");
    expect(experience).toContain("payload.brandFormStep === 1");
  });

  it("the sent sheet gets the order for its row", () => {
    const sent = fs.readFileSync(path.join(src, "components", "purchases", "NativeCheckoutSentSheet.tsx"), "utf8");
    expect(sent).toContain('variant="row"');
    for (const screen of ["Event/ConsumerEventDetailScreen.tsx", "Experience/ConsumerExperienceDetailScreen.tsx", "Trip/ConsumerTripDetailScreen.tsx"]) {
      expect(fs.readFileSync(path.join(src, "screens", screen), "utf8")).toContain("orderId={sentTicket?.orderId ?? null}");
    }
  });
});
