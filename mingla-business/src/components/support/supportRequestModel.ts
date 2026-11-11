/**
 * #4382 Wave 4 — the Host app's support request rules, kept free of React
 * Native and Supabase so they can be tested directly.
 *
 *   - the six Host topics and the image limits the backend enforces
 *     (issue_4382_register_support_attachment: 10 images, 10 MB each,
 *     png / jpeg / webp / heic);
 *   - client_meta: app version, OS, OS version, device model and source
 *     screen, nothing else (the database refuses any other key, and Mingla
 *     never sends a location);
 *   - the exact issue_4382_create_customer_ticket arguments (p_app 'host');
 *   - "My requests" keeps only tickets the signed-in person asked for;
 *   - the status banner and the closed-state composer.
 */

import copy from "../../i18n/locales/en/hostSupport.json";

export const HOST_SUPPORT_TOPICS = [
  "payouts",
  "tickets_checkin",
  "events",
  "venue",
  "account",
  "other",
] as const;
export type HostSupportTopic = (typeof HOST_SUPPORT_TOPICS)[number];

export const MAX_SUPPORT_IMAGES = 10;
export const MAX_SUPPORT_IMAGE_BYTES = 10 * 1024 * 1024;
export const SUPPORT_ATTACHMENTS_BUCKET = "support-attachments";
export const SUPPORT_SIGNED_URL_SECONDS = 3600;
export const SUPPORT_SUMMARY_MAX = 200;
export const SUPPORT_DETAILS_MAX = 8000;

export type SupportImageMime = "image/png" | "image/jpeg" | "image/webp" | "image/heic";

const EXTENSION_MIME: Record<string, SupportImageMime> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heic",
};

/** The upload MIME the backend accepts for this file, or null when it is refused. */
export function supportImageMime(
  mimeType: string | null | undefined,
  fileName: string | null | undefined,
): SupportImageMime | null {
  const mime = (mimeType ?? "").trim().toLowerCase();
  if (mime === "image/png" || mime === "image/jpeg" || mime === "image/webp" || mime === "image/heic") {
    return mime;
  }
  if (mime === "image/jpg") return "image/jpeg";
  if (mime === "image/heif") return "image/heic";
  if (mime !== "" && !mime.startsWith("image/")) return null;
  const ext = (fileName ?? "").toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  return EXTENSION_MIME[ext] ?? null;
}

export interface SupportPickedImage {
  uri: string;
  name: string;
  mimeType: string | null;
  size: number | null;
  width?: number | null;
  height?: number | null;
  /** Browser builds carry the File to upload. */
  webFile?: File;
}

export type SupportImageRefusal = "too_many" | "too_large" | "wrong_type";

/**
 * Add picked images to the ones already chosen, keeping the backend limits:
 * at most 10, each a supported type and at most 10 MB.
 */
export function addSupportImages<T extends SupportPickedImage>(
  existing: readonly T[],
  incoming: readonly T[],
): { images: T[]; refusals: SupportImageRefusal[] } {
  const images = [...existing];
  const refusals = new Set<SupportImageRefusal>();
  for (const image of incoming) {
    if (supportImageMime(image.mimeType, image.name) === null) {
      refusals.add("wrong_type");
      continue;
    }
    if (typeof image.size === "number" && image.size > MAX_SUPPORT_IMAGE_BYTES) {
      refusals.add("too_large");
      continue;
    }
    if (images.length >= MAX_SUPPORT_IMAGES) {
      refusals.add("too_many");
      continue;
    }
    images.push(image);
  }
  return { images, refusals: [...refusals] };
}

export const CLIENT_META_KEYS = [
  "app_version",
  "os",
  "os_version",
  "device_model",
  "source_screen",
] as const;
export type ClientMetaKey = (typeof CLIENT_META_KEYS)[number];
export type SupportClientMeta = Partial<Record<ClientMetaKey, string>>;

/**
 * App and device facts for the ticket. Only the five allowed keys survive;
 * anything else (a location included) is dropped before it leaves the phone.
 */
export function buildSupportClientMeta(input: Record<string, unknown>): SupportClientMeta {
  const meta: SupportClientMeta = {};
  for (const key of CLIENT_META_KEYS) {
    const value = input[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      meta[key] = String(value).slice(0, 120);
    } else if (typeof value === "string" && value.trim().length > 0 && value.trim() !== "unknown") {
      meta[key] = value.trim().slice(0, 120);
    }
  }
  return meta;
}

export interface HostCreateTicketInput {
  clientRequestId: string;
  topic: HostSupportTopic;
  summary: string;
  details: string;
  attachmentIds: readonly string[];
  clientMeta: SupportClientMeta;
  brandId: string | null;
}

export interface CreateCustomerTicketArgs {
  p_client_request_id: string;
  p_app: "host" | "explorer";
  p_topic: string;
  p_subject: string;
  p_message: string;
  p_attachment_ids: string[];
  p_client_meta: SupportClientMeta;
  p_brand_id: string | null;
  p_visibility: "person";
}

export function buildHostCreateTicketArgs(input: HostCreateTicketInput): CreateCustomerTicketArgs {
  if (!HOST_SUPPORT_TOPICS.includes(input.topic)) {
    throw new Error("invalid_topic");
  }
  return {
    p_client_request_id: input.clientRequestId,
    p_app: "host",
    p_topic: input.topic,
    p_subject: input.summary.trim().slice(0, SUPPORT_SUMMARY_MAX),
    p_message: input.details.trim().slice(0, SUPPORT_DETAILS_MAX),
    p_attachment_ids: [...input.attachmentIds],
    p_client_meta: buildSupportClientMeta(input.clientMeta),
    p_brand_id: input.brandId,
    // The request belongs to the person who sent it. The brand is what it is
    // about, not who can read it.
    p_visibility: "person",
  };
}

