/**
 * ORCH-1150 — consumer-app RSVP write (Going / Not-going) for the discover deck.
 *
 * A discoverable RSVP event (host opted in via rsvp_discoverable) surfaces on the
 * deck with a Going/Not-going CTA instead of Book. The consumer app user is
 * authenticated, so the write rides the logged-in path: the JWT on the supabase
 * client lets the public-submit-rsvp edge fn resolve user_id (the link-guest
 * name+email+phone requirement does NOT apply — profile supplies contact + push).
 *
 * do NOT merge back into the checkout/booking path — RSVP writes a Going/Not-going
 * row, never an order. See SPEC §4.8 / §5.3.
 */

import { getSupabaseFunctionHeaders, supabase, supabaseUrl } from "./supabase";
// Unlisted RSVP invite link — the exact-link RSVP row, after the view misses.
import {
  fetchDirectRsvpEventRow,
  rsvpExtraGuestCountFromTheme,
  rsvpHostDisplayGatesFromTheme,
} from "./publicEventSeedService";
import type {
  RsvpAnonymousRecovery,
  RsvpPassCredential,
} from "@mingla/offering-rendering";
// issue #4508 — the pure guest model by subpath (no barrel, so partial jest
// mocks of the barrel are unaffected).
import { parseSubmittedGuests } from "@mingla/offering-rendering/rsvpGuestParse";
import {
  type RsvpGuestLookupResult,
  type RsvpGuestPayload,
  type RsvpSubmittedGuest,
} from "@mingla/offering-rendering/rsvpGuestParty";

/**
 * ORCH-1157 [rsvp-public-redesign] OQ-1 (resolved = option a) — the consumer RSVP
 * detail needs the live going-count + capacity + waitlist/approval to render the
 * Direction-C momentum unit, but the deck seed does NOT carry them (investigation
 * F-6). Rather than widen the deck-supply RPC (option b → would trip the
 * COMMS-0002 backend-allowlist gate), the consumer reads the SAME anon-safe
 * `business_public_events_view` the buyer-web page uses — one data contract, NO
 * migration, NO edge function. The view is security_invoker=false (definer) so the
 * anon/authenticated read is safe; it never touches `.from('brands')`.
 *
 * Returns null on a missing row (deleted/unpublished) — the screen then renders
 * the decision + chips WITHOUT a fabricated count (still honest, rule 9).
 */
export interface RsvpMomentumSnapshot {
  /**
   * Real confirmed-going headcount. issue #3827 going-box — `null` when the
   * host keeps the guest list private (the server withholds it). Never 0 for
   * a withheld count.
   */
  goingCount: number | null;
  /**
   * issue #3827 going-box — guests on the host's own list, set ONLY on the
   * exact-link path (read from that row's public theme). Undefined on the
   * public view path, where the social-proof payload carries it.
   */
  extraGuestCount?: number;
  capacity: number | null;
  allowPlusOnes: boolean;
  plusOnesMax: number;
  waitlistEnabled: boolean;
  manualApproval: boolean;
  // ORCH-1291 [rsvp-chip-in] — voluntary contribution config, surfaced from the
  // SAME anon-safe business_public_events_view. The shared RsvpOfferingBody's
  // guest chip-in panel renders only when rsvpContributionEnabled reaches its
  // config; before ORCH-1291's view redefinition these never left the DB so the
  // panel stayed dark on consumer (report §10.A). Defaults keep every free RSVP
  // unaffected (enabled=false → no panel).
  rsvpContributionEnabled: boolean;
  rsvpContributionSuggestedCents: number | null;
  rsvpContributionMinCents: number | null;
  // Unlisted RSVP invite link — the host's guest-list / remaining-count choices,
  // set ONLY when the snapshot came from the exact-link row (the social-proof
  // read answers NULL for an unlisted event). NULL on the public view path, where
  // the social-proof payload stays their source.
  privateGuestList: boolean | null;
  hideRemainingCount: boolean | null;
}

