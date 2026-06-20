// ORCH-1138 Leg 1C — consumer-app theme-font module thunks.
//
// The consumer app has NO existing theme-font loader (the business app's
// `mingla-business/src/theme/themeFonts.ts` cannot be imported across the app
// boundary — I-MOR-0827-PACKAGE-ISOLATION). This is the consumer-local mirror,
// loaded on demand ONLY by the themed trip detail (and any future consumer
// offering page) via ./useConsumerThemeFont — never at app boot.
//
// Each entry is a DYNAMIC `import()` thunk keyed by the font-family VALUE (the
// `fontFamilyValue` string from @mingla/offering-rendering's FONT_FAMILY_MAP, e.g.
// "Inter_500Medium") + its 700-weight BOLD variant (from FONT_FAMILY_BOLD_MAP).
// The thunk resolves the named export off the lazily-loaded `@expo-google-fonts/*`
// module so the asset is only fetched/parsed when the trip detail mounts and
// requests that family. The 14 `@expo-google-fonts/*` packages + `expo-font` are
// already direct deps of app-mobile (package.json).
//
// NATIVE BOLD: a loaded custom font ignores `fontWeight` on iOS/Android, so the
// trip page sets `fontFamily` to the 700-weight loaded family (boldFontFamily(
// theme)). These bold thunks make that face registerable before it is referenced.
// The 3 single-weight display faces (DM Serif Display, Bebas Neue, Anton) publish
// NO 700Bold export, so FONT_FAMILY_BOLD_MAP maps them back to their base family
// (already registered by the medium thunk) — no bold thunk needed/possible.

export type ConsumerThemeFontModuleThunk = () => Promise<number | string>;

export const CONSUMER_THEME_FONT_MODULE_THUNKS: Record<
  string,
  ConsumerThemeFontModuleThunk
> = {
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

  // 700-weight BOLD variants (the native-bold faces).
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

/** The theme-font family values the consumer app can load on demand. */
export const CONSUMER_THEME_FONT_FAMILY_VALUES = Object.keys(
  CONSUMER_THEME_FONT_MODULE_THUNKS,
) as readonly string[];