export interface OwnTicketRow {
  requester_user_id: string | null;
  visibility?: string | null;
  brand_id?: string | null;
}

/**
 * "My requests": tickets this person asked for, plus tickets shared with the
 * team of a brand they belong to (staff can open those for a brand, with no
 * requester). Never an internal ticket, and never another person's
 * person-visibility ticket, so a host who is also Mingla staff never sees
 * the whole queue.
 */
export function keepOwnTickets<T extends OwnTicketRow>(
  rows: readonly T[],
  userId: string,
  brandIds: readonly string[] = [],
): T[] {
  const brands = new Set(brandIds);
  return rows.filter(
    (row) =>
      row.visibility !== "internal" &&
      (row.requester_user_id === userId ||
        (row.visibility === "brand" && typeof row.brand_id === "string" && brands.has(row.brand_id))),
  );
}

/** The PostgREST `or` filter for "mine, or shared with one of my brands". */
export function ownOrBrandTicketFilter(userId: string, brandIds: readonly string[]): string {
  const mine = `requester_user_id.eq.${userId}`;
  return brandIds.length === 0
    ? mine
    : `${mine},and(visibility.eq.brand,brand_id.in.(${brandIds.join(",")}))`;
}

export function formatTicketNumber(ticketNumber: number | null | undefined): string {
  return typeof ticketNumber === "number" && Number.isFinite(ticketNumber)
    ? `S-${ticketNumber}`
    : "";
}

export function isTicketClosed(status: string | null | undefined): boolean {
  return status === "closed";
}

export type SupportBannerKind = "waiting_mingla" | "waiting_you" | "resolved" | "closed";

export interface SupportBanner {
  kind: SupportBannerKind;
  /** ISO time of the promised next update, shown while Mingla holds the request. */
  nextUpdateAt: string | null;
}

/** Where the request stands, for the banner at the top of the thread. */
export function supportStatusBanner(
  ticket: { status: string; next_update_at?: string | null },
  nowMs: number = Date.now(),
): SupportBanner {
  const next =
    typeof ticket.next_update_at === "string" && Date.parse(ticket.next_update_at) > nowMs
      ? ticket.next_update_at
      : null;
  switch (ticket.status) {
    case "closed":
      return { kind: "closed", nextUpdateAt: null };
    case "resolved":
      return { kind: "resolved", nextUpdateAt: null };
    case "pending":
      return { kind: "waiting_you", nextUpdateAt: next };
    default:
      return { kind: "waiting_mingla", nextUpdateAt: next };
  }
}

/**
 * The customer-safe Product stage of a request (from
 * issue_4382_ticket_product_stage). Shipped, told and won't-do have no stage:
 * the Told message or Support's own reply says it.
 */
export type SupportProductStage = "passed_to_product" | "being_built" | "final_checks";

const SUPPORT_PRODUCT_STAGES: readonly SupportProductStage[] = [
  "passed_to_product",
  "being_built",
  "final_checks",
];

/** Reads the RPC result; anything unexpected is "no banner", never a crash. */
export function parseSupportProductStage(raw: unknown): SupportProductStage | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const stage = (raw as { stage?: unknown }).stage;
  return typeof stage === "string" && (SUPPORT_PRODUCT_STAGES as readonly string[]).includes(stage)
    ? (stage as SupportProductStage)
    : null;
}

/** A sender-less system line in the thread, in the app's words when known. */
export function supportSystemLine(content: string | null | undefined): string {
  const text = String(content ?? "").trim();
  return text === "Reopened automatically" ? supportCopy("thread.reopened_marker") : text;
}

/** Copy keys for the Product banner under the status banner. */
export function supportProductBannerKeys(stage: SupportProductStage): { title: string; body: string } {
  switch (stage) {
    case "passed_to_product":
      return { title: "thread.product_passed", body: "thread.product_passed_body" };
    case "being_built":
      return { title: "thread.product_being_built", body: "thread.product_auto_body" };
    case "final_checks":
      return { title: "thread.product_final_checks", body: "thread.product_auto_body" };
    default: {
      const unreachable: never = stage;
      return unreachable;
    }
  }
}

/** What sits where the reply box is: the composer, or "Start a new request". */
export function supportComposerMode(status: string | null | undefined): "composer" | "start_new" {
  return isTicketClosed(status) ? "start_new" : "composer";
}

type CopyTree = { [key: string]: string | CopyTree };

/**
 * Host support copy. Every string lives in locales/en/hostSupport.json; the
 * Host app's other locales cover the brand group media only, so support
 * reads English until its translations land.
 */
export function supportCopy(key: string, variables: Record<string, string | number> = {}): string {
  let current: string | CopyTree = copy as CopyTree;
  for (const part of key.split(".")) {
    if (typeof current === "string" || !(part in current)) return key;
    current = current[part];
  }
  if (typeof current !== "string") return key;
  return current.replace(/{{\s*([A-Za-z0-9_]+)\s*}}/g, (token, name: string) =>
    Object.prototype.hasOwnProperty.call(variables, name) ? String(variables[name]) : token,
  );
}

export function createSupportRequestId(): string {
  const cryptoValue = (globalThis as {
    crypto?: { randomUUID?: () => string; getRandomValues?: (bytes: Uint8Array) => Uint8Array };
  }).crypto;
  if (typeof cryptoValue?.randomUUID === "function") return cryptoValue.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof cryptoValue?.getRandomValues === "function") {
    cryptoValue.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
