/**
 * #3259 [a wrong account reads as a crash] — TESTER ADVERSARIAL suite.
 *
 * The implementor's happy path proves the good case: signed in, the 404 names
 * the account, drops the typo line, keeps "Go home", and awaits `signOut()`
 * before navigating. This suite deliberately attacks a DIFFERENT set of angles:
 * the ones where naming a session can HURT, where the screen can lie, where the
 * structure #2180 paid for can silently regress, and where the auth gate can
 * half-open.
 *
 *   A. INFORMATION LEAK — identity must be UNREACHABLE from the public buyer
 *      routes, proved by a TRANSITIVE import walk (a barrel cannot launder it),
 *      with a control proving the walker can match.
 *   B. EXISTENCE NON-DISCLOSURE — the anon "not found" copy must not have
 *      drifted; a pending venue must still be indistinguishable from one that
 *      never existed.
 *   C. NEVER CLAIM A DENIAL — `+not-found` is a pure routing outcome. It gets
 *      no status and no error, so no branch of it may say "permission",
 *      "forbidden", "access denied" or "not allowed".
 *   D. NEVER ASSERT WHICH CAUSE — the `restricted` copy must state BOTH
 *      possibilities, hedged, and assert neither.
 *   E. DEGENERATE IDENTITY — null / empty / very long / control-character
 *      emails must never produce a half-sentence or an empty identity card.
 *   F. NO MIXED STATE — for EVERY auth shape, the screen is wholly signed-out
 *      or wholly signed-in. A heading that flips without the notice following
 *      it is a user staring at a changed 404 with nothing to act on.
 *   G. RE-ENTRANCY + REJECTION — a rejecting `signOut()` must never navigate to
 *      `/auth` (the documented infinite-loop trap), and no navigation may
 *      happen while ANY sign-out is still in flight.
 *   H. #2180 STRUCTURE ON THE SIGNED-IN BRANCH — the existing #2180 suite was
 *      pinned to `user: null` by this change, so all 63 of its assertions
 *      stopped covering the branch this issue adds. Every structural guarantee
 *      is re-asserted here WITH the notice rendered, across the whole RN iOS
 *      Dynamic Type table.
 *   I. NO DEAD TAPS — every control in the new states has a real handler and an
 *      accessibility label.
 *
 * MEASUREMENT. `testEnvironment: "node"` with `^react-native$` mapped to
 * `__manual_mocks__/react-native.js`, so this walks the REAL element tree the
 * screens return. Nothing here is a source-text pin except where explicitly
 * labelled a copy-drift pin, and each of those carries a control.
 */

import fs from "node:fs";
import path from "node:path";
import React from "react";

/* ------------------------------------------------------------------ mocks */

const mockAuthState: {
  user: { email?: string | null } | null;
  isAuthReady: boolean;
  signOut: () => Promise<void>;
} = { user: null, isAuthReady: true, signOut: async () => undefined };

const mockRouterReplace = jest.fn();
const mockRouterPush = jest.fn();

jest.mock("../src/context/AuthContext", () => ({
  useAuth: () => mockAuthState,
}));

jest.mock("expo-router", () => ({
  Stack: { Screen: "Stack.Screen" },
  useRouter: () => ({
    replace: mockRouterReplace,
    push: mockRouterPush,
    back: jest.fn(),
  }),
}));

jest.mock("@mingla/brand-assets", () => ({
  MINGLA_WORDMARK: 1,
  MINGLA_BUSINESS_LOGO: 2,
  MINGLA_APP_ICON: 3,
}));

jest.mock("expo-linear-gradient", () => ({ LinearGradient: "LinearGradient" }));

// `PublicVenueNotFound` reaches `src/constants/publicUrls`, which throws at
// module load without the web-URL env. This is the shipped production value,
// supplied the same way every checkout suite supplies it — resolution repair,
// not a behavioural mock.
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: { EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL: "https://host.usemingla.com" },
    },
  },
}));

jest.mock("react-native-safe-area-context", () => ({
  SafeAreaView: "SafeAreaView",
  useSafeAreaInsets: () => ({ top: 59, bottom: 34, left: 0, right: 0 }),
}));

// The Button primitive drags reanimated / svg / haptics (all ESM). Every prop
// this suite asserts — `accessibilityLabel`, `onPress`, `label` — is authored at
// the call site, so a host element preserves them exactly.
jest.mock("../src/components/ui/Button", () => ({ Button: "Button" }));
jest.mock("../src/components/ui/Icon", () => ({ Icon: "Icon" }));

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  selectionAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
  NotificationFeedbackType: {
    Success: "success",
    Warning: "warning",
    Error: "error",
  },
}));

import NotFoundScreen, {
  SIGNED_IN_HEADING,
  SIGNED_OUT_HEADING,
  SIGNED_OUT_SUBTEXT,
  LARGE_TYPE_FONT_SCALE,
} from "../app/+not-found";
import {
  SignedInNotFoundNotice,
  SIGNED_IN_NOT_FOUND_COPY,
  SWITCH_ACCOUNT_LABEL,
} from "../src/components/auth/SignedInNotFoundNotice";
import { PublicBrandNotFound } from "../src/components/brand/PublicBrandNotFound";
import { PublicVenueNotFound } from "../src/components/venue/PublicVenueNotFound";

/* ------------------------------------------------------- tree utilities */

type El = React.ReactElement<Record<string, unknown>>;

const isElement = (v: unknown): v is El =>
  typeof v === "object" && v !== null && "props" in (v as object);

