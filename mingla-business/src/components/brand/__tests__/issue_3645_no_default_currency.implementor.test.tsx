/**
 * #3645 — brand creation saves NO currency until the organiser picks a payout
 * country.
 *
 * Before: finishing the Look step wrote `brands.default_currency` from a rail
 * resolver whose fallback is the United Kingdom, so a brand with no address was
 * saved in pounds before its organiser chose anything, and its drafts were
 * then stamped in pounds.
 *
 * Now: the Payouts step shows a payout-country row listing every supported
 * country, with nothing preselected. Skipping writes nothing. Picking writes
 * that country's currency (or, for Nigeria, makes the same switch call the bank
 * screens make). A brand that already has a payment account is locked.
 */
import React from "react";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

import { BRAND_CREATION_COPY, BrandCreationFlow } from "../BrandCreationFlow";
import { PAYOUT_COUNTRY_FIELD_COPY } from "../BrandPayoutCountryField";
import {
  brandNeedsPayoutCountry,
  PAYOUT_COUNTRY_PROMPT_COPY,
  PayoutCountryInlinePrompt,
} from "../PayoutCountryInlinePrompt";
import { STRIPE_SUPPORTED_COUNTRIES } from "../../../constants/stripeSupportedCountries";
import { NIGERIA_BANK_CONNECT_RAIL } from "../../../utils/bankConnectRail";
import {
  PAYOUT_COUNTRY_PAYMENT_ACCOUNT_LOCKED_COPY,
  PAYOUT_COUNTRY_SWITCH_FAILED_COPY,
} from "../../../utils/payoutCountrySwitchCopy";
import type { Brand } from "../../../types/brand";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const NIGERIA = NIGERIA_BANK_CONNECT_RAIL.countryCode;
const routerPush = jest.fn();
const createBrand = jest.fn<(input: unknown) => Promise<Brand>>();
const updateBrand = jest.fn<(input: unknown) => Promise<Brand>>();
const selectProvider = jest.fn<(brandId: string) => Promise<void>>();
const clearProvider = jest.fn<(brandId: string) => Promise<void>>();
let stripeStatus: "not_connected" | "onboarding" | "active" | "restricted" =
  "not_connected";

const BRAND: Brand = {
  id: "36450000-0000-4000-8000-000000000001",
  displayName: "Issue 3645 No Currency",
  slug: "issue3645nocurrency",
  address: null,
  coverHue: 25,
  accountId: "account-3645",
  role: "owner",
  stats: { events: 0, followers: 0, rev: 0, rev7d: 0, attendees: 0 },
  currentLiveEvent: null,
  stripeStatus: "not_connected",
};

