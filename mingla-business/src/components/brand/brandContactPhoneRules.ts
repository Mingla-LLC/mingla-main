/**
 * Issue #3380 — the rules behind the brand contact phone field, kept out of
 * the component so every branch is provable without rendering. The only state
 * is the in-memory "country last picked for this number" hint, held in
 * `utils/brandPhoneSessionCountries.ts` so sign-out can empty it.
 *
 * `brands.contact_phone` used to hold only the digits typed in the box. The
 * country the host picked was never saved, so every re-open showed the default
 * flag (+44) and the public page dialled a number with no country code.
 *
 * The number is now saved as E.164 (`+2348031234567`). There is no separate
 * country column on `brands`, and none is needed: the country and the local
 * digits are read back out of the saved number when the editor opens. This
 * mirrors the venue contact editor (`venue/venueDetailsEditRules.ts`).
 *
 * WHAT IT WILL NOT DO (Constitution rule 9). A number saved before this change
 * is bare national digits with no country. Nothing here invents a country code
 * for one: the editor opens it under the brand's own country when the brand
 * has one, it is only rewritten as E.164 when the host saves it under a
 * country they can see, and the public page keeps showing and dialling exactly
 * what was saved.
 *
 * The country directory is passed in, never imported: the editor must judge a
 * number against the same list its country chip shows.
 */

import {
  composePhoneE164,
  parsePhoneEntry,
} from "@mingla/phone-input/phoneNumber";

import { brandPhoneE164 } from "@mingla/brand-rendering/brandPhoneHref";

import type { BrandContact } from "../../types/brand";
import {
  clearBrandPhoneSessionCountries,
  getBrandPhoneSessionCountry,
  setBrandPhoneSessionCountry,
} from "../../utils/brandPhoneSessionCountries";
import { phoneCountryIsoFromPlaceCountry } from "../../utils/phoneCountryIsoFromPlaceCountry";

/** The two facts this file needs about a picker country. */
export interface BrandPhoneCountry {
  iso: string;
  dialCode: string;
}

export type BrandPhoneDirectory = readonly BrandPhoneCountry[];

/** The flag the phone field has always fallen back to when nothing is known. */
export const BRAND_PHONE_FALLBACK_COUNTRY_ISO = "GB";

/**
 * Where the country on the phone field came from (issue #3380 rework 2).
 *
 *   - `stored`   read out of a saved E.164 number;
 *   - `brand`    the brand's own country;
 *   - `picked`   the host picked it in the country list during this edit;
 *   - `fallback` none of those: nobody chose it.
 *
 * A number typed without a "+" is only ever composed under a country the host
 * can be said to have chosen. Under `fallback` it is refused, never stamped
 * with a default dial code: no rule can tell `4155550123` (United States) from
 * a UK, Ghanaian or Kenyan number by its digits.
 */
export type BrandPhoneCountrySource = "stored" | "brand" | "picked" | "fallback";

/** What the field says when a number is typed and no country was chosen. */
export const BRAND_PHONE_CHOOSE_COUNTRY_MESSAGE =
  "Choose the country for this number.";

/** What the country chip says while nobody has chosen a country. */
export const BRAND_PHONE_CHOOSE_COUNTRY_LABEL = "Choose country";

/** Added to the wrong-country refusal for the UK ranges it cannot tell apart. */
export const BRAND_PHONE_UK_PLUS_ADVICE =
  "If it is a UK number, type it starting with +44.";

/**
 * The saved value as canonical E.164, or null when it is not one (a legacy
 * bare national number, or anything else). One owner: the same test the public
 * page uses to decide what its `tel:` link dials.
 */
export const storedBrandPhoneE164 = brandPhoneE164;

const countryForIso = (
  iso: string | null | undefined,
  directory: BrandPhoneDirectory,
): BrandPhoneCountry | null => {
  if (typeof iso !== "string") return null;
  const upper = iso.trim().toUpperCase();
  return directory.find((country) => country.iso === upper) ?? null;
};

/** The brand's own country as a picker country, or null when unknown. */
export function brandOwnPhoneCountry(
  brandCountryCode: string | null | undefined,
  directory: BrandPhoneDirectory,
): BrandPhoneCountry | null {
  return countryForIso(
    phoneCountryIsoFromPlaceCountry(brandCountryCode ?? null),
    directory,
  );
}

