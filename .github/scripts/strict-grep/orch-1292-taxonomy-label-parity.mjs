#!/usr/bin/env node
/**
 * ORCH-1292 [public-page-tag-slug-labels] — I-PROPOSED-1292-TAXONOMY-LABEL-AT-RENDER.
 *
 * Two jobs in one gate (this is the ONLY CI that runs on packages/** PRs, so it is
 * BOTH the drift guard AND the CI-enforced fails-on-revert regression guard):
 *
 *   (A) DRIFT — the in-package label map
 *         packages/offering-rendering/taxonomyLabels.ts :: TAXONOMY_LABELS
 *       must stay in SET-EQUALITY + BYTE-EXACT label-parity with the canonical
 *       party/vibe/music labels in the source of truth
 *         supabase/functions/_shared/eventTaxonomy.ts
 *       (PARTY_TYPES + VIBE_TAGS + MUSIC_GENRES `{ slug, label }`). A renamed,
 *       dropped, or added slug on either side fails CI. (This is the ORCH-0824-
 *       style parity extension — semantic, not byte-equal, since the package file
 *       is structured differently from the three canonical copies.)
 *
 *   (B) RENDER SITES — the three shared public-page render sites must RESOLVE
 *       slugs to labels, never render the raw slug:
 *         - EventOfferingBody.tsx  pills call taxonomyLabel(tag), not raw {tag}
 *         - RsvpOfferingBody.tsx   pills call taxonomyLabel(tag), not raw {tag}
 *         - RsvpMomentumDecision.tsx chip calls taxonomyLabel(slug), not the
 *           humanized partyTypeLabel(slug)
 *       (Comment-stripped matching, so a doc comment can never false-pass/fail.)
 *
 * --self-test synthesizes a GOOD fixture (must pass) plus BAD fixtures (a dropped
 * canonical label; a renamed label; an extra non-canonical key; a render site
 * reverted to raw {tag}; the momentum chip reverted to partyTypeLabel) that MUST
 * fail. The self-test gates the real run in CI (self-test step runs first).
 *
 * Runs from repo root (process.cwd()), like the sibling gates.
 * Exit codes: 0 clean · 1 violation · 2 script/parse error.
 *
 * Cross-reference: Mingla_Artifacts/reports/INVESTIGATION_SPEC_ORCH-1292_PUBLIC_PAGE_TAG_SLUG_LABELS.md §7.5
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = process.cwd();

const CANONICAL = "supabase/functions/_shared/eventTaxonomy.ts";
const LABELS = "packages/offering-rendering/taxonomyLabels.ts";
const EVENT_BODY = "packages/offering-rendering/EventOfferingBody.tsx";
const RSVP_BODY = "packages/offering-rendering/RsvpOfferingBody.tsx";
const MOMENTUM = "packages/offering-rendering/RsvpMomentumDecision.tsx";

// ───────────────────────── pure helpers (self-testable) ─────────────────────────

/** Strip /* *​/ block comments, // line comments, and {/* *​/} JSX comments.
 *  Preserves the char before // (so URLs like http:// survive) — mirrors the
 *  proven orch_1157 test stripper. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** Parse `{ slug: "x", label: "y" }` pairs from the canonical option arrays.
 *  slug always immediately precedes label in every entry; the trailing emoji /
 *  tmSlug fields are ignored. */
function parseCanonicalPairs(src) {
  const clean = stripComments(src);
  const pairs = [];
  const re = /slug:\s*"([^"]+)"\s*,\s*label:\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(clean)) !== null) {
    pairs.push({ slug: m[1], label: m[2] });
  }
  return pairs;
}

/** Parse the TAXONOMY_LABELS object literal → Map<slug,label>. Bounds the parse
 *  to the object body (first balanced { … } after the identifier) so the
 *  taxonomyLabel() function body below it is never scanned. */
