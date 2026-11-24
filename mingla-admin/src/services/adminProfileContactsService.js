import { supabase } from "../lib/supabase";
import { fetchContactsInChunks } from "../lib/profileContactsPure";

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
  // The server read refuses more than 1000 ids per call: ask in batches.
  const ids = [...new Set((userIds || []).filter(Boolean))];
  const rows = await fetchContactsInChunks(ids, (chunk) =>
    fetchAdminProfileContacts({ userIds: chunk }),
  );
  const map = {};
  for (const row of rows) map[row.id] = row;
  return map;
}
