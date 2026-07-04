#!/usr/bin/env node
/**
 * ORCH-1292 [public-page-tag-slug-labels] — TESTER ADVERSARIAL sibling gate.
 *
 * This is the mingla-tester's independent, DIFFERENT-ANGLE regression guard. It
 * does NOT duplicate the implementor gate (orch-1292-taxonomy-label-parity.mjs),
 * which uses FILE-WIDE `src.includes("taxonomyLabel(tag)")` + a `>{tag}<`
 * negative. That naive approach false-PASSES on two real regressions this gate is
 * built to catch:
 *
 *   (E) WRONG-VARIABLE / OUT-OF-SCOPE resolve — a pill that renders
 *       `{taxonomyLabel(i)}` (the map index) or resolves the wrong var, while a
 *       correct `taxonomyLabel(tag)` still exists ELSEWHERE in the file. The
 *       implementor gate's file-wide includes() stays green; its `>{tag}<`
 *       negative never fires (there is no raw {tag}). This gate binds the check to
 *       EACH taxonomy `.map(...)` body and fails it.
 *
 *   (B) NON-BYTE-EXACT DRIFT the implementor's single "Pool Bash" rename fixture
 *       never exercises: a TRUNCATED/substring label ("Pool Part"), a
 *       TRAILING-WHITESPACE label ("Pool Party "), and a CASE-FLIPPED label
 *       ("pool party"). All must fail byte-exact parity.
 *
 *   (C) TITLE-CASE-FALLBACK MASKING — a canonical slug dropped from the map whose
 *       Title-Case fallback happens to EQUAL its canonical label (e.g.
 *       "rooftop-party" → fallback "Rooftop Party" == canonical). Runtime would
 *       still look correct via the fallback, so a weaker gate could be tempted to
 *       allow it; set-equality MUST still fail on the missing key.
 *
 * Scope-bound render check: for each of vibeTags/partyTypes/musicGenres in the two
 * bodies, the pill child inside THAT `.map((tag …)` must be `taxonomyLabel(tag)` —
 * not the raw {tag}, not the wrong variable; and for RsvpMomentumDecision the chip
 * inside `partyTypes.map((slug)` must be `taxonomyLabel(slug)`, not
 * `partyTypeLabel(slug)`, not raw {slug}.
 *
 * --self-test synthesizes GOOD (must pass) + BAD fixtures (must fail), including a
 * fixture that the implementor gate would WRONGLY pass (WRONG_VAR) — asserted here.
 * Runs from repo root. Exit: 0 clean · 1 violation · 2 parse/script error.
 *
 * Append-only sibling to the implementor gate. Cross-ref: SPEC §7.5/§7.6b.
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

/** Strip block, line, and JSX comments; preserve the char before // (URLs). */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** Canonical { slug, label } pairs from the option arrays (emoji/tmSlug ignored). */
function parseCanonicalPairs(src) {
  const clean = stripComments(src);
  const pairs = [];
  const re = /slug:\s*"([^"]+)"\s*,\s*label:\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(clean)) !== null) pairs.push({ slug: m[1], label: m[2] });
  return pairs;
}

/** TAXONOMY_LABELS object literal → Map<slug,label>, bounded to the object body. */
function parseTaxonomyLabels(src) {
  const clean = stripComments(src);
  const idStart = clean.indexOf("TAXONOMY_LABELS");
  if (idStart === -1) return null;
  const open = clean.indexOf("{", idStart);
  if (open === -1) return null;
  let depth = 0, end = -1;
  for (let i = open; i < clean.length; i++) {
    const ch = clean[i];
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) return null;
  const body = clean.slice(open + 1, end);
  const map = new Map();
  const re = /"([^"]+)"\s*:\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(body)) !== null) map.set(m[1], m[2]);
  return map;
}