function parseTaxonomyLabels(src) {
  const clean = stripComments(src);
  const idStart = clean.indexOf("TAXONOMY_LABELS");
  if (idStart === -1) return null;
  const open = clean.indexOf("{", idStart);
  if (open === -1) return null;
  let depth = 0;
  let end = -1;
  for (let i = open; i < clean.length; i++) {
    const ch = clean[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return null;
  const body = clean.slice(open + 1, end);
  const map = new Map();
  const re = /"([^"]+)"\s*:\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    map.set(m[1], m[2]);
  }
  return map;
}

/** (A) drift: set-equality + byte-exact label parity between canonical + map. */
function checkDrift(canonicalPairs, labelMap) {
  const failures = [];
  // canonical slugs must be unique (a cross-taxonomy collision makes a flat map unsafe).
  const seen = new Set();
  for (const { slug } of canonicalPairs) {
    if (seen.has(slug)) {
      failures.push(
        `canonical duplicate slug "${slug}" — cross-taxonomy collision; a flat TAXONOMY_LABELS map is unsafe.`,
      );
    }
    seen.add(slug);
  }
  // every canonical pair present + byte-exact in the map.
  for (const { slug, label } of canonicalPairs) {
    if (!labelMap.has(slug)) {
      failures.push(
        `TAXONOMY_LABELS is MISSING canonical slug "${slug}" (expected label "${label}").`,
      );
    } else if (labelMap.get(slug) !== label) {
      failures.push(
        `label DRIFT for "${slug}": canonical "${label}" ≠ TAXONOMY_LABELS "${labelMap.get(slug)}".`,
      );
    }
  }
  // set-equality: no extra (non-canonical) keys in the map.
  const canonicalSlugs = new Set(canonicalPairs.map((p) => p.slug));
  for (const slug of labelMap.keys()) {
    if (!canonicalSlugs.has(slug)) {
      failures.push(
        `TAXONOMY_LABELS has EXTRA non-canonical slug "${slug}" — set-equality with eventTaxonomy.ts broken.`,
      );
    }
  }
  return failures;
}

/** (B) render sites resolve, not raw (fails-on-revert). */
function checkRenderSites(eventSrc, rsvpSrc, momentumSrc) {
  const failures = [];
  const ev = stripComments(eventSrc);
  const rv = stripComments(rsvpSrc);
  const mo = stripComments(momentumSrc);
  const rawTag = />\s*\{tag\}\s*</; // a Pill child that is exactly the raw slug {tag}
  for (const [label, src] of [
    ["EventOfferingBody.tsx", ev],
    ["RsvpOfferingBody.tsx", rv],
  ]) {
    if (!src.includes("taxonomyLabel(tag)")) {
      failures.push(
        `${label}: pills row does not call taxonomyLabel(tag) — party/vibe/music labels are NOT resolved.`,
      );
    }
    if (rawTag.test(src)) {
      failures.push(
        `${label}: pills row still renders the RAW slug {tag} — reverted to unmapped kebab-case.`,
      );
    }
  }
  if (!mo.includes("taxonomyLabel(slug)")) {
    failures.push(
      "RsvpMomentumDecision.tsx: chip does not call taxonomyLabel(slug) — canonical label not applied.",
    );
  }
  if (mo.includes("partyTypeLabel(slug)")) {
    failures.push(
      "RsvpMomentumDecision.tsx: chip still calls the humanized partyTypeLabel(slug) — reverted (not canonical).",
    );
  }
  return failures;
}

// ─────────────────────────────── self-test ───────────────────────────────

const ST_CANON_GOOD = `
export const PARTY_TYPES = [
  { slug: "pool-party", label: "Pool Party" },
  { slug: "rave",       label: "Rave" },
] as const;
export const VIBE_TAGS = [
  { slug: "laid-back",  label: "Laid-back", emoji: "🌴" },
] as const;
export const MUSIC_GENRES = [
  { slug: "hiphop-rap", label: "Hip-Hop/Rap", tmSlug: "hiphop-rap" },
] as const;
`;

