/**
 * #4111 Wave C — Brand edit → Contact: "Let guests message us".
 *
 * WHAT RUNS: the REAL BrandEditView (draft state, dirty check, Save), with
 * sibling chrome as inert stand-ins, then the REAL patch + row mapper the
 * edit route uses to write `brands.enquiries_enabled`.
 *
 * FAILS ON REVERT: remove the enquiriesEnabled branch from
 * computeDirtyFieldsPatch or mapUiToBrandUpdatePatch and the saved patch
 * loses `enquiries_enabled`.
 */
import React from "react";
import { describe, expect, jest, test } from "@jest/globals";

import type { Brand } from "../../../types/brand";
import { computeDirtyFieldsPatch } from "../../../utils/brandPatch";
import { mapBrandRowToUi, mapUiToBrandUpdatePatch, type BrandRow } from "../../../services/brandMapping";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mockLeaf(name: string) {
  const ReactLocal = jest.requireActual<typeof React>("react");
  return (props: Record<string, unknown>) =>
    ReactLocal.createElement(name, props, props.children as React.ReactNode);
}
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("../../../hooks/useSwitchAccount", () => ({
  useSwitchAccount: () => ({ signedInEmail: null, onSwitchAccount: () => undefined }),
}));
jest.mock("../../../constants/publicUrls", () => ({
  brandPublicUrl: (slug: string) => `https://business.example.test/b/${slug}`,
}));
jest.mock("../../../wrappers/SmartScrollView", () => {
  const ReactLocal = jest.requireActual<typeof React>("react");
  return {
    ScrollView: ReactLocal.forwardRef((props: { children?: React.ReactNode }, _ref) =>
      ReactLocal.createElement("mock-scroll", null, props.children)),
  };
});
jest.mock("../../ui/EventCoverMedia", () => ({ EventCoverMedia: mockLeaf("mock-cover") }));
jest.mock("../../ui/Avatar", () => ({ Avatar: mockLeaf("mock-avatar") }));
jest.mock("../../ui/Button", () => ({ Button: mockLeaf("mock-button") }));
jest.mock("../../ui/ConfirmDialog", () => ({ ConfirmDialog: mockLeaf("mock-confirm") }));
jest.mock("../../ui/GlassCard", () => ({ GlassCard: mockLeaf("mock-glass") }));
jest.mock("../../ui/Icon", () => ({ Icon: mockLeaf("mock-icon") }));
jest.mock("../../ui/Toast", () => ({ Toast: mockLeaf("mock-toast") }));
jest.mock("../../ui/TopBar", () => ({ TopBar: mockLeaf("mock-topbar") }));
jest.mock("../../ui/Input", () => ({ Input: mockLeaf("mock-input"), PHONE_COUNTRIES: [] }));
jest.mock("../BrandAvatarPickerSheet", () => ({ BrandAvatarPickerSheet: mockLeaf("mock-avatar-sheet") }));
jest.mock("../../ui/CoverPickerSheet", () => ({ CoverPickerSheet: mockLeaf("mock-cover-sheet") }));
jest.mock("../../theme/ThemeControlRow", () => ({ ThemeControlRow: mockLeaf("mock-theme-row") }));
jest.mock("../../theme/ThemeSheet", () => ({ ThemeSheet: mockLeaf("mock-theme-sheet") }));
jest.mock("../../auth/SignedInNotFoundNotice", () => ({ SignedInNotFoundNotice: mockLeaf("mock-not-found") }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Renderer;
  act: (fn: () => Promise<void> | void) => Promise<void>;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { BrandEditView } = require("../BrandEditView") as typeof import("../BrandEditView");

type Node = {
  type: unknown;
  props: Record<string, unknown>;
  children: (Node | string)[];
  findAll: (predicate: (node: Node) => boolean) => Node[];
};
type Renderer = { root: Node; unmount: () => void };

const BRAND = {
  id: "4111c000-0000-4000-8000-000000004111",
  displayName: "Lantern Room",
  slug: "lantern-room",
  role: "owner",
  stats: { events: 0, rev: 0 },
  currentLiveEvent: null,
  bio: "",
  tagline: "Supper club",
  contact: { email: "hello@lantern.test", phone: "" },
  links: {},
  countryCode: "US",
  coverHue: 25,
  enquiriesEnabled: true,
} as unknown as Brand;

const toggle = (renderer: Renderer): Node => {
  const found = renderer.root.findAll(
    (node) => node.props.accessibilityLabel === "Let guests message us" && node.props.accessibilityRole === "switch",
  );
  expect(found.length).toBeGreaterThan(0);
  return found[0];
};

describe("#4111 Let guests message us", () => {
  test("the Contact section has the switch and the privacy helper; turning it off saves enquiriesEnabled=false", async () => {
    const saved: Brand[] = [];
    let renderer!: Renderer;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(
        <BrandEditView
          brand={BRAND}
          accountId="4111c000-0000-4000-8000-0000000000aa"
          onCancel={() => undefined}
          onSave={async (next: Brand) => { saved.push(next); }}
          onAfterSave={() => undefined}
        />,
      );
    });
    const textOf = (node: Node): string => node.children.map((child) => (typeof child === "string" ? child : textOf(child))).join("");
    const allText = renderer.root.findAll((node) => node.type === "Text").map(textOf);
    expect(allText).toContain("Let guests message us");
    expect(allText).toContain(
      "Your email and phone stay private. Mingla uses them for reminders about waiting enquiries.",
    );
    expect(toggle(renderer).props.accessibilityState).toEqual({ checked: true });

    await TestRenderer.act(async () => { (toggle(renderer).props.onPress as () => void)(); });
    expect(toggle(renderer).props.accessibilityState).toEqual({ checked: false });

    // Save rides in the top bar (an inert stand-in here); press the real element it was handed.
    const saveElement = renderer.root
      .findAll((node) => node.type === "mock-topbar")
      .flatMap((node) => Object.values(node.props))
      .find((value): value is React.ReactElement<{ label?: string; onPress?: () => Promise<void> }> =>
        React.isValidElement(value) && (value.props as { label?: string }).label === "Save");
    expect(saveElement).toBeDefined();
    await TestRenderer.act(async () => { await saveElement?.props.onPress?.(); });
    expect(saved).toHaveLength(1);
    expect(saved[0].enquiriesEnabled).toBe(false);

    // The edit route turns the saved draft into the column write.
    const patch = computeDirtyFieldsPatch(saved[0], BRAND);
    expect(patch).toEqual({ enquiriesEnabled: false });
    expect(mapUiToBrandUpdatePatch(patch)).toEqual({ enquiries_enabled: false });
    await TestRenderer.act(async () => renderer.unmount());
  });

  test("the row mapper reads the column and leaves it out when the row has none", () => {
    const row = {
      id: BRAND.id, account_id: "acct", name: "Lantern Room", slug: "lantern-room", description: null,
      profile_photo_url: null, contact_email: null, contact_phone: null, social_links: {}, custom_links: [],
      display_attendee_count: true, tax_settings: {}, default_currency: "USD", stripe_connect_id: null,
      stripe_payouts_enabled: false, stripe_charges_enabled: false, address: null, cover_hue: 25,
      cover_media_url: null, cover_media_type: null, profile_photo_type: null,
      created_at: "2026-10-25T00:00:00.000Z", updated_at: "2026-10-25T00:00:00.000Z", deleted_at: null,
    } as BrandRow;
    expect(mapBrandRowToUi({ ...row, enquiries_enabled: false }, { role: "owner" }).enquiriesEnabled).toBe(false);
    expect(mapBrandRowToUi({ ...row, enquiries_enabled: true }, { role: "owner" }).enquiriesEnabled).toBe(true);
    expect("enquiriesEnabled" in mapBrandRowToUi(row, { role: "owner" })).toBe(false);
    expect(mapUiToBrandUpdatePatch({ displayName: "X" })).not.toHaveProperty("enquiries_enabled");
  });
});
