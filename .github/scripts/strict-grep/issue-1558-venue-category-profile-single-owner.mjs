#!/usr/bin/env node
// #1558 — WHY THIS GATE EXISTS, AND WHY IT IS A GATE AND NOT A JEST PIN.
//
// The behaviour of the profile table is proved by a real behavioural suite
// (`venueCategoryProfile.issue1558.happy.test.ts`, which imports the module and
// executes it). What that suite CANNOT prove is a STRUCTURAL rule: that the two
// venue surfaces still resolve the shared table rather than quietly growing a
// second `isStay` back. That rule belongs in a gate — a jest source-text pin for
// it would be the exact class I-PROPOSED-1047-BIZ-NO-SOLE-SOURCE-PIN forbids.
//
// TWO LESSONS FROM #1550's OWN RISK REGISTER ARE BUILT IN:
//   R2 — `orch-1255-public-venue-anon-safe.mjs` does `if (f.code === null)
//        continue;`, so it goes VACUOUSLY GREEN the day its target file moves.
//        A gate that skips a missing file is not a gate. Here a missing,
//        unreadable or comment-only file is exit 2, never a pass.
//   #1518/#1529 — assert the scan observed something BEFORE evaluating any
//        violation. A clean tree and a broken scan look identical otherwise.
/**
 * #1558 [venue-category-profiles] — I-PROPOSED-1558-VENUE-CATEGORY-PROFILE-
 * SINGLE-OWNER (DRAFT; flips ACTIVE at CLOSE).
 *
 * WHAT IT ENFORCES
 *   1. ONE owner. `packages/brand-rendering/venueCategoryProfile.ts` holds a
 *      TOTAL `Record<VenueCategoryKey, VenueCategoryProfile>` with an explicit
 *      `uncategorised` arm and no `default:` fall-through, plus the total
 *      `Record<VenueSectionId, true>` witness. A fifth category is then a
 *      compile error rather than a silent restaurant.
 *   2. BOTH surfaces read it. The buyer-web page and the consumer screen each
 *      resolve `venueCategoryProfile(...)`, render `profile.overview.map(...)`,
 *      and type their section registry `Record<VenueSectionId, React.FC<…>>`.
 *   3. NEITHER surface re-grows the branch. No `const isStay`, no raw
 *      `venue.venueCategory === "stay"` compare on either page.
 *   4. The reserve wording has ONE home. The guest-facing reserve strings live
 *      in the profile module and appear in no other scanned file — that is what
 *      collapsed the four competing strings #1550 Leg A counted.
 *   5. The operator facet lookup keeps its total map: no
 *      `// restaurant / default` return, no `?? "restaurant"` null coercion.
 *
 * MATCHING IS WHITESPACE-INSENSITIVE (comments stripped, then every whitespace
 * run removed), so reformatting cannot disarm it and a needle cannot be split
 * across a line break to slip past.
 *
 * WHAT THIS GATE DOES NOT CATCH — read before citing it as proof. It is a
 * TOPOLOGY gate. It proves the surfaces still route through the table; it does
 * NOT prove the table's VALUES are right (that is the behavioural suite), that
 * the sections render correctly (that is a render proof), or that a new surface
 * added elsewhere reads the profile at all.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const PATHS = {
  profile: "packages/brand-rendering/venueCategoryProfile.ts",
  // #1559 — the buyer-web venue BODY moved from
  // `mingla-business/src/components/venue/PublicVenuePage.tsx` into the shared
  // package. `buyerPage` follows it, and `buyerRoute` is added so the CHAIN is
  // still provable end to end: the route mounts the shared screen, and the
  // shared screen resolves the profile. Repointing without adding the route
  // would have left "does the buyer surface use the table?" unproven.
  buyerPage: "packages/brand-rendering/PublicVenueScreen.tsx",
  buyerRoute: "mingla-business/app/b/[brandSlug]/v/[venueSlug].tsx",
  // #1560 — `app-mobile/src/screens/ConsumerPublicVenueScreen.tsx` was DELETED.
  // The consumer surface now mounts the SAME `buyerPage` module, so "does the
  // consumer resolve the category table?" is answered by `buyerPage` for both
  // apps, and what remains consumer-specific is that its ROUTE is an adapter:
  // it mounts the shared screen through the deep specifier and draws no venue
  // body of its own. That is what these needles assert — the same shape
  // `buyerRoute` has carried since #1559.
  consumerRoute: "app-mobile/app/b/[brandSlug]/v/[venueSlug].tsx",
  readiness: "mingla-business/src/components/venue/VenueDeckReadinessSetup.tsx",
  reserveCopy: "mingla-business/src/components/venue/venueReserveCopy.ts",
};
const EXPECTED_FILES = Object.keys(PATHS).length;

/** Comments stripped (the `[^:]` guard keeps `https://` intact), then all
 *  whitespace removed — needles cannot be defeated by reformatting. */
