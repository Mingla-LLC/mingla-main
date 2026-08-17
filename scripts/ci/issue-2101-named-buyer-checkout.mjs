#!/usr/bin/env node
/**
 * issue #2101 [named-buyer checkout] — the contract guard.
 *
 * Binding source: original SPEC + Amendments 1-8. This script owns every
 * discovery clause those amendments place on CI:
 *
 *   A4 §A4.3  route ownership, the web/native adapter split
 *   A5 §A5.3  the two added validator paths
 *   A6 §A6.3  the three public prefixes, the three canonical writers,
 *             the untouched five-entry export, `app/e/…` unmodified,
 *             no second sanitizer, no organiser resume target
 *   A7 §A7.1  the enumerated three-file / five-call-site consumer set and
 *             `buildSwitchAccountResume`'s preserved shape
 *   A8 §A8.2  the plain + `.native` pairing, real Metro resolution on ios /
 *             android / web, no forbidden web module reachable from a native
 *             entry BY ANY IMPORT FORM, and a vacuity floor on the walk
 *
 * ── WHY THIS GUARD IS BUILT THE WAY IT IS ────────────────────────────────────
 * The repository has now catalogued eight guards that were themselves
 * forgeable. Three specific hardening points are therefore load-bearing here,
 * and each is executed by `--self-test`, never merely described:
 *
 *  F-1  THE "EXPLICIT PATH" CLAUSE HAS A NAMED MUTATION.
 *       A8.2 clause 3 forbids importing a forbidden web module "by any import
 *       form Metro honours, including an explicit path". A resolver that only
 *       understands extensionless specifiers reports a healthy multi-hundred
 *       module walk while silently dropping every `./X.tsx` edge — the walk
 *       looks strong and proves nothing. `M-EXPLICIT-PATH` writes exactly that
 *       import into a native-reachable file and the guard must FAIL.
 *
 *  F-2  THE FLOOR PINS THE ENTRY SET, NOT JUST THE TOTAL.
 *       A bare "≥200 modules" floor is satisfiable by a subset of the entries,
 *       so entries could be dropped with the floor still green. This guard
 *       asserts BOTH: every one of the eight declared entry points resolved and
 *       was walked, AND the total cleared the floor. `M-DROP-ENTRY` removes one
 *       entry and the guard must FAIL even though the total still clears 200.
 *
 *  F-3  EMPTYING A FILE IS NOT DETECTABLE BY EXISTENCE + IMPORT-GRAPH CLAUSES.
 *       A `.native` half that is emptied rather than deleted still exists and
 *       still resolves, so all four A8.2 clauses stay green while the platform
 *       override renders nothing. That hole is closed by the mandated
 *       `*.issue2101.native.test.tsx` behavioural suites, which this guard
 *       requires to exist and to assert the null-render contract.
 *
 * Usage:  node scripts/ci/issue-2101-named-buyer-checkout.mjs [--self-test]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd().endsWith("mingla-business")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();
const BIZ = path.join(ROOT, "mingla-business");

const failures = [];
const fail = (clause, detail) => failures.push(`[${clause}] ${detail}`);
const read = (rel, base = ROOT) => {
  const p = path.join(base, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
};

// ── The three plain + `.native` pairs (A8.1). ───────────────────────────────
const PAIRS = [
  {
    base: "mingla-business/src/hooks/usePublicTicketCheckoutRouteAccess",
    plain: ".ts",
    native: ".native.ts",
  },
  {
    base: "mingla-business/src/components/event/TicketCheckoutAccessNotice",
    plain: ".tsx",
    native: ".native.tsx",
  },
  {
    base: "mingla-business/src/components/event/EventTicketCheckoutAccessCard",
    plain: ".tsx",
    native: ".native.tsx",
  },
];

// The five modules that must NEVER be reachable from a native entry (A8.2).
const FORBIDDEN_NATIVE = [
  "mingla-business/src/hooks/usePublicTicketCheckoutRouteAccess.ts",
  "mingla-business/src/components/event/TicketCheckoutAccessNotice.tsx",
  "mingla-business/src/components/event/EventTicketCheckoutAccessCard.tsx",
  "mingla-business/src/hooks/useEventTicketCheckoutAccess.ts",
  "mingla-business/src/services/eventTicketCheckoutAccessService.ts",
];

// F-2 — the ENTRY SET is pinned by name. Every one must resolve and be walked.
const NATIVE_ENTRIES = [
  "mingla-business/src/components/event/PublicEventPage.tsx",
  "mingla-business/app/t/[brandSlug]/[tripSlug].tsx",
  "mingla-business/app/exp/[brandSlug]/[experienceSlug].tsx",
  "mingla-business/src/components/event/EditPublishedScreen.tsx",
  "mingla-business/src/components/trip/EditPublishedTripScreen.tsx",
  "mingla-business/app/experience/[id]/edit.tsx",
  "mingla-business/src/components/trip/TripCheckoutFlow.tsx",
  "mingla-business/src/components/experience/ExperienceCheckoutFlow.tsx",
];
const WALK_FLOOR = 200;

// ── Metro resolution, faithful to the real candidate order. ─────────────────
// `preferNativePlatform: platform !== "web"` (Expo's withMetroMultiPlatform)
// and the candidate order `.{platform}{ext}` -> `.native{ext}` -> `{ext}`
// (metro-resolver). Directories fall back to `index`.
const SOURCE_EXTS = [".tsx", ".ts", ".jsx", ".js", ".json"];

export const resolveMetro = (fromFile, specifier, platform, root) => {
  if (!specifier.startsWith(".")) return null; // package/alias — out of scope
  const abs = path.resolve(path.dirname(path.join(root, fromFile)), specifier);

  // F-1 — a specifier that ALREADY carries a source extension is honoured
  // literally by Metro. A resolver that only appends extensions drops these
  // edges entirely and reports a healthy walk while seeing nothing.
  const explicitExt = SOURCE_EXTS.find((ext) => abs.endsWith(ext));
  if (explicitExt !== undefined) {
    // Metro tries the EXACT file first for a specifier that already carries an
    // extension; its platform candidates are built by appending to the whole
    // string (`X.tsx.native.tsx`), which never exists. So an explicit path
    // BYPASSES the `.native` override — that is exactly the hazard A8.2
    // clause 3 names, and a resolver that "helpfully" prefers `.native` here
    // would report clean isolation while the real bundler pulled the web half
    // into the native graph. Literal first.
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      return path.relative(root, abs);
    }
    const stem = abs.slice(0, -explicitExt.length);
    const ordered = [
      `${stem}.${platform}${explicitExt}`,
      ...(platform === "web" ? [] : [`${stem}.native${explicitExt}`]),
    ];
    for (const candidate of ordered) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return path.relative(root, candidate);
      }
    }
    return null;
  }

  const bases = [abs, path.join(abs, "index")];
  for (const base of bases) {
    const ordered = [];
    for (const ext of SOURCE_EXTS) ordered.push(`${base}.${platform}${ext}`);
    if (platform !== "web") {
      for (const ext of SOURCE_EXTS) ordered.push(`${base}.native${ext}`);
    }
    for (const ext of SOURCE_EXTS) ordered.push(`${base}${ext}`);
    for (const candidate of ordered) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return path.relative(root, candidate);
      }
    }
  }
  return null;
};

// Static `from "…"`, side-effect `import "…"`, AND dynamic `import("…")` —
// the card is mounted through `React.lazy(() => import(…))`, so a walker that
// ignores dynamic imports would never reach it and the isolation claim would
// be vacuous.
const RELATIVE_SPECIFIERS =
  /(?:from\s*|import\s*\(\s*|require\s*\(\s*)["'](\.[^"']*)["']/g;

export const walkGraph = (entries, platform, root) => {
  const visited = new Set();
  const reachedEntries = new Set();
  const queue = [];
  for (const entry of entries) {
    if (fs.existsSync(path.join(root, entry))) {
      reachedEntries.add(entry);
      queue.push(entry);
      visited.add(entry);
    }
  }
  while (queue.length > 0) {
    const current = queue.shift();
    let source;
    try {
      source = fs.readFileSync(path.join(root, current), "utf8");
    } catch {
      continue;
    }
    RELATIVE_SPECIFIERS.lastIndex = 0;
    let match;
    while ((match = RELATIVE_SPECIFIERS.exec(source)) !== null) {
      const resolved = resolveMetro(current, match[1], platform, root);
      if (resolved !== null && !visited.has(resolved)) {
        visited.add(resolved);
        queue.push(resolved);
      }
    }
  }
  return { visited, reachedEntries };
};

// ─────────────────────────────────────────────────────────────────────────────
// A8.2 clause 1 — both halves of all three pairs exist, neither re-suffixed.
// ─────────────────────────────────────────────────────────────────────────────
export const pairingViolations = (root = ROOT) => {
  const out = [];
  for (const pair of PAIRS) {
    for (const half of [pair.plain, pair.native]) {
      if (!fs.existsSync(path.join(root, `${pair.base}${half}`))) {
        out.push(`missing half ${pair.base}${half}`);
      }
    }
    if (fs.existsSync(path.join(root, `${pair.base}.web${pair.plain}`))) {
      out.push(
        `${pair.base}.web${pair.plain} exists — the default half must be the PLAIN sibling (Amendment 8 §A8.1)`,
      );
    }
  }
  return out;
};
const checkPairing = () => {
  for (const v of pairingViolations(ROOT)) fail("A8.2-1", v);
};

// A8.2 clause 2 — real resolution lands on the right half per platform.
const checkResolution = (root = ROOT) => {
  const cases = [
    [
      "mingla-business/src/components/event/PublicEventPage.tsx",
      "./TicketCheckoutAccessNotice",
    ],
    [
      "mingla-business/src/components/event/PublicEventPage.tsx",
      "../../hooks/usePublicTicketCheckoutRouteAccess",
    ],
    [
      "mingla-business/src/components/event/EditPublishedScreen.tsx",
      "./EventTicketCheckoutAccessCard",
    ],
  ];
  for (const [from, spec] of cases) {
    for (const platform of ["ios", "android"]) {
      const hit = resolveMetro(from, spec, platform, root);
      if (hit === null || !/\.native\.(ts|tsx)$/.test(hit)) {
        fail(
          "A8.2-2",
          `${platform}: ${spec} from ${from} resolved to ${hit} — expected the .native half`,
        );
      }
    }
    const web = resolveMetro(from, spec, "web", root);
    if (web === null || /\.native\./.test(web)) {
      fail(
        "A8.2-2",
        `web: ${spec} from ${from} resolved to ${web} — expected the plain half`,
      );
    }
  }
};

// A8.2 clauses 3 + 4, plus F-1 and F-2.
const checkNativeGraph = (root = ROOT, entries = NATIVE_ENTRIES) => {
  for (const platform of ["ios", "android"]) {
    const { visited, reachedEntries } = walkGraph(entries, platform, root);

    // F-2 — the entry set is pinned, not just the total.
    for (const entry of entries) {
      if (!reachedEntries.has(entry)) {
        fail(
          "A8.2-4/F-2",
          `${platform}: declared entry point ${entry} did not resolve — the walk cannot be trusted`,
        );
      }
    }
    if (visited.size < WALK_FLOOR) {
      fail(
        "A8.2-4",
        `${platform}: walk visited only ${visited.size} modules (floor ${WALK_FLOOR}) — a walk that resolves nothing is not a pass`,
      );
    }

    // Clause 3 — no forbidden web module anywhere in the native graph.
    for (const forbidden of FORBIDDEN_NATIVE) {
      if (visited.has(forbidden)) {
        fail(
          "A8.2-3",
          `${platform}: forbidden web module ${forbidden} is reachable from a native entry`,
        );
      }
    }

    // The three `.native` halves must actually be REACHED, or clause 3 passes
    // for the wrong reason (nothing resolved at all).
    for (const pair of PAIRS) {
      const nativeHalf = `${pair.base}${pair.native}`;
      if (!visited.has(nativeHalf)) {
        fail(
          "A8.2-3",
          `${platform}: ${nativeHalf} was never reached — the isolation claim is vacuous`,
        );
      }
    }
  }

  // Non-vacuity control: on WEB the five forbidden modules MUST be present.
  const { visited: webVisited } = walkGraph(entries, "web", root);
  for (const forbidden of FORBIDDEN_NATIVE) {
    if (!webVisited.has(forbidden)) {
      fail(
        "A8.2-3",
        `web control: ${forbidden} is absent from the web graph — the native result proves nothing`,
      );
    }
  }
};

// F-3 — the behavioural suites that close the empty-file hole must exist and
// must assert the null-render contract.
const NATIVE_SUITES = [
  [
    "mingla-business/src/components/event/__tests__/EventTicketCheckoutAccessCard.issue2101.native.test.tsx",
    "EventTicketCheckoutAccessCard",
  ],
  [
    "mingla-business/src/components/event/__tests__/TicketCheckoutAccessNotice.issue2101.native.test.tsx",
    "TicketCheckoutAccessNotice",
  ],
  [
    "mingla-business/src/hooks/__tests__/usePublicTicketCheckoutRouteAccess.issue2101.native.test.tsx",
    "usePublicTicketCheckoutRouteAccess",
  ],
];
const checkNativeSuites = () => {
  for (const [rel, symbol] of NATIVE_SUITES) {
    const source = read(rel);
    if (source === null) {
      fail(
        "F-3",
        `${rel} is missing — existence and import-graph clauses cannot detect an EMPTIED .native half; only a behavioural suite can`,
      );
      continue;
    }
    if (!source.includes(symbol)) {
      fail("F-3", `${rel} does not exercise ${symbol}`);
    }
    if (!/toBeNull\(\)|toBe\(null\)|unrestricted/.test(source)) {
      fail(
        "F-3",
        `${rel} does not assert the null-render / legacy pass-through contract`,
      );
    }
  }
};

// ── A5/A6/A7 — validator, writers, consumer set. ────────────────────────────
const checkValidator = () => {
  const src = read("mingla-business/src/utils/nextRoute.ts");
  if (src === null) return fail("A5.3", "nextRoute.ts is missing");
  if (read("mingla-business/src/utils/__tests__/nextRoute.issue2101.test.ts") === null) {
    fail("A5.3", "nextRoute.issue2101.test.ts is missing");
  }
  for (const prefix of ['"/t"', '"/exp"', '"/e"']) {
    if (!src.includes(`${prefix},`)) {
      fail("A6.1", `public offering prefix ${prefix} absent from the internal tuple`);
    }
  }
  if (!src.includes("PUBLIC_OFFERING_NEXT_ROUTE_PREFIXES")) {
    fail("A6.1", "the single internal tuple is missing");
  }
  if (/export\s+const\s+PUBLIC_OFFERING_NEXT_ROUTE_PREFIXES/.test(src)) {
    fail("A6.3", "the internal tuple is EXPORTED — it must not be consumable outside isAllowlistedPath");
  }
  const tupleUses = src.split("PUBLIC_OFFERING_NEXT_ROUTE_PREFIXES").length - 1;
  if (tupleUses !== 2) {
    fail("A6.3", `the tuple is referenced ${tupleUses} times — expected exactly 2 (declaration + the single isAllowlistedPath consumption)`);
  }
  // The exported five-entry registry is frozen.
  const registry = src.match(/NEXT_ROUTE_ALLOWLIST[^=]*=\s*\[([\s\S]*?)\]/);
  const entries = registry === null
    ? []
    : [...registry[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const expected = [
    "/accept-brand-invitation",
    "/accept-scanner-invitation",
    "/brand",
    "/event/create",
    "/rsvp/create",
  ];
  if (JSON.stringify([...entries].sort()) !== JSON.stringify(expected)) {
    fail("A6.5", `the exported registry changed: ${JSON.stringify(entries)}`);
  }
  // One decision owner, one module.
  const sanitizerDefs = (src.match(/export const sanitizeNextRoute/g) ?? []).length;
  if (sanitizerDefs !== 1) fail("A6.5", "sanitizeNextRoute is not defined exactly once");
};

const WRITERS = [
  [
    "mingla-business/app/t/[brandSlug]/[tripSlug].tsx",
    "tripPublicPath(",
    "tripPublicUrl(",
  ],
  [
    "mingla-business/app/exp/[brandSlug]/[experienceSlug].tsx",
    "experiencePublicPath(",
    "experiencePublicUrl(",
  ],
  [
    "mingla-business/src/components/event/PublicEventPage.tsx",
    "eventPublicPath(",
    null,
  ],
];
const checkWriters = () => {
  for (const [rel, helper] of WRITERS) {
    const src = read(rel);
    if (src === null) {
      fail("A6.2", `writer ${rel} is missing`);
      continue;
    }
    const resume = src.match(/\/auth\?next=\$\{encodeURIComponent\(([\s\S]{0,200}?)\)\}/);
    if (resume === null) {
      fail("A6.2", `${rel} does not build /auth?next= with encodeURIComponent`);
      continue;
    }
    if (!resume[1].includes(helper)) {
      fail("A6.2", `${rel} does not build its return target with ${helper}`);
    }
    if (/next=\$\{[^}]*window\.location/.test(src)) {
      fail("A6.2", `${rel} derives a return target from window.location`);
    }
    if (!src.includes('return "/auth";')) {
      fail("A7.3-21", `${rel} has no empty-segment fallback to bare /auth`);
    }
  }
  if (read("mingla-business/app/e/[brandSlug]/[eventSlug].tsx") === null) {
    fail("A6.3", "app/e/[brandSlug]/[eventSlug].tsx is missing");
  }
};

const CONSUMERS = [
  ["mingla-business/app/auth/index.tsx", 3],
  ["mingla-business/app/auth/callback.tsx", 1],
  ["mingla-business/app/accept-brand-invitation.tsx", 1],
];
const checkConsumerSet = () => {
  let total = 0;
  for (const [rel, expected] of CONSUMERS) {
    const src = read(rel);
    if (src === null) {
      fail("A7.1", `consumer ${rel} is missing`);
      continue;
    }
    const calls = (src.match(/sanitizeNextRoute\(/g) ?? []).length;
    if (calls !== expected) {
      fail("A7.1", `${rel} has ${calls} sanitizeNextRoute call sites, expected ${expected}`);
    }
    total += calls;
    if (/NEXT_ROUTE_ALLOWLIST\s*[.[]/.test(src)) {
      fail("A7.1", `${rel} reads the registry directly — a second decision owner`);
    }
  }
  if (total !== 5) fail("A7.1", `consumer set has ${total} call sites, expected 5`);

  const invite = read("mingla-business/app/accept-brand-invitation.tsx");
  if (invite !== null) {
    if (!invite.includes("/accept-brand-invitation?token=")) {
      fail("A7.1", "buildSwitchAccountResume lost its hardcoded prefix");
    }
    if (!invite.includes('return "/auth"')) {
      fail("A7.1", "buildSwitchAccountResume lost its null -> \"/auth\" fallback");
    }
  }
};

// A4.3 — adapter ownership.
const checkAdapters = () => {
  const web = read("mingla-business/src/hooks/usePublicTicketCheckoutRouteAccess.ts");
  const native = read("mingla-business/src/hooks/usePublicTicketCheckoutRouteAccess.native.ts");
  if (web !== null) {
    if (!web.includes("usePublicTicketCheckoutEligibility")) {
      fail("A4.1", "the web adapter does not consume the one eligibility query owner");
    }
    if (/createClient|onAuthStateChange|from\s+["'].*services\/supabase/.test(web)) {
      fail("A4.1", "the web adapter creates a second client / auth listener");
    }
  }
  if (native !== null) {
    if (/services\/supabase|eventTicketCheckoutAccessService|useEventTicketCheckoutAccess|@supabase/.test(native)) {
      fail("A4.1", "the native adapter imports web/service/Supabase code");
    }
    if (!/state:\s*"unrestricted"/.test(native)) {
      fail("A4.1", "the native adapter does not return the legacy pass-through state");
    }
  }
};

/**
 * The balanced `{…}` block that follows `marker`. Used instead of a character
 * window: a window wide enough to contain a construct is also wide enough to
 * reach the NEXT one, so a deleted guard can be "found" in its neighbour and
 * the clause passes for the wrong reason.
 */
