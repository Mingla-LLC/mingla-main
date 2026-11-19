// #4490 P2-7 — Admin venue offers: list across venues (read) and pause / resume
// (the audited, reason-required `issue_4490_admin_set_offer_status`).
// A separate file from offeringsService.js, which the ORCH-1273 gate holds to
// its own RPC list.
import { supabase } from "../lib/supabase";
import { bookingAdminError, venueOfferAdminError } from "../lib/venueOffersAdmin";

export async function listAdminVenueOffers({ search, filters = {}, page = 0, pageSize = 25 }) {
  const { data, error } = await supabase.rpc("admin_list_venue_offers", {
    p_search: search && search.trim() ? search.trim() : null,
    p_status: filters.status || null,
    p_limit: pageSize,
    p_offset: page * pageSize,
  });
  if (error) throw new Error(venueOfferAdminError(error.message) || "Couldn't load venue offers.");
  return { rows: Array.isArray(data?.rows) ? data.rows : [], total: Number(data?.total) || 0 };
}

export async function setAdminVenueOfferStatus({ offeringId, status, reason }) {
  const { data, error } = await supabase.rpc("issue_4490_admin_set_offer_status", {
    p_offering_id: offeringId,
    p_status: status,
    p_reason: reason,
  });
  if (error) throw new Error(venueOfferAdminError(error.message));
  return data;
}

// #4490 P4-3 — request disputes: one venue booking (timeline, money, the terms
// saved on it, space claims) and an audited force-expire of a hold.
export async function getAdminVenueBooking(groupId) {
  const { data, error } = await supabase.rpc("issue_4490_admin_booking", { p_group_id: groupId });
  if (error) throw new Error(bookingAdminError(error.message));
  return data;
}

export async function forceExpireVenueHold({ groupId, reason }) {
  const { data, error } = await supabase.rpc("issue_4490_admin_force_expire_hold", {
    p_group_id: groupId,
    p_reason: reason,
  });
  if (error) throw new Error(bookingAdminError(error.message));
  return data;
}
