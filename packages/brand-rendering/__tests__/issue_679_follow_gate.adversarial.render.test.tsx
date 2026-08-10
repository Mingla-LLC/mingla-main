/**
 * Issue #679 [follow-a-brand] — TESTER adversarial WEB-RENDER suite (spec §7
 * file 10). Append-only: NEW file, modifies and deletes nothing.
 *
 * The implementor's suite (issue_679_follow_gate.test.tsx) is source-as-text.
 * This file attacks the OTHER side: the REAL PublicBrandPage, really mounted
 * through react-native-web (the resolver that ships on buyer web — the #1484
 * P1-1 lesson), pressed through the Pressable contract, and read back from the
 * emitted DOM the way a browser and a screen reader would read it.
 *
 * ADVERSARIAL ANGLES (all different from the implementor's):
 *   R-1/R-2  the callback gate on the MOUNTED page — no onToggleFollow ⇒ zero
 *            follow surface in the emitted DOM, on BOTH the phone slice and
 *            the ≥1024px desktop sticky-panel slice (paired presence legs keep
 *            every absence assertion non-vacuous).
 *   R-3/R-4  unknown state is honest — isFollowing undefined AND null render
 *            "Follow", never crash, never read as selected (anon-cold-load
 *            shape: the status query is disabled, the prop never arrives).
 *   R-5      the renderer NEVER self-flips: pressing Follow twice fires the
 *            host callback twice and the label stays "Follow" until the HOST
 *            re-renders with isFollowing=true (kills a revert to local
 *            useState toggling — the fabricated-Following failure mode).
 *   R-6      followPending disables the control (Pressable contract +
 *            aria-disabled) and the label still tells the truth.
 *   R-7/R-8  palette-token honesty under a NON-DEFAULT theme: the button
 *            paints with the derived palette accent, and the brand-orange
 *            defaults (#eb7825 / #f97316) appear NOWHERE in its markup — a
 *            hardcoded hex would survive a theme change and fail here.
 *   R-9      desktop panel composition: Follow sits BETWEEN the socials row
 *            and the Share button, and that panel slice carries no contact
 *            data (no mailto:, no tel:, not the fixture's email/phone).
 *   R-10     a11y flip on the mounted node: aria-label Follow↔Unfollow and
 *            aria-selected track isFollowing per spec §4.
 *   R-11     no fabricated audience numbers reach the DOM: a data-rich page
 *            emits no "follower(s)" and no count glued to Follow/Following —
 *            the render-level teeth behind the rewritten orch_1155
 *            server-truth assertions (a fabricated count that satisfies a
 *            source grep still fails here, where the DOM is inspected).
 *
 * VACUITY GUARDS — every absence assertion is paired with a presence leg from
 * the same fixture (the #1484 silent-pass class).
 *
 * FAILS-ON-REVERT (verified by TRUE LINE-DELETION of the renderer gate
 * `if (onToggleFollow === undefined) return null;` — run output in the #679
 * verdict comment): R-1 and R-2's absence legs go RED (an ungated button
 * renders for hosts that passed no callback). Deleting either <FollowButton
 * mount fails the paired presence legs; hardcoding the button color fails
 * R-7/R-8; local-state flipping fails R-5; dropping accessibilityState fails
 * R-6/R-10.
 *
 * MOCK BOUNDARY (declared, minimal): the mocks below stub MODULE-LOAD-ONLY
 * native deps that explode in a node-env harness (lucide icon set →
 * react-native-svg native codegen, expo-video/-haptics/-blur/-constants
 * native module lookups, lottie). None of them is under test and none is
 * reachable from the FollowButton subtree. expo-modules-core is NOT stubbed —
 * its REAL web polyfill is loaded (the harness resolves node platform
 * extensions, so `./polyfill` lands on the native noop instead of the
 * index.web.ts a metro web bundle would load; the registry is pointed at the
 * real web file). PublicBrandPage, react-native-web, and the palette engine
 * are all real.
 *
 * Run: cd mingla-business && npx jest --config jest.issue679.cfg.cjs --runInBand
 */