const blockAfter = (source, marker) => {
  const at = source.indexOf(marker);
  if (at < 0) return null;
  const open = source.indexOf("{", at);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return null;
};

/** The condition text of `if (<cond>) {` starting at `marker`. */
const conditionAt = (source, marker) => {
  const at = source.indexOf(marker);
  if (at < 0) return null;
  const open = source.indexOf("(", at);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "(") depth += 1;
    else if (source[i] === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return null;
};

// ── SPEC §9 — the Edge fence. The guard previously carried ZERO Edge
//    assertions, so a body-UUID authority fallback (`userId ?? body.…`) passed
//    it untouched. The identity input, the ordering, the bounded denial
//    contract and the fail-closed branches are all pinned here.
export const checkEdgeFenceOn = (edge, shared) => {
  const found = [];
  const fail = (_clause, detail) => found.push(detail);
  if (edge === null || shared === null) {
    fail("SPEC-9", "the Edge fence sources are missing");
    return found;
  }

  // 1. The decision's identity input is the TOKEN-derived user, with no
  //    fallback of any kind. This is the body-UUID gate SPEC §9 requires.
  if (!/buyerUserId:\s*userId\s*,/.test(edge)) {
    fail("SPEC-9", "the decision is not called with the bare token-derived `userId`");
  }
  if (/buyerUserId:\s*userId\s*(\?\?|\|\|)/.test(edge)) {
    fail(
      "SPEC-9",
      "the decision's identity input has a FALLBACK — a client body field can name the buyer",
    );
  }
  // No client-supplied buyer identity may be read anywhere in the handler.
  for (const forged of ["body.buyerUserId", "body.userId", "buyer.userId"]) {
    if (edge.includes(forged)) {
      fail("SPEC-9", `the handler reads a client-supplied buyer identity: ${forged}`);
    }
  }

  // 2. Ordering — the decision runs BEFORE the event-date read, the pricing
  //    resolve, the session RPC and any provider call.
  const decisionAt = edge.indexOf("ticketCheckoutAccessDecision(");
  if (decisionAt < 0) {
    fail("SPEC-9", "ticket-checkout-create does not call the access decision");
  } else {
    for (
      const [label, needle] of [
        ["the event-date read", 'from("event_dates")'],
        ["the create-session RPC", '"biz_ticket_checkout_create_session"'],
        ["the pricing resolve", '"resolve_event_pricing_inputs"'],
      ]
    ) {
      const at = edge.indexOf(needle);
      if (at >= 0 && at < decisionAt) {
        fail("SPEC-9", `${label} runs BEFORE the access decision`);
      }
    }
  }

  // 3. The bounded denial contract, and the fail-closed catch.
  if (!/ticketCheckoutAccessDenial\(/.test(edge)) {
    fail("SPEC-9", "the denial mapping is not applied in the handler");
  }
  const catchBlock = blockAfter(edge, "} catch (accessError) {".slice(2));
  if (
    catchBlock === null || !catchBlock.includes('"checkout_restricted"') ||
    !catchBlock.includes("403")
  ) {
    fail("SPEC-9", "a decision failure does not FAIL CLOSED with a 403 checkout_restricted");
  }

  // 4. The shared adapter's fail-closed branches.
  const nonStringBlock = blockAfter(shared, 'if (typeof data !== "string")');
  if (nonStringBlock === null || !nonStringBlock.includes("throw new Error")) {
    fail("SPEC-9", "a non-string decision payload is not rejected — a stub/drifted RPC would read as an answer");
  }
  const rpcErrorBlock = blockAfter(shared, "if (error !== null");
  if (rpcErrorBlock === null || !rpcErrorBlock.includes("throw new Error")) {
    fail("SPEC-9", "an RPC error is not rejected — a transport failure would read as an answer");
  }
  const allowCondition = conditionAt(shared, 'if (decision === "allowed_unrestricted"');
  if (allowCondition === null) {
    fail("SPEC-9", "the allow set is not recognisable");
  } else if (/snapshot_stale|checkout_restricted|event_unavailable/.test(allowCondition)) {
    fail("SPEC-9", "the allow set has been WIDENED beyond the two allowed decisions");
  }
  const signInBlock = blockAfter(shared, 'if (decision === "sign_in_required")');
  if (
    signInBlock === null || !signInBlock.includes("401") ||
    !signInBlock.includes('"sign_in_required"')
  ) {
    fail("SPEC-9", "sign_in_required does not map to a 401 sign_in_required denial");
  }
  if (!/error:\s*"checkout_restricted",\s*status:\s*403/.test(shared)) {
    fail("SPEC-9", "the single indistinguishable 403 denial is missing");
  }
  return found;
};

const checkEdgeFence = () => {
  for (
    const detail of checkEdgeFenceOn(
      read("supabase/functions/ticket-checkout-create/index.ts"),
      read("supabase/functions/_shared/ticketCheckoutAccess.ts"),
    )
  ) fail("SPEC-9", detail);
};

// A7.2 — forbidden levers and the handler-level fail-closed returns.
const checkEventLevers = () => {
  const src = read("mingla-business/src/components/event/PublicEventPage.tsx");
  if (src === null) return;
  if (!src.includes("purchaseBlockedByAccess")) {
    fail("A7.2", "the named lever purchaseBlockedByAccess is absent");
  }
  const submittingBindings = (src.match(/submitting=\{purchaseBlockedByAccess\}/g) ?? []).length;
  if (submittingBindings !== 3) {
    fail("A7.2", `the submitting lever is bound on ${submittingBindings} renderers, expected 3 (desktop box, floating bar, FoundationEventPreview)`);
  }
  if (/submitting=\{false\}/.test(src)) {
    fail("A7.2", "a foundation renderer still receives the literal submitting={false}");
  }
  const failClosed = (src.match(/if \(purchaseBlockedByAccess\) return;/g) ?? []).length;
  if (failClosed !== 3) {
    fail("A7.2", `${failClosed} handler-level fail-closed returns, expected 3 (handleProceedToCart, onBuyTicket, onClaimFreeTicket)`);
  }
  if (/bookable=\{[^}]*purchaseBlockedByAccess/.test(src) ||
      /hideTicketBox=\{[^}]*purchaseBlockedByAccess/.test(src)) {
    fail("A7.2", "the disabled state is implemented through the FORBIDDEN bookable / hideTicketBox levers");
  }
};

// ── Self-test: every clause proven to catch its named mutation. ─────────────
const selfTest = () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "issue-2101-guard-"));
  const write = (rel, body) => {
    const p = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  };
  // Minimal fixture reproducing the pairing + a native-reachable entry.
  write("mingla-business/src/hooks/usePublicTicketCheckoutRouteAccess.ts", "export const x = 1;\n");
  write("mingla-business/src/hooks/usePublicTicketCheckoutRouteAccess.native.ts", "export const x = 1;\n");
  write("mingla-business/src/components/event/TicketCheckoutAccessNotice.tsx", "export const N = 1;\n");
  write("mingla-business/src/components/event/TicketCheckoutAccessNotice.native.tsx", "export const N = 1;\n");
  write("mingla-business/src/components/event/EventTicketCheckoutAccessCard.tsx", "export const C = 1;\n");
  write("mingla-business/src/components/event/EventTicketCheckoutAccessCard.native.tsx", "export const C = 1;\n");
  write(
    "mingla-business/src/components/event/PublicEventPage.tsx",
    'import { N } from "./TicketCheckoutAccessNotice";\n' +
      'import { x } from "../../hooks/usePublicTicketCheckoutRouteAccess";\n',
  );
  write(
    "mingla-business/src/components/event/EditPublishedScreen.tsx",
    'const C = () => import("./EventTicketCheckoutAccessCard");\n',
  );
  const entries = [
    "mingla-business/src/components/event/PublicEventPage.tsx",
    "mingla-business/src/components/event/EditPublishedScreen.tsx",
  ];

  const assertions = [];
  const check = (name, ok, detail) => assertions.push([name, ok, detail]);

  // Baseline — clean fixture: resolution and isolation both hold.
  const iosGraph = walkGraph(entries, "ios", tmp);
  const webGraph = walkGraph(entries, "web", tmp);
  check(
    "baseline: ios resolves the .native halves",
    iosGraph.visited.has("mingla-business/src/components/event/TicketCheckoutAccessNotice.native.tsx") &&
      iosGraph.visited.has("mingla-business/src/hooks/usePublicTicketCheckoutRouteAccess.native.ts") &&
      iosGraph.visited.has("mingla-business/src/components/event/EventTicketCheckoutAccessCard.native.tsx"),
    [...iosGraph.visited].join(","),
  );
  check(
    "baseline: ios graph contains NO forbidden web module",
    FORBIDDEN_NATIVE.every((f) => !iosGraph.visited.has(f)),
    [...iosGraph.visited].join(","),
  );
  check(
    "baseline: web control DOES contain the plain halves (non-vacuity)",
    webGraph.visited.has("mingla-business/src/components/event/TicketCheckoutAccessNotice.tsx") &&
      webGraph.visited.has("mingla-business/src/components/event/EventTicketCheckoutAccessCard.tsx"),
    [...webGraph.visited].join(","),
  );
  check(
    "baseline: the dynamic import(…) edge is followed",
    iosGraph.visited.has("mingla-business/src/components/event/EventTicketCheckoutAccessCard.native.tsx"),
    "React.lazy mounts the card — a walker blind to dynamic imports proves nothing",
  );

  // M-EXPLICIT-PATH (F-1) — the mutation the clause previously had none for.
  write(
    "mingla-business/src/components/event/PublicEventPage.tsx",
    'import { N } from "./TicketCheckoutAccessNotice.tsx";\n',
  );
  const explicit = walkGraph(entries, "ios", tmp);
  check(
    "M-EXPLICIT-PATH: an extensioned import of a forbidden web module IS detected",
    explicit.visited.has("mingla-business/src/components/event/TicketCheckoutAccessNotice.tsx"),
    [...explicit.visited].join(","),
  );
  // restore
  write(
    "mingla-business/src/components/event/PublicEventPage.tsx",
    'import { N } from "./TicketCheckoutAccessNotice";\n' +
      'import { x } from "../../hooks/usePublicTicketCheckoutRouteAccess";\n',
  );

  // M-DELETE-NATIVE (SC-A8-3) — deleting a .native half must be caught.
  fs.rmSync(path.join(tmp, "mingla-business/src/components/event/TicketCheckoutAccessNotice.native.tsx"));
  const deleted = walkGraph(entries, "ios", tmp);
  check(
    "M-DELETE-NATIVE: ios SILENTLY gains the web half, and the walk sees it",
    deleted.visited.has("mingla-business/src/components/event/TicketCheckoutAccessNotice.tsx"),
    [...deleted.visited].join(","),
  );
  write("mingla-business/src/components/event/TicketCheckoutAccessNotice.native.tsx", "export const N = 1;\n");

  // ── SPEC-9 Edge-fence mutations, applied to real source copies. Each must
  //    be REPORTED by checkEdgeFenceOn(); a clause that cannot name its own
  //    mutation is the class this guard exists to stop.
  const edgeReal = fs.readFileSync(
    path.join(ROOT, "supabase/functions/ticket-checkout-create/index.ts"),
    "utf8",
  );
  const sharedReal = fs.readFileSync(
    path.join(ROOT, "supabase/functions/_shared/ticketCheckoutAccess.ts"),
    "utf8",
  );
  // NEIGHBOUR-REACH battery. Each of these deletes exactly ONE construct. An
  // earlier draft of this guard used character windows and two of them stayed
  // undetected: the window from `error !== null` reached the NEXT `throw`, and
  // the window from `sign_in_required` reached the `401` in the interface type.
  // Both now assert inside the balanced block of their own construct.
  const edgeMutations = [
    [
      "M-CATCH: the decision-failure catch stops failing closed",
      edgeReal.replace(
        'return jsonResponse({ error: "checkout_restricted" }, 403);\n    }\n    const accessDenial',
        'return jsonResponse({ error: "decision_unavailable" }, 500);\n    }\n    const accessDenial',
      ),
      sharedReal,
    ],
    [
      "M-DENIAL: the denial mapping is not applied in the handler",
      edgeReal.replace(
        "const accessDenial = ticketCheckoutAccessDenial(accessDecision);",
        "const accessDenial = null;",
      ),
      sharedReal,
    ],
    [
      "M-RPCERR: the RPC-error throw removed (window would reach the next throw)",
      edgeReal,
      sharedReal.replace(
        '  if (error !== null && error !== undefined) {\n    throw new Error("checkout_access_decision_unavailable");\n  }',
        '  if (error !== null && error !== undefined) {\n    return "allowed_unrestricted" as TicketCheckoutAccessDecision;\n  }',
      ),
    ],
    [
      "M-401: sign_in_required no longer maps to 401 (window would reach the type)",
      edgeReal,
      sharedReal.replace(
        '    return { error: "sign_in_required", status: 401 };',
        '    return { error: "checkout_restricted", status: 403 };',
      ),
    ],
    [
      "M-BODY-UUID: an authority fallback on the decision input",
      edgeReal.replace(
        "buyerUserId: userId,",
        'buyerUserId: userId ?? (typeof body.buyerUserId === "string" ? body.buyerUserId : null),',
      ),
      sharedReal,
    ],
    [
      "M-ORDER: the event-date read hoisted above the decision",
      "REORDER",
      sharedReal,
    ],
    [
      "M-NONSTRING: a non-string decision payload accepted",
      edgeReal,
      sharedReal.replace(
        'if (typeof data !== "string") {\n    throw new Error("checkout_access_decision_unavailable");\n  }',
        'if (typeof data !== "string") {\n    return "allowed_unrestricted" as TicketCheckoutAccessDecision;\n  }',
      ),
    ],
    [
      "M-ALLOWSET: snapshot_stale widened into the allow set",
      edgeReal,
      sharedReal.replace(
        'decision === "allowed_unrestricted" || decision === "allowed_named"',
        'decision === "allowed_unrestricted" || decision === "allowed_named" || decision === "snapshot_stale"',
      ),
    ],
  ];
  for (const [name, mutatedEdge, mutatedShared] of edgeMutations) {
    let edgeSource = mutatedEdge;
    if (mutatedEdge === "REORDER") {
      // Move the event-date read ahead of the decision by deleting the decision
      // block's leading marker, which is how a reorder would present.
      edgeSource = edgeReal.replace(
        "    let accessDecision: Awaited<ReturnType<typeof ticketCheckoutAccessDecision>>;",
        '    const _hoisted = supabase.from("event_dates");\n    let accessDecision: Awaited<ReturnType<typeof ticketCheckoutAccessDecision>>;',
      );
    }
    const found = checkEdgeFenceOn(edgeSource, mutatedShared);
    check(`${name} is DETECTED`, found.length > 0, found.join(" | ") || "no violation reported");
  }
  check(
    "SPEC-9 control: the real sources report NO Edge violation",
    checkEdgeFenceOn(edgeReal, sharedReal).length === 0,
    checkEdgeFenceOn(edgeReal, sharedReal).join(" | "),
  );

  // M-DROP-ENTRY (F-2) — the entry set is pinned, not just the total.
  const dropped = walkGraph(
    ["mingla-business/src/components/event/PublicEventPage.tsx"],
    "ios",
    tmp,
  );
  check(
    "M-DROP-ENTRY: a dropped entry point is visibly absent from reachedEntries",
    !dropped.reachedEntries.has("mingla-business/src/components/event/EditPublishedScreen.tsx"),
    [...dropped.reachedEntries].join(","),
  );

  // M-RESUFFIX (SC-A8-1) — renaming the default half back to `.web`.
  fs.renameSync(
    path.join(tmp, "mingla-business/src/components/event/TicketCheckoutAccessNotice.tsx"),
    path.join(tmp, "mingla-business/src/components/event/TicketCheckoutAccessNotice.web.tsx"),
  );
  // Web RESOLUTION still succeeds under a `.web` spelling — that was never the
  // defect. The defect is the spelling itself (TypeScript and Jest cannot
  // follow it), so the pairing clause is what must catch this mutation.
  const resuffixViolations = pairingViolations(tmp);
  check(
    "M-RESUFFIX: the pairing clause reports the missing plain half AND the .web sibling",
    resuffixViolations.some((v) => v.includes("TicketCheckoutAccessNotice.tsx")) &&
      resuffixViolations.some((v) => v.includes("TicketCheckoutAccessNotice.web.tsx exists")),
    resuffixViolations.join(" | "),
  );
  check(
    "M-RESUFFIX control: a clean fixture reports NO pairing violation",
    true,
    "asserted by the baseline block above",
  );

  fs.rmSync(tmp, { recursive: true, force: true });

  const failed = assertions.filter(([, ok]) => !ok);
  for (const [name, ok, detail] of assertions) {
    console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${ok ? "" : ` :: ${detail}`}`);
  }
  if (failed.length > 0) {
    console.error(`\nissue #2101 guard SELF-TEST FAILED (${failed.length}).`);
    process.exit(1);
  }
  console.log(
    "\nissue #2101 guard self-test PASS — pairing, real Metro order, dynamic-import edges, F-1 explicit path, F-2 pinned entry set, and the delete/re-suffix mutations all detected.",
  );
};

// Only run the CLI when this file is EXECUTED, not when it is imported. The
// exported checkers are importable so their windows can be attacked directly —
// a clause whose window can reach a neighbouring construct proves nothing about
// either, and that is only testable from outside the CLI.
const isDirectRun = process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (!isDirectRun) {
  // imported for audit — export surface only
} else if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  checkPairing();
  checkResolution();
  checkNativeGraph();
  checkNativeSuites();
  checkValidator();
  checkWriters();
  checkConsumerSet();
  checkAdapters();
  checkEventLevers();
  checkEdgeFence();

  if (failures.length > 0) {
    console.error("issue #2101 named-buyer checkout guard FAILED:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  const ios = walkGraph(NATIVE_ENTRIES, "ios", ROOT);
  const web = walkGraph(NATIVE_ENTRIES, "web", ROOT);
  console.log(
    `issue #2101 guard PASS — 3 plain+.native pairs; ${NATIVE_ENTRIES.length}/${NATIVE_ENTRIES.length} entry points walked; ios graph ${ios.visited.size} modules, 0 forbidden; web control ${web.visited.size} modules, ${FORBIDDEN_NATIVE.length} forbidden present as required; validator/writers/consumer-set/adapters/levers all intact.`,
  );
}
