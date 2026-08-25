/**
 * #1594 [consumer-map-url] — IMPLEMENTOR regression guard.
 *
 * WHAT USERS LOST, in one paragraph. The consumer app renders a "Where you'll
 * be" / "Where you'll start" static map on FOUR public surfaces — venue, trip,
 * experience and RSVP/event. All four build that map through the single shared
 * owner `buildStaticMapUrl`, which resolves its base from
 * `Constants.expoConfig.extra.EXPO_PUBLIC_SUPABASE_URL`. `mingla-business`
 * emits that key; `app-mobile` never did, because it does not use an env var
 * for its project URL at all. So the resolver returned null, the builder
 * returned null, and every caller HID the map — fail-safe under Constitution
 * rule 9, and therefore completely silent. Nobody saw it until #1550's device
 * pass. The fix gives `app-mobile/app.config.js` the same value the app's own
 * Supabase client uses, from ONE owner module both layers can read.
 *
 * WHY THIS FILE LIVES IN `mingla-business/src/__tests__`. `mingla-business jest
 * (full suite)` is the only universal required gate — it runs on every PR to
 * main with no paths filter — and its roots stop at `mingla-business/src`. A
 * test placed beside the code it guards (`app-mobile/`, `packages/`) runs
 * NOWHERE. `I-PROPOSED-2148-CI-TOPOLOGY-BOUNDED` forbids adding an
 * `issue-*.yml` lane to give it a home. Precedent for reaching into an app
 * config from here: `appConfig_pkLiveFailClose.test.ts`,
 * `issue1732ReleaseBoundStripeFailClose.test.ts`; precedent for reaching into
 * `app-mobile` source: `consumerVenueAdoption.issue1560.happy.test.tsx`.
 *
 * WHY THE ASSERTIONS ARE EXECUTABLE AND NOT A SOURCE GREP. The entire defect is
 * that the source looked correct at every single point — the page code, the
 * builder, the resolver and the comment describing them were all right; only
 * the value was absent. A test that greps for a string would have passed before
 * the bug and after it. So C1/C2 run the REAL `app.config.js` in Node, feed its
 * REAL `extra` to the REAL resolver through a mocked `expo-constants`, and
 * assert on the URL that actually comes out. C2 is the paired negative: the
 * same call with an empty `extra` — i.e. the pre-fix world — must return null,
 * which is what proves C1 is measuring the key and not something incidental.
 *
 * FAILS-ON-REVERT (verified, not asserted): delete the
 * `EXPO_PUBLIC_SUPABASE_URL: SUPABASE_URL` line from
 * `app-mobile/app.config.js` — a true line deletion, not a comment-out — and
 * C1, C3 and C5 go red while C2 stays green.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const APP_MOBILE = path.join(REPO_ROOT, "app-mobile");
const CONSUMER_APP_CONFIG = path.join(APP_MOBILE, "app.config.js");
const CONSUMER_URL_OWNER = path.join(
  APP_MOBILE,
  "src/config/supabaseProject.js",
);
const CONSUMER_SUPABASE_CLIENT = path.join(
  APP_MOBILE,
  "src/services/supabase.ts",
);

/**
 * The mutable `extra` the mocked `expo-constants` hands back BY REFERENCE. The
 * resolver reads it at CALL time, so a test can swap the whole world between
 * assertions without re-importing. Same shape the ORCH-1138 map suite uses.
 */
const mockExtra: Record<string, string | undefined> = {};
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return { extra: mockExtra };
    },
  },
}));

// DEEP specifier on purpose. `^@mingla/offering-rendering$` is mapped to
// `__manual_mocks__/offering-rendering.js` in jest.config.cjs; importing the
// barrel would assert against a mock's re-export rather than the module under
// test. This path resolves through the workspace symlink to the real source.
import { buildStaticMapUrl } from "@mingla/offering-rendering/mapboxStaticImage";
import { getSupabaseFunctionsBaseUrl } from "@mingla/offering-rendering/mapboxFunctionsBase";

const ORIGINAL_ENV = process.env;

/** Shape-only AppsFlyer values so the SIBLING release-bound guards in
 *  `app.config.js` are never what speaks. Not real keys. */
const FAKE_RELEASE_ENV = {
  EXPO_PUBLIC_APPSFLYER_DEV_KEY: "af_dev_key_placeholder",
  EXPO_PUBLIC_APPSFLYER_IOS_APP_ID: "id0000000000",
  EXPO_PUBLIC_APPSFLYER_ANDROID_APP_ID: "com.mingla.app.placeholder",
} as const;

/** Execute the REAL consumer app.config.js and return its resolved `extra`. */
function resolveConsumerExtra(
  env: Record<string, string | undefined> = {},
): Record<string, unknown> {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV, ...FAKE_RELEASE_ENV, ...env } as NodeJS.ProcessEnv;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const configFn = require(CONSUMER_APP_CONFIG) as (ctx: never) => {
    extra?: Record<string, unknown>;
  };
  const resolved = configFn({ config: { plugins: [] } } as never);
  const extra = resolved.extra;
  // Vacuity guard: a config that resolved to nothing must FAIL, never silently
  // satisfy an assertion about a key being absent.
  if (extra === undefined || Object.keys(extra).length === 0) {
    throw new Error(
      "app-mobile/app.config.js resolved an empty `extra` — the harness is broken, not the product.",
    );
  }
  return extra;
}

/** The single owner literal, read the same way `app.config.js` reads it. */
function readUrlOwner(): string {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const owner = require(CONSUMER_URL_OWNER) as { SUPABASE_URL?: unknown };
  if (typeof owner.SUPABASE_URL !== "string" || owner.SUPABASE_URL.length === 0) {
    throw new Error(
      "app-mobile/src/config/supabaseProject.js does not export a non-empty SUPABASE_URL.",
    );
  }
  return owner.SUPABASE_URL;
}

