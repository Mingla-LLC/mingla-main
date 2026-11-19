// #4490 P2-7 — Admin venue offers: list across venues (read) and pause / resume
// (the audited, reason-required `issue_4490_admin_set_offer_status`).
// A separate file from offeringsService.js, which the ORCH-1273 gate holds to
// its own RPC list.
import { supabase } from "../lib/supabase";
import { venueOfferAdminError } from "../lib/venueOffersAdmin";

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
