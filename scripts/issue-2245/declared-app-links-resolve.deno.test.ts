/**
 * issue #2245 — every deep-link path the consumer app DECLARES must resolve to
 * something a person can actually see.
 *
 * ─── WHY THIS FILE IS SHAPED THE WAY IT IS ──────────────────────────────────
 *
 * #2245 shipped because a test asserted a path was DECLARED. `/orders/*`,
 * `/chat/*`, `/board/*` and `/invite/*` were written into the live AASA on
 * 2026-05-27 "to match app.json intentFilters exactly" — checked against the
 * other declaration file, never against the app. So the pinning test and the
 * bug agreed with each other, and both were wrong.
 *
 * The natural over-correction is "assert a route FILE exists". That is the same
 * mistake one layer down, and this repository already contains a live example
 * of it: `.github/scripts/strict-grep/__tests__/i-aasa-claims-match-native-routes.test.mjs`
 * test (b) is literally "every consumer-AASA claimed path is backed by a real
 * expo-router route", it is green, and it never saw this bug — because it reads
 * `mingla-business/public/.well-known/apple-app-site-association` (the
 * host.usemingla.com file) and the four dead claims live in the APEX file,
 * `mingla-marketing/public/.well-known/apple-app-site-association`.
 *
 * So this suite does not ask "is it declared" and does not ask "does a file
 * exist". It RUNS the app's own routing modules over every declared path and
 * asserts each one terminates at a destination that RENDERS.
 *
 * ─── THE CHAIN IT EXECUTES ──────────────────────────────────────────────────
 *
 * A tapped `https://<owned-host>/<path>` in the consumer app goes:
 *
 *   1. `app-mobile/app/+native-intent.tsx` `redirectSystemPath` — runs BEFORE
 *      expo-router's own path extraction, on cold start and warm link alike
 *      (#2180). Returns the path unchanged for a segment the app serves as an
 *      expo-router FILE route, or "/" for everything else (#2219).
 *
 *   2. If it returned "/", `app/index.tsx` mounts — and `app/index.tsx` ALSO
 *      receives the raw URL, from `Linking.getInitialURL()` (cold) and
 *      `Linking.addEventListener("url")` (warm). Those are React Native APIs;
 *      `redirectSystemPath` does not consume them. Runtime-verified on iOS and
 *      Android for #2245, not assumed.
 *
 *   3. `handleDeepLink` applies ONE branch before the parser — the `/invite/`
 *      referral capture — then hands everything else to
 *      `deepLinkService.parseDeepLink` → `executeDeepLink`, which navigates by
 *      calling `setCurrentPage(page)`.
 *
 *   4. `setCurrentPage(page)` only shows anything if `page` has a `case` in
 *      `app/index.tsx`'s `switch (currentPage)`. Its `default:` returns `null`
 *      — a blank screen under the bottom nav. THAT is what `/board/{code}`
 *      did: `parseDeepLink` returned `page: 'board-invite'`, which has never
 *      had a `case` in any commit.
 *
 * Step 4 is the one no previous test modelled, and it is where the class of
 * defect actually lives: a destination that is produced, typed, and dead.
 *
 * ─── HOW IT STAYS HONEST ────────────────────────────────────────────────────
 *
 * • The claim list is READ from the three declaration files, never typed in
 *   here. Add a claim and forget the app and this goes red on the next run.
 * • A claim with no probe is a FAILURE, not a skip (#2272's M3 discipline).
 *   You cannot quietly add `/z/*` and leave it unexercised.
 * • The renderable-page list is PARSED out of `app/index.tsx`'s real switch.
 * • The route tree is ENUMERATED off disk.
 * • Step 3's ordering (invite branch first, parser second) is asserted against
 *   `app/index.tsx`'s source rather than assumed, so this model cannot silently
 *   drift from the shell it claims to model.
 * • The last test is the non-vacuity control: an unbacked claim MUST be
 *   reported dead by this same code path, or every assertion above is trivially
 *   true.
 *
 * Deno, not `node --test`: `+native-intent.tsx` is TypeScript with a `.tsx`
 * extension, which Node's type-stripping will not load.
 *
 * Run:
 *   deno test --allow-read --no-check \
 *     scripts/issue-2245/declared-app-links-resolve.deno.test.ts
 */

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import { redirectSystemPath } from "../../app-mobile/app/+native-intent.tsx";
import {
  type Destination,
  executeDeepLink,
  parseDeepLink,
} from "../../app-mobile/src/services/deepLinkService.ts";

