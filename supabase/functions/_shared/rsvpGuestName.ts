// Issue #4508 R-9 — a plus-one's name on a pass (the submit response's
// credentials and the pass PDF) follows the same 1.11 rule as every other
// reader: the matched account's name, else the name given, else
// "<Inviter first name>'s guest" (rsvp_guest_display_name). A number-only
// guest has no stored name, so reading the row's raw name would print
// "Guest" instead.

export interface GuestNameClient {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{
    data: unknown;
    error: { message?: string | null; code?: string | null } | null;
  }>;
}

/** The 1.11 display name; `fallback` only when the database cannot answer. */
export async function rsvpGuestDisplayName(
  client: GuestNameClient,
  guestId: string,
  fallback: string | null | undefined,
): Promise<string> {
  const last = typeof fallback === "string" && fallback.trim().length > 0
    ? fallback.trim()
    : "Guest";
  try {
    const { data, error } = await client.rpc("rsvp_guest_display_name", {
      p_guest_id: guestId,
    });
    if (error) {
      console.warn(JSON.stringify({
        event: "rsvp_guest_display_name_failed",
        code: String(error.code ?? "unknown"),
      }));
      return last;
    }
    return typeof data === "string" && data.trim().length > 0
      ? data.trim()
      : last;
  } catch {
    console.warn(JSON.stringify({
      event: "rsvp_guest_display_name_failed",
      code: "threw",
    }));
    return last;
  }
}