/** Direct element children of a node, flattened (mirrors the #2180 helper). */
function childrenOf(node: El): El[] {
  const raw = (node.props as { children?: unknown }).children;
  const list = Array.isArray(raw) ? (raw as unknown[]).flat(Infinity) : [raw];
  return list.filter(isElement);
}

/** Every element in the subtree rooted at `node`, WITHOUT invoking components. */
function walkStatic(node: El, out: El[] = []): El[] {
  out.push(node);
  for (const child of childrenOf(node)) walkStatic(child, out);
  return out;
}

/**
 * Walk the tree, INVOKING any function component met, so assertions see what
 * the user sees. Safe: every component reached this way is props-only.
 */
function expand(node: unknown, out: El[] = []): El[] {
  if (Array.isArray(node)) {
    for (const child of node) expand(child, out);
    return out;
  }
  if (!isElement(node)) return out;
  out.push(node);
  if (typeof node.type === "function") {
    expand((node.type as (p: unknown) => unknown)(node.props), out);
  }
  expand((node.props as { children?: unknown }).children, out);
  return out;
}

function strings(nodes: El[]): string[] {
  const found: string[] = [];
  const collect = (v: unknown): void => {
    if (typeof v === "string") {
      found.push(v);
      return;
    }
    if (Array.isArray(v)) for (const item of v) collect(item);
  };
  for (const n of nodes) collect((n.props as { children?: unknown }).children);
  return found;
}

const textOf = (nodes: El[]): string => strings(nodes).join(" ");

const byLabel = (nodes: El[], label: string): El[] =>
  nodes.filter(
    (n) =>
      (n.props as { accessibilityLabel?: string }).accessibilityLabel === label,
  );

function flattenStyle(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) {
    return Object.assign(
      {},
      ...(style as unknown[]).flat(Infinity).filter(Boolean).map(flattenStyle),
    );
  }
  return (style ?? {}) as Record<string, unknown>;
}

/** A real scrolling host: RN's ScrollView (or a wrapper that forwards to one). */
function isScrollHost(node: El): boolean {
  const name =
    typeof node.type === "string"
      ? node.type
      : ((node.type as { displayName?: string; name?: string })?.displayName ??
        (node.type as { name?: string })?.name ??
        "");
  return (
    /ScrollView/.test(name) &&
    "contentContainerStyle" in (node.props as object)
  );
}

const RN_MOCK = require("../__manual_mocks__/react-native.js") as {
  useWindowDimensions: () => {
    width: number;
    height: number;
    scale: number;
    fontScale: number;
  };
};

function withFontScale<T>(fontScale: number, body: () => T): T {
  const original = RN_MOCK.useWindowDimensions;
  const baseline = original();
  RN_MOCK.useWindowDimensions = () => ({ ...baseline, fontScale });
  try {
    return body();
  } finally {
    RN_MOCK.useWindowDimensions = original;
  }
}

/** RN iOS `RCTAccessibilityManager.mm` multipliers, ordinary through AX5. */
const RN_IOS_FONT_SCALES = [
  0.823, 0.882, 0.941, 1, 1.118, 1.235, 1.353, 1.786, 2.143, 2.643, 3.143,
  3.571,
];

const renderTree = (): El[] => expand((NotFoundScreen as unknown as () => El)());
const renderRoot = (): El => (NotFoundScreen as unknown as () => El)();

const EMAIL = "business@usemingla.com";

beforeEach(() => {
  mockRouterReplace.mockReset();
  mockRouterPush.mockReset();
  mockAuthState.user = null;
  mockAuthState.isAuthReady = true;
  mockAuthState.signOut = async () => undefined;
});

/* =====================================================================
   A. INFORMATION LEAK — identity is unreachable from the public routes
   ===================================================================== */

const BUSINESS_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(BUSINESS_ROOT, "..");
const SOURCE_EXTS = [".tsx", ".ts", ".jsx", ".js"];
const PLATFORM_SUFFIXES = ["", ".web", ".native", ".ios", ".android"];

const isTestPath = (p: string): boolean =>
  /__tests__|__mocks__|__manual_mocks__|\.test\.|\.spec\./.test(p);

const fileCache = new Map<string, string | null>();
function readSource(file: string): string | null {
  if (fileCache.has(file)) return fileCache.get(file) ?? null;
  let out: string | null = null;
  try {
    out = fs.readFileSync(file, "utf8");
  } catch {
    out = null;
  }
  fileCache.set(file, out);
  return out;
}

const existsFile = (p: string): boolean => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

/** Resolve a relative or `@mingla/*` specifier to a real file, or null. */
function resolveSpecifier(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith(".")) {
    base = path.resolve(path.dirname(fromFile), spec);
  } else if (spec.startsWith("@mingla/")) {
    // A workspace barrel must not be able to launder an identity import.
    const pkgDir = path.join(REPO_ROOT, "packages", spec.slice("@mingla/".length));
    const manifest = path.join(pkgDir, "package.json");
    if (!existsFile(manifest)) return null;
    const main = (JSON.parse(readSource(manifest) ?? "{}") as { main?: string })
      .main;
    base = path.join(pkgDir, main ?? "index");
    if (existsFile(base)) return base;
    base = base.replace(/\.[^./]+$/, "");
  } else {
    return null;
  }
  for (const suffix of PLATFORM_SUFFIXES)
    for (const ext of SOURCE_EXTS) {
      const candidate = base + suffix + ext;
      if (existsFile(candidate)) return candidate;
    }
  for (const suffix of PLATFORM_SUFFIXES)
    for (const ext of SOURCE_EXTS) {
      const candidate = path.join(base, `index${suffix}${ext}`);
      if (existsFile(candidate)) return candidate;
    }
  return null;
}

