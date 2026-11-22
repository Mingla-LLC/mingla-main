/**
 * #4548 — Host read and write of an event's guest pack.
 *
 * Both calls go through the reviewed server functions
 * (`biz_get_event_guest_pack`, `biz_set_event_guest_pack`); the table has no
 * client access. Services throw: a caller never mistakes a failure for "no pack".
 */

import { supabase } from "./supabase";
import type { GuestPackPayload } from "../utils/guestPackValidation";

export interface SavedGuestPack {
  note: string | null;
  items: Array<{ label: string; url: string }>;
  updatedAt: string | null;
}

export type GuestPackErrorCode =
  | "unsupported_event_type"
  | "note_too_long"
  | "items_invalid"
  | "not_authorized"
  | "event_not_found"
  | "server";

export class GuestPackServiceError extends Error {
  readonly code: GuestPackErrorCode;
  constructor(code: GuestPackErrorCode, message: string) {
    super(message);
    this.name = "GuestPackServiceError";
    this.code = code;
  }
}

function codeFromMessage(message: string): GuestPackErrorCode {
  if (message.includes("guest_pack_unsupported_event_type")) {
    return "unsupported_event_type";
  }
  if (message.includes("guest_pack_note_too_long")) return "note_too_long";
  if (message.includes("guest_pack_items_invalid")) return "items_invalid";
  if (message.includes("not_authorized") || message.includes("authentication_required")) {
    return "not_authorized";
  }
  if (message.includes("event_not_found")) return "event_not_found";
  return "server";
}

/** Reads the wire shape defensively; anything that is not a pack is "no pack". */
export function parseSavedGuestPack(value: unknown): SavedGuestPack | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const row = value as Record<string, unknown>;
  const note = typeof row.note === "string" && row.note !== "" ? row.note : null;
  const items: SavedGuestPack["items"] = [];
  if (Array.isArray(row.items)) {
    for (const raw of row.items) {
      if (raw === null || typeof raw !== "object") continue;
      const item = raw as Record<string, unknown>;
      if (typeof item.label === "string" && typeof item.url === "string") {
        items.push({ label: item.label, url: item.url });
      }
    }
  }
  if (note === null && items.length === 0) return null;
  return {
    note,
    items,
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : null,
  };
}

export async function fetchEventGuestPack(
  eventId: string,
): Promise<SavedGuestPack | null> {
  const { data, error } = await supabase.rpc("biz_get_event_guest_pack", {
    p_event_id: eventId,
  });
  if (error) {
    throw new GuestPackServiceError(codeFromMessage(error.message ?? ""), error.message ?? "");
  }
  return parseSavedGuestPack(data);
}

/** Replaces the whole pack. An empty payload deletes it and returns null. */
export async function saveEventGuestPack(
  eventId: string,
  payload: GuestPackPayload,
): Promise<SavedGuestPack | null> {
  const { data, error } = await supabase.rpc("biz_set_event_guest_pack", {
    p_event_id: eventId,
    p_note: payload.note,
    p_items: payload.items.map((item) => ({ label: item.label, url: item.url })),
  });
  if (error) {
    throw new GuestPackServiceError(codeFromMessage(error.message ?? ""), error.message ?? "");
  }
  return parseSavedGuestPack(data);
}
