// META-ORCH-1161 Sub-A — notify-dispatch v2 core (the {category_key,...} contract).
//
// Simultaneous-send model (DEC-185): write the in-app delivery ALWAYS, then for
// EACH channel in category.default_channels, if can_send() passes, fire the
// adapter — ALL channels fire simultaneously (NO push-first/SMS-fallback
// waterfall). Each attempt writes a notification_deliveries row.
//
// This module is imported by notify-dispatch/index.ts (the v2 branch). The legacy
// dispatchNotification/type path in index.ts is left BYTE-IDENTICAL.

import { pushAdapter } from "./adapters/pushAdapter.ts";
import { emailAdapter } from "./adapters/emailAdapter.ts";
import { smsAdapter } from "./adapters/smsAdapter.ts";
import { renderCategoryMessage } from "./notifyTemplates.ts";

// Minimal subset of the supabase-js client surface the v2 core uses, so the core
// is unit-testable with a fake client.
export interface MinimalClient {
  from(table: string): {
    select: (cols: string, opts?: unknown) => {
      eq: (col: string, val: unknown) => {
        maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
        single?: () => Promise<{ data: unknown; error: unknown }>;
      };
    };
    insert: (row: Record<string, unknown>) => {
      select?: (cols: string) => { single: () => Promise<{ data: unknown; error: unknown }> };
    } & Promise<{ data: unknown; error: unknown }>;
  };
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: unknown }>;
}

export interface DispatchV2Input {
  user_id?: string | null;
  contact?: string | null; // E.164 or email (anon/guest path)
  category_key: string;
  payload: Record<string, unknown>;
  idempotency_key: string;
  country_code?: string | null;
}

export interface CategoryRow {
  key: string;
  is_transactional: boolean;
  urgency: string;
  default_channels: string[];
  active: boolean;
}

export interface DispatchV2Result {
  success: boolean;
  duplicate?: boolean;
  notificationId?: string | null;
  deliveries?: Array<{ channel: string; status: string; providerMessageId: string | null; segments?: number }>;
  reason?: string;
}

const CHANNEL_PROVIDER: Record<string, string> = {
  push: "onesignal",
  email: "resend",
  sms: "twilio",
  inapp: "inapp",
};

const isEmail = (c: string | null | undefined): boolean =>
  !!c && c.includes("@");
const isPhone = (c: string | null | undefined): boolean =>
  !!c && c.startsWith("+");

export async function dispatchV2(
  client: MinimalClient,
  input: DispatchV2Input,
): Promise<DispatchV2Result> {
  // 1. Load + assert category active.
  const { data: catData } = await client
    .from("notification_categories")
    .select("*")
    .eq("key", input.category_key)
    .maybeSingle();
  const cat = catData as CategoryRow | null;
  if (!cat || cat.active !== true) {
    return { success: false, reason: "category_inactive_or_missing" };
  }

  // 2. Render the per-category copy (push title/body, email, sms).
  const rendered = renderCategoryMessage(input.category_key, input.payload);

  // 3. Idempotent insert into notifications (the inbox). Reuse the existing
  //    23505 UNIQUE(idempotency_key) path. Only when we have a user_id (the
  //    inbox is keyed on user_id NOT NULL).
  let notificationId: string | null = null;
  if (input.user_id) {
    const insertRes = await client
      .from("notifications")
      .insert({
        user_id: input.user_id,
        type: input.category_key,
        title: rendered.push.title,
        body: rendered.push.body,
        data: { ...input.payload, category_key: input.category_key },
        idempotency_key: input.idempotency_key,
      })
      // deno-lint-ignore no-explicit-any
      .select?.("id")
      .single() as unknown as { data: { id: string } | null; error: { code?: string } | null };
    if (insertRes.error) {
      if (insertRes.error.code === "23505") {
        return { success: true, duplicate: true, notificationId: null };
      }
      return { success: false, reason: "notification_insert_failed" };
    }
    notificationId = insertRes.data?.id ?? null;
  } else {
    // Anon/guest: no inbox row (notifications.user_id is NOT NULL). Use the
    // idempotency_key against the outbox-side dedupe (already enforced upstream).
    // We still need a notification_id FK for deliveries, so create a synthetic
    // inbox row is NOT possible without a user — record deliveries against a
    // freshly-minted notifications row is impossible; for the thin slice the
    // guest reservation path that lacks a user_id still gets email/SMS but the
    // delivery ledger requires a notification_id. Skip the ledger FK in that
    // edge by returning early after channel sends without deliveries rows.
    return await dispatchAnon(client, input, cat, rendered);
  }

  // A successful insert with no id is a contract violation — surface it, never
  // proceed with a null FK (no silent failure).
  if (!notificationId) {
    return { success: false, reason: "notification_insert_no_id" };
  }
  const nid: string = notificationId;

  // 4. ALWAYS write the in-app delivery (free, durable).
  await writeDelivery(client, nid, "inapp", "delivered", null, null);

  const deliveries: DispatchV2Result["deliveries"] = [
    { channel: "inapp", status: "delivered", providerMessageId: null },
  ];

  // 5. Simultaneous fan-out: for EACH channel in default_channels (besides
  //    inapp), if can_send passes, fire the adapter. ALL fire — no waterfall.
  const contactEmail = isEmail(input.contact) ? input.contact! : null;
  const contactPhone = isPhone(input.contact) ? input.contact! : null;
  const brandName = String(input.payload.brand_name ?? input.payload.brand ?? "Mingla");

  const tasks: Array<Promise<void>> = [];

  for (const channel of cat.default_channels) {
    if (channel === "inapp") continue;
    const contactForChannel =
      channel === "email" ? contactEmail : channel === "sms" ? contactPhone : null;

    // can_send gate (the single chokepoint). push/inapp pass with contact=null.
    const { data: allowedData } = await client.rpc("can_send", {
      p_user_id: input.user_id ?? null,
      p_category_key: input.category_key,
      p_channel: channel,
      p_contact: contactForChannel,
    });
    const allowed = allowedData === true;
    if (!allowed) {
      await writeDelivery(client, nid, channel, "suppressed", CHANNEL_PROVIDER[channel], "can_send_denied");
      deliveries.push({ channel, status: "suppressed", providerMessageId: null });
      continue;
    }

    if (channel === "push") {
      tasks.push((async () => {
        const r = await pushAdapter.send({
          userId: input.user_id!,
          title: rendered.push.title,
          body: rendered.push.body,
          data: { ...input.payload, category_key: input.category_key },
          routingType: input.category_key,
        });
        await writeDelivery(client, nid, "push", r.status, CHANNEL_PROVIDER.push, r.error ?? null);
        deliveries.push({ channel: "push", status: r.status, providerMessageId: r.providerMessageId });
      })());
    } else if (channel === "email" && contactEmail) {
      tasks.push((async () => {
        const r = await emailAdapter.send({
          to: contactEmail,
          title: rendered.email.subject,
          body: rendered.email.body,
        });
        await writeDelivery(client, nid, "email", r.status, CHANNEL_PROVIDER.email, r.error ?? null, r.providerMessageId);
        deliveries.push({ channel: "email", status: r.status, providerMessageId: r.providerMessageId });
      })());
    } else if (channel === "sms" && contactPhone) {
      tasks.push((async () => {
        const r = await smsAdapter.send({
          to: contactPhone,
          brandName,
          message: rendered.sms,
          countryCode: input.country_code,
        });
        await writeDelivery(client, nid, "sms", r.status, CHANNEL_PROVIDER.sms, r.error ?? null, r.providerMessageId, r.segments);
        deliveries.push({ channel: "sms", status: r.status, providerMessageId: r.providerMessageId, segments: r.segments });
      })());
    } else {
      // Channel allowed but no contact for it — record skipped (no silent drop).
      await writeDelivery(client, nid, channel, "skipped", CHANNEL_PROVIDER[channel], "no_contact");
      deliveries.push({ channel, status: "skipped", providerMessageId: null });
    }
  }

  await Promise.all(tasks);

  return { success: true, notificationId, deliveries };
}