jest.mock("expo-router", () => ({
  useRouter: () => ({
    push: (...args: unknown[]) => routerPush(...args),
    replace: jest.fn(),
    canGoBack: () => false,
  }),
  useLocalSearchParams: () => ({}),
}));
jest.mock("expo-haptics", () => ({
  ImpactFeedbackStyle: { Medium: "Medium" },
  impactAsync: jest.fn(),
}));
jest.mock("../../../hooks/usePartnerStripe", () => ({
  usePartnerStripeStatus: () => ({ data: { partner_enabled: false } }),
}));
jest.mock("../../../context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "account-3645" },
    isAuthReady: true,
    loading: false,
    session: { access_token: "test" },
  }),
}));
jest.mock("../../../store/currentBrandStore", () => ({
  useCurrentBrandStore: (
    selector: (state: { setCurrentBrand: () => void }) => unknown,
  ) => selector({ setCurrentBrand: jest.fn() }),
}));
jest.mock("../../../hooks/useCreatorAccount", () => ({
  useUpdateCreatorAccount: () => ({
    mutateAsync: jest.fn(() => Promise.resolve(undefined)),
  }),
}));
jest.mock("../../../hooks/useBrands", () => ({
  SlugCollisionError: class SlugCollisionError extends Error {},
  useBrand: () => ({
    data: null,
    isFetched: false,
    isError: false,
    refetch: jest.fn(),
  }),
  useCreateBrand: () => ({
    mutateAsync: (input: unknown) => createBrand(input),
    isPending: false,
  }),
  useUpdateBrand: () => ({
    mutateAsync: (input: unknown) => updateBrand(input),
    isPending: false,
  }),
}));
jest.mock("../../../hooks/useBrandStripeStatus", () => ({
  useBrandStripeStatus: () => ({
    data: { status: stripeStatus },
    isFetched: true,
    isError: false,
    error: null,
    refetch: jest.fn(),
  }),
}));
jest.mock("../../../hooks/useCanManageBrandPayments", () => ({
  useCanManageBrandPayments: () => ({
    allowed: true,
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  }),
}));
jest.mock("../../../hooks/useCurrentBrandRole", () => ({
  useCurrentBrandRole: () => ({
    role: "brand_owner",
    accepted: true,
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  }),
}));
jest.mock("../../../services/brandPaystackService", () => ({
  selectPaystackProvider: (brandId: string) => selectProvider(brandId),
  clearPaystackProvider: (brandId: string) => clearProvider(brandId),
}));
jest.mock("../../../lib/netinfoSafe", () => ({ useNetInfoSafe: () => null }));
jest.mock("../../../diagnostics/sentry", () => ({ captureException: jest.fn() }));
jest.mock("../../../wrappers/useKeyboardIsVisible", () => ({
  useKeyboardIsVisible: () => false,
}));
jest.mock("../../../services/brandInvitationsService", () => ({
  inviteBrandMember: jest.fn(),
}));
// The country sheet is the bank screens' own; here it is a probe that exposes
// the list it was handed and lets the test pick from it.
jest.mock("../BrandStripeCountryPicker", () => ({
  PayoutCountrySheet: (props: Record<string, unknown>) =>
    React.createElement("PayoutCountrySheet", props),
}));
jest.mock("../../ui/Button", () => ({
  Button: (props: Record<string, unknown>) =>
    React.createElement("Button", {
      ...props,
      accessibilityRole: "button",
      accessibilityLabel: props.accessibilityLabel ?? props.label,
    }),
}));
jest.mock("../../ui/GlassCard", () => ({
  GlassCard: ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement("GlassCard", props, children),
}));
jest.mock("../../ui/Icon", () => ({
  Icon: (props: Record<string, unknown>) => React.createElement("Icon", props),
}));
jest.mock("../../ui/Input", () => ({
  Input: (props: Record<string, unknown>) => React.createElement("Input", props),
}));
jest.mock("../../ui/Stepper", () => ({
  Stepper: (props: Record<string, unknown>) => React.createElement("Stepper", props),
}));
jest.mock("../../ui/Toast", () => ({
  Toast: (props: Record<string, unknown>) => React.createElement("Toast", props),
}));
jest.mock("../../ui/CoverPickerSheet", () => ({
  CoverPickerSheet: (props: Record<string, unknown>) =>
    React.createElement("CoverPickerSheet", props),
}));
jest.mock("../../location/MapboxAddressInput", () => ({
  MapboxAddressInput: (props: Record<string, unknown>) =>
    React.createElement("MapboxAddressInput", props),
}));
jest.mock("../../ui/EventCoverMedia", () => ({
  EventCoverMedia: (props: Record<string, unknown>) =>
    React.createElement("EventCoverMedia", props),
}));

interface TestNode {
  type: unknown;
  props: Record<string, unknown>;
  children: (TestNode | string)[];
  findAll: (predicate: (node: TestNode) => boolean) => TestNode[];
}
interface Renderer {
  root: TestNode;
  unmount: () => void;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Renderer;
  act: (callback: () => Promise<void> | void) => Promise<void> | void;
};

const byLabel = (root: TestNode, label: string): TestNode[] =>
  root.findAll((node) => node.props.accessibilityLabel === label);
const byTestId = (root: TestNode, testID: string): TestNode[] =>
  root.findAll((node) => node.props.testID === testID);
const byType = (root: TestNode, type: string): TestNode[] =>
  root.findAll((node) => node.type === type);
const allText = (root: TestNode): string =>
  root
    .findAll((node) => node.type === "Text")
    .map((node) =>
      node.children.filter((c): c is string => typeof c === "string").join(""),
    )
    .join("\n");
