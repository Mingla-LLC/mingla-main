// #3969 — pure helpers for the admin contacts read (no Supabase import, so they run under node --test).

/** The admin contacts read refuses more than this many ids in one call. */
export const MAX_CONTACT_IDS_PER_CALL = 1000;

export function chunkIds(ids, size = MAX_CONTACT_IDS_PER_CALL) {
  const out = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/**
 * Runs `callRpc(chunk)` for every batch of at most 1000 ids and merges the rows.
 * Any failing batch throws: a partial answer is never returned as complete.
 */
export async function fetchContactsInChunks(ids, callRpc) {
  const rows = [];
  for (const chunk of chunkIds(ids)) {
    rows.push(...(await callRpc(chunk)));
  }
  return rows;
}

/**
 * Picks the one person an email names. Case-insensitive on the email; refuses
 * (never guesses) when there is no match or more than one.
 * Returns { user } or { error: "none" | "ambiguous" }.
 */
export function pickSingleContactByEmail(rows, email) {
  const wanted = String(email || "").trim().toLowerCase();
  const matches = (rows || []).filter((r) => String(r?.email || "").trim().toLowerCase() === wanted);
  if (wanted === "" || matches.length === 0) return { error: "none" };
  if (matches.length > 1) return { error: "ambiguous" };
  return { user: matches[0] };
}