/**
 * Strip `//` and block comments so a source assertion cannot be satisfied — or
 * defeated — by prose. This repo has been burned by an audit regex matching the
 * comment that DESCRIBED the thing it was hunting, so the stripper is itself
 * tested below (S0) rather than trusted.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const LIVE_PROJECT_URL_RE = /https:\/\/[a-z0-9-]+\.supabase\.co/;

beforeEach(() => {
  for (const k of Object.keys(mockExtra)) delete mockExtra[k];
  delete process.env.EXPO_PUBLIC_SUPABASE_URL;
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
  jest.resetModules();
});

describe("#1594 — the consumer static map resolves a functions base URL", () => {
  // ---- C1/C2: the executable pair. Real config -> real resolver -> real URL --

  it("C1 — the REAL consumer app.config.js `extra` makes the REAL builder return a static-map URL", () => {
    const extra = resolveConsumerExtra();
    Object.assign(mockExtra, extra as Record<string, string | undefined>);

    const base = getSupabaseFunctionsBaseUrl();
    expect(base).not.toBeNull();
    expect(base).toMatch(/^https:\/\/[a-z0-9-]+\.supabase\.co\/functions\/v1$/);

    // The exact call the venue page makes (PublicVenueScreen.tsx), with NO
    // functionsBaseUrl override — i.e. the runtime path, not a test shortcut.
    const url = buildStaticMapUrl({
      lat: 25.790654,
      lng: -80.13005,
      accentHex: "#eb7825",
      height: 300,
    });

    expect(url).not.toBeNull();
    expect(url as string).toContain(`${base as string}/static-map?`);
    expect(url as string).toContain("lat=25.790654");
    expect(url as string).toContain("lng=-80.13005");
    // ORCH-1165's vendor-neutrality contract must survive this change.
    expect((url as string).toLowerCase()).not.toContain("mapbox");
    expect(url as string).not.toContain("access_token");
  });

  it("C2 — the pre-fix world (no key in `extra`) still returns null, so C1 is measuring the key", () => {
    // Deliberately NOT calling resolveConsumerExtra(): this is the state
    // app-mobile shipped in before #1594 — an `extra` with every other key and
    // no Supabase URL.
    Object.assign(mockExtra, {
      EXPO_PUBLIC_POSTHOG_HOST: "https://us.i.posthog.com",
      EXPO_PUBLIC_APPSFLYER_IOS_APP_ID: "id0000000000",
    });

    expect(getSupabaseFunctionsBaseUrl()).toBeNull();
    expect(
      buildStaticMapUrl({
        lat: 25.790654,
        lng: -80.13005,
        accentHex: "#eb7825",
        height: 300,
      }),
    ).toBeNull();
  });

  // ---- C3/C4/C5: one owner, and it stays one owner ------------------------

  it("C3 — the emitted `extra` value is byte-identical to the single owner module", () => {
    const extra = resolveConsumerExtra();
    expect(extra.EXPO_PUBLIC_SUPABASE_URL).toBe(readUrlOwner());
  });

  it("C4 — the runtime Supabase client carries NO project-URL literal of its own", () => {
    const source = fs.readFileSync(CONSUMER_SUPABASE_CLIENT, "utf8");
    expect(source.length).toBeGreaterThan(0);
    const code = stripComments(source);

    // It must READ the owner...
    expect(code).toMatch(
      /import\s*\{\s*SUPABASE_URL\s*\}\s*from\s*['"]\.\.\/config\/supabaseProject['"]/,
    );
    // ...and must not re-declare the truth. A second literal here is the exact
    // two-owner state #1594 exists to remove.
    expect(code).not.toMatch(LIVE_PROJECT_URL_RE);
  });

  it("C5 — the emission takes NO process.env override, so `extra` cannot drift from the client", () => {
    const decoy = "https://decoy-not-our-project.supabase.co";
    const extra = resolveConsumerExtra({ EXPO_PUBLIC_SUPABASE_URL: decoy });
    expect(extra.EXPO_PUBLIC_SUPABASE_URL).not.toBe(decoy);
    expect(extra.EXPO_PUBLIC_SUPABASE_URL).toBe(readUrlOwner());
  });

  // ---- S0: the stripper this suite depends on, proven both ways -----------

  it("S0 — stripComments removes prose and keeps code (the assertion in C4 is real)", () => {
    const stripped = stripComments(
      [
        "// const supabaseUrl = 'https://commented.supabase.co';",
        "/* https://blockcommented.supabase.co */",
        "const live = 'https://realcode.supabase.co';",
      ].join("\n"),
    );
    expect(stripped).not.toContain("commented.supabase.co");
    expect(stripped).not.toContain("blockcommented.supabase.co");
    expect(stripped).toContain("realcode.supabase.co");
  });

  // ---- C6: the reach claim. One fix, four consumer surfaces ---------------

  it("C6 — all four consumer map surfaces still route through the shared builder", () => {
    const callers = [
      "packages/brand-rendering/PublicVenueScreen.tsx",
      "packages/offering-rendering/TripOfferingBody.tsx",
      "packages/offering-rendering/ExperienceOfferingBody.tsx",
      "app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx",
    ];
    for (const rel of callers) {
      const abs = path.join(REPO_ROOT, rel);
      // Vacuity guard: a moved/renamed file FAILS here rather than skipping.
      expect(fs.existsSync(abs)).toBe(true);
      const code = stripComments(fs.readFileSync(abs, "utf8"));
      expect(code).toContain("buildStaticMapUrl({");
      // None of them may pin their own base — that would silently exempt a
      // surface from the fix and from C1's coverage.
      expect(code).not.toContain("functionsBaseUrl:");
    }
  });
});