jest.mock("lucide-react-native", () => {
  const mockReact = require("react");
  const icon = (name: string) => {
    const MockIcon = (props: Record<string, unknown>) =>
      mockReact.createElement("mock-icon", { "data-icon": name, ...props });
    MockIcon.displayName = name;
    return MockIcon;
  };
  return new Proxy(
    {},
    {
      get: (_target, prop: string) =>
        prop === "__esModule" ? true : icon(prop),
    },
  );
});

jest.mock("expo-video", () => {
  const mockReact = require("react");
  return {
    __esModule: true,
    VideoView: (props: Record<string, unknown>) =>
      mockReact.createElement("mock-video", props),
    useVideoPlayer: () => ({
      play: () => undefined,
      pause: () => undefined,
      replace: () => undefined,
      release: () => undefined,
      muted: true,
      loop: true,
    }),
  };
});

jest.mock("react-native-svg", () => {
  const mockReact = require("react");
  const el =
    (name: string) =>
    (props: Record<string, unknown>) =>
      mockReact.createElement(`mock-svg-${name.toLowerCase()}`, props);
  return new Proxy(
    { __esModule: true, default: el("Svg") },
    {
      get: (target: Record<string, unknown>, prop: string) =>
        prop in target ? target[prop] : el(prop),
    },
  );
});

jest.mock("lottie-react-native", () => {
  const mockReact = require("react");
  return {
    __esModule: true,
    default: (props: Record<string, unknown>) =>
      mockReact.createElement("mock-lottie", props),
  };
});

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: null, manifest2: null },
}));

// Point expo-modules-core's `./polyfill` at the REAL index.web.ts (installs
// `globalThis.expo`), exactly what metro web resolution would have loaded.
jest.mock(
  "../../../mingla-business/node_modules/expo-modules-core/src/polyfill",
  () =>
    jest.requireActual(
      "../../../mingla-business/node_modules/expo-modules-core/src/polyfill/index.web",
    ),
);

jest.mock("expo-haptics", () => ({
  __esModule: true,
  impactAsync: async () => undefined,
  notificationAsync: async () => undefined,
  selectionAsync: async () => undefined,
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
  NotificationFeedbackType: {
    Success: "success",
    Warning: "warning",
    Error: "error",
  },
}));

jest.mock("expo-blur", () => {
  const mockReact = require("react");
  return {
    __esModule: true,
    BlurView: (props: Record<string, unknown>) =>
      mockReact.createElement("mock-blur", props),
  };
});

import React from "react";
import { Dimensions } from "react-native";
import { createThemePalette } from "@mingla/offering-rendering";

import { PublicBrandPage } from "../PublicBrandPage";
import type { PublicBrandPageProps } from "../types";

// Typed-require idiom (react-dom/server + react-test-renderer ship no types in
// this workspace) — same form as the #1484/#1503/#1563 render suites.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ReactDOMServer = require("react-dom/server") as {
  renderToStaticMarkup: (element: unknown) => string;
};
type HostNode = { type: unknown; props: Record<string, unknown> };
type Tree = {
  root: { findAll: (predicate: (node: HostNode) => boolean) => HostNode[] };
  toJSON: () => unknown;
  update: (element: unknown) => void;
  unmount: () => void;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: unknown) => Tree;
  act: (callback: () => Promise<void> | void) => Promise<void>;
};

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

const PHONE_WIDTH = 390;
const DESKTOP_WIDTH = 1440; // ≥ DESKTOP_BREAKPOINT (1024)

function setViewport(width: number): void {
  const dims = { width, height: 900, scale: 2, fontScale: 1 };
  Dimensions.set({ window: dims, screen: dims });
}

// A NON-DEFAULT theme. #2266cc keeps ≥3:1 contrast against white text, so the
// palette engine passes it through unadjusted — createThemePalette(THEME_BLUE)
// .accent === "#2266cc" (asserted below, not assumed). Any hardcoded brand
// orange in the FollowButton is therefore visible in the emitted styles.
const THEME_BLUE = {
  color: "#2266cc",
  foregroundColor: "#ffffff" as const,
  font: "inter" as const,
  fontFamilyValue: "TestFont",
  animation: "none" as const,
};

