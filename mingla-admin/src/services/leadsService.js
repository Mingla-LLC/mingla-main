// #4452 A1.8 — the Leads list (#/inbound): one row per person across forms,
// Book a call, free tools and beta. Every function returns the server's data
// or throws the server's error; no failure becomes an empty answer here.
// Every gate is enforced again by the RPC (leads_can_view / leads_can_export).
import { supabase } from "../lib/supabase";

async function rpc(name, args = {}) {
  const result = await supabase.rpc(name, args);
  if (result.error) throw result.error;
  return result.data;
}

/** One page: { rows, next, total, facets, test_hidden, can, as_of }. */
export const listLeads = (filter, after = null, limit = 50) =>
  rpc("admin_leads_list", { p_filter: filter || {}, p_after: after, p_limit: limit });

/** One lead: { lead, events, emails, crm, can }. */
export const getLead = (id) => rpc("admin_lead_get", { p_id: id });

/** A selection for the Email composer: ids, or the whole filter. */
export const createLeadSelection = ({ ids = null, filter = null }) =>
  rpc("admin_lead_selection_create", { p_lead_ids: ids, p_filter: filter });

/** CSV rows for the filter (admins and the CRM role; no phones). */
export const exportLeads = (filter) => rpc("admin_leads_export", { p_filter: filter || {} });

/** Link a lead to the pipeline card made for it (PT409 lead_already_linked). */
export const linkLeadToCard = (leadId, recordId) =>
  rpc("admin_lead_link_crm", { p_lead_id: leadId, p_record_id: recordId });

/** Stop a form submission's follow-up emails (the M3 path). */
export const stopFormEmails = (submissionId) =>
  rpc("admin_form_submission_stop_emails", { p_submission_id: submissionId });
