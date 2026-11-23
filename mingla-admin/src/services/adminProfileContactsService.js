import { supabase } from "../lib/supabase";

/**
 * #3969 — the admin read of people's names, email and coach-mark step.
 * Emails are not on the public profile read; the console asks the server,
 * which checks the caller is an admin or support staff.
 */
export async function fetchAdminProfileContacts({ userIds = null, email = null } = {}) {
  const ids = userIds ? [...new Set(userIds.filter(Boolean))] : null;
  if (ids && ids.length === 0 && !email) return [];
  const { data, error } = await supabase.rpc("issue_3969_admin_profile_contacts", {
    p_user_ids: ids && ids.length > 0 ? ids : null,
    p_email: email || null,
  });
  if (error) throw error;
  return data || [];
}

/** Contacts by user id, as a map. Throws when the read fails. */
export async function fetchAdminProfileContactsById(userIds) {
  const rows = await fetchAdminProfileContacts({ userIds });
  const map = {};
  for (const row of rows) map[row.id] = row;
  return map;
}
