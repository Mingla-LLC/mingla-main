import type {
  Channel,
  EventType,
  FireAdConversionInput,
  Lane,
  Surface,
} from "./adConversionFire.ts";
import { classifyReason, isLongRetryClass } from "./adSendOutcome.ts";
import { parseHostFunnelEventId } from "./adEventCatalog.ts";

/**
 * #4238 W3-3: the ad_conversions.event_type values the retry lane re-fires.
 * `lead` is the host lead; the three host kinds are queued by the M-2 triggers
 * (sign-up, first publish) and hostFirstSale.ts (first sale).
 */
export const RETRY_EVENT_TYPES = [
  "purchase",
  "reservation",
  "lead",
  "host_signup",
  "host_first_publish",
  "host_first_sale",
] as const;

export const AD_CONVERSION_RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;
/**
 * #4238 W1-2: a missing or rejected key (config/auth class) is retried for
 * 72 h, so restoring the key within three days recovers the events. Every
 * other failure keeps the 24 h window.
 */
export const AD_CONVERSION_CONFIG_RETRY_WINDOW_MS = 72 * 60 * 60 * 1000;
export const AD_CONVERSION_RETRY_GRACE_MS = 5 * 60 * 1000;
export const AD_CONVERSION_RETRY_BATCH = 100;

export const RETRY_STATUS_COLUMNS = [
  "meta_capi_status",
  "tiktok_events_status",
  "snap_capi_status",
  "reddit_capi_status",
  "google_ads_status",
] as const;

export type RetryStatusColumn = typeof RETRY_STATUS_COLUMNS[number];

export const RETRY_COLUMN_CHANNEL: Record<RetryStatusColumn, Channel> = {
  meta_capi_status: "meta",
  tiktok_events_status: "tiktok",
  snap_capi_status: "snap",
  reddit_capi_status: "reddit",
  google_ads_status: "google",
};

export interface AdConversionRetryRow {
  event_id: string;
  order_id: string | null;
  stay_group_id: string | null;
  event_type: EventType;
  surface: Surface;
  lane: Lane;
  updated_at: string;
  /** #4238 W1-2: the row's age decides the 24 h / 72 h window. */
  created_at?: string | null;
  /** #4238 W1-2: the per-channel reason decides the failure class. */
  provider_response?: Record<string, unknown> | null;
  meta_capi_status: string;
  tiktok_events_status: string;
  snap_capi_status: string;
  reddit_capi_status: string;
  google_ads_status: string;
}

export const failedStatusesToPending = (
  row: AdConversionRetryRow,
): Partial<Record<RetryStatusColumn, "pending">> =>
  Object.fromEntries(
    RETRY_STATUS_COLUMNS
      .filter((column) => row[column] === "failed")
      .map((column) => [column, "pending"]),
  ) as Partial<Record<RetryStatusColumn, "pending">>;

function channelReason(
  row: AdConversionRetryRow,
  channel: Channel,
): string | null {
  const entry = row.provider_response?.[channel];
  if (!entry || typeof entry !== "object") return null;
  const reason = (entry as Record<string, unknown>).reason;
  return typeof reason === "string" ? reason : null;
}

/**
 * #4238 W1-2: the failed channels that go back to `pending` on this run. A row
 * up to 24 h old retries every failed channel (unchanged #3697 behaviour). A
 * row 24-72 h old retries only channels whose recorded reason is a config or
 * auth failure (a missing or rejected key). Older rows retry nothing.
 */
export function retryableChannels(
  row: AdConversionRetryRow,
  nowMs: number,
): Partial<Record<RetryStatusColumn, "pending">> {
  const created = row.created_at ? Date.parse(row.created_at) : NaN;
  const ageMs = Number.isFinite(created) ? nowMs - created : 0;
  if (ageMs > AD_CONVERSION_CONFIG_RETRY_WINDOW_MS) return {};
  const failed = failedStatusesToPending(row);
  if (ageMs <= AD_CONVERSION_RETRY_WINDOW_MS) return failed;
  return Object.fromEntries(
    (Object.keys(failed) as RetryStatusColumn[])
      .filter((column) =>
        isLongRetryClass(
          classifyReason(channelReason(row, RETRY_COLUMN_CHANNEL[column])),
        )
      )
      .map((column) => [column, "pending"]),
  ) as Partial<Record<RetryStatusColumn, "pending">>;
}

export const conversionRetryInput = (
  row: AdConversionRetryRow,
): FireAdConversionInput => {
  // #4238 W3-3: a host-funnel row re-fires as its host event.
  const host = parseHostFunnelEventId(row.event_id);
  if (host) {
    return {
      hostEvent: { ...host, eventId: row.event_id },
      eventType: row.event_type,
      surface: row.surface,
      lane: row.lane,
    };
  }
  return legacyRetryInput(row);
};

const legacyRetryInput = (
  row: AdConversionRetryRow,
): FireAdConversionInput => ({
  ...(row.order_id
    ? { orderId: row.order_id }
    : row.stay_group_id
    ? { stayGroupId: row.stay_group_id }
    : { reservationId: row.event_id }),
  eventType: row.event_type,
  surface: row.surface,
  lane: row.lane,
});

export const retryWindowCutoff = (nowMs: number): string =>
  new Date(nowMs - AD_CONVERSION_RETRY_WINDOW_MS).toISOString();

export const configRetryWindowCutoff = (nowMs: number): string =>
  new Date(nowMs - AD_CONVERSION_CONFIG_RETRY_WINDOW_MS).toISOString();

export const retryGraceCutoff = (nowMs: number): string =>
  new Date(nowMs - AD_CONVERSION_RETRY_GRACE_MS).toISOString();
