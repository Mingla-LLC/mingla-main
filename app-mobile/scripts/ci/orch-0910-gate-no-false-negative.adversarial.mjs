#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Issue #965 TESTER adversarial gate — NO-FALSE-NEGATIVE guard.
 *
 * DIFFERENT ANGLE from the implementor's happy-path
 * (orch-0910-gate-quote-agnostic-check.mjs), which only proves the broadened pin
 * MATCHES valid double-quoted source and that the OLD single-quote pin no longer
 * matches. That proves the gate did not turn into a false-POSITIVE (rejecting
 * valid reformatted code). It says NOTHING about whether the broadening hollowed
 * the gate into a false-NEGATIVE.
 *
 * This test attacks that gap: it proves check #4's HARDENED triplet STILL REJECTS
 * a genuine curated-image contract violation even when the discriminator is written
 * with valid DOUBLE quotes `"curated"` — so the quote/paren/whitespace broadening
 * cannot rescue a real regression.
 *
 * It reconstructs check #4's exact broadened triplet, verbatim, from
 *   .github/scripts/strict-grep/orch-0910-chat-payload-curated-aware.mjs
 * and asserts:
 *   - POSITIVE control: all three regexes MATCH the real current collabSaveCard.ts
 *     (anchors the test to reality; if the source drifts, this fails loudly).
 *   - NEGATIVE / adversarial: three in-memory fixtures, each using double-quoted
 *     "curated" but each violating the curated-image contract a different way, are
 *     EACH rejected (at least one triplet member must fail). A negative fixture that
 *     is wrongly ACCEPTED is the false-negative this guard exists to catch -> exit 1.
 *
 * Pure in-memory + one file read; it spawns NO subprocess, so there is no child
 * exit code for a nested NODE_TEST_CONTEXT to mask (#958). Run as a plain
 * `node script.mjs` (never under `node --test`).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

const read = (rel) => {
  try {
    return fs.readFileSync(path.join(repoRoot, rel), "utf8");
  } catch (error) {
    console.error(`Cannot read ${rel}: ${error.message}`);
    process.exit(2);
  }
};

// ── check #4's exact broadened triplet, copied verbatim from the wired gate ──
// (.github/scripts/strict-grep/orch-0910-chat-payload-curated-aware.mjs, the
//  "buildCardDataPayload synthesizes curated image and images from stops" check.)
const CURATED_DISCRIMINATOR = /c\.cardType === ['"]curated['"]/;
const IMAGE_FIND = /image: \(c\.stops as any\[\] \| undefined\)\?\.find/;
const IMAGES_SLICE =
  /images: \(c\.stops as any\[\] \| undefined\)[\s\S]+?\.slice\(0, 6\)/;

// The real gate ANDs the triplet — so does this reconstruction.
const check4Passes = (src) =>
  CURATED_DISCRIMINATOR.test(src) &&
  IMAGE_FIND.test(src) &&
  IMAGES_SLICE.test(src);

// ── POSITIVE control: the triplet must match the REAL current source ──────────
const collab = read("app-mobile/src/components/helpers/collabSaveCard.ts");

// ── NEGATIVE / adversarial fixtures ──────────────────────────────────────────
// All three use valid DOUBLE-quoted "curated" so the quote-broadening cannot be
// the thing that rescues them; the ONLY difference from valid source is a real
// contract violation. Each MUST be rejected by check4Passes().

// (a) curated branch present, but the top-level `image:` stops-synthesis line is
//     REMOVED (only the images[] array survives). Regresses single-image render.
const FIXTURE_A_NO_IMAGE_SYNTH = `
    ...(c.cardType === "curated"
      ? {
          cardType: c.cardType,
          stops: c.stops,
          images: (c.stops as any[] | undefined)
            ?.map((s) => s?.imageUrl)
            .filter(
              (url): url is string => typeof url === "string" && url.length > 0,
            )
            .slice(0, 6),
        }
      : {}),
`;

// (b) curated branch present, `image:` synthesized correctly, but `.slice(0, 6)`
//     is removed from `images` — the array-cap contract is broken.
const FIXTURE_B_NO_SLICE = `
    ...(c.cardType === "curated"
      ? {
          cardType: c.cardType,
          stops: c.stops,
          image: (c.stops as any[] | undefined)?.find?.(
            (s) => typeof s?.imageUrl === "string" && s.imageUrl.length > 0,
          )?.imageUrl,
          images: (c.stops as any[] | undefined)
            ?.map((s) => s?.imageUrl)
            .filter(
              (url): url is string => typeof url === "string" && url.length > 0,
            ),
        }
      : {}),
`;

// (c) the exact PRE-ORCH-0910 regression shape: the whole stops-synthesis is
//     replaced with the base card passthrough `image: card.image, images: card.images`.
//     This is the bug ORCH-0910 fixed; the gate must never accept it.
const FIXTURE_C_PRE_0910 = `
    ...(c.cardType === "curated"
      ? {
          cardType: c.cardType,
          stops: c.stops,
          image: card.image,
          images: card.images,
        }
      : {}),
`;

const results = [];
const record = (name, pass, detail) => results.push({ name, pass, detail });

// POSITIVE control — real source must satisfy all three triplet members.
record(
  "POSITIVE control: broadened triplet MATCHES real collabSaveCard.ts",
  check4Passes(collab) === true,
  "Real curated synthesis no longer matches check #4's triplet — test is not anchored to reality " +
    `(discriminator=${CURATED_DISCRIMINATOR.test(collab)}, imageFind=${IMAGE_FIND.test(
      collab,
    )}, imagesSlice=${IMAGES_SLICE.test(collab)}).`,
);

// NEGATIVE / adversarial — each double-quoted violation must be REJECTED.
// check4Passes === true on any of these is the false-negative we guard against.
const negatives = [
  [
    "NEGATIVE (a): missing top-level image stops-synthesis is REJECTED",
    FIXTURE_A_NO_IMAGE_SYNTH,
  ],
  ["NEGATIVE (b): missing .slice(0, 6) on images is REJECTED", FIXTURE_B_NO_SLICE],
  [
    "NEGATIVE (c): pre-ORCH-0910 card.image/card.images passthrough is REJECTED",
    FIXTURE_C_PRE_0910,
  ],
];

for (const [name, fixture] of negatives) {
  const accepted = check4Passes(fixture);
  record(
    name,
    accepted === false,
    "FALSE-NEGATIVE: hardened check #4 ACCEPTED a double-quoted contract violation. " +
      `The broadening hollowed the gate (discriminator=${CURATED_DISCRIMINATOR.test(
        fixture,
      )}, imageFind=${IMAGE_FIND.test(fixture)}, imagesSlice=${IMAGES_SLICE.test(
        fixture,
      )}).`,
  );
}

console.log("\n[#965 tester adversarial — no-false-negative guard]");
let ok = true;
for (const r of results) {
  console.log(`${r.pass ? "PASS" : "FAIL"} ${r.name}`);
  if (!r.pass) {
    ok = false;
    console.log(`  ${r.detail}`);
  }
}

if (!ok) {
  console.error(
    "\n#965 no-false-negative guard FAILED — broadened check #4 is hollow (accepts a real violation).",
  );
  process.exit(1);
}
console.log(
  "\n#965 no-false-negative guard PASS — hardened check #4 still rejects double-quoted contract violations.",
);