interface RsvpMomentumRow {
  rsvp_going_count: number | null;
  rsvp_capacity: number | null;
  rsvp_allow_plus_ones: boolean | null;
  rsvp_plus_ones_max: number | null;
  rsvp_waitlist_enabled: boolean | null;
  rsvp_approval_mode: "auto" | "manual" | null;
  // ORCH-1291 — chip-in config columns (view-surfaced; NULL/false for non-chip-in).
  rsvp_contribution_enabled: boolean | null;
  rsvp_contribution_suggested_cents: number | null;
  rsvp_contribution_min_cents: number | null;
}

export const fetchRsvpMomentum = async (
  eventId: string,
  // Unlisted RSVP invite link — the page's exact slugs. When the public view has
  // no row, the exact-link reader is asked with them; without them, unchanged.
  exactLink?: { brandSlug: string; eventSlug: string },
): Promise<RsvpMomentumSnapshot | null> => {
  const { data, error } = await supabase
    .from("business_public_events_view")
    .select(
      "rsvp_going_count,rsvp_capacity,rsvp_allow_plus_ones,rsvp_plus_ones_max,rsvp_approval_mode,rsvp_waitlist_enabled,rsvp_contribution_enabled,rsvp_contribution_suggested_cents,rsvp_contribution_min_cents",
    )
    .eq("id", eventId)
    .maybeSingle();
  if (error !== null) throw error;
  let row = data as RsvpMomentumRow | null;
  let hostGates: { privateGuestList: boolean | null; hideRemainingCount: boolean | null } = {
    privateGuestList: null,
    hideRemainingCount: null,
  };
  let hostExtraGuestCount: number | undefined;
  if (row === null && exactLink !== undefined) {
    const direct = await fetchDirectRsvpEventRow(exactLink.brandSlug, exactLink.eventSlug);
    // Only the SAME event: slugs that now name a different row are not this page.
    if (direct !== null && direct.id === eventId) {
      row = direct as unknown as RsvpMomentumRow;
      hostGates = rsvpHostDisplayGatesFromTheme(direct.public_theme);
      // issue #3827 going-box — the social-proof read answers NULL for an
      // unlisted event, so the host's own-list guests come from this row.
      hostExtraGuestCount = rsvpExtraGuestCountFromTheme(direct.public_theme);
    }
  }
  if (row === null) return null;
  return {
    // issue #3827 going-box — a withheld (private) count stays null.
    goingCount: typeof row.rsvp_going_count === "number" ? row.rsvp_going_count : null,
    extraGuestCount: hostExtraGuestCount,
    capacity: row.rsvp_capacity ?? null,
    allowPlusOnes: row.rsvp_allow_plus_ones ?? false,
    plusOnesMax: row.rsvp_plus_ones_max ?? 0,
    waitlistEnabled: row.rsvp_waitlist_enabled ?? false,
    manualApproval: row.rsvp_approval_mode === "manual",
    // ORCH-1291 — map the view's snake_case chip-in config into the camelCase
    // shape the ConsumerEventDetailScreen builds RsvpOfferingConfig from.
    rsvpContributionEnabled: row.rsvp_contribution_enabled ?? false,
    rsvpContributionSuggestedCents: row.rsvp_contribution_suggested_cents ?? null,
    rsvpContributionMinCents: row.rsvp_contribution_min_cents ?? null,
    privateGuestList: hostGates.privateGuestList,
    hideRemainingCount: hostGates.hideRemainingCount,
  };
};

export interface SubmitDeckRsvpResult {
  status: "going" | "not_going" | "waitlisted" | "maybe";
  approvalStatus: "pending" | "approved";
  // ORCH-1163 [rsvp-shared-body] — the written primary RSVP id + its signed
  // confirmation token, threaded back so the shared RsvpSuccessPopup (and the
  // consumer calendar pass) can reference the created row.
  rsvpId: string;
  confirmationToken: string | null;
  acknowledgement: "accepted" | "pending_approval" | "waitlisted" | "maybe" | "not_going";
  credentials: RsvpPassCredential[];
  anonymousRecovery: RsvpAnonymousRecovery[];
  /** issue #4508 — each person brought, with the link their text carries. */
  guests: RsvpSubmittedGuest[];
}