/**
 * The country the host last picked for a number, kept for THIS run of the app
 * only (issue #3380 rework).
 *
 * WHY IT IS ONLY A HINT. `+14165550123` is the same string whether the host
 * picked Canada, the United States, Puerto Rico or the Dominican Republic:
 * a bare shared dial code (+1, +7, +44) does not say which of its countries
 * was chosen, and `brands` has no column that could. So after a full restart,
 * on another device, or for another team member, a shared-code number on a
 * brand with no country opens under the first country of that code again.
 * Keeping the picked country for good needs a database column; nothing here
 * pretends otherwise. The number that is saved and dialled is identical
 * whichever country the chip shows.
 */
/** Remember the country a number was just saved under (successful saves only). */
export function rememberBrandPhoneSavedCountry(
  saved: Extract<BrandPhoneSaveResult, { ok: true }>,
): void {
  const e164 = storedBrandPhoneE164(saved.phone);
  if (e164 === null || saved.phoneCountryIso === undefined) return;
  setBrandPhoneSessionCountry(e164, saved.phoneCountryIso);
}

/**
 * Forget every remembered country. Sign-out calls the same function through
 * `clearAllStores`, so one account's picks never open under the next one.
 */
export const clearBrandPhoneSavedCountries = clearBrandPhoneSessionCountries;

/** The country last picked for this number in this run of the app, if any. */
export function brandPhoneSessionCountryIso(
  stored: string | null | undefined,
): string | null {
  const e164 = storedBrandPhoneE164(stored);
  return e164 === null ? null : getBrandPhoneSessionCountry(e164);
}

/**
 * Which country a saved E.164 number belongs to.
 *
 * The LONGEST dial code the number starts with decides first, so `+1242…` is
 * the Bahamas on any brand, never the United States. When several countries
 * share that longest code (+1 US/Canada, +7 Russia/Kazakhstan, +44 UK/Jersey)
 * the number itself cannot decide, so in order:
 *
 *   1. the brand's own country;
 *   2. the country the host last picked for this number in this run of the
 *      app (`sessionCountryIso`; see `rememberBrandPhoneSavedCountry` for why
 *      that is a hint and not a saved fact);
 *   3. the country the shared phone rules name for it;
 *   4. the first of them in the directory.
 *
 * Null for anything that is not E.164 — a legacy number has no country.
 */
export function brandPhoneCountryFromStored(
  stored: string | null | undefined,
  brandCountryCode: string | null | undefined,
  directory: BrandPhoneDirectory,
  sessionCountryIso: string | null | undefined = brandPhoneSessionCountryIso(
    stored,
  ),
): BrandPhoneCountry | null {
  const e164 = storedBrandPhoneE164(stored);
  if (e164 === null) return null;

  let longest = 0;
  for (const country of directory) {
    if (!e164.startsWith(country.dialCode)) continue;
    if (country.dialCode.length > longest) longest = country.dialCode.length;
  }
  if (longest === 0) return null;
  const candidates = directory.filter(
    (country) =>
      country.dialCode.length === longest && e164.startsWith(country.dialCode),
  );
  if (candidates.length === 1) return candidates[0];
  const among = (
    country: BrandPhoneCountry | null,
  ): BrandPhoneCountry | null =>
    country !== null && candidates.some((entry) => entry.iso === country.iso)
      ? country
      : null;

  const own = among(brandOwnPhoneCountry(brandCountryCode, directory));
  if (own !== null) return own;

  const picked = among(countryForIso(sessionCountryIso, directory));
  if (picked !== null) return picked;

  const parsed = parsePhoneEntry(e164, { mode: "any" });
  if (parsed.ok && parsed.countryIso !== null) {
    const named = among(countryForIso(parsed.countryIso, directory));
    if (named !== null) return named;
  }
  return candidates[0];
}

export interface BrandPhoneForEdit {
  /** What the phone box shows. */
  localText: string;
  /** The country the chip opens on. */
  countryIso: string;
  /** False for a legacy number that was saved without a country. */
  savedWithCountry: boolean;
}

/**
 * What the editor shows when it opens.
 *
 * A saved E.164 number opens under its own country with the dial code taken
 * off. A legacy number opens exactly as it was saved, under the brand's
 * country, then the field's existing default.
 */