const dense = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/\s+/g, "");

/** The reserve strings the table OWNS, dense. They live ONLY in the profile. */
const OWNED_RESERVE_LITERALS = [
  '"Reserveatable"',
  '"ReservethisStay"',
  '"Bookavisit"',
];
/**
 * RETIRED wording — "Find a table" was the consumer screen's own fourth
 * competing reserve string (#1550 Leg A counted four across two surfaces). It
 * was DELETED, not relocated, so it must appear in NO scanned file, the profile
 * included.
 */
const RETIRED_RESERVE_LITERALS = ['"Findatable"'];

const MUST_CONTAIN = {
  profile: [
    ["Record<VenueCategoryKey,VenueCategoryProfile>", "the total category table"],
    ["uncategorised:", "the explicit arm for venueCategory === null"],
    ["restaurant:", "the restaurant arm"],
    ["play:", "the play arm"],
    ["creative_and_arts:", "the creative_and_arts arm"],
    ["stay:", "the stay arm"],
    ["Record<VenueSectionId,true>", "the total section-id witness"],
  ],
  buyerPage: [
    ["venueCategoryProfile(venue.venueCategory)", "the profile resolution"],
    ["profile.overview.map(", "the order-is-data Overview render"],
    // #1559 — same total Record. The renderer type is declared locally
    // (`VenueSectionRenderer`) rather than as `React.FC`, because a file under
    // packages/ cannot resolve the app's React peer and `React.FC` would widen
    // every section's props to `any`. The consumer screen lives in
    // app-mobile/src, where React resolves, and keeps `React.FC`.
    [
      "Record<VenueSectionId,VenueSectionRenderer>",
      "the total section registry",
    ],
    ["profile.reserveAction", "the single reserve string"],
  ],
  buyerRoute: [
    ["<PublicVenueScreen", "the shared venue screen mount"],
    [
      'from"@mingla/brand-rendering/PublicVenueScreen"',
      "the deep-specifier import of the shared screen",
    ],
  ],
  consumerRoute: [
    ["<PublicVenueScreen", "the shared venue screen mount"],
    [
      'from"@mingla/brand-rendering/PublicVenueScreen"',
      "the deep-specifier import of the shared screen",
    ],
    [
      "context.reserveAction",
      "the reserve string read off the profile-resolved slot context",
    ],
  ],
  readiness: [
    ["FACET_QUESTIONS_BY_CATEGORY", "the total facet lookup"],
    ["Record<VenueCategoryKey,", "the facet lookup keyed over every category"],
    ["uncategorised:", "the explicit arm for a NULL category"],
  ],
  reserveCopy: [
    ["VENUE_CATEGORY_PROFILES", "the profile table as the copy source"],
  ],
};