const SECRET_EMAIL = "secret@neon.example";
const SECRET_PHONE = "+15551234567";
const BRAND_NAME = "Neon Lights";

function brandFixture(): PublicBrandPageProps["brand"] {
  return {
    id: "brand-679",
    slug: "neon-lights",
    displayName: BRAND_NAME,
    address: "1 Test Way, London",
    coverHue: 210,
    links: { instagram: "https://instagram.com/neon" },
    contact: { email: SECRET_EMAIL, phone: SECRET_PHONE },
  };
}

const upcomingFixture = {
  offeringId: "up-1",
  brandId: "brand-679",
  brandSlug: "neon-lights",
  brandName: BRAND_NAME,
  offeringType: "event" as const,
  offeringSlug: "friday-social",
  name: "Friday Social",
  bio: null,
  coverMediaUrl: null,
  coverMediaType: null,
  startsAt: "2026-12-04T20:00:00Z",
  priceFromMinorUnits: 1500,
  currency: "GBP",
  isFree: false,
  publishedAt: "2026-08-01T00:00:00Z",
};

interface ElementOverrides {
  onToggleFollow?: (() => void) | undefined;
  isFollowing?: boolean | undefined;
  followPending?: boolean | undefined;
  upcoming?: PublicBrandPageProps["upcoming"];
}

function pageElement(overrides: ElementOverrides = {}): unknown {
  const props: PublicBrandPageProps = {
    brand: brandFixture(),
    events: [],
    trips: [],
    upcoming: overrides.upcoming ?? [],
    theme: THEME_BLUE,
    isFollowing: overrides.isFollowing,
    followPending: overrides.followPending,
    callbacks: {
      onClose: () => undefined,
      onShare: () => undefined,
      onOpenEvent: () => undefined,
      onOpenTrip: () => undefined,
      ...(overrides.onToggleFollow !== undefined
        ? { onToggleFollow: overrides.onToggleFollow }
        : {}),
    },
  };
  return React.createElement(
    PublicBrandPage as unknown as React.FC<PublicBrandPageProps>,
    props,
  );
}

function markup(overrides: ElementOverrides = {}): string {
  return ReactDOMServer.renderToStaticMarkup(pageElement(overrides));
}

async function mount(overrides: ElementOverrides = {}): Promise<Tree> {
  let created: Tree | undefined;
  await TestRenderer.act(() => {
    created = TestRenderer.create(pageElement(overrides));
  });
  return created as Tree;
}

const FOLLOW_LABEL = `Follow ${BRAND_NAME}`;
const UNFOLLOW_LABEL = `Unfollow ${BRAND_NAME}`;

/** Count of follow-control HOST nodes in emitted markup (aria truth). */
function followButtonCount(html: string): number {
  return (
    html.split(`aria-label="${FOLLOW_LABEL}"`).length -
    1 +
    (html.split(`aria-label="${UNFOLLOW_LABEL}"`).length - 1)
  );
}

/** The follow button's opening <button …> tag (inline styles live here). */
function followButtonTag(html: string, label: string): string {
  const re = new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`);
  const match = html.match(re);
  // VACUITY GUARD — asserting styles on a tag that never rendered is the
  // classic silent pass.
  expect(match).not.toBeNull();
  return (match as RegExpMatchArray)[0];
}

/** Press through the Pressable CONTRACT (onPress), with a vacuity guard. */
async function pressFollow(tree: Tree, label: string): Promise<void> {
  const matches = tree.root.findAll((node) => {
    if (typeof node.type === "string") return false;
    return (
      node.props.accessibilityLabel === label &&
      typeof node.props.onPress === "function"
    );
  });
  expect(matches.length).toBeGreaterThan(0);
  const onPress = matches[0].props.onPress as () => void;
  await TestRenderer.act(() => {
    onPress();
  });
}

/** RNW inline-style form of a hex color: #2266cc → rgba(34,102,204,1.00). */
function rgbaOf(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},1.00)`;
}

const BRAND_ORANGE_FORMS = [
  "#eb7825",
  "#f97316",
  rgbaOf("#eb7825"),
  rgbaOf("#f97316"),
];

// ---------------------------------------------------------------------------
// R-1 / R-2 — the callback gate, phone AND desktop, paired legs
// ---------------------------------------------------------------------------

