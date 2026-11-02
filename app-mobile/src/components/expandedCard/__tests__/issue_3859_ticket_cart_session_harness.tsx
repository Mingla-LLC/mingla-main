/* eslint-disable @typescript-eslint/no-require-imports, react/display-name */
import React from "react";

const TestRenderer =
  // @ts-expect-error react-test-renderer ships without declarations here.
  require("react-test-renderer") as typeof import("react-test-renderer");

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

jest.mock("react-native", () => {
  const React = require("react");
  const host =
    (name: string) =>
    (props: { children?: unknown }) =>
      React.createElement(name, props, props.children ?? null);
  return {
    __esModule: true,
    ActivityIndicator: host("ActivityIndicator"),
    Pressable: host("Pressable"),
    Switch: host("Switch"),
    Text: host("Text"),
    TextInput: host("TextInput"),
    View: host("View"),
    Linking: { openURL: jest.fn(() => Promise.resolve()) },
    Platform: { OS: "ios" },
    StyleSheet: { create: <T,>(styles: T): T => styles },
    useWindowDimensions: () => ({ width: 390, height: 844 }),
  };
});

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("expo-haptics", () => ({
  ImpactFeedbackStyle: { Medium: "medium" },
  NotificationFeedbackType: { Error: "error" },
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  selectionAsync: jest.fn(() => Promise.resolve()),
}));

jest.mock("@mingla/offering-rendering", () => {
  const React = require("react");
  return {
    __esModule: true,
    QuantityRow: (props: {
      ticket: { id: string; name: string };
      quantity: number;
    }) =>
      React.createElement(
        "QuantityRow",
        { ...props, testID: `quantity-${props.ticket.id}` },
        props.ticket.name,
      ),
    tripTierDepositTodayCents: () => null,
  };
}, { virtual: true });

jest.mock("@mingla/offering-rendering/currencyGlyph", () => ({
  withCurrencyGlyph: (value: string) => value,
}));

jest.mock("@mingla/card-identity/phone.mjs", () => ({
  resolveUserPhoneE164: (value: unknown) =>
    typeof value === "string" && /^\+[1-9]\d{7,14}$/.test(value.trim())
      ? value.trim()
      : null,
}), { virtual: true });

jest.mock("@mingla/phone-input", () => ({
  COUNTRIES: [{ code: "US", dialCode: "+1" }],
  getCountryByCode: (code: string) =>
    code === "US" ? { code: "US", dialCode: "+1" } : undefined,
}), { virtual: true });

jest.mock("../../../payments/explorerCheckoutContact.mjs", () => {
  const fields = ["name", "email", "phone"] as const;
  const authority = {
    awaitingAccount: "awaiting_account",
    resolvedAccount: "resolved_account",
    buyerOwned: "buyer_owned",
  } as const;
  const validate = (input: { name?: unknown; email?: unknown; phone?: unknown }) => {
    const normalized = {
      name: typeof input.name === "string" ? input.name.trim() : "",
      email: typeof input.email === "string" ? input.email.trim() : "",
      phone: typeof input.phone === "string" && /^\+[1-9]\d{7,14}$/.test(input.phone.trim())
        ? input.phone.trim()
        : "",
    };
    const valid = {
      name: normalized.name.length >= 2,
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.email),
      phone: normalized.phone.length > 0,
    };
    return {
      normalized,
      valid,
      invalidFields: fields.filter((field) => !valid[field]),
      isValid: valid.name && valid.email && valid.phone,
    };
  };
  return {
    EXPLORER_CHECKOUT_CONTACT_FIELDS: fields,
    EXPLORER_CHECKOUT_CONTACT_SEED_AUTHORITY: authority,
    explorerCheckoutContactFieldsForEditor: (
      validation: { invalidFields: readonly string[] },
      editAll: boolean,
    ) => editAll ? [...fields] : [...validation.invalidFields],
    explorerCheckoutContactSeedDecision: (
      current: string,
      visible: boolean,
      isValid: boolean,
    ) => {
      if (!visible) {
        return { shouldApply: false, nextAuthority: authority.awaitingAccount };
      }
      if (current !== authority.awaitingAccount) {
        return { shouldApply: false, nextAuthority: current };
      }
      return {
        shouldApply: true,
        nextAuthority: isValid
          ? authority.resolvedAccount
          : authority.awaitingAccount,
      };
    },
    validateExplorerCheckoutContact: validate,
  };
});

jest.mock("../../ui/BaseBottomSheet", () => {
  const React = require("react");
  return {
    BaseBottomSheet: (props: { visible: boolean; children?: unknown }) =>
      props.visible
        ? React.createElement("BaseBottomSheet", props, props.children ?? null)
        : null,
  };
});