const MUST_NOT_CONTAIN = {
  profile: [["default:", "a `default:` arm — the table must be total"]],
  buyerPage: [
    ["constisStay", "a re-grown `const isStay` branch"],
    ['venue.venueCategory==="stay"', "a raw category compare"],
  ],
  // The route legitimately gates its QUERIES on the stay category (a Stay has
  // no menu and no table-reservability round-trip); what it must not do is
  // render venue body from that compare. So the forbidden tokens here are the
  // BODY's, not the branch's.
  buyerRoute: [
    ["VERIFIED VENUE", "identity-block JSX that belongs to the shared screen"],
    ["WHERE YOU&apos;LL BE", "address-card JSX that belongs to the shared screen"],
    ["hoursLineFor", "the hours renderer that belongs to the shared screen"],
    [
      "Record<VenueSectionId,React.FC<",
      "a second section registry — there is exactly one, in the shared screen",
    ],
  ],
  // The route legitimately gates its Stay QUERY on the category (a Stay has no
  // menu and no table-reservability round-trip); what it must not do is render
  // venue body from that compare, or grow a second section registry.
  consumerRoute: [
    ["VERIFIEDVENUE", "identity-block JSX that belongs to the shared screen"],
    ["WHEREYOU", "address-card JSX that belongs to the shared screen"],
    ["hoursLineFor", "the hours renderer that belongs to the shared screen"],
    [
      "Record<VenueSectionId,",
      "a second section registry — there is exactly one, in the shared screen",
    ],
    ["profile.overview.map(", "a second order-is-data Overview render"],
  ],
  readiness: [
    ["//restaurant/default", "the restaurant fall-through"],
    ['??"restaurant"', "the NULL-category coercion to restaurant"],
    ["functionfacetQuestionsForCategory(", "the untotal facet function"],
  ],
  reserveCopy: [],
};

/**
 * Pure so the self-test can plant fixtures.
 * @param {Record<string,string|null>} raw  key -> file contents, or null = missing
 * @returns {{code:number, messages:string[]}}
 */
