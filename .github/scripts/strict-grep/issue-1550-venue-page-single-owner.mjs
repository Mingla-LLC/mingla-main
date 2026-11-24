#!/usr/bin/env node
/**
 * #1550 / #1560 — I-PROPOSED-1550-VENUE-PAGE-SINGLE-OWNER (DRAFT; flips ACTIVE
 * at CLOSE).
 *
 * WHAT HAPPENED, AND WHY THIS FILE EXISTS
 * ---------------------------------------
 * `/b/{brand}/v/{venue}` had TWO implementations. The consumer one was written
 * 27 days after the buyer-web one, as a reduced reimplementation, under a work
 * item that explicitly demanded parity — and nothing enforced it. #1550 Leg B
 * counted 17 divergences, 13 of them accidental: no map, a dead address card, a
 * four-photo cap, no brand font, and — on a hotel — no way to book at all.
 *
 * #1560 deleted the fork. The REAL guarantee is structural: after it there is
 * exactly one file that renders this page, so forking again means creating a
 * new file, which is visible in review. This gate is the tripwire under that
 * guarantee. It asserts four things:
 *
 *   R-1  ONE OWNER.        Exactly two non-test files import `PublicVenueScreen`,
 *                          and they are the two ROUTES. A third importer is a
 *                          second mount; a route that stops importing it is a
 *                          route that grew its own page again.
 *   R-2  NO BODY JSX.      Neither route contains venue-body tokens
 *                          ("VERIFIED VENUE", "WHERE YOU'LL BE", the HOURS /
 *                          PHOTOS section labels, `hoursLineFor`, a gallery
 *                          `.slice(0, 4)`). Those belong to the shared module;
 *                          their reappearance in a route IS the fork restarting.
 *   R-3  DEEP SPECIFIER.   Both routes import through
 *                          "@mingla/brand-rendering/PublicVenueScreen", never
 *                          the bare barrel. The barrel re-exports
 *                          `PublicBrandPage`, which imports
 *                          `lucide-react-native`; on web that resolves to the
 *                          shim whose `USED_ICONS` map deep-requires 26 icons at
 *                          module scope, hoisting all of it into the EAGER
 *                          `__common` boot chunk (#1550 R3).
 *   R-4  LAZY BOUNDARY.    The shared module contains no `React.lazy` and
 *                          imports no `*StayGuestExperience` (#1550 R4). The
 *                          host hands in an already-lazy component through the
 *                          `bookingBody` slot, which is what keeps
 *                          `StayGuestBooking` (988 lines) and
 *                          `@stripe/stripe-js` out of the boot path.
 *
 * WHY THE ROUTE FILES AND NOT THE PAGE FILE
 * -----------------------------------------
 * #1550 R2 catalogued four gates pinned to `PublicVenuePage.tsx` by literal
 * path, one of which (`orch-1255-public-venue-anon-safe.mjs`) did
 * `if (f.code === null) continue;` — so it would have gone VACUOUSLY GREEN the
 * day that file moved. This gate reads the two ROUTE files instead, and a route
 * path cannot change without the router noticing. It still refuses to skip: a
 * missing, unreadable, empty or comment-only target is exit 2, never a pass.
 *
 * #1559 converted the anon-safe gate's silent skip into a hard failure and
 * proved it red against a non-existent file. Self-test case 3 below holds this
 * gate to the same standard — and case 9 proves the IMPORTER SWEEP itself
 * cannot go vacuous, which is the failure mode specific to R-1 (a sweep that
 * observes zero files reports "exactly the two routes import it" for a tree
 * where nothing imports it at all).
 *
 * WHAT THIS GATE DOES NOT CATCH — read before citing it as proof. It is a
 * TOPOLOGY gate. It proves both surfaces still route through one module; it
 * does NOT prove that module renders correctly (that is
 * `consumerVenueAdoption.issue1560.happy.test.tsx` and
 * `publicVenueRenderParity.issue1559.happy.test.tsx`), nor that a THIRD surface
 * added elsewhere renders a venue page at all.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

/** The three files whose CONTENT is asserted. All three paths are stable. */
const PATHS = {
  sharedScreen: "packages/brand-rendering/PublicVenueScreen.tsx",
  buyerRoute: "mingla-business/app/b/[brandSlug]/v/[venueSlug].tsx",
  consumerRoute: "app-mobile/app/b/[brandSlug]/v/[venueSlug].tsx",
  // #4490 — the Host's PREVIEW of the same page, for a venue that is not public
  // yet. It mounts the SAME shared screen (so it can never drift from what
  // guests get) with booking switched off; it draws no venue body of its own.
  hostPreviewRoute: "mingla-business/app/venue/[venueId]/preview.tsx",
  // #4490 — the two files that decide the page from a venue's FEATURES. They are
  // pure page logic: no colour, never the venue type, never auth.
  featurePage: "packages/brand-rendering/venueFeaturePage.ts",
  featureSections: "packages/brand-rendering/VenueFeatureSections.tsx",
  // #4490 venue owners: the read model (parsing what the page reads) moved out
  // of venueFeaturePage.ts into its own leaf; the same R-5 rules follow it.
  featureRead: "packages/brand-rendering/venueFeatureRead.ts",
};
const EXPECTED_FILES = Object.keys(PATHS).length;

