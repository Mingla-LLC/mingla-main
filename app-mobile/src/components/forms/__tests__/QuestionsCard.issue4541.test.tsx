/* eslint-disable @typescript-eslint/no-require-imports, import/first -- jest doubles are declared before the modules they replace */
/**
 * #4541 R2.6 (T-30) — the questions card and the "Still to answer" row.
 *
 *   - Each R2.6 state draws its line and tint; tapping opens the form with the
 *     full route (event, subject, opener).
 *   - A Maybe pass adds "Answering doesn't change your reply."
 *   - No card for a sent-ticket holder or an unclaimed plus-one (nothing in
 *     `brand_forms_my_pending` for them), for reservations, or while shared.
 *   - Loading and couldn't-load rows; Try again refetches.
 *   - "Still to answer · {n}" counts live, unanswered required or
 *     after-purchase forms only, and opens the first one.
 *   - The purchase page mounts the card after "Show at the door" and before
 *     Details; the pass sheet's [TRANSITIONAL] status line is gone.
 *
 * Red on revert of the state mapping, the route, or either mount. Runs under
 * app-mobile/jest.issue2774.render.cjs.
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
const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("../../../store/appStore", () => ({
  useAppStore: (select: (s: { user: { id: string } }) => unknown) => select({ user: { id: "user-a" } }),
}));
const mockPending = jest.fn();
jest.mock("../../../services/brandFormService", () => ({
  ...jest.requireActual("../../../services/brandFormService"),
  fetchMyPendingBrandForms: () => mockPending(),
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { QuestionsCard, questionsCardState } from "../QuestionsCard";
import { StillToAnswerRow, stillToAnswer } from "../StillToAnswerRow";
import type { PendingBrandForm } from "../../../services/brandFormService";

const forms = require("../../../i18n/locales/en/forms.json") as Record<string, string>;
const fs = require("node:fs") as typeof import("node:fs");
const path = require("node:path") as typeof import("node:path");

const FORM = "45410000-0000-4000-8000-000000000004";
const EVENT = "45410000-0000-4000-8000-0000000000e1";
const ORDER = "45410000-0000-4000-8000-0000000000a1";
const RSVP = "45410000-0000-4000-8000-0000000000b1";

const row = (over: Partial<PendingBrandForm> = {}): PendingBrandForm => ({
  eventId: EVENT,
  eventTitle: "Detty December",
  eventStatus: "scheduled",
  subject: { kind: "order", id: ORDER },
  mode: "after_purchase",
  required: false,
  formId: FORM,
  formName: "Guest details",
  formStatus: "live",
  answered: false,
  answeredSource: null,
  brand: { displayName: "Harmattan Club" },
  ...over,
});

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
};
async function render(node: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let root!: import("react-test-renderer").ReactTestRenderer;
  await act(async () => {
    root = TestRenderer.create(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
  });
  await flush();
  return root;
}
const text = (root: import("react-test-renderer").ReactTestRenderer): string =>
  JSON.stringify(root.toJSON() ?? "");
const node = (root: import("react-test-renderer").ReactTestRenderer, id: string) =>
  root.root.findAll((n) => n.props.testID === id && typeof n.type !== "string")[0];

beforeEach(() => {
  mockPush.mockReset();
  mockPending.mockReset();
});

describe("#4541 T-30 — card states", () => {
  it.each([
    [row(), "toAnswer", forms.cardToAnswer],
    [row({ mode: "required_step", required: true }), "required", forms.cardToAnswer],
    [row({ mode: "optional_on_page" }), "optional", forms.cardOptional],
    [row({ answered: true, answeredSource: "link" }), "answered", forms.cardAnswered],
    [row({ answered: true, answeredSource: "page" }), "answeredAtCheckout", forms.cardAnsweredAtCheckout],
    [row({ answered: true, formStatus: "closed" }), "closed", forms.cardClosed],
    [row({ eventStatus: "ended" }), "closed", forms.cardClosed],
    [row({ eventStatus: "cancelled" }), "closed", forms.cardClosed],
  ])("%#: %s", async (pending, state, line) => {
    expect(questionsCardState(pending)).toBe(state);
    mockPending.mockResolvedValue([pending]);
    const root = await render(<QuestionsCard subjectKind="order" subjectId={ORDER} from="ticket" />);
    expect(node(root, `form-card-${state}`)).toBeDefined();
    expect(text(root)).toContain(line);
    if (state === "required") expect(text(root)).toContain(forms.cardRequired);
    expect(node(root, "form-card").props.accessibilityLabel)
      .toBe(`Questions from Harmattan Club. Guest details. ${line}. Opens the form.`);
  });

  it("opens the form with the full route, closing a sheet first", async () => {
    const before = jest.fn();
    mockPending.mockResolvedValue([row({ subject: { kind: "rsvp", id: RSVP } })]);
    const root = await render(
      <QuestionsCard subjectKind="rsvp" subjectId={RSVP} eventId={EVENT} from="pass" maybe onBeforeOpen={before} />,
    );
    expect(text(root)).toContain(forms.cardMaybe);
    await act(async () => {
      node(root, "form-card").props.onPress();
    });
    expect(before).toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith(`/form/${FORM}?event=${EVENT}&as=rsvp&sid=${RSVP}&from=pass`);
  });

  it("no card when the list has nothing for this item (sent ticket, unclaimed plus-one), or for other kinds", async () => {
    mockPending.mockResolvedValue([row({ subject: { kind: "order", id: "other" } })]);
    expect((await render(<QuestionsCard subjectKind="order" subjectId={ORDER} from="ticket" />)).toJSON()).toBeNull();
    expect((await render(<QuestionsCard subjectKind="reservation" subjectId={ORDER} from="ticket" />)).toJSON()).toBeNull();
    expect((await render(<QuestionsCard subjectKind={null} subjectId={ORDER} from="ticket" />)).toJSON()).toBeNull();
  });

  it("couldn't load: one row, Try again refetches", async () => {
    mockPending.mockRejectedValue(new Error("down"));
    const root = await render(<QuestionsCard subjectKind="order" subjectId={ORDER} from="ticket" />);
    expect(text(root)).toContain(forms.cardLoadFailed);
    mockPending.mockResolvedValue([row()]);
    await act(async () => {
      node(root, "form-card-error").props.onPress();
    });
    await flush();
    expect(node(root, "form-card")).toBeDefined();
  });

  it("loading draws a skeleton row", async () => {
    mockPending.mockReturnValue(new Promise(() => undefined));
    const root = await render(<QuestionsCard subjectKind="order" subjectId={ORDER} from="ticket" />);
    expect(node(root, "form-card-loading")).toBeDefined();
  });
});

describe("#4541 T-30 — Still to answer", () => {
  it("counts live, unanswered required or after-purchase forms only", () => {
    expect(stillToAnswer([
      row(),
      row({ mode: "required_step", subject: { kind: "rsvp", id: RSVP } }),
      row({ mode: "optional_on_page" }),
      row({ answered: true }),
      row({ formStatus: "closed" }),
      row({ eventStatus: "ended" }),
    ])).toHaveLength(2);
  });

  it("shows the count and opens the first form", async () => {
    mockPending.mockResolvedValue([row(), row({ mode: "required_step", subject: { kind: "rsvp", id: RSVP } })]);
    const root = await render(<StillToAnswerRow />);
    expect(text(root)).toContain("Still to answer · 2");
    await act(async () => {
      node(root, "form-still-to-answer").props.onPress();
    });
    expect(mockPush).toHaveBeenCalledWith(`/form/${FORM}?event=${EVENT}&as=order&sid=${ORDER}&from=ticket`);
  });

  it("is absent with nothing to answer", async () => {
    mockPending.mockResolvedValue([row({ answered: true })]);
    expect((await render(<StillToAnswerRow />)).toJSON()).toBeNull();
  });
});

describe("#4541 T-30 — mounts", () => {
  const appRoot = path.join(__dirname, "..", "..", "..", "..");
  it("the purchase page mounts the card after Show at the door and before Details", () => {
    const page = fs.readFileSync(path.join(appRoot, "app", "purchases", "[kind]", "[id].tsx"), "utf8");
    const door = page.indexOf('t("ticket.showAtDoor")');
    const card = page.indexOf("<QuestionsCard");
    const details = page.indexOf('t("link.details")');
    expect(door).toBeGreaterThan(0);
    expect(card).toBeGreaterThan(door);
    expect(details).toBeGreaterThan(card);
  });

  it("the pass sheet mounts the card and its [TRANSITIONAL] status line is gone", () => {
    const sheet = fs.readFileSync(path.join(appRoot, "src", "components", "activity", "RsvpPassSheet.tsx"), "utf8");
    expect(sheet).toContain("<QuestionsCard");
    expect(sheet).not.toContain("issue-4541-rsvp-pass-questions");
    expect(sheet).not.toContain("[TRANSITIONAL] #4541");
  });

  it("Purchases shows the Still to answer row", () => {
    const list = fs.readFileSync(path.join(appRoot, "app", "purchases", "index.tsx"), "utf8");
    expect(list).toContain("<StillToAnswerRow />");
  });
});
