import type {
  EventType,
  FireAdConversionInput,
  Lane,
  Surface,
} from "./adConversionFire.ts";

export const AD_CONVERSION_RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;
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

export interface AdConversionRetryRow {
  event_id: string;
  order_id: string | null;
  stay_group_id: string | null;
  event_type: EventType;
  surface: Surface;
  lane: Lane;
  updated_at: string;
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

export const conversionRetryInput = (
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

export const retryGraceCutoff = (nowMs: number): string =>
  new Date(nowMs - AD_CONVERSION_RETRY_GRACE_MS).toISOString();