export function runGate(raw) {
  const messages = [];
  const keys = Object.keys(PATHS);

  // ---- P-VACUOUS: the scan must have observed every target, non-empty. ----
  if (Object.keys(raw).length !== EXPECTED_FILES) {
    return {
      code: 2,
      messages: [
        `#1558 gate VACUOUS — expected ${EXPECTED_FILES} target files, received ${Object.keys(raw).length}.`,
      ],
    };
  }
  const codes = {};
  for (const key of keys) {
    const src = raw[key];
    if (src === null || src === undefined) {
      return {
        code: 2,
        messages: [
          `#1558 gate FAIL — ${PATHS[key]} is missing or unreadable. A gate that SKIPS a missing file is not a gate (#1550 R2).`,
        ],
      };
    }
    const d = dense(src);
    if (d.length < 200) {
      return {
        code: 2,
        messages: [
          `#1558 gate VACUOUS — ${PATHS[key]} has only ${d.length} chars of real code after comment-stripping; every assertion below would pass for the wrong reason.`,
        ],
      };
    }
    codes[key] = d;
  }

  // ---- ANCHOR: the reserve strings must EXIST in the owner, or rule 4 is
  // vacuous (a "lives nowhere else" rule proves nothing if it lives nowhere).
  const anchored = OWNED_RESERVE_LITERALS.filter((lit) =>
    codes.profile.includes(lit),
  );
  if (anchored.length !== OWNED_RESERVE_LITERALS.length) {
    return {
      code: 2,
      messages: [
        `#1558 gate VACUOUS — ${PATHS.profile} carries only ${anchored.length}/${OWNED_RESERVE_LITERALS.length} owned reserve strings; the single-owner rule cannot be evaluated.`,
      ],
    };
  }

  const failures = [];

  for (const key of keys) {
    for (const [needle, why] of MUST_CONTAIN[key]) {
      if (!codes[key].includes(needle)) {
        failures.push(`${PATHS[key]}: lost ${why} (expected \`${needle}\`).`);
      }
    }
    for (const [needle, why] of MUST_NOT_CONTAIN[key]) {
      if (codes[key].includes(needle)) {
        failures.push(`${PATHS[key]}: re-introduced ${why} (found \`${needle}\`).`);
      }
    }
  }

  // ---- Rule 4: the reserve wording has exactly one home. ----
  for (const key of keys) {
    if (key !== "profile") {
      for (const lit of OWNED_RESERVE_LITERALS) {
        if (codes[key].includes(lit)) {
          failures.push(
            `${PATHS[key]}: hardcodes the reserve string ${lit} — it belongs to ${PATHS.profile} alone, or the competing strings come back.`,
          );
        }
      }
    }
    for (const lit of RETIRED_RESERVE_LITERALS) {
      if (codes[key].includes(lit)) {
        failures.push(
          `${PATHS[key]}: revived the RETIRED reserve string ${lit} — it was deleted, not relocated.`,
        );
      }
    }
  }

  if (failures.length > 0) {
    return {
      code: 1,
      messages: [
        "FAIL [I-PROPOSED-1558-VENUE-CATEGORY-PROFILE-SINGLE-OWNER]:",
        ...failures.map((f) => `  x ${f}`),
      ],
    };
  }
  messages.push(
    `OK [I-PROPOSED-1558-VENUE-CATEGORY-PROFILE-SINGLE-OWNER]: ${EXPECTED_FILES} files scanned; ` +
      "one total category table, both surfaces resolve it, neither re-grew `isStay`, " +
      `${OWNED_RESERVE_LITERALS.length} reserve strings with one owner, ` +
      `${RETIRED_RESERVE_LITERALS.length} retired string absent everywhere.`,
  );
  return { code: 0, messages };
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------
if (process.argv.includes("--self-test")) {
  const pad = (s) => s + "\n" + "// filler ".repeat(60).replace(/\/\//g, "x");
  const clean = () => ({
    profile: pad(`
      export const VENUE_CATEGORY_PROFILES: Record<VenueCategoryKey, VenueCategoryProfile> = {
        restaurant: { reserveAction: "Reserve a table" },
        play: { reserveAction: "Book a visit" },
        creative_and_arts: { reserveAction: "Book a visit" },
        stay: { reserveAction: "Reserve this Stay" },
        uncategorised: { reserveAction: "Book a visit" },
      };
      const SECTION_ID_PRESENCE: Record<VenueSectionId, true> = { about: true };
    `),
    buyerPage: pad(`
      const profile = venueCategoryProfile(venue.venueCategory);
      const VENUE_SECTIONS: Record<VenueSectionId, VenueSectionRenderer> = {};
      {profile.overview.map((sectionId) => null)}
      title={profile.reserveAction}
    `),
    buyerRoute: pad(`
      import { PublicVenueScreen } from "@mingla/brand-rendering/PublicVenueScreen";
      return <PublicVenueScreen venue={venueViewModel} />;
    `),
    consumerRoute: pad(`
      import { PublicVenueScreen } from "@mingla/brand-rendering/PublicVenueScreen";
      accessibilityLabel={context.reserveAction}
      return <PublicVenueScreen venue={venueViewModel} />;
    `),
    readiness: pad(`
      const FACET_QUESTIONS_BY_CATEGORY: Record<VenueCategoryKey, X> = { uncategorised: [] };
    `),
    reserveCopy: pad(`
      import { VENUE_CATEGORY_PROFILES } from "@mingla/brand-rendering/venueCategoryProfile";
    `),
  });

  const problems = [];
  const expect = (label, got, want) => {
    if (got !== want) problems.push(`${label}: expected exit ${want}, got ${got}`);
  };

  // 1 — clean fixture passes.
  expect("clean", runGate(clean()).code, 0);

  // 2 — the total table loses its NULL arm.
  {
    const f = clean();
    f.profile = f.profile.replace("uncategorised:", "notTheNullArm:");
    expect("missing uncategorised arm", runGate(f).code, 1);
  }
  // 3 — a `default:` fall-through comes back.
  {
    const f = clean();
    f.profile = f.profile.replace("uncategorised:", "uncategorised: 1, default:");
    expect("default arm", runGate(f).code, 1);
  }
  // 4 — a surface re-grows `const isStay`.
  {
    const f = clean();
    f.buyerPage += '\nconst isStay = venue.venueCategory === "stay";';
    expect("buyer isStay", runGate(f).code, 1);
  }
  // 5 — #1560: the consumer ROUTE re-grows venue body instead of adapting.
  {
    const f = clean();
    f.consumerRoute += "\nconst eyebrow = \"VERIFIED VENUE\";";
    expect("consumer route re-grows body", runGate(f).code, 1);
  }
  // 6 — a surface stops rendering from the order data.
  {
    const f = clean();
    f.buyerPage = f.buyerPage.replace("profile.overview.map(", "HARDCODED_ORDER.map(");
    expect("buyer lost order data", runGate(f).code, 1);
  }
  // 7 — a section registry stops being total.
  {
    const f = clean();
    f.buyerPage = f.buyerPage.replace(
      "Record<VenueSectionId, VenueSectionRenderer>",
      "Partial<Record<VenueSectionId, unknown>>",
    );
    expect("buyer partial registry", runGate(f).code, 1);
  }
  // 7b — #1560: the consumer route stops mounting the shared screen (which is
  //      how it would grow a second implementation again).
  {
    const f = clean();
    f.consumerRoute = f.consumerRoute.replace("<PublicVenueScreen", "<MyOwnVenuePage");
    expect("consumer route dropped the shared mount", runGate(f).code, 1);
  }
  // 8 — a surface revives the RETIRED fourth reserve string.
  {
    const f = clean();
    f.consumerRoute += '\naccessibilityLabel="Find a table"';
    expect("consumer hardcoded copy", runGate(f).code, 1);
  }
  // 9 — the operator fall-through returns.
  {
    const f = clean();
    f.readiness += '\nconst venueCategory = venueCategoryProp ?? "restaurant";';
    expect("readiness null coercion", runGate(f).code, 1);
  }
  // 10 — VACUITY: a target file is missing. MUST be exit 2, never a pass.
  {
    const f = clean();
    f.buyerPage = null;
    expect("missing file", runGate(f).code, 2);
  }
  // 11 — VACUITY: a target file is comment-only (the #1518 shape).
  {
    const f = clean();
    f.readiness = "// everything real was deleted\n/* and this too */";
    expect("comment-only file", runGate(f).code, 2);
  }
  // 12 — VACUITY: the owner lost the strings the single-owner rule is about.
  {
    const f = clean();
    f.profile = f.profile.replace('"Reserve a table"', '"TBD"');
    expect("anchor lost", runGate(f).code, 2);
  }
  // 12b — the RETIRED consumer string is revived anywhere, profile included.
  {
    const f = clean();
    f.profile = f.profile.replace('"Reserve a table"', '"Reserve a table", legacy: "Find a table"');
    expect("retired string revived in owner", runGate(f).code, 1);
  }
  // 13 — a violation hidden in a COMMENT must NOT fail (comments are stripped).
  {
    const f = clean();
    f.buyerPage += '\n// this used to read `const isStay = venue.venueCategory === "stay"`';
    expect("comment-only violation", runGate(f).code, 0);
  }
  // 14 — reformatting must NOT disarm the gate (whitespace-insensitive).
  {
    const f = clean();
    f.buyerPage = f.buyerPage.replace(
      "Record<VenueSectionId, React.FC<VenueSectionProps>>",
      "Record<\n  VenueSectionId,\n  React.FC<VenueSectionProps>\n>",
    );
    expect("reformatted registry still detected", runGate(f).code, 0);
  }

  if (problems.length) {
    console.error("#1558 VENUE-CATEGORY-PROFILE-SINGLE-OWNER self-test FAIL:");
    problems.forEach((p) => console.error("  - " + p));
    process.exit(1);
  }
  console.log(
    "#1558 VENUE-CATEGORY-PROFILE-SINGLE-OWNER self-test PASS " +
      "(15/15: 1 clean, 2-9 planted violations, 10-12 vacuity, 12b retired-string revival, 13 comment-strip, 14 reformat).",
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Live mode
// ---------------------------------------------------------------------------
const raw = {};
for (const [key, rel] of Object.entries(PATHS)) {
  const abs = path.join(repoRoot, rel);
  raw[key] = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
}
const result = runGate(raw);
if (result.code === 0) {
  result.messages.forEach((m) => console.log(m));
} else {
  result.messages.forEach((m) => console.error(m));
}
process.exit(result.code);
