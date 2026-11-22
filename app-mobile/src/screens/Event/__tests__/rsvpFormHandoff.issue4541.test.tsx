/* eslint-disable @typescript-eslint/no-require-imports, import/first -- jest doubles are declared before the modules they replace */
/**
 * #4541 A3 — "After they RSVP" in the app: the hand-off block lives inside the
 * shared RSVP success popup, a modal the block could not close before. The
 * popup's `formHandoff` slot now also takes a function given the popup's own
 * close, so "Answer now" closes the popup first and then opens
 * `/form/{formId}?event=&as=rsvp&sid=&from=rsvp` (never a form under a modal).
 * A plain node still works.
 *
 * Red on revert of: the popup calling a function slot with its close
 * (`resolveFormHandoff`), or the event screen passing `formHandoff` with the
 * block's `onBeforeAnswer={close}`. Runs under app-mobile/jest.issue2774.render.cjs.
 */
import React from "react";

const TestRenderer = require("react-test-renderer") as typeof import("react-test-renderer");
const { act } = TestRenderer;
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });

// react-test-renderer has no portals: draw the RN-web Modal's children in place.
jest.mock("react-native", () => {
  const RN = jest.requireActual("react-native");
  const ReactLib = jest.requireActual("react");
  return {
    ...RN,
    Modal: ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
      visible ? ReactLib.createElement(ReactLib.Fragment, null, children) : null,
  };
});
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
jest.mock("../../../components/forms/RsvpFormWebDateInput", () => ({ RsvpFormWebDateInput: () => null }), { virtual: true });
jest.mock("../../../components/ui/Icon", () => ({ Icon: () => null }));
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
import { RsvpSuccessPopup, resolveFormHandoff } from "@mingla/offering-rendering/RsvpSuccessPopup";
import { createThemePalette } from "@mingla/offering-rendering/themePalette";
import { MINGLA_DEFAULT_THEME } from "@mingla/offering-rendering/designTokens";
import { FormHandoffBlock } from "../../../components/forms/FormHandoffBlock";
import type { PendingBrandForm } from "../../../services/brandFormService";

const fs = require("node:fs") as typeof import("node:fs");
const path = require("node:path") as typeof import("node:path");

const FORM = "45410000-0000-4000-8000-000000000004";
const EVENT = "45410000-0000-4000-8000-0000000000e1";
const RSVP = "45410000-0000-4000-8000-0000000000b1";

const pendingRow = (): PendingBrandForm => ({
  eventId: EVENT, eventTitle: "Detty", eventStatus: "scheduled", subject: { kind: "rsvp", id: RSVP },
  mode: "after_purchase", required: false, formId: FORM, formName: "Guest details", formStatus: "live",
  answered: false, answeredSource: null, brand: { displayName: "Harmattan Club" },
});

const details = {
  eventName: "Detty",
  dateLine: "Sat 20 Dec",
  venueLine: "Lagos",
  guestName: "Ada",
  status: "going" as const,
  plusGuests: [],
  confirmationToken: null,
  credentials: [],
  anonymousRecovery: [],
};
const theme = { ...MINGLA_DEFAULT_THEME } as unknown as Parameters<typeof createThemePalette>[0];
const palette = createThemePalette(theme);

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
};
const node = (root: import("react-test-renderer").ReactTestRenderer, id: string) =>
  root.root.findAll((n) => n.props.testID === id && typeof n.type !== "string")[0];

beforeEach(async () => {
  mockCalls.length = 0;
  mockPush.mockClear();
  mockPending.mockReset();
  await AsyncStorage.clear();
});

describe("#4541 A3 — the RSVP popup's hand-off slot", () => {
  it("a function slot is called with the popup's close; a node is drawn as is", () => {
    const close = jest.fn();
    const seen: Array<() => void> = [];
    resolveFormHandoff((c) => {
      seen.push(c);
      return null;
    }, close);
    expect(seen).toEqual([close]);
    const plain = <></>;
    expect(resolveFormHandoff(plain, close)).toBe(plain);
    expect(resolveFormHandoff(undefined, close)).toBeUndefined();
  });

  it("Answer now closes the popup first, then opens the form with the full route", async () => {
    mockPending.mockResolvedValue([pendingRow()]);
    const onClose = jest.fn(() => mockCalls.push("close"));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let root!: import("react-test-renderer").ReactTestRenderer;
    await act(async () => {
      root = TestRenderer.create(
        <QueryClientProvider client={client}>
          <RsvpSuccessPopup
            visible
            palette={palette}
            theme={theme}
            details={details}
            showCalendarNudge={false}
            onClose={onClose}
            formHandoff={(close: () => void) => (
              <FormHandoffBlock kind="rsvp" subjectId={RSVP} from="rsvp" onBeforeAnswer={close} />
            )}
          />
        </QueryClientProvider>,
      );
    });
    await flush();
    expect(node(root, "issue-4541-rsvp-form-handoff")).toBeDefined();
    await act(async () => {
      node(root, "form-handoff-answer").props.onPress();
    });
    expect(mockCalls).toEqual(["close", `push:/form/${FORM}?event=${EVENT}&as=rsvp&sid=${RSVP}&from=rsvp`]);
    act(() => root.unmount());
  });

  it("the event screen hands the block the popup's close", () => {
    const screen = fs.readFileSync(path.resolve(__dirname, "../ConsumerEventDetailScreen.tsx"), "utf8");
    expect(screen).toMatch(/formHandoff: rsvpFormHandoff,/);
    expect(screen).toMatch(/\(close: \(\) => void\): React\.ReactNode =>/);
    expect(screen).toMatch(/kind="rsvp"\s+subjectId=\{rsvpHandoffId\}\s+from="rsvp"\s+onBeforeAnswer=\{close\}/);
  });
});