/**
 * The files ALLOWED to import the shared screen (R-1): the two public routes
 * and, since #4490, the Host's preview of the same page.
 */
const ALLOWED_IMPORTERS = [PATHS.buyerRoute, PATHS.consumerRoute, PATHS.hostPreviewRoute];

/** Roots the importer sweep walks. A venue page could only live in these. */
const SWEEP_ROOTS = ["mingla-business", "app-mobile", "packages", "mingla-admin"];
const SWEEP_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);
const SWEEP_SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".expo",
  "dist",
  "build",
  "web-build",
  "ios",
  "android",
  "coverage",
]);

/**
 * A file is a TEST if it lives in a `__tests__` directory or its name carries a
 * test/spec/fixture marker. Tests legitimately import the screen to render it.
 */
const isTestFile = (rel) =>
  /(^|\/)__tests__\//.test(rel) ||
  /(^|\/)__fixtures__\//.test(rel) ||
  /\.(test|spec|adversarial|tester)\./.test(path.basename(rel));

/** Comments stripped (`[^:]` keeps `https://` intact), then whitespace removed. */
const dense = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/\s+/g, "");

/** Comments stripped only — for rules that must read real import statements. */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

/** Below this much real code every assertion would pass for the wrong reason. */
const MIN_REAL_CHARS = 400;

/**
 * A file IMPORTS the shared screen when it has a VALUE import of it — through
 * the deep specifier or a relative path. Deliberately precise:
 *   - `import type { … } from ".../PublicVenueScreen"` is ERASED at build time
 *     and mounts nothing, so a type-only importer is not a second owner;
 *   - a bare mention of the identifier (a comment, the module's own export, a
 *     prop name) is not an import, and matching on it made this gate accuse the
 *     shared module of importing itself.
 */
const IMPORT_SPECIFIER =
  String.raw`["'](?:@mingla/brand-rendering/PublicVenueScreen|\.{1,2}(?:/[^"']*)?/?PublicVenueScreen)["']`;
const VALUE_IMPORT = new RegExp(
  String.raw`(?:^|[\n;])\s*import\s+(?!type\s)[^;]*?from\s*` + IMPORT_SPECIFIER +
    String.raw`|require\(\s*` + IMPORT_SPECIFIER,
  "m",
);

const importsSharedScreen = (code) => VALUE_IMPORT.test(stripComments(code));

/**
 * R-2 — venue-BODY tokens. Each one is a thing the deleted consumer screen drew
 * itself; finding any of them in a route means the body is being re-forked.
 * Dense form, so reformatting or a line break cannot hide one.
 */
const FORBIDDEN_BODY_TOKENS = [
  ["VERIFIEDVENUE", "the identity-block eyebrow"],
  ["WHEREYOU", "the address-card label"],
  [">HOURS<", "the hours-section label"],
  [">PHOTOS<", "the gallery-section label"],
  ["hoursLineFor", "the hours-row renderer"],
  [".slice(0,4)", "the four-photo gallery cap"],
  ["Record<VenueSectionId,", "a second Overview section registry"],
  ["profile.overview.map(", "a second order-is-data Overview render"],
];

/** R-4 — what the shared module may never contain. */
const FORBIDDEN_IN_SHARED = [
  ["React.lazy", "a React.lazy boundary (the HOST owns code-splitting)"],
  ["StayGuestExperience", "a *StayGuestExperience import (it arrives as a slot)"],
];