const press = (node: TestNode): void => {
  const onPress = node.props.onPress;
  if (typeof onPress !== "function") throw new Error("Expected onPress");
  onPress({});
};
/** Lets lazy modules and awaited writes settle. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) {
    await TestRenderer.act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
  }
};

const currencyWrites = (): unknown[] =>
  updateBrand.mock.calls
    .map((call) => call[0] as { patch?: Record<string, unknown> })
    .filter((input) => input.patch !== undefined && "defaultCurrency" in input.patch);

/** Drives the flow from the name step to the Payouts step. */
async function mountAtPayouts(created: Brand): Promise<Renderer> {
  createBrand.mockResolvedValue(created);
  let tree!: Renderer;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(
      <BrandCreationFlow onComplete={jest.fn()} onCancel={jest.fn()} />,
    );
  });
  await TestRenderer.act(async () => {
    const input = byLabel(tree.root, BRAND_CREATION_COPY.step1.nameLabel)[0]!;
    (input.props.onChangeText as (value: string) => void)(created.displayName);
  });
  await TestRenderer.act(async () => {
    press(byLabel(tree.root, BRAND_CREATION_COPY.step1.cta)[0]!);
    await Promise.resolve();
    await Promise.resolve();
  });
  await TestRenderer.act(async () => {
    press(byLabel(tree.root, BRAND_CREATION_COPY.step2.skip)[0]!);
  });
  await TestRenderer.act(async () => {
    press(byLabel(tree.root, BRAND_CREATION_COPY.step3.cta)[0]!);
    await Promise.resolve();
  });
  await settle();
  return tree;
}

const trigger = (tree: Renderer): TestNode =>
  byTestId(tree.root, "brand-payout-country-field-trigger")[0]!;
const primary = (tree: Renderer): TestNode =>
  byLabel(tree.root, BRAND_CREATION_COPY.step4.primary)[0]!;

async function openSheet(tree: Renderer): Promise<TestNode> {
  await TestRenderer.act(async () => {
    press(trigger(tree));
  });
  await settle();
  const sheet = byType(tree.root, "PayoutCountrySheet")[0];
  if (sheet === undefined) throw new Error("Country sheet did not open.");
  return sheet;
}

async function pick(tree: Renderer, countryCode: string): Promise<void> {
  const sheet = await openSheet(tree);
  await TestRenderer.act(async () => {
    (sheet.props.onPick as (code: string) => void)(countryCode);
  });
  await settle();
}

beforeEach(() => {
  routerPush.mockReset();
  createBrand.mockReset();
  updateBrand.mockReset();
  selectProvider.mockReset();
  clearProvider.mockReset();
  stripeStatus = "not_connected";
  updateBrand.mockImplementation(async (input) => ({
    ...BRAND,
    ...((input as { patch: Partial<Brand> }).patch),
  }));
  selectProvider.mockResolvedValue(undefined);
  clearProvider.mockResolvedValue(undefined);
});