export function brandPhoneForEdit(
  stored: string | null | undefined,
  brandCountryCode: string | null | undefined,
  directory: BrandPhoneDirectory,
  sessionCountryIso: string | null | undefined = brandPhoneSessionCountryIso(
    stored,
  ),
): BrandPhoneForEdit {
  const e164 = storedBrandPhoneE164(stored);
  const fromNumber = brandPhoneCountryFromStored(
    stored,
    brandCountryCode,
    directory,
    sessionCountryIso,
  );
  if (e164 !== null && fromNumber !== null) {
    return {
      localText: e164.slice(fromNumber.dialCode.length),
      countryIso: fromNumber.iso,
      savedWithCountry: true,
    };
  }
  const own = brandOwnPhoneCountry(brandCountryCode, directory);
  return {
    localText: typeof stored === "string" ? stored.trim() : "",
    countryIso: own?.iso ?? BRAND_PHONE_FALLBACK_COUNTRY_ISO,
    savedWithCountry: false,
  };
}

/**
 * Where the country `brandPhoneForEdit` opens the chip on came from. Never
 * `picked`: that only happens when the host uses the country list.
 */
export function brandPhoneCountrySourceForEdit(
  stored: string | null | undefined,
  brandCountryCode: string | null | undefined,
  directory: BrandPhoneDirectory,
  sessionCountryIso: string | null | undefined = brandPhoneSessionCountryIso(
    stored,
  ),
): Exclude<BrandPhoneCountrySource, "picked"> {
  const fromNumber = brandPhoneCountryFromStored(
    stored,
    brandCountryCode,
    directory,
    sessionCountryIso,
  );
  if (fromNumber !== null) return "stored";
  return brandOwnPhoneCountry(brandCountryCode, directory) !== null
    ? "brand"
    : "fallback";
}

export type BrandPhoneSaveResult =
  | {
      ok: true;
      /** The value for `brands.contact_phone`; undefined clears it. */
      phone: string | undefined;
      /** The country it was saved under; undefined when there is none. */
      phoneCountryIso: string | undefined;
    }
  | { ok: false; message: string };

/**
 * What to save.
 *
 * `edit` is null when the host did not touch the phone box or its country.
 * An untouched number is never a reason to refuse a save of other fields: it
 * is kept as it is, except that a legacy number is upgraded to E.164 when the
 * brand has a country and the number is a real one for that country.
 */