const ST_LABELS_GOOD = `
export const TAXONOMY_LABELS = {
  // a comment "with": "quotes" must not be parsed as a pair
  "pool-party": "Pool Party",
  "rave": "Rave",
  "laid-back": "Laid-back",
  "hiphop-rap": "Hip-Hop/Rap",
};
export const taxonomyLabel = (slug) => TAXONOMY_LABELS[slug] ?? slug.split("-").join(" ");
`;

const ST_LABELS_DROP = `
export const TAXONOMY_LABELS = {
  "pool-party": "Pool Party",
  "laid-back": "Laid-back",
  "hiphop-rap": "Hip-Hop/Rap",
};
`; // "rave" dropped

const ST_LABELS_RENAME = `
export const TAXONOMY_LABELS = {
  "pool-party": "Pool Bash",
  "rave": "Rave",
  "laid-back": "Laid-back",
  "hiphop-rap": "Hip-Hop/Rap",
};
`; // "pool-party" label renamed

const ST_LABELS_EXTRA = `
export const TAXONOMY_LABELS = {
  "pool-party": "Pool Party",
  "rave": "Rave",
  "laid-back": "Laid-back",
  "hiphop-rap": "Hip-Hop/Rap",
  "made-up-slug": "Made Up Slug",
};
`; // extra non-canonical key

const ST_EVENT_GOOD = `
        {vibeTags.map((tag, i) => (
          <Pill key={\`vibe-\${i}\`} palette={palette} surface={surface} font={boldFamily}>
            {taxonomyLabel(tag)}
          </Pill>
        ))}
`;
const ST_EVENT_RAW = `
        {vibeTags.map((tag, i) => (
          <Pill key={\`vibe-\${i}\`} palette={palette} surface={surface} font={boldFamily}>
            {tag}
          </Pill>
        ))}
`;
const ST_RSVP_GOOD = `
        {vibeTags.map((tag, i) => (
          <Pill key={\`vibe-\${i}\`} palette={palette} font={boldFamily}>{taxonomyLabel(tag)}</Pill>
        ))}
`;
const ST_RSVP_RAW = `
        {vibeTags.map((tag, i) => (
          <Pill key={\`vibe-\${i}\`} palette={palette} font={boldFamily}>{tag}</Pill>
        ))}
`;
const ST_MOMENTUM_GOOD = `
            <Text style={[styles.chipText]}>
              {taxonomyLabel(slug)}
            </Text>
`;
const ST_MOMENTUM_RAW = `
            <Text style={[styles.chipText]}>
              {partyTypeLabel(slug)}
            </Text>
`;