describe("#3645 no currency is saved until a payout country is chosen", () => {
  test("a brand with no address reaches Payouts with NO currency written and nothing preselected", async () => {
    const tree = await mountAtPayouts(BRAND);

    expect(currencyWrites()).toEqual([]);
    expect(updateBrand).not.toHaveBeenCalledWith(
      expect.objectContaining({ patch: { defaultCurrency: "GBP" } }),
    );
    const text = allText(tree.root);
    expect(text).toContain(PAYOUT_COUNTRY_FIELD_COPY.empty);
    expect(text).toContain(BRAND_CREATION_COPY.step4.countryHelper);
    expect(text).not.toContain("United Kingdom");
    expect(text).not.toContain("GBP");
    expect(text).not.toMatch(/Stripe|Paystack/);
    // Payout setup cannot start from a country nobody chose.
    expect(primary(tree).props.disabled).toBe(true);
    await TestRenderer.act(async () => {
      press(primary(tree));
    });
    expect(routerPush).not.toHaveBeenCalled();
    await TestRenderer.act(async () => tree.unmount());
  });

  test("an address country is not a choice either: still no currency", async () => {
    for (const countryCode of ["GB", "US", NIGERIA]) {
      updateBrand.mockClear();
      selectProvider.mockClear();
      const tree = await mountAtPayouts({ ...BRAND, countryCode });
      expect(currencyWrites()).toEqual([]);
      expect(selectProvider).not.toHaveBeenCalled();
      expect(allText(tree.root)).toContain(PAYOUT_COUNTRY_FIELD_COPY.empty);
      await TestRenderer.act(async () => tree.unmount());
    }
  });

  test("skipping leaves the brand with no currency and still opens the creators", async () => {
    const tree = await mountAtPayouts(BRAND);
    await TestRenderer.act(async () => {
      press(byLabel(tree.root, BRAND_CREATION_COPY.step4.secondary)[0]!);
    });
    await settle();
    expect(currencyWrites()).toEqual([]);
    expect(selectProvider).not.toHaveBeenCalled();
    for (const kind of ["event", "trip", "experience", "rsvp", "venue"]) {
      expect(
        byTestId(tree.root, `offering-chooser-${kind}`).length,
      ).toBeGreaterThan(0);
    }
    await TestRenderer.act(async () => tree.unmount());
  });

  test("the country list is every supported country plus Nigeria", async () => {
    const tree = await mountAtPayouts(BRAND);
    const sheet = await openSheet(tree);
    const listed = (
      sheet.props.countriesQuery as { data: readonly { country: string }[] }
    ).data.map((country) => country.country);
    expect(listed).toEqual(STRIPE_SUPPORTED_COUNTRIES.map((c) => c.country));
    expect(listed.length).toBeGreaterThan(30);
    const extras = sheet.props.extraOptions as readonly {
      code: string;
      sublabel?: string;
    }[];
    expect(extras.map((option) => option.code)).toEqual([NIGERIA]);
    expect(JSON.stringify(extras)).not.toMatch(/Stripe|Paystack/);
    expect(sheet.props.selectedCode).toBeNull();
    await TestRenderer.act(async () => tree.unmount());
  });

  test("picking a country writes exactly that country's currency and unlocks payout setup", async () => {
    const tree = await mountAtPayouts(BRAND);
    await pick(tree, "FR");

    expect(currencyWrites()).toEqual([
      expect.objectContaining({
        brandId: BRAND.id,
        patch: { defaultCurrency: "EUR" },
      }),
    ]);
    expect(selectProvider).not.toHaveBeenCalled();
    expect(clearProvider).not.toHaveBeenCalled();
    const text = allText(tree.root);
    expect(text).toContain("France · EUR");
    expect(text).toContain(PAYOUT_COUNTRY_FIELD_COPY.chosen("EUR"));
    expect(primary(tree).props.disabled).toBe(false);

    await TestRenderer.act(async () => {
      press(primary(tree));
    });
    // The chosen country travels to the bank screen.
    expect(routerPush).toHaveBeenCalledWith(
      `/brand/${BRAND.id}/connect?from=brand-create&country=FR`,
    );
    await TestRenderer.act(async () => tree.unmount());
  });

  test("changing the pick rewrites the currency to the new country", async () => {
    const tree = await mountAtPayouts(BRAND);
    await pick(tree, "US");
    await pick(tree, "GB");
    expect(
      currencyWrites().map(
        (input) => (input as { patch: { defaultCurrency: string } }).patch
          .defaultCurrency,
      ),
    ).toEqual(["USD", "GBP"]);
    expect(allText(tree.root)).toContain("United Kingdom · GBP");
    await TestRenderer.act(async () => tree.unmount());
  });

  test("picking Nigeria makes the bank screens' switch call and writes no currency from the client", async () => {
    const tree = await mountAtPayouts(BRAND);
    await pick(tree, NIGERIA);

    expect(selectProvider).toHaveBeenCalledTimes(1);
    expect(selectProvider).toHaveBeenCalledWith(BRAND.id);
    expect(currencyWrites()).toEqual([]);
    expect(allText(tree.root)).toContain("Nigeria · NGN");
    expect(primary(tree).props.disabled).toBe(false);
    await TestRenderer.act(async () => {
      press(primary(tree));
    });
    // The saved brand row already says Nigeria; no country hint is needed.
    expect(routerPush).toHaveBeenCalledWith(
      `/brand/${BRAND.id}/connect?from=brand-create`,
    );

    // Leaving Nigeria reverses the switch, then saves the new currency.
    await pick(tree, "DE");
    expect(clearProvider).toHaveBeenCalledWith(BRAND.id);
    expect(currencyWrites()).toEqual([
      expect.objectContaining({ patch: { defaultCurrency: "EUR" } }),
    ]);
    await TestRenderer.act(async () => tree.unmount());
  });

  test("a failed pick chooses nothing, says so without naming a provider, and can be retried", async () => {
    selectProvider.mockRejectedValueOnce(
      new Error("brand-paystack-onboard: internal_error"),
    );
    const tree = await mountAtPayouts(BRAND);
    await pick(tree, NIGERIA);

    const text = allText(tree.root);
    expect(text).toContain(PAYOUT_COUNTRY_SWITCH_FAILED_COPY);
    expect(text).not.toMatch(/paystack|stripe|internal_error/i);
    expect(text).toContain(PAYOUT_COUNTRY_FIELD_COPY.empty);
    expect(primary(tree).props.disabled).toBe(true);

    await TestRenderer.act(async () => {
      press(byTestId(tree.root, "brand-payout-country-field-retry")[0]!);
    });
    await settle();
    expect(selectProvider).toHaveBeenCalledTimes(2);
    expect(allText(tree.root)).toContain("Nigeria · NGN");
    await TestRenderer.act(async () => tree.unmount());
  });

  test("a brand that already has a payment account is locked with the bank screen's sentence", async () => {
    stripeStatus = "onboarding";
    const tree = await mountAtPayouts({
      ...BRAND,
      stripeStatus: "onboarding",
      defaultCurrency: "GBP",
    });
    expect(allText(tree.root)).toContain(
      PAYOUT_COUNTRY_PAYMENT_ACCOUNT_LOCKED_COPY,
    );
    expect(trigger(tree).props.disabled).toBe(true);
    await TestRenderer.act(async () => {
      press(trigger(tree));
    });
    await settle();
    expect(byType(tree.root, "PayoutCountrySheet")).toHaveLength(0);
    expect(selectProvider).not.toHaveBeenCalled();
    expect(currencyWrites()).toEqual([]);
    await TestRenderer.act(async () => tree.unmount());
  });
});

