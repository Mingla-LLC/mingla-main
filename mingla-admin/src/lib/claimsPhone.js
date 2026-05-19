/**
 * Ve3 — resolve dial-ready phone for venue claim queue rows.
 */

/**
 * @param {object} row
 * @param {string | null | undefined} row.contact_phone
 * @param {string | null | undefined} row.place_pool_id
 * @param {{ national_phone_number?: string | null } | null | undefined} row.place_pool
 */
export function resolveClaimDisplayPhone(row) {
  const poolPhone =
    row?.place_pool?.national_phone_number?.trim?.() ?? "";
  if (row?.place_pool_id && poolPhone.length > 0) {
    return {
      phone: poolPhone,
      source: "pool",
      note: null,
    };
  }

  const operatorPhone = row?.contact_phone?.trim?.() ?? "";
  return {
    phone: operatorPhone.length > 0 ? operatorPhone : null,
    source: "operator",
    note:
      row?.place_pool_id == null
        ? "Verify via Google Maps lookup"
        : "Pool match — no Google phone on file; use operator number or Maps",
  };
}

export function formatPhoneHref(phone) {
  if (!phone) return null;
  const digits = phone.replace(/[^\d+]/g, "");
  return digits.length > 0 ? `tel:${digits}` : null;
}
