// Issue #4130 (Wave 5) — the Data room analytics reads.
//
// Each section is one gated, aggregate-only RPC (admin_data_room_*, migration
// 20280116004130): owners, admins and founding partners only. Each answer is
// { section, source: "snapshot" | "live", snapshot_date, as_of, data }.
// Every function throws on error so the page shows LoadError + Retry, never 0.
// The documents list stays on teamCollaborationService (admin-data-room).
import { supabase } from "../lib/supabase";

export const DATA_ROOM_SECTIONS = Object.freeze([
  "users",
  "overview",
  "explorers",
  "hosts",
  "funnels",
  "retention",
  "money",
]);

function readError(error) {
  const message = String(error?.message || "");
  if (/not_authorized/.test(message)) return "Only owners, admins and founding partners can see Data room numbers.";
  if (/no_snapshot_for_day/.test(message)) return "There is no stored snapshot for that day.";
  return message || "Couldn't load these numbers.";
}

/** One section, today (snapshot or live) or as of a stored day (YYYY-MM-DD). */
export async function getDataRoomSection(section, asOf = null) {
  if (!DATA_ROOM_SECTIONS.includes(section)) throw new Error(`Unknown Data room section: ${section}`);
  const { data, error } = await supabase.rpc(`admin_data_room_${section}`, { p_as_of: asOf || null });
  if (error) throw new Error(readError(error));
  if (!data || typeof data !== "object" || !data.data) throw new Error("The server sent no numbers.");
  return data;
}

/** The days a nightly snapshot exists for, newest first. */
export async function getDataRoomSnapshotDates() {
  const { data, error } = await supabase.rpc("admin_data_room_snapshot_dates");
  if (error) throw new Error(readError(error));
  return Array.isArray(data) ? data : [];
}