/**
 * Every platform variant of a resolved module. Expo Router picks `.web.tsx`
 * over `.tsx` on web, so following only the file the specifier happens to hit
 * would let a `.web` sibling import identity unseen.
 */
function platformVariants(file: string): string[] {
  const out = new Set<string>([file]);
  const ext = path.extname(file);
  let stem = file.slice(0, file.length - ext.length);
  for (const suffix of PLATFORM_SUFFIXES)
    if (suffix && stem.endsWith(suffix))
      stem = stem.slice(0, stem.length - suffix.length);
  for (const suffix of PLATFORM_SUFFIXES)
    for (const e of SOURCE_EXTS) {
      const candidate = stem + suffix + e;
      if (existsFile(candidate)) out.add(candidate);
    }
  return [...out];
}

const STATIC_IMPORT_RE =
  /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*["']([^"']+)["']/g;
const SIDE_EFFECT_IMPORT_RE = /(?:^|\n)\s*import\s*["']([^"']+)["']/g;
const DYNAMIC_IMPORT_RE =
  /\brequire\(\s*["']([^"']+)["']\s*\)|\bimport\(\s*["']([^"']+)["']\s*\)/g;

function specifiersIn(src: string): string[] {
  const out: string[] = [];
  for (const re of [STATIC_IMPORT_RE, SIDE_EFFECT_IMPORT_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) out.push(m[1]);
  }
  DYNAMIC_IMPORT_RE.lastIndex = 0;
  let d: RegExpExecArray | null;
  while ((d = DYNAMIC_IMPORT_RE.exec(src)) !== null) out.push(d[1] ?? d[2]);
  return out;
}

interface Reach {
  parent: Map<string, string | null>;
  reached: Set<string>;
}

/** Transitive module closure of `entries`, test files excluded. */
function closure(entries: string[]): Reach {
  const parent = new Map<string, string | null>();
  const reached = new Set<string>();
  const stack: string[] = [];
  for (const entry of entries)
    for (const variant of platformVariants(entry))
      if (!reached.has(variant)) {
        reached.add(variant);
        parent.set(variant, null);
        stack.push(variant);
      }
  while (stack.length > 0) {
    const file = stack.pop() as string;
    if (isTestPath(file)) continue;
    const src = readSource(file);
    if (src === null) continue;
    for (const spec of specifiersIn(src)) {
      const resolved = resolveSpecifier(spec, file);
      if (resolved === null || isTestPath(resolved)) continue;
      for (const variant of platformVariants(resolved)) {
        if (reached.has(variant)) continue;
        reached.add(variant);
        parent.set(variant, file);
        stack.push(variant);
      }
    }
  }
  return { parent, reached };
}

function chainTo(parent: Map<string, string | null>, file: string): string {
  const hops: string[] = [];
  let cursor: string | null = file;
  while (cursor != null) {
    hops.push(path.relative(BUSINESS_ROOT, cursor));
    cursor = parent.get(cursor) ?? null;
  }
  return hops.reverse().join(" -> ");
}

const IDENTITY_MODULES: Record<string, RegExp> = {
  SignedInNotFoundNotice: /components\/auth\/SignedInNotFoundNotice\.[jt]sx?$/,
  useSwitchAccount: /hooks\/useSwitchAccount\.[jt]sx?$/,
};
const AUTH_CONTEXT_RE = /context\/AuthContext\.[jt]sx?$/;

function listFiles(dir: string): string[] {
  const out: string[] = [];
  const rec = (d: string): void => {
    for (const name of fs.readdirSync(d)) {
      const p = path.join(d, name);
      if (fs.statSync(p).isDirectory()) {
        if (name === "__tests__" || name === "__mocks__") continue;
        rec(p);
        continue;
      }
      if (/\.tsx?$/.test(name) && !isTestPath(p)) out.push(p);
    }
  };
  rec(dir);
  return out;
}

/** Every public / anon-tolerant buyer entry point. */
const PUBLIC_ENTRIES: string[] = (() => {
  const named = [
    "app/b/[brandSlug]/index.tsx",
    "app/b/[brandSlug]/v/[venueSlug].tsx",
    "app/e/[brandSlug]/[eventSlug].tsx",
    "app/t/[brandSlug]/[tripSlug].tsx",
    "app/exp/[brandSlug]/[experienceSlug].tsx",
    "app/o/[orderId].tsx",
    "app/o/venue/[orderId].tsx",
    "app/reserve/[brandId]/index.tsx",
    "app/reserve/[brandId]/manage.tsx",
    "app/reserve/[brandId]/confirm.tsx",
    "src/components/brand/PublicBrandNotFound.tsx",
    "src/components/venue/PublicVenueNotFound.tsx",
  ].map((rel) => path.join(BUSINESS_ROOT, rel));
  const dirs = ["app/checkout", "app/checkout-experience", "app/checkout-trip"];
  for (const dir of dirs) named.push(...listFiles(path.join(BUSINESS_ROOT, dir)));
  return named;
})();

/**
 * The ONE pre-existing transitive AuthContext path from a public entry, pinned
 * at `8c7f5a05c` and identical on `origin/main` (`16fbeb16c`) — it predates
 * #3259 and runs through a store shim, never through an identity component.
 * Pinned as a SET, not a count: a new path reds this, and removing the old one
 * reds it too so the pin cannot rot silently.
 */
const PREEXISTING_AUTHCONTEXT_ENTRYPOINTS = [
  "app/checkout-trip/[tripEventId]/payment.tsx",
];

