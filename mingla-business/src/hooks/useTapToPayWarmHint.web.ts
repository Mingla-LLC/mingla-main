/**
 * #4389 — web build of useTapToPayWarmHint. Tap to Pay never runs on the web:
 * its callers pass null there (useTapToPaySettingsEntry.web.ts is always
 * null), so the answer is always null and the web skips the Terminal store.
 */
export function useTapToPayWarmHint(_brandId: string | null): boolean | null {
  return null;
}