/** Pull the edge function's `{ error }` code out of a supabase invoke error. */
const invokeErrorCode = (
  error: { message?: string; context?: { body?: unknown } },
  fallback: string,
): string => {
  let code = error.message ?? fallback;
  const ctx = error.context;
  if (ctx?.body !== undefined && ctx.body !== null) {
    try {
      const parsed =
        typeof ctx.body === "string"
          ? (JSON.parse(ctx.body) as { error?: string })
          : (ctx.body as { error?: string });
      if (typeof parsed.error === "string" && parsed.error.length > 0) {
        code = parsed.error;
      }
    } catch {
      // keep the fallback code
    }
  }
  return code;
};

/**
 * issue #4508 1.2a — the live match under the RSVP guest number field
 * (public-submit-rsvp op `guest_lookup`). Signed in, so an account's name and
 * username come back. Throws Error(code): rate_limited, unavailable,
 * rsvp_guest_phone_invalid, …
 */
export const lookupRsvpGuest = async (
  eventId: string,
  phone: string,
): Promise<RsvpGuestLookupResult> => {
  const { data, error } = await supabase.functions.invoke("public-submit-rsvp", {
    body: { op: "guest_lookup", eventId, phone },
  });
  if (error !== null) {
    throw new Error(invokeErrorCode(error as { message?: string; context?: { body?: unknown } }, "unavailable"));
  }
  return parseRsvpGuestLookup(data);
};

export const parseRsvpGuestLookup = (data: unknown): RsvpGuestLookupResult => {
  const row = (data ?? {}) as Record<string, unknown>;
  const user = row.user as Record<string, unknown> | null | undefined;
  const text = (v: unknown): string | null =>
    typeof v === "string" && v.trim().length > 0 ? v : null;
  return {
    valid: row.valid === true,
    isYou: row.isYou === true,
    onMingla: row.onMingla === true,
    alreadyOnList: row.alreadyOnList === true,
    released: row.released === true,
    user:
      user !== null && user !== undefined && typeof user.id === "string"
        ? {
            id: user.id,
            displayName: text(user.displayName),
            username: text(user.username),
            avatarUrl: text(user.avatarUrl),
          }
        : null,
  };
};

/**
 * Write the signed-in user's Going / Maybe / Not-going for a discoverable RSVP
 * event. Throws an Error whose message is the edge-fn error code (rsvp_full /
 * rsvp_not_open / …) so the caller can show the right toast.
 *
 * ORCH-1157 [rsvp-public-redesign] — "maybe" added to the write enum so the
 * consumer RSVP detail reaches parity with the shared RsvpPublicBody (which has
 * had Maybe since ORCH-1150 R2). The public-submit-rsvp edge fn already accepts
 * "maybe"; this only widens the consumer caller (was narrowed to going/not_going).
 */
export const submitDeckRsvp = async (
  eventId: string,
  rsvpStatus: "going" | "not_going" | "maybe",
  // ORCH-1163 [rsvp-shared-body] — optional per-guest plus-one contacts (FLOW B).
  // Passed straight through to the edge fn body; omitted (empty) keeps the call
  // byte-identical to the prior no-guests path.
  // issue #4508 — number-only guests ({ phone, phoneCountryIso }).
  guests?: RsvpGuestPayload[],
  primary?: { name: string; email: string; phone: string; phoneCountryIso?: string | null },
): Promise<SubmitDeckRsvpResult> => {
  const { data, error } = await supabase.functions.invoke("public-submit-rsvp", {
    body: {
      eventId,
      rsvpStatus,
      guests: guests ?? [],
      plusCount: guests?.length ?? 0,
      guestName: primary?.name,
      guestEmail: primary?.email,
      guestPhone: primary?.phone,
      guestPhoneCountryIso: primary?.phoneCountryIso,
    },
  });
  if (error !== null) {
    throw new Error(
      invokeErrorCode(error as { message?: string; context?: { body?: unknown } }, "rsvp_write_failed"),
    );
  }
  const res = (data ?? {}) as {
    status?: "going" | "not_going" | "waitlisted" | "maybe";
    approvalStatus?: "pending" | "approved";
    rsvpId?: string;
    confirmationToken?: string | null;
    acknowledgement?: SubmitDeckRsvpResult["acknowledgement"];
    credentials?: RsvpPassCredential[];
    anonymousRecovery?: RsvpAnonymousRecovery[];
    guests?: unknown;
  };
  return {
    status: res.status ?? rsvpStatus,
    approvalStatus: res.approvalStatus ?? "approved",
    rsvpId: res.rsvpId ?? "",
    confirmationToken: res.confirmationToken ?? null,
    acknowledgement: res.acknowledgement ??
      (res.approvalStatus === "pending" ? "pending_approval" :
        (res.status === "waitlisted" || res.status === "maybe" || res.status === "not_going")
          ? res.status : "accepted"),
    credentials: res.credentials ?? [],
    anonymousRecovery: res.anonymousRecovery ?? [],
    guests: parseSubmittedGuests(res.guests),
  };
};

