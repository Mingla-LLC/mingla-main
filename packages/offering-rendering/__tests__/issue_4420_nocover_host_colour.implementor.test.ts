// #4420 journey — a public event, trip or RSVP with NO cover printed the
// authoring placeholder ("COVER" on Mingla-orange stripes). The shell now
// paints the host's own colour instead: their gradient when they chose one,
// else their single colour. A caller that names its own placeholder word
// (the venue page, #1561) keeps it.
//
// Source contract (the shell mounts react-native views), Deno-runnable:
//   deno test --allow-read packages/offering-rendering/__tests__/issue_4420_nocover_host_colour.implementor.test.ts
//
// FAILS ON REVERT: the no-cover branch goes back to EventCoverMedia's
// striped placeholder, stops reading the palette, or swallows the venue's
// explicit placeholder label.

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SRC = await Deno.readTextFile(new URL("../ParallaxCoverShell.tsx", import.meta.url));

Deno.test("no cover media → the host colour fill replaces the striped placeholder", () => {
  assert(/const hasCoverMedia =\s*\n\s*typeof coverMediaUrl === "string" && coverMediaUrl\.trim\(\)\.length > 0;/.test(SRC));
  assert(/!hasCoverMedia && placeholderLabel === null \? \(/.test(SRC), "only when no caller label");
  assert(/const coverMedia = themedFallback \?\? \(\s*\n\s*<EventCoverMedia/.test(SRC), "fallback wins over the stripes");
});

Deno.test("the fill is the host's gradient, else their single colour", () => {
  assert(/const accentStops = paletteAccentGradient\(palette\);/.test(SRC));
  assert(/accentStops !== null\s*\n\s*\? \[accentStops\[0\], accentStops\[1\]\]\s*\n\s*: \[palette\.accent, hexToRgba\(palette\.accent, 0\.72\)\]/.test(SRC));
});
