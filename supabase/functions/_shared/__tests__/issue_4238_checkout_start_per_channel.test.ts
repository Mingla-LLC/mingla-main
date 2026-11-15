// MINGLA-INVARIANT: I-4238-CHECKOUT-START-PER-CHANNEL | issue #4238 | a channel recorded sent for a checkout session is never sent again for that session; a checkout-start retry sends only the channels still open and merges their verdicts into ad_checkout_start_provider_response.
/**
 * #4238 W1-3 (D13). One TikTok 401 used to clear the checkout-start claim and
 * re-send Meta and Snap InitiateCheckout every hour for 24 h (about 550
 * duplicates, ledger L19). Hermetic: stateful fake session row, fake senders.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type Channel,
  type ConversionSendInput,
  fireAdCheckoutStart,
  type SenderResult,
} from "../adConversionFire.ts";

const SESSION_ID = "checkout-4238-w13";

/** A stateful ticket_checkout_sessions row; other tables return canned data. */
function statefulDb() {
  const session: Record<string, unknown> = {
    id: SESSION_ID,
    event_id: "ev-1",
    brand_id: "brand-1",
    total_cents: 2500,
    buyer_total_cents: 2750,
    currency: "GBP",
    buyer_user_id: "user-1",
    attribution_click_id: null,
    fbp: "fb.1.1.abc",
    fbc: null,
    scid: null,
    ttp: null,
    ad_tracking_opt_out: false,
    client_ip: null,
    client_user_agent: null,
    ad_checkout_start_sent_at: null,
    ad_checkout_start_provider_response: null,
    created_at: "2026-11-14T09:00:00.000Z",
  };
  const from = (table: string) => {
    let pending: Record<string, unknown> | null = null;
    const filters: Array<(row: Record<string, unknown>) => boolean> = [];
    let selecting = false;
    const apply = () => {
      if (table !== "ticket_checkout_sessions" || !pending) return null;
      if (!filters.every((filter) => filter(session))) return null;
      Object.assign(session, pending);
      pending = null;
      return { id: session.id };
    };
    const builder: Record<string, unknown> = {
      select: () => {
        selecting = true;
        return builder;
      },
      eq: () => builder,
      is: (column: string, value: unknown) => {
        filters.push((row) => (row[column] ?? null) === value);
        return builder;
      },
      update: (values: Record<string, unknown>) => {
        pending = values;
        return builder;
      },
      maybeSingle: () => {
        if (pending) return Promise.resolve({ data: apply(), error: null });
        if (table === "ticket_checkout_sessions") {
          return Promise.resolve({ data: { ...session }, error: null });
        }
        if (table === "ad_connections") {
          return Promise.resolve({ data: { extra: { dataset_id: "px", pixel_id: "px" } }, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      then: (resolve: (value: { data: unknown; error: null }) => unknown) => {
        const data = pending ? apply() : selecting ? [] : null;
        return resolve({ data, error: null });
      },
    };
    return builder;
  };
  return {
    client: { from } as unknown as Parameters<typeof fireAdCheckoutStart>[0],
    session,
  };
}

function countingSenders(outcomes: Record<"meta" | "tiktok" | "snap", SenderResult["status"][]>) {
  const calls: Record<string, number> = { meta: 0, tiktok: 0, snap: 0 };
  const make = (channel: "meta" | "tiktok" | "snap") =>
  (_input: ConversionSendInput): Promise<SenderResult> => {
    const status = outcomes[channel][calls[channel]] ?? outcomes[channel].at(-1) ?? "sent";
    calls[channel] += 1;
    return Promise.resolve(
      status === "sent"
        ? { channel: channel as Channel, status, httpStatus: 200 }
        : { channel: channel as Channel, status, reason: "http_401", httpStatus: 401 },
    );
  };
  return {
    calls,
    senders: { meta: make("meta"), tiktok: make("tiktok"), snap: make("snap") },
  };
}

Deno.test("#4238 W1-3 a retry after TikTok 401 sends only TikTok; Meta and Snap are sent exactly once", async () => {
  const { client, session } = statefulDb();
  const { calls, senders } = countingSenders({
    meta: ["sent"],
    tiktok: ["failed", "sent"],
    snap: ["sent"],
  });

  const first = await fireAdCheckoutStart(client, SESSION_ID, { senders });
  assertEquals(first.ok, true);
  assertEquals(calls, { meta: 1, tiktok: 1, snap: 1 });
  assertEquals(session.ad_checkout_start_sent_at, null, "claim cleared while TikTok is open");
  const afterFirst = session.ad_checkout_start_provider_response as Record<string, { status: string }>;
  assertEquals(afterFirst.meta.status, "sent");
  assertEquals(afterFirst.tiktok.status, "failed");
  assertEquals(typeof session.updated_at, "string");

  const retry = await fireAdCheckoutStart(client, SESSION_ID, { senders });
  assertEquals(retry.results?.map((result) => result.channel), ["tiktok"]);
  assertEquals(calls, { meta: 1, tiktok: 2, snap: 1 });
  const merged = session.ad_checkout_start_provider_response as Record<string, { status: string }>;
  assertEquals(
    [merged.meta.status, merged.tiktok.status, merged.snap.status],
    ["sent", "sent", "sent"],
  );
  assertEquals(typeof session.ad_checkout_start_sent_at, "string", "closed once every channel is sent");

  const third = await fireAdCheckoutStart(client, SESSION_ID, { senders });
  assertEquals(third.deduped, true);
  assertEquals(calls, { meta: 1, tiktok: 2, snap: 1 });
});

Deno.test("#4238 W1-3 a session whose every channel is settled is closed without sending", async () => {
  const { client, session } = statefulDb();
  session.ad_checkout_start_provider_response = {
    meta: { status: "sent", reason: null, http: 200 },
    tiktok: { status: "skipped", reason: "consent_rejected", http: null },
    snap: { status: "sent", reason: null, http: 200 },
  };
  const { calls, senders } = countingSenders({ meta: ["sent"], tiktok: ["sent"], snap: ["sent"] });
  const result = await fireAdCheckoutStart(client, SESSION_ID, { senders });
  assertEquals(result.deduped, true);
  assertEquals(calls, { meta: 0, tiktok: 0, snap: 0 });
  assertEquals(typeof session.ad_checkout_start_sent_at, "string");
});
