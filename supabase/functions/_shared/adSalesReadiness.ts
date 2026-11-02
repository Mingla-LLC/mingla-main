/**
 * #4238 — a read-only preview of whether a provider account can optimise a
 * Host ad for ticket sales right now.
 *
 * It mirrors the live-signal gates Admin Sales uses in admin-ad-create-campaign
 * (Meta dataset last fired, Snapchat / TikTok purchase events in the last 28
 * days). It is a PREVIEW only: the create-campaign gates stay authoritative and
 * re-check at validate and create. Every failure reads "not ready" — a provider
 * error or timeout never claims readiness.
 */

import type { AdConnectionRow } from "./adChannelCore.ts";
import { metaFetchPixelLastFired, resolveMetaClient } from "./meta.ts";
import {
  resolveSnapchatClient,
  snapchatFetchPurchaseSignal28d,
} from "./snapchat.ts";
import { resolveTikTokClient, tiktokFetchPurchaseSignal28d } from "./tiktok.ts";

/** Minimum provider purchase events in 28 days before Sales is allowed. */
export const PURCHASE_SIGNAL_MIN_28D = 20;

export type SalesReadinessReason =
  | "ready"
  | "not_supported"
  | "no_pixel"
  | "waiting_for_sales"
  | "unknown";

export type SalesReadiness = { ready: boolean; reason: SalesReadinessReason };

/** Platforms with a website-sales optimisation path Host ads can use. */
export const HOST_SALES_PLATFORMS = ["meta", "snapchat", "tiktok"] as const;

export type SalesSignalProbes = {
  metaHasSignal(conn: AdConnectionRow): Promise<boolean>;
  snapchatPurchases28d(conn: AdConnectionRow, pixelId: string): Promise<number>;
  tiktokPurchases28d(conn: AdConnectionRow, pixelId: string): Promise<number>;
};

export const liveSalesSignalProbes: SalesSignalProbes = {
  async metaHasSignal(conn) {
    const pixel = await metaFetchPixelLastFired(resolveMetaClient(conn));
    return pixel.hasSignal;
  },
  async snapchatPurchases28d(conn, pixelId) {
    const client = await resolveSnapchatClient(conn);
    const signal = await snapchatFetchPurchaseSignal28d(client, pixelId);
    return signal.purchaseEvents28d;
  },
  async tiktokPurchases28d(conn, pixelId) {
    const signal = await tiktokFetchPurchaseSignal28d(
      resolveTikTokClient(conn),
      pixelId,
    );
    return signal.purchaseEvents28d;
  },
};

function extraString(conn: AdConnectionRow, key: string): string {
  const extra = conn.extra && typeof conn.extra === "object" ? conn.extra : {};
  const value = (extra as Record<string, unknown>)[key];
  return typeof value === "string" ? value.trim() : "";
}

function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("sales_readiness_timeout")),
      timeoutMs,
    );
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

const UNKNOWN: SalesReadiness = { ready: false, reason: "unknown" };

/** Read-only provider GETs; never spends, never throws. */
export async function salesReadiness(
  conn: AdConnectionRow,
  probes: SalesSignalProbes = liveSalesSignalProbes,
  timeoutMs = 4000,
): Promise<SalesReadiness> {
  try {
    if (conn.platform === "meta") {
      if (!extraString(conn, "dataset_id")) {
        return { ready: false, reason: "no_pixel" };
      }
      const hasSignal = await withTimeout(
        probes.metaHasSignal(conn),
        timeoutMs,
      );
      return hasSignal === true
        ? { ready: true, reason: "ready" }
        : { ready: false, reason: "waiting_for_sales" };
    }
    if (conn.platform === "snapchat" || conn.platform === "tiktok") {
      const pixelId = extraString(conn, "pixel_id");
      if (!pixelId) return { ready: false, reason: "no_pixel" };
      const count = await withTimeout(
        conn.platform === "snapchat"
          ? probes.snapchatPurchases28d(conn, pixelId)
          : probes.tiktokPurchases28d(conn, pixelId),
        timeoutMs,
      );
      if (!Number.isFinite(count)) return UNKNOWN;
      return count >= PURCHASE_SIGNAL_MIN_28D
        ? { ready: true, reason: "ready" }
        : { ready: false, reason: "waiting_for_sales" };
    }
    return { ready: false, reason: "not_supported" };
  } catch (err) {
    // Fail closed: an unreadable signal is never "ready". The authoritative
    // create-campaign gate reports the real provider error at validate.
    console.warn("[ad-sales-readiness] signal unreadable", {
      platform: conn.platform,
      error: err instanceof Error ? err.name : "unknown",
    });
    return UNKNOWN;
  }
}
