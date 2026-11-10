/**
 * #4334 — a trip patch that sends a departure or destination place id goes
 * through the command's pin-keeping twin (`biz_repick_*`), which asserts those ids so the same
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
 * The pin-keeping twin's result, or null when the caller should run the plain
 * command: the patch sends no place id, or the twin is missing (PGRST202).
 * [TRANSITIONAL] PGRST202 until 20280526004334 is applied. Exit: the
 * migration is live.
 */
export const repickTripRpc = async (
  /** The command's name after `biz_`: its twin is `biz_repick_<name>`. */
  name: "apply_trip_draft_graph" | "update_trip_live_command",
  args: Record<string, unknown>,
): Promise<{ data: unknown; error: { code?: string; message: string } | null } | null> => {
  if (!tripPatchSendsPlaceId(args.p_patch)) return null;
  const twin = await supabase.rpc(`biz_repick_${name}`, args);
  return twin.error?.code === "PGRST202" ? null : twin;
};