function runSelfTest() {
  const problems = [];

  // GOOD parses to the expected shapes.
  const cg = parseCanonicalPairs(ST_CANON_GOOD);
  const lg = parseTaxonomyLabels(ST_LABELS_GOOD);
  if (cg.length !== 4) {
    problems.push(`GOOD canonical parse expected 4 pairs, got ${cg.length}.`);
  }
  if (!lg || lg.size !== 4) {
    problems.push(`GOOD label parse expected 4 entries, got ${lg ? lg.size : "null"}.`);
  }

  // GOOD must PASS both checks.
  const goodDrift = checkDrift(cg, lg ?? new Map());
  if (goodDrift.length !== 0) {
    problems.push(`GOOD drift wrongly failed: ${goodDrift.join(" | ")}`);
  }
  const goodRender = checkRenderSites(ST_EVENT_GOOD, ST_RSVP_GOOD, ST_MOMENTUM_GOOD);
  if (goodRender.length !== 0) {
    problems.push(`GOOD render wrongly failed: ${goodRender.join(" | ")}`);
  }

  // BAD fixtures must FAIL.
  if (checkDrift(cg, parseTaxonomyLabels(ST_LABELS_DROP) ?? new Map()).length === 0) {
    problems.push("BAD (dropped canonical label) did not fail the drift check.");
  }
  if (checkDrift(cg, parseTaxonomyLabels(ST_LABELS_RENAME) ?? new Map()).length === 0) {
    problems.push("BAD (renamed canonical label) did not fail the drift check.");
  }
  if (checkDrift(cg, parseTaxonomyLabels(ST_LABELS_EXTRA) ?? new Map()).length === 0) {
    problems.push("BAD (extra non-canonical key) did not fail the drift check.");
  }
  if (checkRenderSites(ST_EVENT_RAW, ST_RSVP_GOOD, ST_MOMENTUM_GOOD).length === 0) {
    problems.push("BAD (EventOfferingBody reverted to raw {tag}) did not fail the render check.");
  }
  if (checkRenderSites(ST_EVENT_GOOD, ST_RSVP_RAW, ST_MOMENTUM_GOOD).length === 0) {
    problems.push("BAD (RsvpOfferingBody reverted to raw {tag}) did not fail the render check.");
  }
  if (checkRenderSites(ST_EVENT_GOOD, ST_RSVP_GOOD, ST_MOMENTUM_RAW).length === 0) {
    problems.push("BAD (RsvpMomentumDecision reverted to partyTypeLabel) did not fail the render check.");
  }

  if (problems.length > 0) {
    console.error("\nORCH-1292 taxonomy-label-parity gate SELF-TEST FAIL:\n");
    for (const p of problems) console.error(`  ✗ ${p}`);
    process.exit(1);
  }
  console.log("ORCH-1292 taxonomy-label-parity gate SELF-TEST PASS.");
  process.exit(0);
}

// ─────────────────────────────── real run ───────────────────────────────

function readOrDie(rel) {
  const p = join(REPO_ROOT, rel);
  if (!existsSync(p)) {
    console.error(`[ORCH-1292 TAXONOMY-LABEL-PARITY] missing file: ${rel}`);
    process.exit(2);
  }
  return readFileSync(p, "utf8");
}

function runReal() {
  const canonical = parseCanonicalPairs(readOrDie(CANONICAL));
  const labelMap = parseTaxonomyLabels(readOrDie(LABELS));
  const failures = [];

  if (canonical.length === 0) {
    console.error(
      `[ORCH-1292 TAXONOMY-LABEL-PARITY] parse error: no { slug, label } pairs found in ${CANONICAL}.`,
    );
    process.exit(2);
  }
  if (!labelMap) {
    console.error(
      `[ORCH-1292 TAXONOMY-LABEL-PARITY] parse error: could not read TAXONOMY_LABELS object from ${LABELS}.`,
    );
    process.exit(2);
  }

  failures.push(...checkDrift(canonical, labelMap));
  failures.push(
    ...checkRenderSites(
      readOrDie(EVENT_BODY),
      readOrDie(RSVP_BODY),
      readOrDie(MOMENTUM),
    ),
  );

  if (failures.length > 0) {
    console.error("\nORCH-1292 taxonomy-label-parity gate FAILED:\n");
    for (const f of failures) console.error(`  ✗ ${f}`);
    console.error(
      "\nFix: keep packages/offering-rendering/taxonomyLabels.ts::TAXONOMY_LABELS " +
        "in set-equality + byte-exact label-parity with the PARTY_TYPES/VIBE_TAGS/" +
        "MUSIC_GENRES labels in supabase/functions/_shared/eventTaxonomy.ts, and keep " +
        "all three render sites resolving via taxonomyLabel(...).",
    );
    process.exit(1);
  }

  console.log(
    `ORCH-1292 taxonomy-label-parity: clean — ${canonical.length} canonical labels in ` +
      "set-equality + parity with TAXONOMY_LABELS; all 3 render sites resolve via taxonomyLabel.",
  );
  process.exit(0);
}

if (process.argv.includes("--self-test")) {
  runSelfTest();
} else {
  runReal();
}
