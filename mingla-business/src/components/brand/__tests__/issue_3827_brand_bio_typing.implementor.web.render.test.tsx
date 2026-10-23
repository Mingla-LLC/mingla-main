/**
 * #3827 — typing on the Host website never drops letters (Sentry
 * MINGLA-BUSINESS-22, "Maximum update depth exceeded"), Edit brand Bio.
 *
 * SYMPTOM: on Edit brand, a host typing quickly into Bio lost a letter about
 * every 50 characters, and Sentry recorded "Maximum update depth exceeded"
 * from the Bio `setDraft`.
 *
 * CAUSE: the brand cover preview is the shared EventCoverMedia. It handed
 * react-native-web's <Image> a NEW onError function on every render, and that
 * Image re-runs its load effect when onError changes, setting LOADING: a
 * second state update chained onto every keystroke. Keystrokes that arrive
 * back to back never let that chain drain, so React's nested-update counter
 * passed 50 and the 51st keystroke threw before its letter landed.
 *
 * WHAT RUNS HERE: the REAL BrandEditView (its Bio field, its draft state) and
 * the REAL EventCoverMedia from THIS checkout's packages/offering-rendering,
 * through react-native-web on a concurrent react-test-renderer root. The brand
 * has an image cover. 120 characters are typed back to back, each delivered
 * through `unstable_flushSync` (a discrete, synchronous update, as a browser
 * input event is). Sibling chrome (buttons, sheets, pickers, top bar) renders
 * as inert stand-ins; none of it owns Bio or the cover.
 *
 * FAILS ON REVERT: give the cover <Image> inline onError / onLoad handlers
 * again (EventCoverMedia.tsx) and this suite goes red: characters 53 and 106
 * are lost and the update-depth error is thrown.
 *
 * Run (from mingla-business/):
 *   npx jest --config jest.issue3827.web.render.cjs --ci --maxWorkers=2
 */

import fs from "node:fs";
import path from "node:path";
import React from "react";
import { describe, expect, jest, test } from "@jest/globals";

import type { Brand } from "../../../types/brand";