jest.mock("../../ui/Icon", () => {
  const React = require("react");
  return { Icon: (props: unknown) => React.createElement("Icon", props) };
});

jest.mock("../../onboarding/PhoneInput", () => {
  const React = require("react");
  return {
    PhoneInput: (props: unknown) => React.createElement("PhoneInput", props),
  };
});

jest.mock("../ConsumerCartCard", () => {
  const React = require("react");
  return {
    ConsumerCartCard: (props: { children?: unknown }) =>
      React.createElement("ConsumerCartCard", props, props.children ?? null),
  };
});

jest.mock("../ConsumerIntakeForm", () => {
  const React = require("react");
  return {
    ConsumerIntakeForm: (props: unknown) =>
      React.createElement("ConsumerIntakeForm", props),
  };
});

jest.mock("../EventDayChooser", () => {
  const React = require("react");
  return {
    EventDayChooser: (props: unknown) =>
      React.createElement("EventDayChooser", props),
  };
});

jest.mock("../../../hooks/useAppLayout", () => ({
  BOTTOM_NAV_CONTENT_HEIGHT: 72,
}));

// #3872 moved checkout totals behind the live quote hook. These #3859 session
// tests exercise auth/contact state only, so keep the money rail inert and
// avoid importing the native Supabase/app-version stack into this render unit.
// #4174 — money-display render tests set `mockTicketQuote.data` to a server
// quote; every other suite keeps the inert `null` default.
export const mockTicketQuote: { data: unknown; input: unknown } = {
  data: null,
  input: null,
};
jest.mock("../../../hooks/useTicketQuote", () => ({
  useTicketQuote: (input: unknown) => {
    mockTicketQuote.input = input;
    return {
      query: { data: mockTicketQuote.data, isFetching: false, isError: false },
      isDebouncing: false,
    };
  },
}));

jest.mock("../../../services/postHogService", () => ({
  postHogService: { capture: jest.fn() },
}));

jest.mock("../../../services/consentService", () => ({
  recordConsent: jest.fn(() => Promise.resolve({ ok: true, inserted: 1, deduped: 0 })),
}));

jest.mock("../../../services/tripIntakeSchemaService", () => ({
  buildIntakeFormData: () => [],
  createIntakeUploadSessionId: () => "3859-upload-session",
  revokeTripIntakeFileClaim: jest.fn(() => Promise.resolve()),
  uploadTripIntakeFile: jest.fn(() => Promise.resolve()),
  validateAnswerAgainstSchema: () => [],
}));

import {
  TicketCartSheet,
  type TicketCartSheetProps,
} from "../TicketCartSheet";

export const TEST_TICKET_ID = "ticket-3859";

const ticket = {
  id: TEST_TICKET_ID,
  name: "Weekend pass",
  description: null,
  priceGbp: 120,
  priceAllInGbp: 120,
  currency: "USD",
  capacity: 20,
  isUnlimited: false,
  isFree: false,
  minPurchaseQty: 1,
  maxPurchaseQty: 10,
  visibility: "visible",
  availableAt: "online",
  saleStartAt: null,
  saleEndAt: null,
  displayOrder: 0,
};

export const makeTicketCartProps = (
  overrides: Partial<TicketCartSheetProps> = {},
): TicketCartSheetProps => ({
  visible: true,
  eventId: "event-3859",
  tickets: [ticket] as TicketCartSheetProps["tickets"],
  fallbackCurrency: "USD",
  initialTicketTypeId: TEST_TICKET_ID,
  initialQuantity: 2,
  buyerName: "",
  buyerEmail: "",
  buyerPhone: "",
  buyerCountryCode: "US",
  buyerUserId: null,
  isSubmitting: false,
  onCancel: jest.fn(),
  onCheckout: jest.fn(),
  ...overrides,
});

export const mountTicketCart = (props: TicketCartSheetProps) => {
  let renderer: ReturnType<typeof TestRenderer.create> | null = null;
  TestRenderer.act(() => {
    renderer = TestRenderer.create(<TicketCartSheet {...props} />);
  });
  if (renderer === null) throw new Error("TicketCartSheet did not mount");
  return renderer;
};

export const updateTicketCart = (
  renderer: ReturnType<typeof TestRenderer.create>,
  props: TicketCartSheetProps,
): void => {
  TestRenderer.act(() => {
    renderer.update(<TicketCartSheet {...props} />);
  });
};

export const renderedText = (
  renderer: ReturnType<typeof TestRenderer.create>,
): string[] =>
  renderer.root.findAllByType("Text" as never).flatMap((node) =>
    node.children.filter((child): child is string => typeof child === "string")
  );

export { TestRenderer };