describe("#3645 the inline prompt a creator shows for a price with no currency", () => {
  const render = async (
    brand: Brand | null,
    priced: boolean,
  ): Promise<Renderer> => {
    let tree!: Renderer;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        <PayoutCountryInlinePrompt brand={brand} priced={priced} />,
      );
    });
    await settle();
    return tree;
  };

  test("a free item never sees it", async () => {
    const tree = await render(BRAND, false);
    expect(allText(tree.root)).toBe("");
    await TestRenderer.act(async () => tree.unmount());
  });

  test("a brand that has a currency never sees it", async () => {
    const tree = await render({ ...BRAND, defaultCurrency: "EUR" }, true);
    expect(allText(tree.root)).toBe("");
    await TestRenderer.act(async () => tree.unmount());
  });

  test("no brand loaded yet renders nothing rather than crashing", async () => {
    const tree = await render(null, true);
    expect(allText(tree.root)).toBe("");
    await TestRenderer.act(async () => tree.unmount());
  });

  test("a price on a brand with no currency offers the same country choice in place", async () => {
    const tree = await render(BRAND, true);
    const text = allText(tree.root);
    expect(text).toContain(PAYOUT_COUNTRY_PROMPT_COPY.title);
    expect(text).toContain(PAYOUT_COUNTRY_FIELD_COPY.empty);
    expect(text).not.toMatch(/Stripe|Paystack/);

    await TestRenderer.act(async () => {
      press(byTestId(tree.root, "payout-country-inline-prompt-field-trigger")[0]!);
    });
    await settle();
    const sheet = byType(tree.root, "PayoutCountrySheet")[0]!;
    await TestRenderer.act(async () => {
      (sheet.props.onPick as (code: string) => void)("CA");
    });
    await settle();
    expect(updateBrand).toHaveBeenCalledWith(
      expect.objectContaining({ patch: { defaultCurrency: "CAD" } }),
    );
    await TestRenderer.act(async () => tree.unmount());
  });

  test("blank and missing currencies both count as none", () => {
    expect(brandNeedsPayoutCountry({ defaultCurrency: undefined })).toBe(true);
    expect(brandNeedsPayoutCountry({ defaultCurrency: "  " })).toBe(true);
    expect(brandNeedsPayoutCountry({ defaultCurrency: "ngn" })).toBe(false);
    expect(brandNeedsPayoutCountry(null)).toBe(false);
  });
});
