// ISSUE-1001 [brand logo consolidation] — implementor HAPPY-PATH regression
// test for the ShareModal text-wordmark → image swap (SPEC §4.4 W4-1).
// House pattern for app-mobile/__tests__: Deno source-scan (see
// googlePay_testEnvProductionGate.test.ts).
//
// Pins: the share-card badge renders the REAL orange wordmark image inside
// the white pill — never the old red dot + "Mingla" <Text> pair.

import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const source = await Deno.readTextFile(
  new URL("../src/components/ShareModal.tsx", import.meta.url),
);

Deno.test("ISSUE-1001 T6 — ShareModal badge is the wordmark Image, not text", () => {
  // Canonical import + Image render with a11y label.
  assertStringIncludes(
    source,
    "import { MINGLA_WORDMARK } from '@mingla/brand-assets'",
  );
  assert(
    /<Image\s+source=\{MINGLA_WORDMARK\}[\s\S]*?accessibilityLabel="Mingla"[\s\S]*?\/>/
      .test(source),
    "ShareModal must render the MINGLA_WORDMARK Image with accessibilityLabel",
  );
  assertStringIncludes(source, 'resizeMode="contain"');

  // The old badge internals are gone: no red dot, no "Mingla" text node.
  assert(!source.includes("minglaDot"), "minglaDot style/view must stay deleted");
  assert(!source.includes("minglaText"), "minglaText style must stay deleted");
  assert(
    !/<Text[^>]*>\s*Mingla\s*<\/Text>/.test(source),
    "no <Text> node may render the bare 'Mingla' wordmark in the badge",
  );

  // The wordmark keeps the pill's proportions (34x12 ≈ the 1356:480 ratio).
  assert(
    /minglaWordmark:\s*\{[\s\S]*?width:\s*34,[\s\S]*?height:\s*12,/.test(source),
    "minglaWordmark style must pin the 34x12 box",
  );
});
