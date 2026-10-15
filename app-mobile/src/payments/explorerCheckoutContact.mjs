/**
 * Issue #3859 — pure Explorer checkout-contact authority.
 *
 * Access belongs to the authenticated account id. Checkout contact does not:
 * name comes only from the current account's nonblank profile display name,
 * email comes only from auth, and phone comes only from the current account's
 * profile after the existing phone authority can normalize it to strict E.164.
 * This module is deliberately effect-free so editing a booking snapshot can
 * never update a profile or login identity by accident.
 */

// Keep this pure authority runnable from the repository's Node-only CI lanes.
// Those lanes intentionally do not install app-mobile/node_modules, so the
// workspace package must be addressed by its repository path rather than the
// Metro-only bare-package link.
import { resolveUserPhoneE164 } from "../../../packages/card-identity/phone.mjs";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTACT_FIELDS = /** @type {const} */ (["name", "email", "phone"]);
const CONTACT_SEED_AUTHORITY = /** @type {const} */ ({
  awaitingAccount: "awaiting_account",
  resolvedAccount: "resolved_account",
  buyerOwned: "buyer_owned",
});

/** @param {unknown} value */
const trimmedString = (value) =>
  typeof value === "string" ? value.trim() : "";

/**
 * @param {{ name?: unknown, email?: unknown, phone?: unknown }} input
 */
function validateExplorerCheckoutContact(input) {
  const normalized = {
    name: trimmedString(input.name),
    email: trimmedString(input.email),
    phone: resolveUserPhoneE164(trimmedString(input.phone), null) ?? "",
  };
  const valid = {
    name: normalized.name.length >= 2,
    email: EMAIL.test(normalized.email),
    phone: normalized.phone.length > 0,
  };
  return {
    normalized,
    valid,
    invalidFields: CONTACT_FIELDS.filter((field) => !valid[field]),
    isValid: valid.name && valid.email && valid.phone,
  };
}

/**
 * Freeze the fields shown when the editor opens. Missing/invalid entry asks
 * only for those fields; an explicit Change action asks for all three.
 *
 * @param {{ invalidFields: readonly ("name" | "email" | "phone")[] }} validation
 * @param {boolean} editAll
 */
function explorerCheckoutContactFieldsForEditor(validation, editAll) {
  return editAll ? [...CONTACT_FIELDS] : [...validation.invalidFields];
}

/**
 * Decide whether a newly rendered account snapshot may replace the booking
 * contact shown in an open cart.
 *
 * The auth user and profile load on separate asynchronous rails. An invalid
 * first render therefore is not authoritative: keep accepting account updates
 * until a complete contact arrives. Once the account is complete, or the buyer
 * starts editing, freeze the booking-local snapshot so a late background load
 * can never overwrite buyer input.
 *
 * @param {"awaiting_account" | "resolved_account" | "buyer_owned"} authority
 * @param {boolean} visible
 * @param {boolean} accountContactIsValid
 */
function explorerCheckoutContactSeedDecision(
  authority,
  visible,
  accountContactIsValid,
) {
  if (!visible) {
    return {
      shouldApply: false,
      nextAuthority: CONTACT_SEED_AUTHORITY.awaitingAccount,
    };
  }
  if (authority !== CONTACT_SEED_AUTHORITY.awaitingAccount) {
    return { shouldApply: false, nextAuthority: authority };
  }
  return {
    shouldApply: true,
    nextAuthority: accountContactIsValid
      ? CONTACT_SEED_AUTHORITY.resolvedAccount
      : CONTACT_SEED_AUTHORITY.awaitingAccount,
  };
}

/**
 * Resolve only current-account values. A lagging cached profile for another
 * account is ignored rather than becoming the next buyer's booking contact.
 *
 * @param {{
 *   authUserId?: unknown,
 *   authEmail?: unknown,
 *   profileId?: unknown,
 *   profileDisplayName?: unknown,
 *   profilePhone?: unknown,
 *   profileCountry?: unknown,
 * }} input
 */
function resolveExplorerCheckoutContact(input) {
  const authUserId = trimmedString(input.authUserId);
  const profileId = trimmedString(input.profileId);
  const currentProfile = authUserId.length > 0 && profileId === authUserId;
  const profileCountry = trimmedString(input.profileCountry).toUpperCase();
  const normalizedPhone = currentProfile
    ? resolveUserPhoneE164(
      trimmedString(input.profilePhone),
      /^[A-Z]{2}$/.test(profileCountry) ? profileCountry : null,
    )
    : null;
  const validation = validateExplorerCheckoutContact({
    name: currentProfile ? input.profileDisplayName : "",
    email: input.authEmail,
    phone: normalizedPhone ?? "",
  });
  return {
    ...validation,
    provenance: {
      name: currentProfile && validation.normalized.name.length > 0
        ? "current_profile"
        : "missing",
      email: validation.normalized.email.length > 0 ? "current_auth" : "missing",
      phone: normalizedPhone !== null ? "current_profile_normalized" : "missing",
    },
  };
}

export {
  CONTACT_FIELDS as EXPLORER_CHECKOUT_CONTACT_FIELDS,
  CONTACT_SEED_AUTHORITY as EXPLORER_CHECKOUT_CONTACT_SEED_AUTHORITY,
  explorerCheckoutContactSeedDecision,
  explorerCheckoutContactFieldsForEditor,
  resolveExplorerCheckoutContact,
  validateExplorerCheckoutContact,
};