const REPO_ROOT = new URL("../../", import.meta.url).pathname;
const read = (rel: string): string => Deno.readTextFileSync(REPO_ROOT + rel);
const readJson = (rel: string): any => JSON.parse(read(rel));

const CONSUMER_APP_ID = "782KVMY869.com.mingla.app.v2";
const CONSUMER_PACKAGE = "com.mingla.app.v2";
const APEX_AASA = "mingla-marketing/public/.well-known/apple-app-site-association";
const HOST_AASA = "mingla-business/public/.well-known/apple-app-site-association";
const APP_JSON = "app-mobile/app.json";
const SHELL = "app-mobile/app/index.tsx";

// ─── What the app can actually show ─────────────────────────────────────────

/**
 * The pages `setCurrentPage` can be handed that produce a screen, PARSED from
 * the real `switch (currentPage)` in `app/index.tsx`. Anything else falls to
 * that switch's `default: return null` and paints nothing.
 */
function renderablePages(): Set<string> {
  const src = read(SHELL);
  const start = src.indexOf("switch (currentPage) {");
  assert(
    start !== -1,
    `could not find "switch (currentPage) {" in ${SHELL} — this suite must not guess which pages render`,
  );
  const end = src.indexOf("default:", start);
  assert(end !== -1, `the switch in ${SHELL} has no default: branch — parse is wrong`);
  const block = src.slice(start, end);
  const pages = new Set(
    [...block.matchAll(/case\s+'([^']+)':/g)].map((m) => m[1]),
  );
  assert(
    pages.size >= 5,
    `only ${pages.size} renderable pages parsed out of ${SHELL} — the parse is wrong`,
  );
  return pages;
}

/**
 * Top-level expo-router file-route segments, ENUMERATED off disk (never copied
 * from `SERVED_ROUTE_SEGMENTS`, which would make the assertion tautological).
 */
function fileRouteSegments(): Set<string> {
  const dir = REPO_ROOT + "app-mobile/app";
  const out = new Set<string>();
  for (const entry of Deno.readDirSync(dir)) {
    const name = entry.name;
    if (name.startsWith("_") || name.startsWith("+") || name.startsWith(".")) continue;
    if (name === "__tests__") continue;
    if (entry.isDirectory) {
      out.add(name);
      continue;
    }
    if (!/\.(tsx?|jsx?)$/.test(name)) continue;
    const seg = name.slice(0, name.indexOf("."));
    if (seg === "" || seg === "index") continue;
    out.add(seg);
  }
  assert(out.size >= 5, `only ${out.size} file routes enumerated — the enumeration is wrong`);
  return out;
}

const RENDERABLE = renderablePages();
const FILE_ROUTES = fileRouteSegments();

// ─── The shell's one pre-parser branch, asserted rather than assumed ─────────

/**
 * `app/index.tsx handleDeepLink` handles `/invite/` ITSELF — it persists the
 * referral code and returns, never reaching `parseDeepLink` (which has no
 * `invite` case and would return null). Modelling that ordering without
 * checking it is exactly how a model rots, so the ordering is pinned here.
 */
Deno.test("the shell really does capture /invite/ before the parser sees it", () => {
  const src = read(SHELL);
  const invite = src.indexOf("url.includes('/invite/')");
  const parse = src.indexOf("const action = parseDeepLink(url)");
  assert(
    invite !== -1,
    `${SHELL} no longer contains the /invite/ branch of handleDeepLink. If the referral capture moved, this suite's model of INVITE_CAPTURE must move with it — do not delete this assertion.`,
  );
  assert(parse !== -1, `${SHELL} no longer calls parseDeepLink from handleDeepLink`);
  assert(
    invite < parse,
    "handleDeepLink now reaches parseDeepLink before the /invite/ branch — parseDeepLink returns null for invite, so the referral code would be dropped",
  );
  assert(
    src.includes("persistValidatedReferralCode(referralCode)"),
    "the /invite/ branch no longer persists a referral code, so an invite link would do nothing at all",
  );
});

