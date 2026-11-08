// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// issue #1023 wave 2 — P-10. The consumer app (Explorer) draws a host's Google
// font: event, experience and trip pages call useConsumerThemeFont with the
// resolved GF_<family>_500 / _700 keys, and the hook hands those keys to the
// shared loader with the bundled Inter faces as the fallback. Bundled slugs
// keep their @expo-google-fonts thunks (no network).
//
// FAILS-ON-REVERT:
//  - delete the GF_ branch in loadConsumerThemeFont → the delegation checks fail
//    (a Google key would hit the thunk table, find nothing and draw the system
//    face);
//  - drop the Inter thunks from loadInterFallback → the fallback check fails;
//  - put isThemeFontSlug back in the consumer payload readers → a Google
//    family read from an event payload is dropped and the reader check fails.
import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

// Source-level suite: the shared package uses extensionless imports, which
// the Deno lane cannot resolve. The resolver behaviour itself (GF_ keys,
// gradients) is exercised for real in mingla-business P-2
// (issue_1023_theme_resolver_gradient.implementor.test.ts).

const read = (rel: string): string =>
  Deno.readTextFileSync(new URL(rel, import.meta.url));

const hook = read("../useConsumerThemeFont.ts");

Deno.test("#1023 — consumer pages load both theme keys (base and bold)", () => {
  for (const file of [
    "../../screens/Event/ConsumerEventDetailScreen.tsx",
    "../../screens/Experience/ConsumerExperienceDetailScreen.tsx",
    "../../screens/Trip/ConsumerTripDetailScreen.tsx",
  ]) {
    const src = read(file);
    assert(src.includes("useConsumerThemeFont(theme.fontFamilyValue)"), file);
    assert(src.includes("useConsumerThemeFont(boldFamily)"), file);
  }
});

Deno.test("#1023 — useConsumerThemeFont delegates GF_ keys to the shared loader", () => {
  assert(hook.includes('from "@mingla/offering-rendering/googleFontLoader"'));
  // Each key (base or bold) loads on its own: the bold face only where used.
  assert(/key\.startsWith\("GF_"\) && familyFromGoogleFontKey\(key\) !== null/.test(hook));
  // Loaded on demand (dynamic import), so render paths never pull expo-font's
  // remote loader in.
  assert(hook.includes('import("@mingla/offering-rendering/googleFontLoader")'));
  assert(/await ensureGoogleFontKey\(family, \{\s*loadFallback: loadInterFallback,?\s*\}\)/.test(hook));
  assert(!/^import \{[^}]*ensureGoogleFontKey[^}]*\} from/m.test(hook));
  // The delegation happens before the bundled thunk lookup.
  assert(hook.indexOf("ensureGoogleFontKey(family") < hook.indexOf("CONSUMER_THEME_FONT_MODULE_THUNKS[family]"));
});

Deno.test("#1023 — the fallback is the bundled Inter 500 and 700", () => {
  assert(hook.includes("CONSUMER_THEME_FONT_MODULE_THUNKS.Inter_500Medium()"));
  assert(hook.includes("CONSUMER_THEME_FONT_MODULE_THUNKS.Inter_700Bold()"));
  // ORCH-1083: still no static @expo-google-fonts import and no root useFonts.
  assert(!/^import[^;]*@expo-google-fonts/m.test(hook));
  assert(!/useFonts\(/.test(hook));
});

Deno.test("#1023 — consumer payload readers keep a Google family and the gradient", () => {
  for (const file of [
    "../../hooks/usePublicEventBySlug.ts",
    "../../hooks/useEventTheme.ts",
    "../../hooks/useBrandBySlug.ts",
  ]) {
    const src = read(file);
    assert(src.includes("themeInputFromFields"), file);
    assert(!src.includes("isThemeFontSlug"), file);
    assert(/[Gg]radient/.test(src), `${file} passes the gradient field`);
  }
});
