/**
 * Issue #3380 — the text-editing half of the phone field's smart entry.
 *
 * Pure and React-free so it can be proven without mounting a TextInput: where
 * the cursor belongs after an edit, and which country a typed or pasted
 * "+code" names. The number rules themselves live in `./phoneNumber`.
 */

import { COUNTRIES } from "./countries";

/**
 * Issue #3380 — where the cursor sits after an edit, from the text alone.
 *
 * `onChangeText` does not report the selection, and `onSelectionChange` fires
 * before it on some platforms and after it on others. The edited span can be
 * recovered exactly from what stayed the same at either end, which works for a
 * keystroke, a deletion and a paste alike.
 */
export const cursorAfterEdit = (previous: string, next: string): number => {
  let prefix = 0;
  const shortest = Math.min(previous.length, next.length);
  while (prefix < shortest && previous[prefix] === next[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < shortest - prefix &&
    previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  return next.length - suffix;
};

/**
 * Issue #3380 — a typed or pasted "+code" names the country. Returns the
 * country and the national remainder once the code is settled (at least four
 * digits after it), so typing "+2" never jumps the picker to a guess.
 */
export const countryFromInternationalEntry = (
  text: string,
  currentCountryCode: string | null,
): { countryCode: string; national: string } | null => {
  const compact = text.replace(/[\s().-]/g, "");
  let digits: string;
  if (compact.startsWith("+")) digits = compact.slice(1).replace(/\D/g, "");
  else if (/^00[1-9]/.test(compact)) digits = compact.slice(2).replace(/\D/g, "");
  else return null;
  let best: { code: string; dial: string } | null = null;
  for (const country of COUNTRIES) {
    const dial = country.dialCode.replace(/\D/g, "");
    if (!digits.startsWith(dial)) continue;
    const better =
      best === null ||
      dial.length > best.dial.length ||
      (dial.length === best.dial.length && country.code === currentCountryCode);
    if (better) best = { code: country.code, dial };
  }
  if (best === null) return null;
  const national = digits.slice(best.dial.length);
  if (national.length < 4) return null;
  return { countryCode: best.code, national };
};