// ─── Resolving one URL through the real modules ─────────────────────────────

type Outcome =
  | { kind: "file-route"; segment: string }
  | { kind: "shell-page"; page: string; params: Record<string, string> }
  | { kind: "referral-capture" }
  | { kind: "dead"; why: string };

/**
 * Runs a concrete URL through `redirectSystemPath`, the shell's invite branch,
 * `parseDeepLink` and `executeDeepLink`, and reports where a person ends up.
 */
function resolveDeclaredUrl(url: string): Outcome {
  const redirected = redirectSystemPath({ path: url, initial: true });

  if (redirected !== "/") {
    // #2180 R-5: an expo-router FILE route, handed through byte-for-byte.
    const segment = new URL(redirected).pathname.split("/").filter(Boolean)[0] ?? "";
    return FILE_ROUTES.has(segment)
      ? { kind: "file-route", segment }
      : {
        kind: "dead",
        why:
          `+native-intent passed "${url}" through as a file route but app-mobile/app/${segment} does not exist`,
      };
  }

  // `redirectSystemPath` said "/", so app/index.tsx mounts and ALSO receives the
  // raw URL via Linking. Everything below is what the shell then does with it.
  if (url.includes("/invite/")) return { kind: "referral-capture" };

  const dest: Destination | null = parseDeepLink(url);
  if (dest === null) {
    return {
      kind: "dead",
      why:
        `parseDeepLink returned null for "${url}", so executeDeepLink is a no-op and the app sits on whatever screen it was already showing — the URL's subject is never reached`,
    };
  }

  // Drive the REAL executor with recording handlers: what it calls is what the
  // shell would have called.
  let page: string | null = null;
  let params: Record<string, string> = {};
  let paywall = false;
  let profileId: string | null = null;
  executeDeepLink(dest, {
    setCurrentPage: (p) => {
      page = p;
    },
    setDeepLinkParams: (p) => {
      params = p;
    },
    setShowPaywall: (v) => {
      paywall = v;
    },
    setViewingFriendProfileId: (id) => {
      profileId = id;
    },
  });

  if (paywall || profileId !== null) {
    // Overlays mount over the current page; they always render.
    return { kind: "shell-page", page: "overlay", params };
  }
  if (page === null) {
    return { kind: "dead", why: `executeDeepLink navigated nowhere for "${url}"` };
  }
  if (!RENDERABLE.has(page)) {
    return {
      kind: "dead",
      why:
        `executeDeepLink set currentPage='${page}' for "${url}", and ${SHELL}'s switch has no case for it — it falls to default: return null and paints a blank screen under the bottom nav`,
    };
  }
  return { kind: "shell-page", page, params };
}

// ─── The declared claim set, read from the declaration files ────────────────

interface Claim {
  /** Where the claim is written, for the failure message. */
  readonly source: string;
  /** Host the claim applies to. */
  readonly host: string;
  /** The pattern as declared (`/orders/*`, or an Android `pathPrefix`). */
  readonly pattern: string;
}

function apexAasaClaims(): Claim[] {
  const aasa = readJson(APEX_AASA);
  const details = aasa?.applinks?.details ?? [];
  assert(details.length >= 1, `${APEX_AASA} declares no app details — wrong file`);
  const block = details.find((d: any) =>
    d.appID === CONSUMER_APP_ID || (d.appIDs ?? []).includes(CONSUMER_APP_ID)
  );
  assert(block, `${APEX_AASA} has no block for the consumer appID ${CONSUMER_APP_ID}`);
  const paths: string[] = block.paths ?? (block.components ?? []).map((c: any) => c["/"]);
  return paths.filter((p) => typeof p === "string").map((pattern) => ({
    source: APEX_AASA,
    host: "usemingla.com",
    pattern,
  }));
}