// Anon/guest path: no inbox row (notifications.user_id NOT NULL), so no
// notification_deliveries FK. Fire email/SMS directly through the gate; record
// nothing in the FK-bound ledger. Returns the channel results inline.
async function dispatchAnon(
  client: MinimalClient,
  input: DispatchV2Input,
  cat: CategoryRow,
  rendered: ReturnType<typeof renderCategoryMessage>,
): Promise<DispatchV2Result> {
  const deliveries: DispatchV2Result["deliveries"] = [];
  const contactEmail = isEmail(input.contact) ? input.contact! : null;
  const contactPhone = isPhone(input.contact) ? input.contact! : null;
  const brandName = String(input.payload.brand_name ?? input.payload.brand ?? "Mingla");

  for (const channel of cat.default_channels) {
    if (channel === "inapp" || channel === "push") continue; // no user → no inbox/push
    const contactForChannel = channel === "email" ? contactEmail : channel === "sms" ? contactPhone : null;
    if (!contactForChannel) continue;

    const { data: allowedData } = await client.rpc("can_send", {
      p_user_id: null,
      p_category_key: input.category_key,
      p_channel: channel,
      p_contact: contactForChannel,
    });
    if (allowedData !== true) {
      deliveries.push({ channel, status: "suppressed", providerMessageId: null });
      continue;
    }

    if (channel === "email") {
      const r = await emailAdapter.send({ to: contactEmail!, title: rendered.email.subject, body: rendered.email.body });
      deliveries.push({ channel: "email", status: r.status, providerMessageId: r.providerMessageId });
    } else if (channel === "sms") {
      const r = await smsAdapter.send({ to: contactPhone!, brandName, message: rendered.sms, countryCode: input.country_code });
      deliveries.push({ channel: "sms", status: r.status, providerMessageId: r.providerMessageId, segments: r.segments });
    }
  }

  return { success: true, notificationId: null, deliveries };
}

async function writeDelivery(
  client: MinimalClient,
  notificationId: string,
  channel: string,
  status: string,
  provider: string | null,
  failedReason: string | null,
  providerMessageId?: string | null,
  segments?: number,
): Promise<void> {
  await client.from("notification_deliveries").insert({
    notification_id: notificationId,
    channel,
    status,
    provider,
    provider_message_id: providerMessageId ?? null,
    failed_reason: failedReason,
    delivered_at: status === "delivered" ? new Date().toISOString() : null,
    segments: segments ?? null,
  });
}
