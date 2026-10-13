/**
 * Issue #3380 — the `tel:` link for a brand's contact phone.
 *
 * A number saved with its country (`+234 803 123 4567`, however it is spaced)
 * dials as canonical E.164. A number saved before brand phones carried a
 * country is bare national digits: it is dialled exactly as it was saved, as it
 * always has been. No country code is ever added to it here — we do not know
 * one, and a guessed code would ring a stranger (Constitution rule 9).
 *
 * Dependency-free on purpose: imported by the shared public brand page and by
 * the Host app's own profile view.
 */

const E164_RE = /^\+[1-9][0-9]{6,14}$/;

/**
 * The saved value as canonical E.164 (`+2348031234567`), or null when it is
 * not one. Spaces and phone punctuation are tolerated; nothing is added.
 */
export const brandPhoneE164 = (
  phone: string | null | undefined,
): string | null => {
  if (typeof phone !== "string") return null;
  const compact = phone.trim().replace(/[\s().-]/g, "");
  return E164_RE.test(compact) ? compact : null;
};

export const brandPhoneTelHref = (phone: string): string =>
  `tel:${brandPhoneE164(phone) ?? phone}`;
