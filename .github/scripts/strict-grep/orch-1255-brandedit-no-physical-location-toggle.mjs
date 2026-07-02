#!/usr/bin/env node
/**
 * META-ORCH-1255 Leg B — BrandEditView physical-location toggle removal guard
 * (SPEC §9 Leg B fails-on-revert: "re-adding the toggle block fails T-B7 +
 * the strict-grep BrandEditView rule").
 *
 * Venue creation lives in the UniversalCreatorSheet's 4th root option; the
 * brand-edit page carries NO physical-location toggle, NO "Add your venue"
 * CTA, and NO `has_physical_location` WRITE path. Fails if:
 *   (a) mingla-business/src/components/brand/BrandEditView.tsx references
 *       hasPhysicalLocation / handleClaimVenue / the "PHYSICAL LOCATION"
 *       section label (comments stripped first);
 *   (b) mingla-business/src/utils/brandPatch.ts diffs hasPhysicalLocation
 *       into the patch;
 *   (c) mingla-business/src/services/brandMapping.ts maps
 *       patch.hasPhysicalLocation → has_physical_location (WRITE mapping;
 *       the row→UI READ mapping is allowed — the column is legacy-inert).
 *
 * Mirrors the modular self-testing gate pattern
 * (sibling: orch-1255-no-hidden-brand-on-venue-create.mjs).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? join(process.cwd(), "..")
  : process.cwd();

const SELF_TEST = process.argv.includes("--self-test");

const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const run = (files) => {
  // files: [{ name, code }] — code null = missing file.
  const failures = [];
  const edit = files.find((f) => f.name.endsWith("BrandEditView.tsx"));
  if (edit) {
    if (edit.code === null) {
      failures.push(`${edit.name}: file missing`);
    } else {
      const code = stripComments(edit.code);
      for (const banned of [
        "hasPhysicalLocation",
        "handleClaimVenue",
        "PHYSICAL LOCATION",
      ]) {
        if (code.includes(banned)) {
          failures.push(
            `${edit.name}: contains "${banned}" — the physical-location toggle was removed (META-ORCH-1255 D-5); venue creation lives in the creator sheet.`,
          );
        }
      }
    }
  }
  const patch = files.find((f) => f.name.endsWith("brandPatch.ts"));
  if (patch && patch.code !== null) {
    if (stripComments(patch.code).includes("hasPhysicalLocation")) {
      failures.push(
        `${patch.name}: diffs hasPhysicalLocation into the brand patch — the write path is decommissioned (META-ORCH-1255).`,
      );
    }
  }
  const mapping = files.find((f) => f.name.endsWith("brandMapping.ts"));
  if (mapping && mapping.code !== null) {
    if (
      /patch\.hasPhysicalLocation|out\.has_physical_location\s*=/.test(
        stripComments(mapping.code),
      )
    ) {
      failures.push(
        `${mapping.name}: writes has_physical_location — the write mapping is decommissioned (META-ORCH-1255; the read mapping is allowed).`,
      );
    }
  }
  return failures;
};

if (SELF_TEST) {
  const clean = [
    {
      name: "mingla-business/src/components/brand/BrandEditView.tsx",
      code: 'const toggleValue = draft.displayAttendeeCount ?? true;\n// prose\n',
    },
    {
      name: "mingla-business/src/utils/brandPatch.ts",
      code: "if (draft.coverMediaUrl !== original.coverMediaUrl) { patch.coverMediaUrl = draft.coverMediaUrl; }",
    },
    {
      name: "mingla-business/src/services/brandMapping.ts",
      code: "hasPhysicalLocation: row.has_physical_location === true,",
    },
  ];
  if (run(clean).length !== 0) {
    console.error("SELF-TEST FAIL: clean fixtures should pass:", run(clean));
    process.exit(1);
  }
  const badToggle = [
    {
      name: "mingla-business/src/components/brand/BrandEditView.tsx",
      code: "value={draft.hasPhysicalLocation === true}",
    },
  ];
  if (run(badToggle).length === 0) {
    console.error("SELF-TEST FAIL: toggle re-add should fail");
    process.exit(1);
  }
  const badPatch = [
    {
      name: "mingla-business/src/utils/brandPatch.ts",
      code: "if (draft.hasPhysicalLocation !== original.hasPhysicalLocation) { patch.hasPhysicalLocation = draft.hasPhysicalLocation; }",
    },
  ];
  if (run(badPatch).length === 0) {
    console.error("SELF-TEST FAIL: patch write re-add should fail");
    process.exit(1);
  }
  const badMapping = [
    {
      name: "mingla-business/src/services/brandMapping.ts",
      code: "if (patch.hasPhysicalLocation !== undefined) { out.has_physical_location = patch.hasPhysicalLocation; }",
    },
  ];
  if (run(badMapping).length === 0) {
    console.error("SELF-TEST FAIL: mapping write re-add should fail");
    process.exit(1);
  }
  console.log(
    "ORCH-1255 brandedit-no-physical-location-toggle gate self-test passed.",
  );
  process.exit(0);
}

const FILES = [
  "mingla-business/src/components/brand/BrandEditView.tsx",
  "mingla-business/src/utils/brandPatch.ts",
  "mingla-business/src/services/brandMapping.ts",
];
const files = FILES.map((rel) => {
  const p = join(root, rel);
  return { name: rel, code: existsSync(p) ? readFileSync(p, "utf8") : null };
});
const failures = run(files);
if (failures.length > 0) {
  console.error("ORCH-1255 brandedit-no-physical-location-toggle gate failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("ORCH-1255 brandedit-no-physical-location-toggle gate passed.");