function hostAasaClaims(): Claim[] {
  const aasa = readJson(HOST_AASA);
  const block = (aasa?.applinks?.details ?? []).find((d: any) =>
    (d.appIDs ?? []).includes(CONSUMER_APP_ID)
  );
  assert(block, `${HOST_AASA} has no block for the consumer appID ${CONSUMER_APP_ID}`);
  return (block.components ?? [])
    .map((c: any) => c["/"])
    .filter((p: unknown): p is string => typeof p === "string")
    .map((pattern: string) => ({
      source: HOST_AASA,
      host: "host.usemingla.com",
      pattern,
    }));
}

function androidClaims(): Claim[] {
  const filters = readJson(APP_JSON).expo?.android?.intentFilters ?? [];
  const out: Claim[] = [];
  for (const f of filters) {
    if (f.autoVerify !== true) continue;
    for (const d of f.data ?? []) {
      if (d.scheme !== "https" || typeof d.host !== "string") continue;
      // A filter with a host but no path claims the WHOLE host. go.usemingla.com
      // is that shape on purpose: it is the AppsFlyer OneLink template domain,
      // whose ids are not routes (#2180) and are resolved by the SDK.
      out.push({
        source: `${APP_JSON} (android.intentFilters, package ${CONSUMER_PACKAGE})`,
        host: d.host,
        pattern: d.pathPrefix ?? d.path ?? d.pathPattern ?? "*WHOLE-HOST*",
      });
    }
  }
  assert(out.length >= 5, `only ${out.length} Android https claims parsed from ${APP_JSON}`);
  return out;
}

/**
 * One concrete URL per declared pattern. Keyed `host + pattern` so the apex and
 * host.usemingla.com claims never share a probe by accident.
 *
 * A pattern with no entry here FAILS the run. That is deliberate: a claim
 * nobody exercised is precisely the #2245 defect, so adding one to a
 * declaration file forces you to come here and prove it lands somewhere.
 */
const PROBES: Readonly<Record<string, readonly string[]>> = {
  // ── apex, iOS AASA + Android intent filters ──
  // `/orders/*` claims TWO real shapes and both must land. The `/chat` shape is
  // the one the pre-#2240 confirmation emails carried; the bare shape is what a
  // wildcard also promises, and it returned null until #2245.
  "usemingla.com/orders/*": [
    "https://usemingla.com/orders/0a0870b0-c117-4707-bdf4-21fc64bebcab/chat",
    "https://usemingla.com/orders/0a0870b0-c117-4707-bdf4-21fc64bebcab",
  ],
  "usemingla.com/orders": [
    "https://usemingla.com/orders/0a0870b0-c117-4707-bdf4-21fc64bebcab/chat",
    "https://usemingla.com/orders/0a0870b0-c117-4707-bdf4-21fc64bebcab",
  ],
  "usemingla.com/chat/*": ["https://usemingla.com/chat/0a0870b0-c117-4707-bdf4-21fc64bebcab"],
  "usemingla.com/chat": ["https://usemingla.com/chat/0a0870b0-c117-4707-bdf4-21fc64bebcab"],
  "usemingla.com/invite/*": ["https://usemingla.com/invite/ADA2026"],
  "usemingla.com/invite": ["https://usemingla.com/invite/ADA2026"],
  "usemingla.com/s/*": ["https://usemingla.com/s/a1B2c3D4e5F6g7H8"],
  "usemingla.com/s/": ["https://usemingla.com/s/a1B2c3D4e5F6g7H8"],
  "usemingla.com/p/*": [`https://usemingla.com/p/${"a".repeat(36)}`],
  "usemingla.com/p/": [`https://usemingla.com/p/${"a".repeat(36)}`],
  "usemingla.com/b/": ["https://usemingla.com/b/alte-nights", "https://usemingla.com/b/alte-nights/v/ikoyi"],
  "usemingla.com/brand/": ["https://usemingla.com/brand/alte-nights"],
  // ── host.usemingla.com, the public guest routes (#2050) ──
  "host.usemingla.com/b/*": ["https://host.usemingla.com/b/alte-nights"],
  "host.usemingla.com/b/": ["https://host.usemingla.com/b/alte-nights"],
  "host.usemingla.com/e/*": ["https://host.usemingla.com/e/alte-nights/rooftop-sessions"],
  "host.usemingla.com/e/": ["https://host.usemingla.com/e/alte-nights/rooftop-sessions"],
  "host.usemingla.com/t/*": ["https://host.usemingla.com/t/alte-nights/lagos-weekender"],
  "host.usemingla.com/t/": ["https://host.usemingla.com/t/alte-nights/lagos-weekender"],
  "host.usemingla.com/exp/*": ["https://host.usemingla.com/exp/alte-nights/pottery"],
  "host.usemingla.com/exp/": ["https://host.usemingla.com/exp/alte-nights/pottery"],
};