describe("#3259 A — the signed-in identity block is UNREACHABLE from public buyer routes", () => {
  const publicReach = closure(PUBLIC_ENTRIES);
  const notFoundReach = closure([path.join(BUSINESS_ROOT, "app/+not-found.tsx")]);

  it("CONTROL: the walker really does find both identity modules from +not-found", () => {
    // Without this, every negative below could be a walker that matches nothing.
    expect(PUBLIC_ENTRIES.length).toBeGreaterThanOrEqual(25);
    for (const entry of PUBLIC_ENTRIES) expect(existsFile(entry)).toBe(true);
    for (const [name, re] of Object.entries(IDENTITY_MODULES)) {
      const hit = [...notFoundReach.reached].filter((f) => re.test(f));
      expect({ name, hits: hit.length }).toEqual({ name, hits: 1 });
    }
    expect(
      [...notFoundReach.reached].some((f) => AUTH_CONTEXT_RE.test(f)),
    ).toBe(true);
  });

  it.each(Object.keys(IDENTITY_MODULES))(
    "%s is reachable from ZERO public buyer entry points",
    (name) => {
      const re = IDENTITY_MODULES[name];
      const hits = [...publicReach.reached]
        .filter((f) => re.test(f))
        .map((f) => chainTo(publicReach.parent, f));
      // A transitive chain counts: a barrel re-export must not launder it.
      expect(hits).toEqual([]);
    },
  );

  it("adds no NEW AuthContext path to the public buyer surface", () => {
    // Handbook §5: buyer routes (/checkout/, /e/, /b/, /t/) never reach auth.
    const authFiles = [...publicReach.reached].filter((f) =>
      AUTH_CONTEXT_RE.test(f),
    );
    const entryPoints = authFiles
      .map((f) => chainTo(publicReach.parent, f).split(" -> ")[0])
      .filter((v, i, a) => a.indexOf(v) === i)
      .sort();
    expect(entryPoints).toEqual([...PREEXISTING_AUTHCONTEXT_ENTRYPOINTS].sort());
  });

  it("no public buyer route FILE calls useAuth / useSwitchAccount itself", () => {
    const CALL_RE = /\buse(?:Auth|SwitchAccount)\s*\(/;
    // CONTROL: the regex must match where the call really is.
    expect(
      CALL_RE.test(readSource(path.join(BUSINESS_ROOT, "app/+not-found.tsx")) ?? ""),
    ).toBe(true);
    const offenders = PUBLIC_ENTRIES.filter((f) =>
      CALL_RE.test(readSource(f) ?? ""),
    ).map((f) => path.relative(BUSINESS_ROOT, f));
    expect(offenders).toEqual([]);
  });

  it("every SignedInNotFoundNotice call site sources the email from the hook, never from useAuth directly", () => {
    // TRAP 1 defence: `signedInEmail={user?.email ?? null}` at a call site
    // would bypass the `isAuthReady` gate and flash an identity on cold load.
    const callSites: { file: string; expr: string }[] = [];
    for (const file of [
      ...listFiles(path.join(BUSINESS_ROOT, "app")),
      ...listFiles(path.join(BUSINESS_ROOT, "src")),
    ]) {
      const src = readSource(file) ?? "";
      if (!src.includes("<SignedInNotFoundNotice")) continue;
      const re = /signedInEmail=\{([^}]*)\}/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null)
        callSites.push({
          file: path.relative(BUSINESS_ROOT, file),
          expr: m[1].trim(),
        });
    }
    // CONTROL: the scan found the real call sites, so an empty offender list
    // below is a verdict and not a vacuous run.
    expect(callSites.length).toBeGreaterThanOrEqual(10);
    expect(
      callSites.filter((c) => c.expr !== "signedInEmail"),
    ).toEqual([]);
  });

  it("every SignedInNotFoundNotice call site passes a literal, known variant", () => {
    const found: { file: string; variant: string }[] = [];
    for (const file of [
      ...listFiles(path.join(BUSINESS_ROOT, "app")),
      ...listFiles(path.join(BUSINESS_ROOT, "src")),
    ]) {
      const src = readSource(file) ?? "";
      if (!src.includes("<SignedInNotFoundNotice")) continue;
      const re = /variant="([^"]+)"\s*\n\s*signedInEmail/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null)
        found.push({ file: path.relative(BUSINESS_ROOT, file), variant: m[1] });
    }
    expect(found.length).toBeGreaterThanOrEqual(10);
    expect(
      found.filter((f) => f.variant !== "missing" && f.variant !== "restricted"),
    ).toEqual([]);
    // `missing` says "switch accounts and open it again" — only honest on a
    // pure route miss. Every data-backed screen must use `restricted`.
    expect(found.filter((f) => f.variant === "missing").map((f) => f.file)).toEqual(
      ["app/+not-found.tsx"],
    );
  });
});

/* =====================================================================
   B. EXISTENCE NON-DISCLOSURE — the anon copy has not drifted
   ===================================================================== */