export interface RsvpPassFetchResult {
  pdf: { filename: string; contentBase64: string };
}

interface RsvpPartyPassRow {
  entity_type: "primary" | "guest";
  entity_id: string;
  display_name: string;
  qr_code: string;
  // issue #4508 contract §4 — present once the bring-a-friend migration is
  // applied; absent on older servers (read as unknown, never invented).
  claimed?: boolean | null;
  invited_by_name?: string | null;
  invite_status?: string | null;
  invite_link?: string | null;
  phone_last4?: string | null;
  // issue #4508 C2 — the host's "Bring someone too" setting, on the viewer's
  // own pass rows only.
  guests_can_bring?: boolean | null;
}

/** issue #4508 1.24 — one person the inviter brought, as the pass sheet shows them. */
export interface RsvpPartyGuestStatus {
  guestId: string;
  displayName: string;
  /** null ⇒ the server did not say (older server). */
  claimed: boolean | null;
  inviteStatus: "sent" | "sending" | "failed" | "not_texted" | null;
  inviteLink: string | null;
  phoneLast4: string | null;
}

export interface RsvpPartyDetails {
  credentials: RsvpPassCredential[];
  /** Guests of the caller's own RSVP (the primary's view only). */
  guests: RsvpPartyGuestStatus[];
  /**
   * issue #4508 2.5 / C2 — the host lets a claimed guest bring one more
   * person. Read from the viewer's own pass row; false when absent.
   */
  guestsCanBring: boolean;
}

const INVITE_STATUSES = new Set(["sent", "sending", "failed", "not_texted"]);

export const mapRsvpPartyRows = (rows: unknown): RsvpPartyDetails => {
  const list = (Array.isArray(rows) ? rows : []) as RsvpPartyPassRow[];
  return {
    credentials: list.map((row) => ({
      entityType: row.entity_type,
      entityId: row.entity_id,
      displayName: row.display_name,
      qrCode: row.qr_code,
      pdfFetchRef: row.entity_id,
    })),
    guests: list
      // invite_status is filled only for the RSVP's owner (contract §4).
      .filter((row) => row.entity_type === "guest" && typeof row.invite_status === "string")
      .map((row) => ({
        guestId: row.entity_id,
        displayName: row.display_name,
        claimed: typeof row.claimed === "boolean" ? row.claimed : null,
        inviteStatus: INVITE_STATUSES.has(row.invite_status ?? "")
          ? (row.invite_status as RsvpPartyGuestStatus["inviteStatus"])
          : null,
        inviteLink: typeof row.invite_link === "string" && row.invite_link.length > 0
          ? row.invite_link
          : null,
        phoneLast4: typeof row.phone_last4 === "string" && row.phone_last4.length > 0
          ? row.phone_last4
          : null,
      })),
    // R-6: only a guest who has claimed their pass may bring someone; the
    // server already says so, and an unclaimed row never turns it on here.
    guestsCanBring: list.some(
      (row) =>
        row.entity_type === "guest" &&
        row.guests_can_bring === true &&
        row.claimed === true,
    ),
  };
};

export const fetchRsvpPartyDetails = async (
  rsvpId: string,
): Promise<RsvpPartyDetails> => {
  const { data, error } = await supabase.rpc("fetch_user_rsvp_party_passes", {
    p_rsvp_id: rsvpId,
  });
  if (error) throw error;
  return mapRsvpPartyRows(data);
};