describe("#679 R-1 · phone slice: the callback gate really gates the DOM", () => {
  test("no onToggleFollow ⇒ ZERO follow surface; same fixture WITH it ⇒ exactly one", () => {
    setViewport(PHONE_WIDTH);
    const withFollow = markup({ onToggleFollow: () => undefined });
    const without = markup({});

    // presence leg (vacuity guard for the absence leg)
    expect(followButtonCount(withFollow)).toBe(1);
    expect(withFollow).toContain(">Follow<");

    // absence leg — the actual gate
    expect(followButtonCount(without)).toBe(0);
    expect(without).not.toMatch(/aria-label="(Follow|Unfollow) /);
    expect(without).not.toContain(">Follow<");
    expect(without).not.toContain(">Following<");
    // the page itself really rendered (not an empty shell passing vacuously)
    expect(without).toContain(BRAND_NAME);
  });
});

describe("#679 R-2 · desktop slice (≥1024px): the gate holds in the sticky panel", () => {
  test("no onToggleFollow ⇒ ZERO follow surface; with it ⇒ exactly one, in the panel", () => {
    setViewport(DESKTOP_WIDTH);
    const withFollow = markup({ onToggleFollow: () => undefined });
    const without = markup({});

    // desktop layout really engaged — the panel Share button is desktop-only
    expect(withFollow).toContain('aria-label="Share this brand"');
    expect(without).toContain('aria-label="Share this brand"');

    expect(followButtonCount(withFollow)).toBe(1);
    expect(followButtonCount(without)).toBe(0);
    expect(without).not.toMatch(/aria-label="(Follow|Unfollow) /);
    expect(without).not.toContain(">Follow<");
    expect(without).not.toContain(">Following<");
  });
});

// ---------------------------------------------------------------------------
// R-3 / R-4 — unknown isFollowing is honest, never a crash
// ---------------------------------------------------------------------------

describe("#679 R-3 · isFollowing undefined (anon / status query disabled)", () => {
  test("renders 'Follow', never 'Following', and is not selected", () => {
    setViewport(PHONE_WIDTH);
    const html = markup({ onToggleFollow: () => undefined });
    const tag = followButtonTag(html, FOLLOW_LABEL);
    expect(html).toContain(">Follow<");
    expect(html).not.toContain(">Following<");
    expect(tag).not.toContain('aria-selected="true"');
  });
});

describe("#679 R-4 · isFollowing null (hostile host payload)", () => {
  test("still renders 'Follow' and does not crash", () => {
    setViewport(PHONE_WIDTH);
    const html = markup({
      onToggleFollow: () => undefined,
      isFollowing: null as unknown as boolean,
    });
    const tag = followButtonTag(html, FOLLOW_LABEL);
    expect(tag).toContain('role="button"');
    expect(html).toContain(">Follow<");
    expect(html).not.toContain(">Following<");
  });
});

// ---------------------------------------------------------------------------
// R-5 — server truth: the renderer never flips itself
// ---------------------------------------------------------------------------

describe("#679 R-5 · pressing fires the host and NEVER self-flips the label", () => {
  test("two presses ⇒ two callback invocations, label still 'Follow'; host re-render flips it", async () => {
    setViewport(PHONE_WIDTH);
    let presses = 0;
    const onToggleFollow = (): void => {
      presses += 1;
    };
    const tree = await mount({ onToggleFollow, isFollowing: false });

    await pressFollow(tree, FOLLOW_LABEL);
    await pressFollow(tree, FOLLOW_LABEL);
    expect(presses).toBe(2);

    // STILL "Follow" — state is host-owned server truth, not renderer state.
    const stillIdle = tree.root.findAll(
      (node) =>
        typeof node.type !== "string" &&
        node.props.accessibilityLabel === FOLLOW_LABEL &&
        typeof node.props.onPress === "function",
    );
    expect(stillIdle.length).toBeGreaterThan(0);

    // Only the HOST flips it, by re-rendering with the server-truth prop.
    await TestRenderer.act(() => {
      tree.update(pageElement({ onToggleFollow, isFollowing: true }));
    });
    const nowActive = tree.root.findAll(
      (node) =>
        typeof node.type !== "string" &&
        node.props.accessibilityLabel === UNFOLLOW_LABEL,
    );
    expect(nowActive.length).toBeGreaterThan(0);
    tree.unmount();
  });
});

// ---------------------------------------------------------------------------
// R-6 — pending really disables
// ---------------------------------------------------------------------------

describe("#679 R-6 · followPending disables the control and stays honest", () => {
  test("Pressable contract carries disabled=true; DOM announces aria-disabled", async () => {
    setViewport(PHONE_WIDTH);
    const html = markup({
      onToggleFollow: () => undefined,
      isFollowing: false,
      followPending: true,
    });
    const tag = followButtonTag(html, FOLLOW_LABEL);
    expect(tag).toContain('aria-disabled="true"');
    // label still tells the truth while pending
    expect(html).toContain(">Follow<");

    const tree = await mount({
      onToggleFollow: () => undefined,
      isFollowing: false,
      followPending: true,
    });
    const pressables = tree.root.findAll(
      (node) =>
        typeof node.type !== "string" &&
        node.props.accessibilityLabel === FOLLOW_LABEL &&
        typeof node.props.onPress === "function",
    );
    expect(pressables.length).toBeGreaterThan(0);
    expect(pressables[0].props.disabled).toBe(true);
    const state = pressables[0].props.accessibilityState as
      | Record<string, unknown>
      | undefined;
    expect(state?.disabled).toBe(true);
    tree.unmount();
  });
});

// ---------------------------------------------------------------------------
// R-7 / R-8 — palette-token honesty under a non-default theme
// ---------------------------------------------------------------------------

describe("#679 R-7 · idle button paints with the DERIVED palette accent", () => {
  test("background is the theme-derived accent; brand-orange defaults appear nowhere in the tag", () => {
    setViewport(PHONE_WIDTH);
    const accent = createThemePalette(THEME_BLUE).accent;
    // guard: the fixture theme really derives a NON-default accent
    expect(accent.toLowerCase()).toBe("#2266cc");

    const html = markup({ onToggleFollow: () => undefined, isFollowing: false });
    const tag = followButtonTag(html, FOLLOW_LABEL);
    expect(tag).toContain(`background-color:${rgbaOf(accent)}`);
    for (const orange of BRAND_ORANGE_FORMS) {
      expect(tag.toLowerCase()).not.toContain(orange.toLowerCase());
    }
  });
});

describe("#679 R-8 · active button: transparent fill + accent border, no hardcoded hex", () => {
  test("Following state styles come from the palette too", () => {
    setViewport(PHONE_WIDTH);
    const accent = createThemePalette(THEME_BLUE).accent;
    const html = markup({ onToggleFollow: () => undefined, isFollowing: true });
    const tag = followButtonTag(html, UNFOLLOW_LABEL);
    // border carries the accent; the fill does NOT (transparent per spec §4)
    expect(tag).toContain(`border-top-color:${rgbaOf(accent)}`);
    expect(tag).not.toContain(`background-color:${rgbaOf(accent)}`);
    for (const orange of BRAND_ORANGE_FORMS) {
      expect(tag.toLowerCase()).not.toContain(orange.toLowerCase());
    }
    expect(html).toContain(">Following<");
  });
});

// ---------------------------------------------------------------------------
// R-9 — desktop panel composition + contact-data boundary
// ---------------------------------------------------------------------------

describe("#679 R-9 · desktop panel: Follow BETWEEN socials and Share; no contact data in that slice", () => {
  test("ordering socials < Follow < Share holds in the emitted DOM", () => {
    setViewport(DESKTOP_WIDTH);
    const html = markup({ onToggleFollow: () => undefined, isFollowing: false });

    const socialsIdx = html.indexOf('aria-label="Instagram"');
    const followIdx = html.indexOf(`aria-label="${FOLLOW_LABEL}"`);
    const shareIdx = html.indexOf('aria-label="Share this brand"');

    // vacuity guards — every landmark really rendered
    expect(socialsIdx).toBeGreaterThan(-1);
    expect(followIdx).toBeGreaterThan(-1);
    expect(shareIdx).toBeGreaterThan(-1);

    // the spec'd insertion point: socials → Follow → Share
    expect(followIdx).toBeGreaterThan(socialsIdx);
    expect(shareIdx).toBeGreaterThan(followIdx);

    // the panel slice around Follow carries NO contact data — following must
    // never surface an address/phone (Ring-2 boundary, #876)
    const panelSlice = html.slice(socialsIdx, shareIdx);
    expect(panelSlice).not.toContain(SECRET_EMAIL);
    expect(panelSlice).not.toContain(SECRET_PHONE);
    expect(panelSlice).not.toContain("mailto:");
    expect(panelSlice).not.toContain("tel:");
  });
});

// ---------------------------------------------------------------------------
// R-10 — a11y flip on the mounted node
// ---------------------------------------------------------------------------

describe("#679 R-10 · a11y state tracks isFollowing", () => {
  // TESTER FINDING (documented, not a v1 defect): react-native-web 0.19 DROPS
  // the RN `accessibilityState` object (it forwards only flat aria-* /
  // accessibility* props — see forwardedProps/index.js), so
  // `accessibilityState={{selected}}` never reaches the web DOM as
  // aria-selected. The `aria-disabled` seen in R-6 comes from RNW Pressable's
  // own `disabled` prop mapping, not from accessibilityState. v1 renders
  // Follow ONLY on consumer NATIVE (the callback gate keeps every web surface
  // dark), where `accessibilityState` IS the canonical API VoiceOver/TalkBack
  // read — so the shipped surface is correct. When leg 5 wires web, the
  // FollowButton must ALSO pass flat `aria-selected` for web AT parity; this
  // block pins today's contract so that change is deliberate.
  test("mounted Pressable carries accessibilityState.selected per spec §4; DOM label flips", async () => {
    setViewport(PHONE_WIDTH);

    // native contract — the mounted Pressable's accessibilityState
    for (const state of [false, true]) {
      const tree = await mount({
        onToggleFollow: () => undefined,
        isFollowing: state,
      });
      const label = state ? UNFOLLOW_LABEL : FOLLOW_LABEL;
      const pressables = tree.root.findAll(
        (node) =>
          typeof node.type !== "string" &&
          node.props.accessibilityLabel === label &&
          typeof node.props.onPress === "function",
      );
      expect(pressables.length).toBeGreaterThan(0);
      const a11yState = pressables[0].props.accessibilityState as
        | Record<string, unknown>
        | undefined;
      expect(a11yState?.selected).toBe(state);
      tree.unmount();
    }

    // DOM truth — the accessible NAME flips both ways (this IS emitted on web)
    const idle = markup({ onToggleFollow: () => undefined, isFollowing: false });
    expect(idle).toContain(`aria-label="${FOLLOW_LABEL}"`);
    expect(idle).not.toContain(`aria-label="${UNFOLLOW_LABEL}"`);

    const active = markup({ onToggleFollow: () => undefined, isFollowing: true });
    expect(active).toContain(`aria-label="${UNFOLLOW_LABEL}"`);
    expect(active).not.toContain(`aria-label="${FOLLOW_LABEL}"`);
  });
});

// ---------------------------------------------------------------------------
// R-11 — no fabricated audience numbers reach the DOM
// ---------------------------------------------------------------------------

describe("#679 R-11 · a data-rich page emits no follower counts, ever", () => {
  test("no 'follower(s)', no digit glued to Follow/Following, no 'subscrib'", () => {
    for (const width of [PHONE_WIDTH, DESKTOP_WIDTH]) {
      setViewport(width);
      const html = markup({
        onToggleFollow: () => undefined,
        isFollowing: true,
        upcoming: [upcomingFixture],
      });
      // vacuity guard — the rich page really carries the follow surface
      expect(followButtonCount(html)).toBe(1);
      // 'Following' is legal; 'follower'/'followers' (a count concept) is not
      expect(html).not.toMatch(/follower/i);
      expect(html).not.toMatch(/\d+\s*Follow/);
      expect(html).not.toMatch(/Following\s*\d/);
      expect(html).not.toMatch(/subscrib/i);
    }
  });
});