const DEEP_SPECIFIER = '"@mingla/brand-rendering/PublicVenueScreen"';
const BARE_BARREL = /from"@mingla\/brand-rendering"/;

/**
 * Pure, so the self-test can plant fixtures.
 *
 * @param {Record<string,string|null>} raw   key -> contents (null = missing)
 * @param {{rel:string, code:string}[]} swept every non-test source file scanned
 * @param {number} sweptTotal                how many files the sweep OBSERVED
 * @returns {{code:number, messages:string[]}} 0 pass · 1 violation · 2 vacuous
 */
export function runGate(raw, swept, sweptTotal) {
  const keys = Object.keys(PATHS);

  // ---- P-COUNT: the scan observed what it claims to enforce. --------------
  if (Object.keys(raw).length !== EXPECTED_FILES) {
    return {
      code: 2,
      messages: [
        `#1550 single-owner gate VACUOUS — expected ${EXPECTED_FILES} target files, received ${Object.keys(raw).length}.`,
      ],
    };
  }

  const codes = {};
  const rawCodes = {};
  for (const key of keys) {
    const src = raw[key];
    // ---- P-PRESENT: a missing target is a HARD FAILURE, never a skip. ----
    if (src === null || src === undefined) {
      return {
        code: 2,
        messages: [
          `#1550 single-owner gate FAIL — ${PATHS[key]} is MISSING or unreadable. ` +
            "A gate that SKIPS a missing file is not a gate: it reports green while the " +
            "invariant stops being enforced (#1550 R2). If this file legitimately moved, " +
            "REPOINT this gate in the same PR that moves it.",
        ],
      };
    }
    const d = dense(src);
    // ---- P-SUBSTANCE: a comment-only stub cannot pass vacuously. ---------
    if (d.length < MIN_REAL_CHARS) {
      return {
        code: 2,
        messages: [
          `#1550 single-owner gate VACUOUS — ${PATHS[key]} has only ${d.length} chars of ` +
            `real code after comment-stripping (minimum ${MIN_REAL_CHARS}). Every assertion ` +
            "below would pass for the wrong reason.",
        ],
      };
    }
    codes[key] = d;
    rawCodes[key] = stripComments(src);
  }

  // ---- P-SWEEP: the importer sweep must have observed a real tree. -------
  // Without this, a sweep that walked nothing would report "exactly the two
  // routes import PublicVenueScreen" for a tree where NOTHING does — the same
  // class of vacuity R2 catalogued, one level up.
  if (!Number.isInteger(sweptTotal) || sweptTotal < 500) {
    return {
      code: 2,
      messages: [
        `#1550 single-owner gate VACUOUS — the importer sweep observed ${sweptTotal} source ` +
          "files. The repo has thousands; a sweep this small did not walk the tree, so " +
          '"exactly two importers" would be true of an empty result set.',
      ],
    };
  }

  const failures = [];

  // ---- R-1: exactly the allowed mounts import the shared screen. ----------
  const importers = swept
    .filter((f) => f.rel !== PATHS.sharedScreen && importsSharedScreen(f.code))
    .map((f) => f.rel)
    .sort();
  const expected = [...ALLOWED_IMPORTERS].sort();
  for (const extra of importers.filter((r) => !expected.includes(r))) {
    failures.push(
      `${extra}: imports PublicVenueScreen. Exactly THREE non-test files may — the buyer-web ` +
        "route, the consumer route and the Host's preview of the same page (#4490). Any other " +
        "mount is a second implementation waiting to diverge; that is the whole reason #1560 exists.",
    );
  }
  // #4490 venue owners: the Host preview mounts the SAME screen but takes it
  // from the buyer route's own chunk (a lazy import of that module, which
  // re-exports it) instead of bundling a second copy, which web export would
  // hoist into the eager __common chunk. That still counts as mounting the
  // shared screen: the buyer route re-exports exactly the deep-imported
  // module, and the preview renders it.
  const previewBorrows =
    codes.hostPreviewRoute.includes('import("../../b/[brandSlug]/v/[venueSlug]")') &&
    codes.hostPreviewRoute.includes("<PublicVenueScreen") &&
    codes.buyerRoute.includes("export{PublicVenueScreen};");
  for (const missing of expected.filter(
    (r) => !importers.includes(r) && !(r === PATHS.hostPreviewRoute && previewBorrows),
  )) {
    failures.push(
      `${missing}: no longer imports PublicVenueScreen. A route that stops mounting the ` +
        "shared screen has grown its own venue page again.",
    );
  }

  // ---- R-2 / R-3: the two routes are adapters, on the deep specifier. -----
  for (const key of ["buyerRoute", "consumerRoute", "hostPreviewRoute"]) {
    for (const [needle, why] of FORBIDDEN_BODY_TOKENS) {
      if (codes[key].includes(needle)) {
        failures.push(
          `${PATHS[key]}: contains ${why} (\`${needle}\`). Venue body belongs to ` +
            `${PATHS.sharedScreen}; a route that draws it is re-growing the fork.`,
        );
      }
    }
    if (!codes[key].includes(`from${DEEP_SPECIFIER}`)) {
      failures.push(
        `${PATHS[key]}: does not import from the DEEP specifier ` +
          `${DEEP_SPECIFIER}. The bare barrel re-exports PublicBrandPage and hoists the ` +
          "lucide shim's 26 module-scope icon requires into the eager boot chunk (#1550 R3).",
      );
    }
    for (const line of rawCodes[key].match(/import\s+(?:type\s+)?[^;]*?from\s*"@mingla\/brand-rendering"/g) ?? []) {
      if (!/^import\s+type\s/.test(line.trim())) {
        failures.push(
          `${PATHS[key]}: has a VALUE import from the bare "@mingla/brand-rendering" barrel ` +
            `(\`${line.replace(/\s+/g, " ").slice(0, 70)}…\`). Every bare-barrel import here must ` +
            "be `import type` (erased) or use a deep specifier.",
        );
      }
    }
  }

  // ---- R-4: the shared module keeps the lazy boundary OUT. ----------------
  for (const [needle, why] of FORBIDDEN_IN_SHARED) {
    if (codes.sharedScreen.includes(needle.replace(/\s+/g, ""))) {
      failures.push(
        `${PATHS.sharedScreen}: contains ${why}. That re-imports StayGuestBooking (988 lines) ` +
          "and @stripe/stripe-js into the eager boot path (#1550 R4).",
      );
    }
  }
  if (BARE_BARREL.test(codes.sharedScreen)) {
    failures.push(
      `${PATHS.sharedScreen}: imports its own barrel "@mingla/brand-rendering" — that pulls ` +
        "PublicBrandPage into the venue chunk. Use relative sibling imports inside the package.",
    );
  }

  // ---- R-5 (#4490): the page is decided by FEATURES, not the venue type. ---
  for (const key of ["featurePage", "featureSections", "featureRead"]) {
    const code = rawCodes[key];
    if (/#[0-9a-fA-F]{3,8}\b/.test(code)) {
      failures.push(
        `${PATHS[key]}: contains a hex colour literal. Every colour comes from the page's ` +
          "resolved theme palette (#4490).",
      );
    }
    if (/venueCategory/.test(code)) {
      failures.push(
        `${PATHS[key]}: reads \`venueCategory\`. A venue type is a label and a starting preset ` +
          "only; tabs, the info row and the booking bar are derived from features (#4490).",
      );
    }
    if (/useAuth/.test(code)) {
      failures.push(
        `${PATHS[key]}: calls useAuth. The public venue page is anonymous-tolerant ` +
          "(I-anon-buyer-routes).",
      );
    }
  }

  if (failures.length > 0) {
    return {
      code: 1,
      messages: [
        "FAIL [I-PROPOSED-1550-VENUE-PAGE-SINGLE-OWNER]:",
        ...failures.map((f) => `  x ${f}`),
      ],
    };
  }
  return {
    code: 0,
    messages: [
      `OK [I-PROPOSED-1550-VENUE-PAGE-SINGLE-OWNER]: ${EXPECTED_FILES} targets present and ` +
        `substantive; ${sweptTotal} source files swept; exactly ${importers.length} non-test ` +
        "importers, and they are the two public routes and the Host preview; no venue-body JSX in " +
        "any; deep specifier holds; the shared module carries no React.lazy and no " +
        "StayGuestExperience import; the feature-page files hold no colour, no venue type, no auth.",
    ],
  };
}

