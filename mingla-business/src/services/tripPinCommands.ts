/**
 * #4334 — a trip patch that sends a departure or destination place id goes
 * through the command's `_repick` twin, which asserts those ids so the same
 * place re-picked onto refined coordinates keeps its place id (the plain
 * command clears the id of any pin that moves). Every other patch uses the
 * plain command. Loaded on demand by tripsService, out of the boot payload.
 */
import { supabase } from "./supabase";

/** Does this trip patch send a departure or destination place id? */
export const tripPatchSendsPlaceId = (patch: unknown): boolean => {
  const groups = patch as {
    event?: { business_trip?: Record<string, unknown> };
    theme?: { business_trip?: Record<string, unknown> };
  } | null;
  return [groups?.event?.business_trip, groups?.theme?.business_trip].some(
    (trip) =>
      typeof trip?.departurePlaceId === "string" ||
      typeof trip?.destinationPlaceId === "string",
  );
};

/**
 * [TRANSITIONAL] until 20280526004334 is applied the twin is missing
 * (PGRST202) and the plain command runs instead, with the same arguments.
 * Exit: the migration is live.
 */
export const tripRpcKeepingPins = async (
  name: "biz_apply_trip_draft_graph" | "biz_update_trip_live_command",
  args: Record<string, unknown>,
): Promise<{ data: unknown; error: { code?: string; message: string } | null }> => {
  if (!tripPatchSendsPlaceId(args.p_patch)) return supabase.rpc(name, args);
  const first = await supabase.rpc(`${name}_repick`, args);
  return first.error?.code === "PGRST202" ? supabase.rpc(name, args) : first;
};