export const fetchRsvpPartyPasses = async (
  rsvpId: string,
): Promise<RsvpPassCredential[]> =>
  (await fetchRsvpPartyDetails(rsvpId)).credentials;

export type RsvpGuestBringResult =
  | { ok: true; guestId: string | null; inviteUrl: string | null }
  | { ok: false; code: string };

/** issue #4508 2.5 — a claimed guest brings one more person (op guest_bring). */
export const bringRsvpGuest = async (
  guestId: string,
  phone: string,
  phoneCountryIso: string | null,
): Promise<RsvpGuestBringResult> => {
  const { data, error } = await supabase.functions.invoke("public-submit-rsvp", {
    body: {
      op: "guest_bring",
      guestId,
      phone,
      ...(phoneCountryIso ? { phoneCountryIso } : {}),
    },
  });
  if (error !== null) {
    return {
      ok: false,
      code: invokeErrorCode(error as { message?: string; context?: { body?: unknown } }, "unavailable"),
    };
  }
  const row = (data ?? {}) as Record<string, unknown>;
  return row.outcome === "added"
    ? {
        ok: true,
        guestId: typeof row.guestId === "string" ? row.guestId : null,
        inviteUrl: typeof row.inviteUrl === "string" ? row.inviteUrl : null,
      }
    : { ok: false, code: typeof row.error === "string" ? row.error : "unavailable" };
};

/** issue #4508 2.5 — guest_bring refusals in plain words. */
export const rsvpGuestBringMessage = (code: string): string => {
  if (code.includes("not_allowed")) return "This host isn't letting guests bring anyone.";
  if (code.includes("already_brought")) return "You've already brought someone to this event.";
  if (code.includes("rsvp_full")) return "This event is full, so there's no room for another guest.";
  if (code.includes("not_your_pass") || code.includes("ineligible")) return "Only a guest with a claimed pass can bring someone.";
  if (code.includes("rsvp_guest_own_number")) return "That's you. Enter a friend's number.";
  if (code.includes("rsvp_guest_already_listed")) return "That person is already on the list.";
  if (code.includes("rsvp_guest_released")) return "That number can't be invited to this event.";
  if (code.includes("rsvp_guest_daily_cap")) return "You've invited a lot of numbers today. Try again tomorrow.";
  if (code.includes("rsvp_guest_phone")) return "Enter a valid phone number.";
  if (code.includes("rate_limited")) return "Too many tries in a row. Wait a minute, then try again.";
  // #4508 T1: a session the server could not verify.
  if (code.includes("rsvp_guest_sign_in_required")) return "Update or open the Mingla app to bring someone";
  // #4508 P3: a server without bring-a-friend answers the op as an unknown payload.
  if (code.includes("rsvp_payload_invalid")) return "Bringing someone isn't available yet. Try again soon.";
  return "We couldn't add them just now. Try again.";
};

const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
};

const pdfFilename = (disposition: string | null): string => {
  const match = disposition?.match(/filename="?([^";]+)"?/i);
  return match?.[1] ?? "rsvp-pass.pdf";
};

export const fetchRsvpPassPdf = async (
  entityId: string,
  recoveryToken?: string | null,
  entityType: "primary" | "guest" = "primary",
): Promise<RsvpPassFetchResult> => {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  const response = await fetch(`${supabaseUrl}/functions/v1/rsvp-pass-fetch`, {
    method: "POST",
    headers: {
      ...getSupabaseFunctionHeaders(sessionData.session?.access_token),
      Accept: "application/pdf",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ entityType, entityId, recoveryToken: recoveryToken ?? null }),
  });
  if (!response.ok) throw new Error(`rsvp_pdf_${response.status}`);
  if (!response.headers.get("content-type")?.startsWith("application/pdf")) {
    throw new Error("rsvp_pdf_invalid_content_type");
  }
  return {
    pdf: {
      filename: pdfFilename(response.headers.get("content-disposition")),
      contentBase64: arrayBufferToBase64(await response.arrayBuffer()),
    },
  };
};