// ---------------------------------------------------------------------------
// Disk I/O
// ---------------------------------------------------------------------------

function sweepSources() {
  const out = [];
  const walk = (absDir, relDir) => {
    let entries;
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const rel = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (SWEEP_SKIP_DIRS.has(entry.name)) continue;
        walk(path.join(absDir, entry.name), rel);
        continue;
      }
      if (!SWEEP_EXTENSIONS.has(path.extname(entry.name))) continue;
      if (isTestFile(rel)) continue;
      try {
        out.push({ rel, code: fs.readFileSync(path.join(absDir, entry.name), "utf8") });
      } catch {
        /* unreadable file: not an importer */
      }
    }
  };
  for (const root of SWEEP_ROOTS) {
    walk(path.join(REPO_ROOT, root), root);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

if (process.argv.includes("--self-test")) {
  const filler = "constFILLER=1;\n".repeat(60);
  const clean = () => ({
    sharedScreen:
      filler +
      'import { PublicMenuSections } from "./PublicMenuSections";\n' +
      "export const PublicVenueScreen = () => null;\n" +
      "const VENUE_SECTIONS: Record<VenueSectionId, VenueSectionRenderer> = {};\n" +
      "{profile.overview.map((id) => null)}\n" +
      "const line = hoursLineFor(entry);\n",
    buyerRoute:
      filler +
      'import { PublicVenueScreen } from "@mingla/brand-rendering/PublicVenueScreen";\n' +
      "return <PublicVenueScreen venue={vm} />;\n",
    consumerRoute:
      filler +
      'import { PublicVenueScreen } from "@mingla/brand-rendering/PublicVenueScreen";\n' +
      "return <PublicVenueScreen venue={vm} />;\n",
    hostPreviewRoute:
      filler +
      'import { PublicVenueScreen } from "@mingla/brand-rendering/PublicVenueScreen";\n' +
      "return <PublicVenueScreen venue={vm} preview={note} />;\n",
    featurePage: filler + "export const deriveVenuePage = () => null;\n",
    featureSections: filler + "export const VenueWaysToCome = () => null;\n",
    featureRead: filler + "export const parsePublicVenueFeatures = () => null;\n",
  });
  /** A plausible swept tree: the two routes plus 700 innocent files. */
  const cleanSweep = () => {
    const files = ALLOWED_IMPORTERS.map((rel) => ({
      rel,
      code: 'import { PublicVenueScreen } from "@mingla/brand-rendering/PublicVenueScreen";',
    }));
    for (let i = 0; i < 700; i += 1) {
      files.push({ rel: `mingla-business/src/filler${i}.ts`, code: "export const x = 1;" });
    }
    return files;
  };
  const run = (raw = clean(), sweep = cleanSweep()) =>
    runGate(raw, sweep, sweep.length);

  const problems = [];
  const expect = (label, got, want) => {
    if (got !== want) problems.push(`${label}: expected exit ${want}, got ${got}`);
  };

  // 1 — a clean tree passes.
  expect("clean fixture", run().code, 0);

  // 2 — a THIRD importer is a second implementation.
  {
    const sweep = cleanSweep();
    sweep.push({
      rel: "app-mobile/src/screens/ConsumerPublicVenueScreen.tsx",
      code: 'import { PublicVenueScreen } from "@mingla/brand-rendering/PublicVenueScreen";',
    });
    const result = run(clean(), sweep);
    expect("third importer", result.code, 1);
    if (!result.messages.join("\n").includes("ConsumerPublicVenueScreen")) {
      problems.push("third-importer failure did not name the offending file");
    }
  }

  // 3 — THE REGRESSION GUARD (#1550 R2 / #1559). A missing target HARD FAILS.
  {
    const raw = clean();
    raw.consumerRoute = null;
    const result = run(raw);
    expect("missing target file", result.code, 2);
    if (!result.messages.join("\n").includes("MISSING")) {
      problems.push("missing-target failure did not say MISSING");
    }
  }

  // 4 — a target stubbed down to comments cannot pass vacuously.
  {
    const raw = clean();
    raw.buyerRoute = "// everything moved somewhere else\n";
    expect("comment-only target", run(raw).code, 2);
  }

  // 5 — a short scan (a target silently dropped from PATHS) is vacuous.
  {
    const raw = clean();
    delete raw.sharedScreen;
    expect("truncated scan", run(raw).code, 2);
  }

  // 6 — venue-body JSX re-appearing in a route.
  for (const [token] of [
    ['const eyebrow = "VERIFIED VENUE";'],
    ["<Text>WHERE YOU’LL BE</Text>"],
    ["gallery.slice(0, 4)"],
    ["const R: Record<VenueSectionId, X> = {};"],
  ]) {
    const raw = clean();
    raw.consumerRoute += `\n${token}\n`;
    expect(`body JSX back in a route: ${token.slice(0, 24)}`, run(raw).code, 1);
  }

  // 7 — the deep specifier replaced by the bare barrel.
  {
    const raw = clean();
    raw.buyerRoute = raw.buyerRoute.replace(
      '"@mingla/brand-rendering/PublicVenueScreen"',
      '"@mingla/brand-rendering"',
    );
    expect("bare barrel on a route", run(raw).code, 1);
  }

  // 8 — the lazy boundary migrating INTO the shared module.
  for (const token of [
    "const Lazy = React.lazy(() => import('./x'));",
    'import { BuyerStayGuestExperience } from "../stay/BuyerStayGuestExperience";',
  ]) {
    const raw = clean();
    raw.sharedScreen += `\n${token}\n`;
    expect(`lazy/stay import in the shared module: ${token.slice(0, 20)}`, run(raw).code, 1);
  }

  // 9 — THE SWEEP'S OWN VACUITY GUARD. A sweep that walked nothing would find
  //     zero importers and, without this, report "exactly two importers" as a
  //     pass for a tree where the routes do not import the screen at all.
  {
    const result = runGate(clean(), [], 0);
    expect("empty sweep", result.code, 2);
    if (!result.messages.join("\n").includes("did not walk the tree")) {
      problems.push("empty-sweep failure did not explain the vacuity");
    }
  }

  // 9b — #4490: the feature-page files stay colour-free, type-free and anonymous.
  for (const [key, token] of [
    ["featurePage", 'const accent = "#ff8a3b";'],
    ["featureSections", "const c = '#fff';"],
    ["featurePage", "if (venue.venueCategory === 'club') return null;"],
    ["featureSections", "const { user } = useAuth();"],
  ]) {
    const raw = clean();
    raw[key] += `\n${token}\n`;
    expect(`feature-page rule: ${token.slice(0, 26)}`, run(raw).code, 1);
  }

  // 10 — a route that stops importing the screen.
  {
    const sweep = cleanSweep().filter((f) => f.rel !== PATHS.consumerRoute);
    const result = run(clean(), sweep);
    expect("route stopped importing the screen", result.code, 1);
    if (!result.messages.join("\n").includes("no longer imports")) {
      problems.push("dropped-importer failure did not name the rule");
    }
  }

  // 11 — #4490: the preview may borrow the screen from the buyer route's
  // chunk, but only while the buyer route re-exports it and the preview mounts it.
  {
    const borrowing = () => {
      const f = clean();
      f.hostPreviewRoute =
        filler +
        'import type { PublicVenueScreenProps } from "@mingla/brand-rendering/PublicVenueScreen";\n' +
        'const PublicVenueScreen = React.lazy(async () => ({ default: (await import("../../b/[brandSlug]/v/[venueSlug]")).PublicVenueScreen }));\n' +
        "return <PublicVenueScreen venue={vm} preview={note} />;\n";
      f.buyerRoute += "export { PublicVenueScreen };\n";
      return f;
    };
    const sweep = cleanSweep().filter((f) => f.rel !== PATHS.hostPreviewRoute);
    expect("preview borrows the buyer route's screen", run(borrowing(), sweep).code, 0);
    const noReexport = borrowing();
    noReexport.buyerRoute = noReexport.buyerRoute.replace("export { PublicVenueScreen };\n", "");
    expect("preview borrows but the buyer route no longer re-exports", run(noReexport, sweep).code, 1);
  }

  if (problems.length > 0) {
    console.error("SELF-TEST FAIL:");
    for (const p of problems) console.error(`- ${p}`);
    process.exit(1);
  }
  console.log(
    "#1550 venue-page-single-owner gate self-test passed " +
      `(${EXPECTED_FILES} targets; missing/stubbed/short-scan/empty-sweep all HARD FAIL).`,
  );
  process.exit(0);
}

const raw = {};
for (const [key, rel] of Object.entries(PATHS)) {
  const abs = path.join(REPO_ROOT, rel);
  raw[key] = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
}
const swept = sweepSources();
const { code, messages } = runGate(raw, swept, swept.length);
for (const message of messages) {
  if (code === 0) console.log(message);
  else console.error(message);
}
process.exit(code);
