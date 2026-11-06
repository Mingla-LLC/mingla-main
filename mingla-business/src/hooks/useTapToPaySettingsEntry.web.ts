/**
 * #4271 — web build of useTapToPaySettingsEntry. Tap to Pay never runs on the
 * web: the native hook answers null there too (no supported device, and the
 * release query is disabled off iOS and Android), so the web build skips the
 * release, device and Terminal modules entirely.
 */
export { tapToPayBrandEligible } from "../utils/tapToPayBrandEligible";

export const useTapToPaySettingsEntry = (_brandId: string | null): { label: string } | null => null;
