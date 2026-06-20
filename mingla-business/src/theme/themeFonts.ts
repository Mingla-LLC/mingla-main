// ORCH-1083: the 14 theme fonts are deferred out of the initial web bundle.
// DO NOT re-add static `import { Xxx_500Medium } from "@expo-google-fonts/..."`
// here or call `useFonts(MINGLA_THEME_FONTS)` at the app root — that pulls every
// family's font-registration module into the boot bundle and fires 14 boot-time
// asset fetches on the login path (breaks the mobile boot budget). See SPEC §C-2.
//
// These families render ONLY on the 3 themed surfaces (PublicBrandPage,
// PublicEventPage, ThemeEditorSection), each of which loads the needed family
// on demand via `useThemeFont` / `loadThemeFont` (./useThemeFont).
//
// Each entry below is a DYNAMIC `import()` thunk keyed by the font-family VALUE
// (the `fontFamilyValue` string from FONT_FAMILY_MAP, e.g. "Inter_500Medium").
// The thunk resolves the named export off the lazily-loaded
// `@expo-google-fonts/*` module so the asset module is only fetched/parsed when
// a themed surface actually requests that family.

export type ThemeFontModuleThunk = () => Promise<number | string>;

export const THEME_FONT_MODULE_THUNKS: Record<string, ThemeFontModuleThunk> = {
  Inter_500Medium: () =>
    import("@expo-google-fonts/inter").then((m) => m.Inter_500Medium),
  Poppins_500Medium: () =>
    import("@expo-google-fonts/poppins").then((m) => m.Poppins_500Medium),
  SpaceGrotesk_500Medium: () =>
    import("@expo-google-fonts/space-grotesk").then(
      (m) => m.SpaceGrotesk_500Medium,
    ),
  PlusJakartaSans_500Medium: () =>
    import("@expo-google-fonts/plus-jakarta-sans").then(
      (m) => m.PlusJakartaSans_500Medium,
    ),
  Manrope_500Medium: () =>
    import("@expo-google-fonts/manrope").then((m) => m.Manrope_500Medium),
  PlayfairDisplay_500Medium: () =>
    import("@expo-google-fonts/playfair-display").then(
      (m) => m.PlayfairDisplay_500Medium,
    ),
  DMSerifDisplay_400Regular: () =>
    import("@expo-google-fonts/dm-serif-display").then(
      (m) => m.DMSerifDisplay_400Regular,
    ),
  Fraunces_500Medium: () =>
    import("@expo-google-fonts/fraunces").then((m) => m.Fraunces_500Medium),
  Lora_500Medium: () =>
    import("@expo-google-fonts/lora").then((m) => m.Lora_500Medium),
  BebasNeue_400Regular: () =>
    import("@expo-google-fonts/bebas-neue").then((m) => m.BebasNeue_400Regular),
  Anton_400Regular: () =>
    import("@expo-google-fonts/anton").then((m) => m.Anton_400Regular),
  Unbounded_500Medium: () =>
    import("@expo-google-fonts/unbounded").then((m) => m.Unbounded_500Medium),
  Caveat_500Medium: () =>
    import("@expo-google-fonts/caveat").then((m) => m.Caveat_500Medium),
  DancingScript_500Medium: () =>
    import("@expo-google-fonts/dancing-script").then(
      (m) => m.DancingScript_500Medium,
    ),

  // ORCH-1138 Leg-1 (native-parity fix #2) — the 700-weight BOLD variants.
  // A loaded custom font ignores `fontWeight` on native, so bold themed text must
  // set `fontFamily` to the weight-specific loaded family (see
  // @mingla/offering-rendering `FONT_FAMILY_BOLD_MAP` / `boldFontFamily`). These
  // thunks make those bold faces loadable on demand via `useThemeFont`/
  // `loadThemeFont`, exactly like the medium variants above — same dynamic
  // `import()` deferral (ORCH-1083 boot-budget). The 3 single-weight display
  // faces (DM Serif Display, Bebas Neue, Anton) publish NO 700Bold export, so
  // `FONT_FAMILY_BOLD_MAP` maps them back to their base family (already
  // registered above) — no bold thunk needed/possible.
  Inter_700Bold: () =>
    import("@expo-google-fonts/inter").then((m) => m.Inter_700Bold),
  Poppins_700Bold: () =>
    import("@expo-google-fonts/poppins").then((m) => m.Poppins_700Bold),
  SpaceGrotesk_700Bold: () =>
    import("@expo-google-fonts/space-grotesk").then(
      (m) => m.SpaceGrotesk_700Bold,
    ),
  PlusJakartaSans_700Bold: () =>
    import("@expo-google-fonts/plus-jakarta-sans").then(
      (m) => m.PlusJakartaSans_700Bold,
    ),
  Manrope_700Bold: () =>
    import("@expo-google-fonts/manrope").then((m) => m.Manrope_700Bold),
  PlayfairDisplay_700Bold: () =>
    import("@expo-google-fonts/playfair-display").then(
      (m) => m.PlayfairDisplay_700Bold,
    ),
  Fraunces_700Bold: () =>
    import("@expo-google-fonts/fraunces").then((m) => m.Fraunces_700Bold),
  Lora_700Bold: () =>
    import("@expo-google-fonts/lora").then((m) => m.Lora_700Bold),
  Unbounded_700Bold: () =>
    import("@expo-google-fonts/unbounded").then((m) => m.Unbounded_700Bold),
  Caveat_700Bold: () =>
    import("@expo-google-fonts/caveat").then((m) => m.Caveat_700Bold),
  DancingScript_700Bold: () =>
    import("@expo-google-fonts/dancing-script").then(
      (m) => m.DancingScript_700Bold,
    ),
};

/** The 14 theme-font family values, for callers that need to enumerate them. */
export const THEME_FONT_FAMILY_VALUES = Object.keys(
  THEME_FONT_MODULE_THUNKS,
) as ReadonlyArray<string>;