/**
 * `go.usemingla.com` is claimed as a WHOLE HOST with no path, and that is
 * correct: its paths are AppsFlyer OneLink template ids (`/w36m`), not screens.
 * #2180 established that they must land on home and let the AppsFlyer SDK
 * resolve the payload — so "lands on home" IS resolution for this host, and it
 * is exempt from the every-path-reaches-its-subject rule below.
 */
const ONELINK_HOST = "go.usemingla.com";

const ALL_CLAIMS = [...apexAasaClaims(), ...hostAasaClaims(), ...androidClaims()];

// ─── The assertions ─────────────────────────────────────────────────────────

Deno.test("A1 the declaration files were really read (never vacuously empty)", () => {
  assert(
    apexAasaClaims().length >= 4,
    "the apex AASA parsed to fewer than 4 claims — this suite is reading the wrong file or the wrong shape",
  );
  assert(hostAasaClaims().length >= 4, "the host AASA consumer block parsed to fewer than 4 claims");
  assert(ALL_CLAIMS.length >= 15, `only ${ALL_CLAIMS.length} claims across all three files`);
});

Deno.test("A2 every declared path has a probe — an unexercised claim is the #2245 defect", () => {
  for (const claim of ALL_CLAIMS) {
    if (claim.host === ONELINK_HOST) continue;
    const key = `${claim.host}${claim.pattern}`;
    assert(
      PROBES[key] !== undefined,
      `${claim.source} declares "${claim.pattern}" on ${claim.host} and this suite has no probe for it. Add one AND make sure it resolves in the app — a claim nobody exercised is exactly how #2245 shipped.`,
    );
  }
});

Deno.test("A3 EVERY declared path resolves to a destination that renders", () => {
  const report: string[] = [];
  for (const claim of ALL_CLAIMS) {
    if (claim.host === ONELINK_HOST) continue;
    const urls = PROBES[`${claim.host}${claim.pattern}`];
    if (urls === undefined) continue; // A2 owns this failure
    for (const url of urls) {
      const outcome = resolveDeclaredUrl(url);
      if (outcome.kind === "dead") {
        report.push(`  ${claim.host}${claim.pattern}  (${claim.source})\n      ${outcome.why}`);
      }
    }
  }
  assertEquals(
    report.join("\n"),
    "",
    `\nDeclared deep-link paths that do not resolve:\n${report.join("\n")}\n\n` +
      "Every path a declaration file claims must either reach a real destination in the app or be withdrawn from that file. Leaving it declared and dead is the #2245 defect: the OS opens the app and the app shows nothing.\n",
  );
});

Deno.test("A4 the OneLink host is claimed whole and lands on home, by design (#2180)", () => {
  const oneLink = ALL_CLAIMS.filter((c) => c.host === ONELINK_HOST);
  assert(oneLink.length >= 1, `${ONELINK_HOST} is no longer claimed — the Explorer get-app CTA breaks`);
  assertEquals(
    redirectSystemPath({ path: "https://go.usemingla.com/w36m?pid=mingla_web", initial: true }),
    "/",
    "a OneLink template id must land on home so the AppsFlyer SDK can resolve it (#2180)",
  );
});