export function brandPhoneForSave(input: {
  stored: string | null | undefined;
  brandCountryCode: string | null | undefined;
  edit: {
    text: string;
    countryIso: string;
    /**
     * Where `countryIso` came from. Left out, it is read as `picked` (what
     * every caller meant before the source was tracked). The editor always
     * passes it.
     */
    countrySource?: BrandPhoneCountrySource;
  } | null;
  directory: BrandPhoneDirectory;
}): BrandPhoneSaveResult {
  const { stored, brandCountryCode, edit, directory } = input;
  const storedTrimmed = typeof stored === "string" ? stored.trim() : "";

  if (edit === null) {
    if (storedTrimmed.length === 0) {
      return { ok: true, phone: undefined, phoneCountryIso: undefined };
    }
    const e164 = storedBrandPhoneE164(storedTrimmed);
    if (e164 !== null) {
      const country = brandPhoneCountryFromStored(
        e164,
        brandCountryCode,
        directory,
      );
      return { ok: true, phone: e164, phoneCountryIso: country?.iso };
    }
    const own = brandOwnPhoneCountry(brandCountryCode, directory);
    // Nobody is looking at the field on this save, so be stricter than a typed
    // edit: when the digits read as another country's number (a Nigerian
    // mobile on a UK brand), leave them alone rather than stamp +44 on them.
    const probe =
      own === null
        ? null
        : parsePhoneEntry(storedTrimmed, {
            countryIso: own.iso,
            dialCode: own.dialCode,
            mode: "mobile",
          });
    const looksForeign =
      probe !== null && !probe.ok && probe.problem === "wrong_country";
    const upgraded =
      own === null || looksForeign
        ? null
        : composePhoneE164(own.dialCode, storedTrimmed);
    if (own !== null && upgraded !== null) {
      const country = brandPhoneCountryFromStored(
        upgraded,
        brandCountryCode,
        directory,
      );
      return {
        ok: true,
        phone: upgraded,
        phoneCountryIso: country?.iso ?? own.iso,
      };
    }
    // No country to save it under: leave it exactly as it was.
    return { ok: true, phone: storedTrimmed, phoneCountryIso: undefined };
  }

  const text = edit.text.trim();
  if (text.length === 0) {
    return { ok: true, phone: undefined, phoneCountryIso: undefined };
  }
  const country = countryForIso(edit.countryIso, directory);
  if (country === null) {
    return { ok: false, message: "Choose the country for this phone number." };
  }
  // issue #3380 rework — a number typed WITHOUT a "+" is judged against the
  // country on the chip before anything is composed. Digits that read as
  // another country's mobile (a Nigerian 0803… under the default +44 flag) are
  // refused with the message that names that country, never saved behind the
  // wrong code where the public page would dial a stranger. A typed "+" names
  // its own country and skips this.
  //
  // UK 0800 freephone is let through: the probe cannot tell it from a foreign
  // mobile by shape, but no Nigerian mobile range starts 0800. The other UK
  // ranges that collide with Nigerian mobile prefixes (070 personal numbers,
  // 0808 freephone, 09 premium rate) are refused here; a host who really has
  // one types it with "+44".
  //
  // issue #3380 rework 2 — and a number typed without a "+" (or the "00"
  // international prefix) under a country NOBODY chose is refused outright.
  // The probe below only recognises Nigerian mobiles; a US, Ghanaian, Kenyan
  // or Irish number under the default flag would otherwise be saved as +44.
  // A picked country is never second-guessed into another one: the outcome is
  // a refusal with advice, or a save under the country the host picked.
  const compact = text.replace(/[\s().-]/g, "");
  const namesOwnCountry = compact.startsWith("+") || /^00[1-9]/.test(compact);
  if ((edit.countrySource ?? "picked") === "fallback" && !namesOwnCountry) {
    return { ok: false, message: BRAND_PHONE_CHOOSE_COUNTRY_MESSAGE };
  }
  if (!text.startsWith("+")) {
    const national = text.replace(/\D/g, "").replace(/^0+/, "");
    const ukFreephone = country.dialCode === "+44" && national.startsWith("800");
    const probe = ukFreephone
      ? null
      : parsePhoneEntry(text, {
          countryIso: country.iso,
          dialCode: country.dialCode,
          mode: "mobile",
        });
    if (probe !== null && !probe.ok && probe.problem === "wrong_country") {
      // 070 personal, 0808 freephone and 09 premium-rate numbers are real UK
      // ranges the probe reads as Nigerian. Say how to save one.
      const maybeUk =
        country.dialCode === "+44" && /^(70|808|9)/.test(national);
      return {
        ok: false,
        message: maybeUk
          ? `${probe.message} ${BRAND_PHONE_UK_PLUS_ADVICE}`
          : probe.message,
      };
    }
  }
  const e164 = composePhoneE164(country.dialCode, text);
  if (e164 === null) {
    const problem = parsePhoneEntry(text, {
      countryIso: country.iso,
      dialCode: country.dialCode,
      mode: "any",
    });
    return {
      ok: false,
      message: problem.ok
        ? "That phone number doesn't look right. Check the country and the number."
        : problem.message,
    };
  }
  // A typed "+234…" names its own country; the saved country follows it.
  const savedCountry = e164.startsWith(country.dialCode)
    ? country
    : brandPhoneCountryFromStored(e164, brandCountryCode, directory);
  return { ok: true, phone: e164, phoneCountryIso: savedCountry?.iso };
}

/** The contact block to save, with the phone decided by `brandPhoneForSave`. */
export function brandContactWithSavedPhone(
  contact: BrandContact | undefined,
  saved: Extract<BrandPhoneSaveResult, { ok: true }>,
): BrandContact | undefined {
  // Nothing about the number changed: hand the block back untouched so an
  // unrelated save does not re-send the contact.
  if ((contact?.phone?.trim() || undefined) === saved.phone) return contact;
  // The country is not carried beside the number any more: it is part of the
  // number, and is read back out of it when the editor opens.
  const { phoneCountryIso: _retired, ...rest } = contact ?? {};
  return { ...rest, phone: saved.phone };
}