/** Title-Case fallback — MUST mirror taxonomyLabel's fallback exactly (angle C). */
function titleCaseFallback(slug) {
  return slug
    .split("-")
    .filter((w) => w.length > 0)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** (B/C) STRICT byte-exact drift: whitespace/case/substring sensitive + set-equality. */
function checkStrictDrift(canonicalPairs, labelMap) {
  const failures = [];
  const seen = new Set();
  for (const { slug } of canonicalPairs) {
    if (seen.has(slug)) failures.push(`canonical duplicate slug "${slug}" — flat map unsafe.`);
    seen.add(slug);
  }
  for (const { slug, label } of canonicalPairs) {
    if (!labelMap.has(slug)) {
      // (C) explicit: a drop is a failure even if the Title-Case fallback would mask it.
      const masks = titleCaseFallback(slug) === label ? " (fallback would MASK this at runtime — still a drift)" : "";
      failures.push(`TAXONOMY_LABELS is MISSING canonical slug "${slug}" (want "${label}")${masks}.`);
    } else {
      const got = labelMap.get(slug);
      // (B) byte-exact: reject substring, trailing/leading whitespace, case flips.
      if (got !== label) {
        failures.push(`label DRIFT for "${slug}": canonical "${label}" ≠ map "${got}".`);
      } else if (/^\s|\s$/.test(got)) {
        failures.push(`label for "${slug}" has leading/trailing whitespace: "${got}".`);
      }
    }
  }
  const canonicalSlugs = new Set(canonicalPairs.map((p) => p.slug));
  for (const slug of labelMap.keys()) {
    if (!canonicalSlugs.has(slug)) {
      failures.push(`TAXONOMY_LABELS has EXTRA non-canonical slug "${slug}" — set-equality broken.`);
    }
  }
  return failures;
}

/** Extract the pill child of a specific taxonomy `.map` — scope-bound (angle E). */
function pillChildForMap(cleanSrc, arrayName, mapVar, closeTag) {
  // From `<arrayName>.map((<mapVar>` to the FIRST closeTag after it.
  const re = new RegExp(
    `${arrayName}\\.map\\(\\(${mapVar}[^)]*\\)\\s*=>[\\s\\S]{0,600}?<\\/${closeTag}>`,
  );
  const m = re.exec(cleanSrc);
  return m ? m[0] : null;
}

/** (E) scope-bound render check on the two bodies + momentum. */
function checkScopedRenderSites(eventSrc, rsvpSrc, momentumSrc) {
  const failures = [];
  const bodies = [
    ["EventOfferingBody.tsx", stripComments(eventSrc)],
    ["RsvpOfferingBody.tsx", stripComments(rsvpSrc)],
  ];
  for (const [name, clean] of bodies) {
    for (const arr of ["vibeTags", "partyTypes", "musicGenres"]) {
      const seg = pillChildForMap(clean, arr, "tag", "Pill");
      if (seg === null) {
        failures.push(`${name}: could not locate the ${arr}.map((tag …) <Pill> segment.`);
        continue;
      }
      if (!seg.includes("taxonomyLabel(tag)")) {
        failures.push(
          `${name}: ${arr} pill does NOT resolve via taxonomyLabel(tag) inside its own .map (wrong var / raw / out-of-scope).`,
        );
      }
      if (/>\s*\{tag\}\s*</.test(seg)) {
        failures.push(`${name}: ${arr} pill renders the RAW slug {tag}.`);
      }
    }
  }
  const mo = stripComments(momentumSrc);
  const chip = pillChildForMap(mo, "partyTypes", "slug", "Text");
  if (chip === null) {
    failures.push("RsvpMomentumDecision.tsx: could not locate the partyTypes.map((slug) <Text> chip segment.");
  } else {
    if (!chip.includes("taxonomyLabel(slug)")) {
      failures.push("RsvpMomentumDecision.tsx: chip does NOT resolve via taxonomyLabel(slug) inside its own .map.");
    }
    if (chip.includes("partyTypeLabel(slug)")) {
      failures.push("RsvpMomentumDecision.tsx: chip still calls the humanized partyTypeLabel(slug).");
    }
    if (/>\s*\{slug\}\s*</.test(chip)) {
      failures.push("RsvpMomentumDecision.tsx: chip renders the RAW slug {slug}.");
    }
  }
  return failures;
}

// ─────────────────────────────── self-test ───────────────────────────────

const ST_CANON = `
export const PARTY_TYPES = [
  { slug: "pool-party",    label: "Pool Party" },
  { slug: "rooftop-party", label: "Rooftop Party" },
] as const;
export const VIBE_TAGS = [
  { slug: "laid-back", label: "Laid-back", emoji: "🌴" },
] as const;
export const MUSIC_GENRES = [
  { slug: "hiphop-rap", label: "Hip-Hop/Rap", tmSlug: "hiphop-rap" },
] as const;
`;
const goodMap = `export const TAXONOMY_LABELS = {
  "pool-party": "Pool Party",
  "rooftop-party": "Rooftop Party",
  "laid-back": "Laid-back",
  "hiphop-rap": "Hip-Hop/Rap",
};`;
const ST_LABELS_GOOD = goodMap;
const ST_LABELS_SUBSTRING = goodMap.replace('"Pool Party"', '"Pool Part"');       // (B) truncation
const ST_LABELS_TRAILWS = goodMap.replace('"Pool Party"', '"Pool Party "');       // (B) trailing space
const ST_LABELS_CASE = goodMap.replace('"Pool Party"', '"pool party"');           // (B) case flip
const ST_LABELS_MASKDROP = goodMap.replace('  "rooftop-party": "Rooftop Party",\n', ""); // (C) fallback-masking drop

// GOOD bodies (each taxonomy map resolves its own var).
const evGood = `
  <View testID="orch-1167-pills-row">
    {vibeTags.map((tag, i) => (<Pill key={\`vibe-\${i}\`}>{taxonomyLabel(tag)}</Pill>))}
    {partyTypes.map((tag, i) => (<Pill key={\`party-\${i}\`}>{taxonomyLabel(tag)}</Pill>))}
    {musicGenres.map((tag, i) => (<Pill key={\`music-\${i}\`}>{taxonomyLabel(tag)}</Pill>))}
  </View>`;
const rvGood = evGood;
const moGood = `
  <View testID="orch-1157-rsvp-chips">
    {partyTypes.map((slug) => (<View key={slug}><Text>{taxonomyLabel(slug)}</Text></View>))}
  </View>`;

// (E) WRONG_VAR: vibe pill resolves the INDEX i, not tag — but a correct
// taxonomyLabel(tag) still exists in party/music, so the implementor gate's
// file-wide includes() PASSES and its >{tag}< negative never fires.
const evWrongVar = `
  <View testID="orch-1167-pills-row">
    {vibeTags.map((tag, i) => (<Pill key={\`vibe-\${i}\`}>{taxonomyLabel(i)}</Pill>))}
    {partyTypes.map((tag, i) => (<Pill key={\`party-\${i}\`}>{taxonomyLabel(tag)}</Pill>))}
    {musicGenres.map((tag, i) => (<Pill key={\`music-\${i}\`}>{taxonomyLabel(tag)}</Pill>))}
  </View>`;

/** the implementor gate's exact render logic, for the superiority assertion. */
function implementorGatePassesRender(src) {
  const s = stripComments(src);
  const includes = s.includes("taxonomyLabel(tag)");
  const rawNeg = />\s*\{tag\}\s*</.test(s);
  return includes && !rawNeg; // implementor gate would report PASS for this body
}

function runSelfTest() {
  const problems = [];
  const canon = parseCanonicalPairs(ST_CANON);
  if (canon.length !== 4) problems.push(`self-test canonical parse expected 4, got ${canon.length}.`);

  // GOOD passes both checks.
  if (checkStrictDrift(canon, parseTaxonomyLabels(ST_LABELS_GOOD) ?? new Map()).length !== 0) {
    problems.push("GOOD drift wrongly failed.");
  }
  if (checkScopedRenderSites(evGood, rvGood, moGood).length !== 0) {
    problems.push("GOOD scoped render wrongly failed.");
  }

  // (B) byte-exact BADs must fail.
  if (checkStrictDrift(canon, parseTaxonomyLabels(ST_LABELS_SUBSTRING) ?? new Map()).length === 0) {
    problems.push("BAD (substring/truncated label) did not fail strict drift.");
  }
  if (checkStrictDrift(canon, parseTaxonomyLabels(ST_LABELS_TRAILWS) ?? new Map()).length === 0) {
    problems.push("BAD (trailing-whitespace label) did not fail strict drift.");
  }
  if (checkStrictDrift(canon, parseTaxonomyLabels(ST_LABELS_CASE) ?? new Map()).length === 0) {
    problems.push("BAD (case-flipped label) did not fail strict drift.");
  }
  // (C) fallback-masking drop must fail — AND be flagged as fallback-masking.
  {
    const fails = checkStrictDrift(canon, parseTaxonomyLabels(ST_LABELS_MASKDROP) ?? new Map());
    if (fails.length === 0) problems.push("BAD (fallback-masking drop) did not fail strict drift.");
    else if (!fails.some((f) => f.includes("fallback would MASK"))) {
      problems.push("BAD (fallback-masking drop) failed but was not flagged as fallback-masking.");
    }
  }

  // (E) WRONG_VAR must fail THIS gate…
  if (checkScopedRenderSites(evWrongVar, rvGood, moGood).length === 0) {
    problems.push("BAD (wrong-variable resolve taxonomyLabel(i)) did not fail the scoped render check.");
  }
  // …and the whole point: the implementor gate would have WRONGLY passed it.
  if (!implementorGatePassesRender(evWrongVar)) {
    problems.push("self-test assumption broken: implementor gate did NOT pass WRONG_VAR (angle no longer distinct).");
  }

  if (problems.length > 0) {
    console.error("\nORCH-1292 taxonomy-label ADVERSARIAL gate SELF-TEST FAIL:\n");
    for (const p of problems) console.error(`  ✗ ${p}`);
    process.exit(1);
  }
  console.log("ORCH-1292 taxonomy-label ADVERSARIAL gate SELF-TEST PASS (scope-bound render + strict byte-exact drift; WRONG_VAR caught here, passes implementor gate).");
  process.exit(0);
}

// ─────────────────────────────── real run ───────────────────────────────

function readOrDie(rel) {
  const p = join(REPO_ROOT, rel);
  if (!existsSync(p)) {
    console.error(`[ORCH-1292 ADVERSARIAL] missing file: ${rel}`);
    process.exit(2);
  }
  return readFileSync(p, "utf8");
}

function runReal() {
  const canonical = parseCanonicalPairs(readOrDie(CANONICAL));
  const labelMap = parseTaxonomyLabels(readOrDie(LABELS));
  if (canonical.length === 0) { console.error(`[ORCH-1292 ADVERSARIAL] parse error: no canonical pairs in ${CANONICAL}.`); process.exit(2); }
  if (!labelMap) { console.error(`[ORCH-1292 ADVERSARIAL] parse error: no TAXONOMY_LABELS in ${LABELS}.`); process.exit(2); }

  const failures = [
    ...checkStrictDrift(canonical, labelMap),
    ...checkScopedRenderSites(readOrDie(EVENT_BODY), readOrDie(RSVP_BODY), readOrDie(MOMENTUM)),
  ];

  if (failures.length > 0) {
    console.error("\nORCH-1292 taxonomy-label ADVERSARIAL gate FAILED:\n");
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log(
    `ORCH-1292 adversarial: clean — ${canonical.length} canonical labels byte-exact (whitespace/case/set-equality strict); ` +
      "every taxonomy .map resolves its own var via taxonomyLabel (scope-bound; no wrong-var/raw).",
  );
  process.exit(0);
}

if (process.argv.includes("--self-test")) runSelfTest();
else runReal();
