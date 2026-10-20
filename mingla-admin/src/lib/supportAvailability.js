/**
 * #3720 — the "Available for support" switch in the Community & Support header.
 *
 * Changing availability can fail (most often because Support is not turned on
 * for the signed-in teammate, which the RPC refuses with `not_support_staff`). The switch must then stay where it was and say why in
 * plain words, never fail silently or leak a raw database error.
 *
 * Pure module with no imports so the Deno suite can exercise it directly.
 */

export const NOT_ON_SUPPORT_ROSTER_MESSAGE =
  "Support isn't turned on for you yet. Ask an Owner or Admin to turn it on in Community & Support → People and roles.";
export const AVAILABLE_ON_MESSAGE =
  "You're available. Hosts see Support is online and you'll get alerts.";
export const AVAILABLE_OFF_MESSAGE =
  "You're away. You can still answer tickets; you just won't get alerts.";
export const AVAILABILITY_CHANGE_FAILED_MESSAGE =
  "Couldn't change your availability. Try again.";

/** Plain-English message for a failed availability change. */
export function supportAvailabilityErrorMessage(error) {
  const text = [error?.message, error?.details, error?.hint]
    .filter((part) => typeof part === "string")
    .join(" ");
  if (/\bnot_support_staff\b/.test(text)) return NOT_ON_SUPPORT_ROSTER_MESSAGE;
  return AVAILABILITY_CHANGE_FAILED_MESSAGE;
}

/**
 * Ask the server to change availability and report what is now true.
 * Never throws: on failure the previous value is kept and a message returned.
 *
 * @param {{ next: boolean, current: boolean, setAvailable: (next: boolean) => Promise<unknown> }} input
 * @returns {Promise<{ available: boolean, message: string | null }>}
 */
export async function changeSupportAvailability({ next, current, setAvailable }) {
  try {
    const confirmed = await setAvailable(Boolean(next));
    return {
      available: typeof confirmed === "boolean" ? confirmed : Boolean(next),
      message: null,
    };
  } catch (error) {
    return {
      available: Boolean(current),
      message: supportAvailabilityErrorMessage(error),
    };
  }
}