// ---- environment ------------------------------------------------------------
// react-native-web's TextInput reads `document.activeElement` and its
// ImageLoader builds `new window.Image()`. Node has neither, so supply the two
// members they touch. `window.document` stays undefined, so react-native-web
// still treats this as a non-DOM environment. The fake image "loads" on the
// next macrotask, the way a cached cover loads in the browser.
class FakeImage {
  onload: ((event: unknown) => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 1600;
  naturalHeight = 900;
  set src(_value: string) {
    setTimeout(() => this.onload?.({}), 0);
  }
  decode(): Promise<void> {
    return Promise.resolve();
  }
}
Reflect.set(globalThis, "window", { Image: FakeImage });
Reflect.set(globalThis, "document", { activeElement: null });

type Node = {
  type: unknown;
  props: Record<string, unknown>;
  findAll: (predicate: (node: Node) => boolean) => Node[];
};
type Renderer = {
  root: Node;
  unmount: () => void;
  unstable_flushSync: (fn: () => void) => void;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Renderer;
  act: (fn: () => Promise<void> | void) => Promise<void>;
};

// ---- boundaries -------------------------------------------------------------
jest.mock("expo-video", () => ({
  VideoView: () => null,
  useVideoPlayer: () => ({
    addListener: () => ({ remove: () => undefined }),
  }),
}));
jest.mock("expo-linear-gradient", () => ({ LinearGradient: () => null }));
jest.mock("react-native-svg", () => {
  const Leaf = (): null => null;
  return {
    __esModule: true,
    default: Leaf,
    Svg: Leaf,
    Path: Leaf,
    Line: Leaf,
    Rect: Leaf,
    G: Leaf,
    ClipPath: Leaf,
    Defs: Leaf,
    Circle: Leaf,
  };
});
// The app re-exports EventCoverMedia from the package barrel, whose other
// exports pull every public offering screen. Point it straight at the REAL
// component file in THIS checkout.
jest.mock("../../ui/EventCoverMedia", () =>
  jest.requireActual(
    "../../../../../packages/offering-rendering/EventCoverMedia",
  ),
);
jest.mock("../../../constants/publicUrls", () => ({
  brandPublicUrl: (slug: string) => `https://business.example.test/b/${slug}`,
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("../../../hooks/useSwitchAccount", () => ({
  useSwitchAccount: () => ({
    signedInEmail: null,
    onSwitchAccount: () => undefined,
  }),
}));
jest.mock("../../../wrappers/SmartScrollView", () => {
  const ReactLocal = jest.requireActual<typeof React>("react");
  return {
    ScrollView: ReactLocal.forwardRef(
      (props: { children?: React.ReactNode }, _ref) =>
        ReactLocal.createElement("mock-scroll", null, props.children),
    ),
  };
});
// A declaration (hoisted), because the jest.mock factories below are hoisted.
function mockLeaf(name: string) {
  const ReactLocal = jest.requireActual<typeof React>("react");
  return (props: { children?: React.ReactNode }) =>
    ReactLocal.createElement(name, null, props.children);
}
jest.mock("../../ui/Avatar", () => ({ Avatar: mockLeaf("mock-avatar") }));
jest.mock("../../ui/Button", () => ({ Button: mockLeaf("mock-button") }));
jest.mock("../../ui/ConfirmDialog", () => ({
  ConfirmDialog: mockLeaf("mock-confirm"),
}));
jest.mock("../../ui/GlassCard", () => ({ GlassCard: mockLeaf("mock-glass") }));
jest.mock("../../ui/Icon", () => ({ Icon: mockLeaf("mock-icon") }));
jest.mock("../../ui/Toast", () => ({ Toast: mockLeaf("mock-toast") }));
jest.mock("../../ui/TopBar", () => ({ TopBar: mockLeaf("mock-topbar") }));
jest.mock("../../ui/Input", () => ({
  Input: mockLeaf("mock-input"),
  PHONE_COUNTRIES: [],
}));
jest.mock("../BrandAvatarPickerSheet", () => ({
  BrandAvatarPickerSheet: mockLeaf("mock-avatar-sheet"),
}));
jest.mock("../../ui/CoverPickerSheet", () => ({
  CoverPickerSheet: mockLeaf("mock-cover-sheet"),
}));
jest.mock("../../theme/ThemeControlRow", () => ({
  ThemeControlRow: mockLeaf("mock-theme-row"),
}));
jest.mock("../../theme/ThemeSheet", () => ({
  ThemeSheet: mockLeaf("mock-theme-sheet"),
}));
jest.mock("../../auth/SignedInNotFoundNotice", () => ({
  SignedInNotFoundNotice: mockLeaf("mock-not-found"),
}));

// eslint-disable-next-line import/first
import { BrandEditView } from "../BrandEditView";
// eslint-disable-next-line import/first
import { EventCoverMedia as PackageEventCoverMedia } from "../../ui/EventCoverMedia";

const COVER_URL = "https://example.test/brand_covers/salsa.jpg";
const BRAND = {
  id: "50df414e-0000-4000-8000-000000003827",
  displayName: "Salsa Social",
  slug: "salsa-social",
  role: "owner",
  stats: { events: 0, rev: 0 },
  currentLiveEvent: null,
  bio: "",
  tagline: "Social Latin dance",
  contact: { email: "hello@example.test", phone: "" },
  links: {},
  countryCode: "US",
  coverHue: 25,
  coverMediaUrl: COVER_URL,
  coverMediaType: "image",
} as unknown as Brand;

const TYPED = Array.from(
  { length: 120 },
  (_unused, index) => "salsa night in raleigh "[index % 23],
).join("");

const bioField = (renderer: Renderer): Node => {
  const matches = renderer.root.findAll(
    (node) =>
      node.props.accessibilityLabel === "Bio / description" &&
      typeof node.props.onChangeText === "function",
  );
  expect(matches.length).toBeGreaterThan(0);
  return matches[0];
};

describe("#3827 Edit brand Bio keeps every letter typed back to back", () => {
  test("120 back-to-back characters into Bio, beside an image cover: all land, no update-depth error", async () => {
    // Worktree trap: node_modules (and its @mingla/* links) may point at the
    // anchor checkout. The component executed here must come from the SAME
    // checkout as this behavior proof.
    const checkoutRoot = fs.realpathSync(path.resolve(__dirname, "../../../../.."));
    const executed = fs.realpathSync(
      require.resolve("../../../../../packages/offering-rendering/EventCoverMedia"),
    );
    expect(executed).toBe(
      path.join(checkoutRoot, "packages/offering-rendering/EventCoverMedia.tsx"),
    );
    expect(typeof PackageEventCoverMedia).toBe("function");

    Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
    let renderer: Renderer | null = null;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(
        <BrandEditView
          brand={BRAND}
          accountId="00000000-0000-4000-8000-000000003827"
          onCancel={() => undefined}
          onSave={async () => undefined}
          onAfterSave={() => undefined}
        />,
      );
    });
    // Let the cover finish loading, as it has by the time a host types.
    await TestRenderer.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const mounted = renderer as unknown as Renderer;
    // The real cover image is on screen (not the placeholder).
    expect(
      mounted.root.findAll(
        (node) =>
          typeof node.type !== "string" &&
          (node.props.source as { uri?: string } | undefined)?.uri === COVER_URL,
      ).length,
    ).toBeGreaterThan(0);

    // Keystrokes are real browser-style discrete updates, outside act().
    Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", false);
    const thrown: { at: number; message: string }[] = [];
    let held = "";
    for (let index = 0; index < TYPED.length; index += 1) {
      const next = held + TYPED[index];
      const field = bioField(mounted);
      try {
        mounted.unstable_flushSync(() => {
          (field.props.onChangeText as (text: string) => void)(next);
        });
      } catch (error) {
        thrown.push({ at: index + 1, message: String(error) });
      }
      held = String(bioField(mounted).props.value ?? "");
    }
    Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

    expect(thrown).toEqual([]);
    expect(held).toBe(TYPED);
    expect(held.length).toBe(120);

    await TestRenderer.act(async () => {
      mounted.unmount();
    });
  });
});