Deno.test("A5 every page deepLinkService can navigate to has a case in the shell's switch", () => {
  // The `board-invite` class of defect, caught at its source: a Destination the
  // parser can produce, that the shell cannot render. Read out of the union in
  // deepLinkService.ts so a new page kind cannot be added without a screen.
  const src = read("app-mobile/src/services/deepLinkService.ts");
  const union = /page:\s*((?:'[^']+'\s*\|\s*)*'[^']+')\s*;/.exec(src);
  assert(union !== null, "could not parse the `page` union out of deepLinkService.ts");
  const pages = [...union[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert(pages.length >= 5, `only ${pages.length} page kinds parsed from the union`);
  for (const page of pages) {
    assert(
      RENDERABLE.has(page),
      `deepLinkService can produce page '${page}' but ${SHELL}'s switch (currentPage) has no case for it, so executeDeepLink would navigate to a blank screen. Either give it a case or remove it from the union. (This is what /board/{code} did from 2026-05 to #2245.)`,
    );
  }
});

Deno.test("A7 no Android pathPrefix on the apex swallows a marketing page the app cannot show", () => {
  // The SAME defect pointed the other way, and it was live until #2245.
  //
  // An Android `pathPrefix` is a raw string prefix, not a path-segment match, so
  // a prefix with no trailing slash captures far more than it looks like it
  // does. `"/p"` claimed `/p/{shareId}` — and also `usemingla.com/privacy-policy`,
  // a real page linked from the App Store listing, the Play listing and the site
  // footer. On any Android phone with Explorer installed, tapping it opened the
  // app, `+native-intent` found no `privacy-policy` route, and the person got
  // Home instead of the privacy policy. Nothing was "dead" in the #2245 sense —
  // the app rendered fine — which is exactly why nothing caught it.
  //
  // Rule: a claimed prefix may swallow an apex page ONLY when the app genuinely
  // serves that path (the `/orders`, `/chat` and `/invite` landings are the
  // without-the-app fallbacks for paths the app really does own, #2272).
  const marketingRoutes = [...Deno.readDirSync(REPO_ROOT + "mingla-marketing/app")]
    .filter((e) => e.isDirectory && !e.name.startsWith("(") && !e.name.startsWith("_") && e.name !== "api")
    .map((e) => e.name);
  assert(
    marketingRoutes.length >= 10,
    `only ${marketingRoutes.length} marketing routes enumerated — the enumeration is wrong`,
  );
  assert(
    marketingRoutes.includes("privacy-policy"),
    "privacy-policy is gone from mingla-marketing/app — this test's whole point was that /p swallowed it",
  );

  const apexPrefixes = androidClaims()
    .filter((c) => c.host === "usemingla.com" && c.pattern !== "*WHOLE-HOST*")
    .map((c) => c.pattern);

  const offenders: string[] = [];
  for (const prefix of apexPrefixes) {
    for (const route of marketingRoutes) {
      const path = `/${route}`;
      if (!path.startsWith(prefix)) continue;
      // The app claiming a path it genuinely serves is the point, not a bug.
      const probe = PROBES[`usemingla.com${prefix}`]?.[0];
      const outcome = resolveDeclaredUrl(probe ?? `https://usemingla.com${path}`);
      const appOwnsIt = path === prefix || `${path}/` === prefix ||
        (outcome.kind !== "dead" && probe !== undefined &&
          new URL(probe).pathname.startsWith(path));
      if (!appOwnsIt) {
        offenders.push(
          `  intentFilter pathPrefix "${prefix}" swallows the marketing page usemingla.com${path}, which the app has no screen for. Add the trailing slash (or narrow the prefix) so Android stops intercepting it.`,
        );
      }
    }
  }
  assertEquals(offenders.join("\n"), "", `\nAndroid claims that hijack a real web page:\n${offenders.join("\n")}\n`);
});

Deno.test("A6 NON-VACUITY: an unbacked claim IS reported dead by this same code", () => {
  // If this came back anything other than "dead", every assertion above would
  // be trivially true and this file would prove nothing.
  const outcome = resolveDeclaredUrl("https://usemingla.com/zzz-no-such-route/1");
  assertEquals(
    outcome.kind,
    "dead",
    "a path with no route in the app was NOT reported dead — A3 cannot fail and is worthless",
  );

  // And the positive control: a real deep link is not reported dead.
  const real = resolveDeclaredUrl("https://host.usemingla.com/e/alte-nights/rooftop-sessions");
  assertEquals(real.kind, "file-route", "a genuine file-route deep link is being reported dead");
});
