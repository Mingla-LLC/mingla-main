import { resolveTheme, type ResolvedTheme } from "@mingla/offering-rendering";

/**
 * #4420 — the app's own text face. react-native-web expands "System" to the
 * system font stack (its own default for Text); iOS and Android read it as
 * the system face.
 */
export const HOST_CHROME_FONT_FAMILY = "System";

/**
 * #4420 — the theme for the shared Stay booking parts when they are drawn
 * inside Host chrome (the front desk "Add reservation" sheet). The default
 * guest theme names a theme font (Inter) that only themed guest pages load,
 * so on Host web every pill drawn in the theme's face fell back to the
 * browser's serif. Colours stay the default guest theme's; the face is the
 * app's.
 */
export const stayHostChromeTheme = (): ResolvedTheme => ({
  ...resolveTheme(null, null),
  fontFamilyValue: HOST_CHROME_FONT_FAMILY,
  boldFontFamilyValue: HOST_CHROME_FONT_FAMILY,
});
