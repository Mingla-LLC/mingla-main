#!/usr/bin/env node
/**
 * ORCH-1138 Leg 3 REWORK (§9) — I-MOR-0827 PACKAGE-ISOLATION gate.
 *
 * The consumer experience surface (the detail screen, the open-daily reserve
 * picker, the ported static-map util, and the seed mappers) MUST import nothing
 * from `mingla-business/src`. The web picker, the web CountAwareGallery, and the
 * web mapboxStaticImage are business-local; the consumer reuses app-mobile/
 * packages ports instead. A cross-package import re-couples the two apps and
 * breaks the consumer build (the exact trap the prior pass avoided by leaving
 * the open-daily flow OFF the consumer — this rework ports it correctly).
 *
 * FAILS-ON-REVERT: add a `from "mingla-business/src/..."` (or a relative climb
 * into mingla-business) to any guarded consumer file → this gate FAILS.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const GUARDED = [
  "app-mobile/src/screens/Experience/ConsumerExperienceDetailScreen.tsx",
  "app-mobile/src/components/expandedCard/ExperienceReservePicker.tsx",
  "app-mobile/src/components/expandedCard/ExperienceOccurrencePicker.tsx",
  "app-mobile/src/utils/mapboxStaticImage.ts",
  "app-mobile/src/utils/venueExperienceMapping.ts",
  "app-mobile/src/hooks/useVenueExperiences.ts",
];

// Any import that reaches into mingla-business (absolute alias OR relative climb).
const BAD = /(from|import)\s+["'][^"']*mingla-business\/src[^"']*["']/;

const offenders = [];
for (const rel of GUARDED) {
  let src;
  try {
    src = readFileSync(resolve(ROOT, rel), "utf8");
  } catch {
    continue; // file may not exist on some branches; skip
  }
  src.split("\n").forEach((line, i) => {
    if (BAD.test(line)) {
      offenders.push(`${rel}:${i + 1}  ${line.trim()}`);
    }
  });
}

if (offenders.length > 0) {
  console.error(
    "[ORCH-1138 mor-isolation] FAIL — consumer experience files import from mingla-business/src (I-MOR-0827):",
  );
  offenders.forEach((o) => console.error("  " + o));
  process.exit(1);
}

console.log(
  "[ORCH-1138 mor-isolation] OK — consumer experience surface imports nothing from mingla-business/src.",
);