describe("#3259 B — an anon visitor still cannot tell a pending thing from a nonexistent one", () => {
  const venueTree = (brandSlug: string | null, brandDisplayName: string | null): El[] =>
    expand(
      (PublicVenueNotFound as unknown as (p: unknown) => El)({
        brandSlug,
        brandDisplayName,
      }),
    );

  it("PublicVenueNotFound renders IDENTICAL copy for every reason it can fire", () => {
    // META-ORCH-1255(C) §6.8: one state for "no such venue", "not live yet"
    // and "suspended/removed". The component takes no reason prop, and this
    // pins that it never grows one.
    const a = textOf(venueTree(null, null));
    const b = textOf(venueTree("lanternroom", null));
    expect(a).toBe(b);
    expect(a).toContain("This venue isn't on Mingla yet");
    expect(a).toContain("The link may be mistyped, or the venue isn't live right now.");
  });

  it("PublicVenueNotFound names no account, no session and no cause", () => {
    const copy = textOf(venueTree("lanternroom", "Lantern Room")).toLowerCase();
    for (const forbidden of [
      "signed in as",
      "switch account",
      "deleted",
      "permission",
      "access",
      "your account",
    ])
      expect(copy).not.toContain(forbidden);
  });

  it("PublicBrandNotFound copy is unchanged and equally reason-free", () => {
    const copy = textOf(
      expand((PublicBrandNotFound as unknown as (p: unknown) => El)({})),
    );
    expect(copy).toContain("We couldn't find that brand");
    expect(copy).toContain(
      "The link may be mistyped or the brand may have changed its name.",
    );
    const lower = copy.toLowerCase();
    for (const forbidden of ["signed in as", "switch account", "deleted", "permission"])
      expect(lower).not.toContain(forbidden);
  });

  it("the public order routes keep their generic copy and gain no identity", () => {
    // COPY-DRIFT PIN (source text, with the control immediately below).
    const order = readSource(path.join(BUSINESS_ROOT, "app/o/[orderId].tsx")) ?? "";
    // CONTROL: the file really was read and really is the order route.
    expect(order).toContain('title="Order not found"');
    expect(order).toContain(
      "If you have your confirmation email, the link there is the canonical reference.",
    );
    const venueOrder =
      readSource(path.join(BUSINESS_ROOT, "app/o/venue/[orderId].tsx")) ?? "";
    expect(venueOrder).toContain("We can't open this order");
    for (const src of [order, venueOrder]) {
      expect(src).not.toContain("SignedInNotFoundNotice");
      expect(src).not.toContain("useSwitchAccount");
      expect(src).not.toMatch(/You(?:'|&apos;|’)re signed in as/);
    }
  });
});

/* =====================================================================
   C. NEVER CLAIM A PERMISSION DENIAL ON A ROUTE MISS
   ===================================================================== */

const DENIAL_WORDS = [
  "permission",
  "not allowed",
  "access denied",
  "forbidden",
  "unauthorized",
  "unauthorised",
  "denied",
  "403",
];

describe("#3259 C — the route-miss screen never claims a denial", () => {
  it.each(RN_IOS_FONT_SCALES)(
    "signed in at fontScale %s, no branch of the 404 asserts a denial",
    (fontScale: number) => {
      mockAuthState.user = { email: EMAIL };
      const copy = withFontScale(fontScale, () => textOf(renderTree()));
      // CONTROL: the tree really rendered the signed-in branch at this scale.
      expect(copy).toContain(EMAIL);
      expect(copy).toContain(SIGNED_IN_HEADING);
      for (const word of DENIAL_WORDS)
        expect(copy.toLowerCase()).not.toContain(word);
    },
  );

  it("the `missing` copy itself is denial-free and blames nobody", () => {
    const copy = SIGNED_IN_NOT_FOUND_COPY.missing.toLowerCase();
    for (const word of DENIAL_WORDS) expect(copy).not.toContain(word);
    // It must also not re-introduce the typo-hunt the issue was filed about.
    expect(copy).not.toContain("typo");
    expect(copy).not.toContain("mistyped");
    // …and it must still not claim the thing exists.
    expect(copy).not.toContain("this page exists");
  });

  it("the signed-in heading still says the page does not exist", () => {
    // #3259 must not over-correct into "you can't see this", which the screen
    // has no status, no error and no props to justify.
    expect(SIGNED_IN_HEADING.toLowerCase()).toContain("doesn't exist");
  });
});

/* =====================================================================
   D. NEVER ASSERT WHICH CAUSE FIRED ON `restricted`
   ===================================================================== */

describe("#3259 D — `restricted` states both possibilities and asserts neither", () => {
  const copy = SIGNED_IN_NOT_FOUND_COPY.restricted;

  it("hedges, and offers a disjunction rather than a diagnosis", () => {
    expect(copy).toMatch(/\bmay\b/);
    expect(copy).toMatch(/\bor\b/);
    // Both halves present: deletion AND invisibility-to-this-account.
    expect(copy.toLowerCase()).toContain("deleted");
    expect(copy.toLowerCase()).toContain("visible to this account");
  });

  it("never states a bare cause as fact", () => {
    const lower = copy.toLowerCase();
    expect(lower).not.toMatch(/\bhas been deleted\b/);
    expect(lower).not.toMatch(/\bwas deleted\b/);
    expect(lower).not.toMatch(/\bdon'?t have (?:access|permission)\b/);
    for (const word of DENIAL_WORDS) expect(lower).not.toContain(word);
  });

  it("the two variants are genuinely different sentences", () => {
    // A copy/paste that collapsed them would make `missing` claim a deletion.
    expect(SIGNED_IN_NOT_FOUND_COPY.missing).not.toBe(copy);
    expect(SIGNED_IN_NOT_FOUND_COPY.missing.toLowerCase()).not.toContain("deleted");
  });
});

/* =====================================================================
   E. DEGENERATE IDENTITY VALUES
   ===================================================================== */

const noticeTree = (variant: "missing" | "restricted", email: string | null): El[] =>
  expand(
    (SignedInNotFoundNotice as unknown as (p: unknown) => El | null)({
      variant,
      signedInEmail: email,
      onSwitchAccount: jest.fn(),
      testID: "probe",
    }),
  );

describe("#3259 E — degenerate identity values never produce a half-sentence", () => {
  it.each([
    ["null", null],
    ["empty string", ""],
  ])("renders NOTHING at all for %s", (_label, email) => {
    const nodes = noticeTree("restricted", email as string | null);
    expect(nodes).toEqual([]);
  });

  it("the hook can only ever emit a non-empty string or null", () => {
    // The component is props-only; this is the guarantee at the source, so a
    // future relaxation there cannot silently create the empty-card state.
    const src = readSource(path.join(BUSINESS_ROOT, "src/hooks/useSwitchAccount.ts")) ?? "";
    expect(src).toContain("isAuthReady");
    expect(src).toMatch(/typeof user\?\.email === "string"/);
    expect(src).toMatch(/user\.email\.length > 0/);
    expect(src).toMatch(/:\s*null;/);
  });

  it.each([
    ["a 254-char RFC-max address", `${"a".repeat(240)}@usemingla.com`],
    ["a plus-addressed alias", "business+stripe.return@usemingla.com"],
    ["a unicode local part", "séth.ögieva@usemingla.com"],
    ["an address containing markup-ish characters", "a<b>&\"'@usemingla.com"],
  ])("renders %s as ONE complete sentence, verbatim", (_label, email) => {
    const nodes = noticeTree("restricted", email);
    const sentence = strings(nodes).find((s) => s.includes("signed in as"));
    // The email is a separate child, so recombine the identity Text's children.
    const identity = nodes.find((n) =>
      strings([n]).some((s) => s.includes("signed in as")),
    ) as El;
    const joined = strings([identity]).join("");
    expect(sentence).toBeDefined();
    expect(joined).toContain(email);
    expect(joined.endsWith(".")).toBe(true);
    // No "signed in as ." and no stray double space around the slot.
    expect(joined).not.toMatch(/signed in as\s*\.$/);
    expect(joined).not.toMatch(/signed in as\s{2,}/);
  });

  it("never truncates the identity — a clipped address can name the WRONG account", () => {
    const nodes = noticeTree("restricted", `${"a".repeat(240)}@usemingla.com`);
    const identity = nodes.find((n) =>
      strings([n]).some((s) => s.includes("signed in as")),
    ) as El;
    expect(identity).toBeDefined();
    expect((identity.props as { numberOfLines?: number }).numberOfLines).toBeUndefined();
    expect(
      (identity.props as { ellipsizeMode?: string }).ellipsizeMode,
    ).toBeUndefined();
    const card = nodes[0];
    const cardStyle = flattenStyle((card.props as { style?: unknown }).style);
    // A fixed height would clip the address at large Dynamic Type instead.
    expect(cardStyle.height).toBeUndefined();
    expect(cardStyle.maxHeight).toBeUndefined();
  });

  it("the email never reaches a testID, a route or a query string", () => {
    mockAuthState.user = { email: EMAIL };
    const nodes = renderTree();
    for (const n of nodes) {
      const props = n.props as Record<string, unknown>;
      for (const key of ["testID", "accessibilityHint", "accessibilityValue"])
        expect(JSON.stringify(props[key] ?? null)).not.toContain(EMAIL);
    }
    const control = byLabel(nodes, SWITCH_ACCOUNT_LABEL)[0];
    return (control.props as { onPress: () => Promise<void> })
      .onPress()
      .then(() => {
        for (const call of mockRouterReplace.mock.calls.concat(
          mockRouterPush.mock.calls,
        )) {
          const target = String(call[0]);
          expect(target).not.toContain(EMAIL);
          expect(target).not.toContain("?");
          expect(target).not.toContain("@");
        }
      });
  });
});

/* =====================================================================
   F. NO MIXED STATE — the heading and the notice flip together
   ===================================================================== */

interface AuthShape {
  label: string;
  user: { email?: string | null } | null;
  isAuthReady: boolean;
  expectIdentity: boolean;
}

const AUTH_SHAPES: AuthShape[] = [
  { label: "signed out, auth ready", user: null, isAuthReady: true, expectIdentity: false },
  { label: "signed out, auth NOT ready", user: null, isAuthReady: false, expectIdentity: false },
  {
    label: "signed in, auth NOT ready (cold load race)",
    user: { email: EMAIL },
    isAuthReady: false,
    expectIdentity: false,
  },
  {
    label: "session with a null email",
    user: { email: null },
    isAuthReady: true,
    expectIdentity: false,
  },
  {
    label: "session with an absent email key",
    user: {},
    isAuthReady: true,
    expectIdentity: false,
  },
  {
    label: "session with an empty-string email",
    user: { email: "" },
    isAuthReady: true,
    expectIdentity: false,
  },
  {
    label: "signed in, auth ready",
    user: { email: EMAIL },
    isAuthReady: true,
    expectIdentity: true,
  },
];

describe("#3259 F — every auth shape is WHOLLY signed-out or WHOLLY signed-in", () => {
  it.each(AUTH_SHAPES.map((s) => [s.label, s] as const))(
    "%s never renders a mixed screen",
    (_label, shape) => {
      mockAuthState.user = shape.user;
      mockAuthState.isAuthReady = shape.isAuthReady;
      const nodes = renderTree();
      const copy = textOf(nodes);
      const hasNotice = byLabel(nodes, SWITCH_ACCOUNT_LABEL).length > 0;
      expect(hasNotice).toBe(shape.expectIdentity);

      if (shape.expectIdentity) {
        // Signed-in: new heading, no typo line, identity present, exit present.
        expect(copy).toContain(SIGNED_IN_HEADING);
        expect(copy).not.toContain(SIGNED_OUT_SUBTEXT);
        expect(copy).toContain(EMAIL);
      } else {
        // THE MIXED STATE THIS CATCHES: a heading that flipped to the signed-in
        // wording while the notice rendered nothing would leave the reader with
        // no typo hint AND no account to act on. Both halves must move as one.
        expect(copy).toContain(SIGNED_OUT_HEADING);
        expect(copy).toContain(SIGNED_OUT_SUBTEXT);
        expect(copy).not.toContain(SIGNED_IN_HEADING);
        expect(copy).not.toContain("signed in as");
      }
      // The guaranteed exit survives every shape.
      expect(byLabel(nodes, "Go home").length).toBeGreaterThanOrEqual(1);
    },
  );

  it("flipping isAuthReady true moves the heading and the notice in the SAME step", () => {
    mockAuthState.user = { email: EMAIL };
    mockAuthState.isAuthReady = false;
    const before = renderTree();
    mockAuthState.isAuthReady = true;
    const after = renderTree();
    expect(textOf(before)).toContain(SIGNED_OUT_HEADING);
    expect(byLabel(before, SWITCH_ACCOUNT_LABEL)).toHaveLength(0);
    expect(textOf(after)).toContain(SIGNED_IN_HEADING);
    expect(byLabel(after, SWITCH_ACCOUNT_LABEL)).toHaveLength(1);
  });
});

/* =====================================================================
   G. RE-ENTRANCY AND A REJECTING SIGN-OUT
   ===================================================================== */

describe("#3259 G — the escape hatch under stress", () => {
  const pressControl = (): (() => Promise<void>) => {
    mockAuthState.user = { email: EMAIL };
    mockAuthState.isAuthReady = true;
    const control = byLabel(renderTree(), SWITCH_ACCOUNT_LABEL)[0];
    expect(control).toBeDefined();
    return (control.props as { onPress: () => Promise<void> }).onPress;
  };

  it("a REJECTING signOut never navigates to /auth", async () => {
    // THE INFINITE-LOOP TRAP (app/accept-brand-invitation.tsx:191-202): /auth
    // resumes whenever `!loading && user`, so landing there while still signed
    // in bounces back and re-fails as the same account, forever.
    const boom = new Error("network down");
    mockAuthState.signOut = jest.fn(async () => {
      throw boom;
    });
    const onPress = pressControl();
    await expect(onPress()).rejects.toThrow("network down");
    expect(mockRouterReplace).not.toHaveBeenCalled();
    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  it("the handler returns a promise, so the ordering is observable to its caller", () => {
    const onPress = pressControl();
    const result = onPress();
    expect(result).toBeInstanceOf(Promise);
    return result;
  });

  it("no navigation happens while ANY sign-out is still in flight (double tap)", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const signOut = jest.fn(() => gate);
    mockAuthState.signOut = signOut;
    const onPress = pressControl();

    const first = onPress();
    const second = onPress();
    // Both taps are in flight; the user is still signed in. Navigating now
    // would hand /auth a live session and start the bounce loop.
    expect(mockRouterReplace).not.toHaveBeenCalled();

    release();
    await Promise.all([first, second]);
    expect(mockRouterReplace).toHaveBeenCalledWith("/auth");
  });

  it("navigates to plain /auth with exactly one argument — no resume payload", async () => {
    const onPress = pressControl();
    await onPress();
    expect(mockRouterReplace).toHaveBeenCalledTimes(1);
    expect(mockRouterReplace.mock.calls[0]).toEqual(["/auth"]);
  });
});

/* =====================================================================
   H. #2180 STRUCTURE, RE-ASSERTED ON THE SIGNED-IN BRANCH
   ===================================================================== */

describe("#3259 H — #2180's structural guarantees survive WITH the notice rendered", () => {
  const signedInRoot = (fontScale: number): El => {
    mockAuthState.user = { email: EMAIL };
    mockAuthState.isAuthReady = true;
    return withFontScale(fontScale, renderRoot);
  };

  const safeAreaOf = (root: El): El => {
    const found = walkStatic(root).find((n) => n.type === "SafeAreaView");
    if (found === undefined) throw new Error("no SafeAreaView in the tree");
    return found;
  };

  it.each(RN_IOS_FONT_SCALES)(
    "at fontScale %s the footer is a non-shrinking SIBLING holding Go home",
    (fontScale: number) => {
      const safeArea = safeAreaOf(signedInRoot(fontScale));
      const regions = childrenOf(safeArea);
      expect(regions.length).toBeGreaterThanOrEqual(2);

      const content = flattenStyle((regions[0].props as { style?: unknown }).style);
      expect(content.flex).toBe(1);
      expect(content.overflow).toBe("hidden");

      const footer = regions[regions.length - 1];
      const footerNodes = expand(footer);
      expect(byLabel(footerNodes, "Go home").length).toBe(1);
      expect(
        flattenStyle((footer.props as { style?: unknown }).style).flexShrink,
      ).toBe(0);

      // THE #2180 REGRESSION: the one certain exit must never move back inside
      // the region whose height the new notice can now grow.
      expect(byLabel(expand(regions[0]), "Go home")).toHaveLength(0);
      // …and the safe area still reaches the bottom edge.
      expect((safeArea.props as { edges?: string[] }).edges ?? []).toContain("bottom");
    },
  );

  it.each(RN_IOS_FONT_SCALES)(
    "at fontScale %s the footer holds EXACTLY ONE control — the notice never doubles its height",
    (fontScale: number) => {
      // The implementor's stated reason for putting "Switch account" inside the
      // ScrollView. Verified, not accepted.
      const safeArea = safeAreaOf(signedInRoot(fontScale));
      const regions = childrenOf(safeArea);
      const footerNodes = expand(regions[regions.length - 1]);
      const pressables = footerNodes.filter(
        (n) => typeof (n.props as { onPress?: unknown }).onPress === "function",
      );
      expect(pressables).toHaveLength(1);
      expect(byLabel(footerNodes, SWITCH_ACCOUNT_LABEL)).toHaveLength(0);
    },
  );

  it.each(RN_IOS_FONT_SCALES)(
    "at fontScale %s the Switch account control lives inside the SCROLLING region, so it is reachable",
    (fontScale: number) => {
      const safeArea = safeAreaOf(signedInRoot(fontScale));
      const regions = childrenOf(safeArea);
      const scrollNodes = expand(regions[0]);
      expect(byLabel(scrollNodes, SWITCH_ACCOUNT_LABEL)).toHaveLength(1);
      // It must be inside a real SCROLL host, not a pinned region: at AX5 the
      // lockup + heading + card overflow the column, and a non-scrolling host
      // would simply clip the recovery action away (`content` is
      // `overflow: "hidden"`).
      const hosts = walkStatic(regions[0]).filter(isScrollHost);
      expect(hosts.length).toBeGreaterThanOrEqual(1);
      expect(isScrollHost(regions[0])).toBe(true);
    },
  );

  it.each(RN_IOS_FONT_SCALES)(
    "at fontScale %s the heading still carries accessibilityRole=header",
    (fontScale: number) => {
      const root = signedInRoot(fontScale);
      const headings = expand(root).filter(
        (n) =>
          (n.props as { accessibilityRole?: string }).accessibilityRole ===
          "header",
      );
      expect(headings.length).toBeGreaterThanOrEqual(1);
      expect(strings(headings).join(" ")).toContain(SIGNED_IN_HEADING);
    },
  );

  it.each(RN_IOS_FONT_SCALES)(
    "at fontScale %s the brand lockup is still sized on BOTH axes with no aspectRatio",
    (fontScale: number) => {
      const image = expand(signedInRoot(fontScale)).find(
        (n) => (n.props as { accessibilityRole?: string }).accessibilityRole === "image",
      ) as El;
      expect(image).toBeDefined();
      const applied = flattenStyle((image.props as { style?: unknown }).style);
      expect(typeof applied.width).toBe("number");
      expect(typeof applied.height).toBe("number");
      expect(applied.aspectRatio).toBeUndefined();
      expect(applied.width as number).toBeGreaterThan(0);
      expect(applied.width as number).toBeLessThanOrEqual(400);
      expect(applied.height as number).toBeGreaterThan(0);
      expect(applied.height as number).toBeLessThanOrEqual(400);
    },
  );

  it("the large-type lockup step-down still fires on the SIGNED-IN branch", () => {
    // CONTROL for the matrix above: without this, all twelve rows could be one
    // branch and the compact arm could be dead on this branch specifically.
    const findImage = (fontScale: number): Record<string, unknown> => {
      const image = expand(signedInRoot(fontScale)).find(
        (n) => (n.props as { accessibilityRole?: string }).accessibilityRole === "image",
      ) as El;
      return flattenStyle((image.props as { style?: unknown }).style);
    };
    const ordinary = findImage(LARGE_TYPE_FONT_SCALE - 0.5);
    const accessibility = findImage(LARGE_TYPE_FONT_SCALE + 0.5);
    expect(accessibility.width as number).toBeLessThan(ordinary.width as number);
    expect(accessibility.height as number).toBeLessThan(ordinary.height as number);
  });
});

/* =====================================================================
   I. NO DEAD TAPS (Constitution #1)
   ===================================================================== */

describe("#3259 I — every control in the new states is real and labelled", () => {
  it("the signed-in 404 has no control without a handler or a label", () => {
    mockAuthState.user = { email: EMAIL };
    const nodes = renderTree();
    const controls = nodes.filter(
      (n) =>
        "onPress" in (n.props as object) ||
        (n.props as { accessibilityRole?: string }).accessibilityRole === "button",
    );
    // CONTROL: at minimum Go home + Switch account.
    expect(controls.length).toBeGreaterThanOrEqual(2);
    for (const control of controls) {
      const props = control.props as {
        onPress?: unknown;
        accessibilityLabel?: string;
        label?: string;
      };
      expect(typeof props.onPress).toBe("function");
      expect(typeof (props.accessibilityLabel ?? props.label)).toBe("string");
      expect((props.accessibilityLabel ?? props.label ?? "").length).toBeGreaterThan(0);
    }
  });

  it.each(["missing", "restricted"] as const)(
    "the %s notice's switch control is full-width, labelled, and wired",
    (variant) => {
      const handler = jest.fn();
      const nodes = expand(
        (SignedInNotFoundNotice as unknown as (p: unknown) => El)({
          variant,
          signedInEmail: EMAIL,
          onSwitchAccount: handler,
          testID: "probe",
        }),
      );
      const control = byLabel(nodes, SWITCH_ACCOUNT_LABEL)[0];
      expect(control).toBeDefined();
      expect((control.props as { onPress?: unknown }).onPress).toBe(handler);
      expect((control.props as { fullWidth?: boolean }).fullWidth).toBe(true);
      expect((control.props as { label?: string }).label).toBe(SWITCH_ACCOUNT_LABEL);
      // The card itself must be addressable for the host screen's own proofs.
      expect((nodes[0].props as { testID?: string }).testID).toBe("probe");
    },
  );
});
