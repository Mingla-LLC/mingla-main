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
// #1537 — the adapter owns provider SELECTION, so it also owns provider
// REPORTING. `smsProviderForDestination` is the same derivation `send()` runs,
// exposed for the ledger rows written when no send is attempted.
import {
  smsAdapter,
  smsProviderForDestination,
} from "./adapters/smsAdapter.ts";
import { renderCategoryMessage } from "./notifyTemplates.ts";
import type { RenderedMessage } from "./notifyTemplates.ts";
import {
  type PersistedOfferingPushV1,
  validatePersistedOfferingPushV1,
} from "./offeringInviteQuote.ts";
import { notificationSafeError } from "./notificationSafeError.ts";
// #1529 — the single source of truth for E.164 → ISO-2, replacing the
// two-country ternary that used to sit at the RSVP SMS call site below.
import { countryFromE164 } from "./e164Country.ts";

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
      select?: (
        cols: string,
      ) => { single: () => Promise<{ data: unknown; error: unknown }> };
    } & Promise<{ data: unknown; error: unknown }>;
    update?: (row: Record<string, unknown>) => {
      eq: (col: string, val: unknown) => {
        eq: (
          col: string,
          val: unknown,
        ) => Promise<{ data: unknown; error: unknown }>;
      };
    };
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
  requested_channel?: "inapp" | "push" | "email" | "sms" | null;
  persisted_offering_push?: PersistedOfferingPushV1;
  offering_attempt_id?: string;
  internal_provider_claim_key?: string;
  onesignal_idempotency_key?: string;
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
  deliveries?: Array<
    {
      channel: string;
      status: string;
      providerMessageId: string | null;
      segments?: number;
    }
  >;
  reason?: string;
}

// ===========================================================================
// #1537 — `sms` IS DELIBERATELY ABSENT FROM THIS MAP. DO NOT ADD IT BACK.
// ===========================================================================
// This map used to carry `sms: "twilio"`, and that value was stamped into
// `notification_deliveries.provider` at every SMS call site REGARDLESS of which
// provider handled the send. Nigeria routes to Termii, so every Nigerian text
// was logged as Twilio and the ledger held zero `termii` rows — SMS delivery in
// the one market about to be switched on was unauditable, and the #1529 SC-11
// kill-switch probe could only be established by elimination because its row
// claimed the wrong provider.
//
// The remaining three channels are single-provider TODAY, so their constants
// are still true. They are NOT derived, which is the same latent shape — if
// push or email ever gains a second provider, that adapter must report its own
// identity the way `smsAdapter` now does, and this map must lose that key too.
// Channels are looked up through `providerForChannel` below, never directly, so
// an SMS lookup here cannot silently resolve to `undefined`.
const CHANNEL_PROVIDER: Record<string, string> = {
  push: "onesignal",
  email: "resend",
  inapp: "inapp",
};

// #1537 — provider attribution for ledger rows written on paths where no
// adapter ran: a `can_send` denial, and the no-contact skip. SMS delegates to
// the ADAPTER's own derivation rather than re-deriving the country here — a
// second country→provider mapping in this file is exactly the split-brain the
// fix removes, and the adapter is the single owner of provider selection. When
// the destination is missing or unroutable the answer is null, not a guess.
function providerForChannel(
  channel: string,
  contact: string | null | undefined,
): string | null {
  if (channel === "sms") return smsProviderForDestination(contact);
  return CHANNEL_PROVIDER[channel] ?? null;
}

const isEmail = (c: string | null | undefined): boolean =>
  !!c && c.includes("@");
const isPhone = (c: string | null | undefined): boolean =>
  !!c && c.startsWith("+");

export async function dispatchV2(
  client: MinimalClient,
  input: DispatchV2Input,
): Promise<DispatchV2Result> {
  if (input.persisted_offering_push !== undefined) {
    return await dispatchPersistedOfferingPush(client, input);
  }
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
  const rendered: RenderedMessage = renderCategoryMessage(
    input.category_key,
    input.payload,
  );
  const inboxData = { ...input.payload, category_key: input.category_key };

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
        data: inboxData,
        idempotency_key: input.idempotency_key,
      })
      // deno-lint-ignore no-explicit-any
      .select?.("id")
      .single() as unknown as {
        data: { id: string } | null;
        error: { code?: string } | null;
      };
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
  const brandName = String(
    input.payload.brand_name ?? input.payload.brand ?? "Mingla",
  );

  const tasks: Array<Promise<void>> = [];

  const requestedChannels = input.requested_channel
    ? [input.requested_channel]
    : cat.default_channels;
  for (const channel of requestedChannels) {
    if (channel === "inapp") continue;
    const contactForChannel = channel === "email"
      ? contactEmail
      : channel === "sms"
      ? contactPhone
      : null;

    // can_send gate (the single chokepoint). push/inapp pass with contact=null.
    const { data: allowedData } = await client.rpc("can_send", {
      p_user_id: input.user_id ?? null,
      p_category_key: input.category_key,
      p_channel: channel,
      p_contact: contactForChannel,
    });
    const allowed = allowedData === true;
    if (!allowed) {
      await writeDelivery(
        client,
        nid,
        channel,
        "suppressed",
        // #1537 — a policy suppression is attributable to the market that would
        // have carried it: `can_send` was called with this exact contact, so
        // the provider that would have handled it is known.
        providerForChannel(channel, contactForChannel),
        "can_send_denied",
      );
      deliveries.push({
        channel,
        status: "suppressed",
        providerMessageId: null,
      });
      continue;
    }

    if (channel === "push") {
      tasks.push((async () => {
        const pushData = { ...input.payload, category_key: input.category_key };
        const r = await pushAdapter.send({
          userId: input.user_id!,
          title: rendered.push.title,
          body: rendered.push.body,
          data: pushData,
          routingType: input.category_key,
        });
        await writeDelivery(
          client,
          nid,
          "push",
          r.status,
          CHANNEL_PROVIDER.push,
          r.error ?? null,
        );
        deliveries.push({
          channel: "push",
          status: r.status,
          providerMessageId: r.providerMessageId,
        });
      })());
    } else if (channel === "email" && contactEmail) {
      tasks.push((async () => {
        const r = await emailAdapter.send({
          to: contactEmail,
          title: rendered.email.subject,
          body: rendered.email.body,
        });
        await writeDelivery(
          client,
          nid,
          "email",
          r.status,
          CHANNEL_PROVIDER.email,
          r.error ?? null,
          r.providerMessageId,
        );
        deliveries.push({
          channel: "email",
          status: r.status,
          providerMessageId: r.providerMessageId,
        });
      })());
    } else if (channel === "sms" && contactPhone) {
      tasks.push((async () => {
        const r = await smsAdapter.send({
          to: contactPhone,
          brandName,
          message: rendered.sms,
          countryCode: input.country_code,
        });
        await writeDelivery(
          client,
          nid,
          "sms",
          r.status,
          // #1537 — the provider the ADAPTER actually used (or, on a
          // kill-switch skip, would have used). Was `CHANNEL_PROVIDER.sms`, a
          // constant `"twilio"` that no send ever consulted.
          r.provider,
          r.error ?? null,
          r.providerMessageId,
          r.segments,
        );
        deliveries.push({
          channel: "sms",
          status: r.status,
          providerMessageId: r.providerMessageId,
          segments: r.segments,
        });
      })());
    } else {
      // Channel allowed but no contact for it — record skipped (no silent drop).
      await writeDelivery(
        client,
        nid,
        channel,
        "skipped",
        // #1537 — there is no destination for this channel, so for SMS there is
        // no market and no provider. null, not a fabricated "twilio".
        providerForChannel(channel, contactForChannel),
        "no_contact",
        null, // providerMessageId — nothing was sent
        undefined, // segments
        // #1537 — the contact that was REJECTED for this channel (an email
        // supplied where a phone was required, or vice versa). Production held
        // three `no_contact` rows with contact=NULL, so the recipient that
        // failed to be reached was unrecoverable from the ledger — the row
        // recorded that SOMEONE was missed but not who.
        input.contact ?? null,
      );
      deliveries.push({ channel, status: "skipped", providerMessageId: null });
    }
  }

  await Promise.all(tasks);

  return { success: true, notificationId, deliveries };
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function recordOfferingPushResult(
  client: MinimalClient,
  attemptId: string,
  outcome: string,
  providerAppId: string | null,
  providerMessageId: string | null,
  safeCode: string | null,
  retryable: boolean,
): Promise<boolean> {
  const { error } = await client.rpc(
    "biz_record_offering_push_dispatch_result",
    {
      p_attempt_id: attemptId,
      p_outcome: outcome,
      p_provider_app_id: providerAppId,
      p_provider_message_id: providerMessageId,
      p_safe_code: safeCode,
      p_retryable: retryable,
    },
  );
  return !error;
}

async function dispatchPersistedOfferingPush(
  client: MinimalClient,
  input: DispatchV2Input,
): Promise<DispatchV2Result> {
  const attemptId = input.offering_attempt_id ?? "";
  const internalKey = input.internal_provider_claim_key ?? "";
  const oneSignalKey = input.onesignal_idempotency_key ?? "";
  const scopeValid = input.category_key === "offering_invitation" &&
    input.requested_channel === "push" && !!input.user_id &&
    UUID.test(attemptId) && oneSignalKey === attemptId &&
    internalKey === `offering:${attemptId}:push:v1` &&
    input.idempotency_key === internalKey;
  const persisted = scopeValid
    ? await validatePersistedOfferingPushV1(input.persisted_offering_push!)
    : null;
  if (!scopeValid || persisted === null) {
    if (UUID.test(attemptId)) {
      const saved = await recordOfferingPushResult(
        client,
        attemptId,
        "definitive_unsent_terminal",
        null,
        null,
        "local_payload_invalid",
        false,
      );
      if (!saved) {
        return { success: false, reason: "push_result_persist_failed" };
      }
    }
    return { success: false, reason: "persisted_push_payload_invalid" };
  }

  const { data: catData, error: categoryError } = await client.from(
    "notification_categories",
  )
    .select("*").eq("key", "offering_invitation").maybeSingle();
  if (categoryError) {
    return { success: false, reason: "category_lookup_unavailable" };
  }
  const category = catData as CategoryRow | null;
  if (!category?.active) {
    const saved = await recordOfferingPushResult(
      client,
      attemptId,
      "suppressed",
      null,
      null,
      "category_inactive",
      false,
    );
    if (!saved) return { success: false, reason: "push_result_persist_failed" };
    return {
      success: true,
      deliveries: [{
        channel: "push",
        status: "suppressed",
        providerMessageId: null,
      }],
    };
  }

  let notificationId: string | null = null;
  const inserted = await client.from("notifications").insert({
    user_id: input.user_id,
    type: "offering_invitation",
    title: persisted.title,
    body: persisted.body,
    data: { event_id: persisted.eventId, category_key: "offering_invitation" },
    idempotency_key: internalKey,
  }).select?.("id").single() as unknown as {
    data: { id: string } | null;
    error: { code?: string } | null;
  };
  if (inserted.error?.code === "23505") {
    const existing = await client.from("notifications").select("*")
      .eq("idempotency_key", internalKey).maybeSingle();
    if (existing.error) {
      return { success: false, reason: "inbox_unavailable" };
    }
    const row = existing.data as Record<string, unknown> | null;
    if (
      !row || row.user_id !== input.user_id ||
      row.type !== "offering_invitation" || row.idempotency_key !== internalKey
    ) {
      const saved = await recordOfferingPushResult(
        client,
        attemptId,
        "definitive_unsent_terminal",
        null,
        null,
        "inbox_idempotency_collision",
        false,
      );
      if (!saved) {
        return { success: false, reason: "push_result_persist_failed" };
      }
      return { success: false, reason: "inbox_idempotency_collision" };
    }
    notificationId = String(row.id);
  } else if (inserted.error || !inserted.data?.id) {
    const saved = await recordOfferingPushResult(
      client,
      attemptId,
      "definitive_unsent_retryable",
      null,
      null,
      "inbox_unavailable",
      true,
    );
    if (!saved) return { success: false, reason: "push_result_persist_failed" };
    return { success: false, reason: "inbox_unavailable" };
  } else notificationId = inserted.data.id;

  const policy = await client.rpc("can_send", {
    p_user_id: input.user_id,
    p_category_key: "offering_invitation",
    p_channel: "push",
    p_contact: null,
  });
  if (policy.error) {
    return { success: false, reason: "can_send_unavailable" };
  }
  if (policy.data !== true) {
    const saved = await recordOfferingPushResult(
      client,
      attemptId,
      "suppressed",
      null,
      null,
      "can_send_denied",
      false,
    );
    if (!saved) return { success: false, reason: "push_result_persist_failed" };
    return {
      success: true,
      notificationId,
      deliveries: [{
        channel: "push",
        status: "suppressed",
        providerMessageId: null,
      }],
    };
  }

  try {
    const result = await pushAdapter.send({
      userId: input.user_id!,
      title: persisted.title,
      body: persisted.body,
      data: {
        event_id: persisted.eventId,
        category_key: "offering_invitation",
        offering_attempt_id: attemptId,
      },
      routingType: "offering_invitation",
      offeringAttemptId: attemptId,
      internalProviderClaimKey: internalKey,
      oneSignalIdempotencyKey: oneSignalKey,
      persistedPushPayload: persisted,
      beforeProviderIo: async () => {
        const claim = await client.rpc("biz_claim_offering_push_provider_io", {
          p_attempt_id: attemptId,
          p_recipient_user_id: input.user_id,
          p_internal_provider_claim_key: internalKey,
          p_push_payload: persisted,
        });
        if (claim.error || !claim.data) {
          if (
            String((claim.error as { message?: unknown } | null)?.message ?? "")
              .includes("not_claimable")
          ) {
            throw new Error("offering_push_claim_ineligible");
          }
          throw new Error("offering_push_claim_unavailable");
        }
        return claim.data as {
          attemptId: string;
          recipientUserId: string;
          internalProviderClaimKey: string;
          pushPayload: PersistedOfferingPushV1;
        };
      },
    });
    const saved = await recordOfferingPushResult(
      client,
      attemptId,
      result.outcome,
      result.providerAppId,
      result.providerMessageId,
      result.safeCode,
      result.retryable,
    );
    if (!saved) return { success: false, reason: "push_result_persist_failed" };
    return {
      success: true,
      notificationId,
      deliveries: [{
        channel: "push",
        status: result.status,
        providerMessageId: result.providerMessageId,
      }],
    };
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "offering_push_claim_ineligible"
    ) {
      const current = await client.from(
        "brand_offering_invite_delivery_attempts",
      )
        .select("status,provider_idempotency_key").eq("id", attemptId)
        .maybeSingle();
      const row = current.data as Record<string, unknown> | null;
      if (
        !current.error && row && row.status !== "queued" &&
        row.provider_idempotency_key === internalKey
      ) {
        return { success: true, duplicate: true, notificationId };
      }
      const saved = await recordOfferingPushResult(
        client,
        attemptId,
        "suppressed",
        null,
        null,
        "claim_ineligible",
        false,
      );
      if (!saved) {
        return { success: false, reason: "push_result_persist_failed" };
      }
      return {
        success: true,
        notificationId,
        deliveries: [{
          channel: "push",
          status: "suppressed",
          providerMessageId: null,
        }],
      };
    }
    return { success: false, reason: "offering_push_claim_unavailable" };
  }
}

export interface SourceRefundChannelInput extends DispatchV2Input {
  requested_channel: "inapp" | "push" | "email" | "sms";
  delivery_id: string;
  delivery_claim_id: string;
  attention_url?: string | null;
}

export interface RsvpChannelInput {
  channel: "in_app" | "push" | "email" | "sms";
  user_id: string | null;
  contact: string | null;
  category_key: "rsvp_acknowledgement" | "rsvp_pass";
  payload: Record<string, unknown>;
  idempotency_key: string;
  title: string;
  body: string;
  sms_body: string;
  deep_link: string;
  attachment?: { filename: string; content: string } | null;
  delivery_id: string;
  lease_id: string;
}

/** Issue #1447: RSVP's claimed channel rows still use the unified dispatcher
 * adapters and mandatory can_send chokepoint. The caller owns the durable RSVP
 * lease; this function owns only policy + provider I/O. */
export async function dispatchRsvpChannel(
  client: MinimalClient,
  input: RsvpChannelInput,
): Promise<{
  outcome: "sent" | "retryable" | "terminal" | "ambiguous";
  providerMessageId: string | null;
  safeCode: string | null;
}> {
  const policyChannel = input.channel === "in_app" ? "inapp" : input.channel;
  const { data: catData } = await client.from("notification_categories")
    .select("*").eq("key", input.category_key).maybeSingle();
  const category = catData as CategoryRow | null;
  if (!category?.active || !category.default_channels.includes(policyChannel)) {
    return {
      outcome: "terminal",
      providerMessageId: null,
      safeCode: "dispatch_rejected",
    };
  }
  const { data: allowed } = await client.rpc("can_send", {
    p_user_id: input.user_id,
    p_category_key: input.category_key,
    p_channel: policyChannel,
    p_contact: input.contact,
  });
  if (allowed !== true) {
    return {
      outcome: "terminal",
      providerMessageId: null,
      safeCode: "can_send_denied",
    };
  }
  if (input.channel === "in_app") {
    if (!input.user_id) {
      return {
        outcome: "terminal",
        providerMessageId: null,
        safeCode: "no_contact",
      };
    }
    const inserted = await client.from("notifications").insert({
      user_id: input.user_id,
      type: input.category_key,
      title: input.title,
      body: input.body,
      data: { ...input.payload, deepLink: input.deep_link },
      idempotency_key: `${input.idempotency_key}:in_app`,
    }) as unknown as { error: { code?: string } | null };
    return !inserted.error || inserted.error.code === "23505"
      ? { outcome: "sent", providerMessageId: null, safeCode: null }
      : {
        outcome: "retryable",
        providerMessageId: null,
        safeCode: "dispatch_unavailable",
      };
  }
  let result: {
    ok: boolean;
    status: string;
    providerMessageId: string | null;
    error?: string;
  };
  if (input.channel === "push") {
    if (!input.user_id) {
      return {
        outcome: "terminal",
        providerMessageId: null,
        safeCode: "no_contact",
      };
    }
    result = await pushAdapter.send({
      userId: input.user_id,
      title: input.title,
      body: input.body,
      data: { ...input.payload, deepLink: input.deep_link },
      routingType: input.category_key,
      beforeProviderIo: async () => {
        await markRsvpProviderIo(client, input);
      },
    });
  } else if (input.channel === "email") {
    if (!input.contact) {
      return {
        outcome: "terminal",
        providerMessageId: null,
        safeCode: "no_contact",
      };
    }
    result = await emailAdapter.send({
      to: input.contact,
      title: input.title,
      body: input.body,
      cta: { label: "View RSVP", url: input.deep_link },
      idempotencyKey: `${input.idempotency_key}:email`,
      ...(input.attachment ? { attachments: [input.attachment] } : {}),
    });
  } else {
    if (!input.contact) {
      return {
        outcome: "terminal",
        providerMessageId: null,
        safeCode: "no_contact",
      };
    }
    result = await smsAdapter.send({
      to: input.contact,
      brandName: String(input.payload.brandName ?? "Mingla"),
      message: input.sms_body,
      // #1529 — was `contact.startsWith("+234") ? "NG" : "US"`, a private
      // two-country guess that labelled EVERY other market as US (production
      // holds +44 and +32 handsets). Routing is unchanged — the adapter sends
      // every non-NG country over Twilio under SMS_LIVE_ENABLED_US, which is
      // where a null or a wrong "US" landed anyway — but the country is now
      // honest, which matters because it is what reaches the consent audit.
      countryCode: countryFromE164(input.contact),
      beforeProviderIo: async () => {
        await markRsvpProviderIo(client, input);
      },
    });
  }
  if (result.ok && result.status === "sent") {
    return {
      outcome: "sent",
      providerMessageId: result.providerMessageId,
      safeCode: null,
    };
  }
  // #2218 — a Nigerian `generic` send held by the operator embargo is
  // DEFINITIVELY unsent and DEFINITIVELY retryable: zero HTTP happened, so
  // there is no ambiguity about whether the provider took it, and the window
  // reopens at a known instant. Classified before the ladder below so it can
  // never be read as `terminal` (which would abandon a message that is still
  // owed) or as `ambiguous` (which would make re-sending look like a
  // double-send risk).
  if (result.status === "deferred") {
    return {
      outcome: "retryable",
      providerMessageId: null,
      safeCode: notificationSafeError(result.error ?? "ng_operator_embargo"),
    };
  }
  const safe = result.error
    ? notificationSafeError(result.error)
    : "provider_unavailable";
  const terminal = result.status === "skipped" ||
    safe === "invalid_recipient" ||
    safe === "recipient_opted_out" || safe === "provider_rejected";
  const definitiveRetry = safe === "provider_config_missing" ||
    safe === "provider_rate_limited" || input.channel === "email";
  return {
    outcome: terminal
      ? "terminal"
      : definitiveRetry
      ? "retryable"
      : "ambiguous",
    providerMessageId: null,
    safeCode: safe,
  };
}

async function markRsvpProviderIo(
  client: MinimalClient,
  input: RsvpChannelInput,
): Promise<void> {
  const { data, error } = await client.rpc(
    "mark_rsvp_notification_provider_io",
    {
      p_delivery_id: input.delivery_id,
      p_lease_id: input.lease_id,
    },
  );
  if (error || data !== true) throw new Error("rsvp_provider_io_not_marked");
}

export async function dispatchSourceRefundChannel(
  client: MinimalClient,
  input: SourceRefundChannelInput,
): Promise<{
  success: boolean;
  outcome:
    | "accepted"
    | "suppressed"
    | "skipped"
    | "definitive_unsent_retryable"
    | "terminal_unsent"
    | "acceptance_unknown";
  providerMessageId: string | null;
  safeCode: string | null;
}> {
  const { data: catData } = await client.from("notification_categories")
    .select("*").eq("key", input.category_key).maybeSingle();
  const cat = catData as CategoryRow | null;
  if (!cat?.active || !cat.default_channels.includes(input.requested_channel)) {
    return {
      success: false,
      outcome: "terminal_unsent",
      providerMessageId: null,
      safeCode: "dispatch_rejected",
    };
  }
  const channel = input.requested_channel;
  const { data: allowed } = await client.rpc("can_send", {
    p_user_id: input.user_id ?? null,
    p_category_key: input.category_key,
    p_channel: channel,
    p_contact: input.contact ?? null,
  });
  if (allowed !== true) {
    return {
      success: true,
      outcome: "suppressed",
      providerMessageId: null,
      safeCode: "can_send_denied",
    };
  }
  const rendered = renderCategoryMessage(input.category_key, input.payload);
  const actionSuffix = input.attention_url
    ? `\n\nContinue securely: ${input.attention_url}`
    : "";
  if (channel === "inapp") {
    if (!input.user_id) {
      return {
        success: true,
        outcome: "skipped",
        providerMessageId: null,
        safeCode: "no_contact",
      };
    }
    const result = await client.from("notifications").insert({
      user_id: input.user_id,
      type: input.category_key,
      title: rendered.push.title,
      body: rendered.push.body,
      data: {
        ...input.payload,
        category_key: input.category_key,
        ...(input.attention_url ? { attention_url: input.attention_url } : {}),
      },
      idempotency_key: input.idempotency_key,
    }) as unknown as { error: { code?: string } | null };
    if (result.error?.code === "23505") {
      return {
        success: true,
        outcome: "accepted",
        providerMessageId: null,
        safeCode: null,
      };
    }
    return result.error
      ? {
        success: false,
        outcome: "definitive_unsent_retryable",
        providerMessageId: null,
        safeCode: "dispatch_unavailable",
      }
      : {
        success: true,
        outcome: "accepted",
        providerMessageId: null,
        safeCode: null,
      };
  }
  if (channel === "push") {
    if (!input.user_id) {
      return {
        success: true,
        outcome: "skipped",
        providerMessageId: null,
        safeCode: "no_contact",
      };
    }
    await markSourceRefundProviderIo(client, input);
    const result = await pushAdapter.send({
      userId: input.user_id,
      title: rendered.push.title,
      body: `${rendered.push.body}${actionSuffix}`,
      data: {
        ...input.payload,
        ...(input.attention_url ? { attention_url: input.attention_url } : {}),
      },
      routingType: input.category_key,
    });
    return adapterOutcome(result, channel);
  }
  if (!input.contact) {
    return {
      success: true,
      outcome: "skipped",
      providerMessageId: null,
      safeCode: "no_contact",
    };
  }
  if (channel === "email") {
    const providerIdempotencyKey = await sourceRefundResendIdempotencyKey(
      input.idempotency_key,
    );
    const result = await emailAdapter.send({
      to: input.contact,
      title: rendered.email.subject,
      body: `${rendered.email.body}${actionSuffix}`,
      ...(input.attention_url
        ? { cta: { label: "Continue refund", url: input.attention_url } }
        : {}),
      idempotencyKey: providerIdempotencyKey,
      beforeProviderIo: async () => {
        await markSourceRefundProviderIo(client, input);
      },
    });
    return adapterOutcome(result, channel);
  }
  const result = await smsAdapter.send({
    to: input.contact,
    brandName: String(input.payload.brand_name ?? "Mingla"),
    message: `${rendered.sms}${actionSuffix}`,
    countryCode: input.country_code,
    beforeProviderIo: async () => {
      await markSourceRefundProviderIo(client, input);
    },
  });
  return adapterOutcome(result, channel);
}

async function markSourceRefundProviderIo(
  client: MinimalClient,
  input: SourceRefundChannelInput,
): Promise<void> {
  const { data, error } = await client.rpc(
    "mark_source_refund_notification_provider_io",
    {
      p_delivery_id: input.delivery_id,
      p_claim_id: input.delivery_claim_id,
      p_now: new Date().toISOString(),
    },
  );
  if (error || data !== true) throw new Error("source_provider_io_not_marked");
}

export async function sourceRefundResendIdempotencyKey(
  logicalKey: string,
): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(logicalKey),
    ),
  );
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  const encoded = btoa(binary).replaceAll("+", "-").replaceAll("/", "_")
    .replace(/=+$/, "");
  return `source-refund-email/${encoded}`;
}

function adapterOutcome(result: {
  ok: boolean;
  status: string;
  providerMessageId: string | null;
  error?: string;
}, channel: "push" | "email" | "sms"): {
  success: boolean;
  outcome:
    | "accepted"
    | "suppressed"
    | "skipped"
    | "definitive_unsent_retryable"
    | "terminal_unsent"
    | "acceptance_unknown";
  providerMessageId: string | null;
  safeCode: string | null;
} {
  const safe = result.error ? notificationSafeError(result.error) : null;
  if (result.ok && result.status === "sent") {
    return {
      success: true,
      outcome: "accepted",
      providerMessageId: result.providerMessageId,
      safeCode: null,
    };
  }
  // #2218 — held by the Nigerian operator embargo. NOT `skipped`: a skip means
  // the send was deliberately abandoned and `success: true` is the honest
  // answer; a deferral means the message is still owed and must come back.
  if (result.status === "deferred") {
    return {
      success: false,
      outcome: "definitive_unsent_retryable",
      providerMessageId: null,
      safeCode: safe ?? "ng_operator_embargo",
    };
  }
  if (result.status === "skipped") {
    return {
      success: true,
      outcome: "skipped",
      providerMessageId: null,
      safeCode: safe ?? "provider_kill_switch_off",
    };
  }
  if (
    safe === "provider_rejected" || safe === "invalid_recipient" ||
    safe === "recipient_opted_out"
  ) {
    return {
      success: false,
      outcome: "terminal_unsent",
      providerMessageId: null,
      safeCode: safe,
    };
  }
  if (
    safe === "provider_config_missing" ||
    safe === "provider_rate_limited" ||
    (channel === "email" &&
      (safe === "provider_unavailable" || safe === "provider_timeout" ||
        safe === "provider_protocol_error"))
  ) {
    return {
      success: false,
      outcome: "definitive_unsent_retryable",
      providerMessageId: null,
      safeCode: safe,
    };
  }
  return {
    success: false,
    outcome: "acceptance_unknown",
    providerMessageId: null,
    safeCode: safe ?? "provider_unavailable",
  };
}

// Anon/guest path: no inbox row (notifications.user_id NOT NULL). REWORK (P2-2):
// each send now writes a CONTACT-KEYED notification_deliveries row (notification_id
// NULL, contact + idempotency_key populated) so the guest path has the same durable,
// webhook-reconcilable ledger as the authenticated path. REWORK (P2-1, second line
// of defense): before each send we INSERT the ledger row FIRST; the partial
// UNIQUE(idempotency_key, channel) on guest rows means a duplicated drain tick that
// re-dispatches the same key gets a 23505 → we skip the provider send entirely (the
// notifications UNIQUE backstop the user_id path enjoys, now mirrored for guests).
async function dispatchAnon(
  client: MinimalClient,
  input: DispatchV2Input,
  cat: CategoryRow,
  rendered: ReturnType<typeof renderCategoryMessage>,
): Promise<DispatchV2Result> {
  const deliveries: DispatchV2Result["deliveries"] = [];
  const contactEmail = isEmail(input.contact) ? input.contact! : null;
  const contactPhone = isPhone(input.contact) ? input.contact! : null;
  const brandName = String(
    input.payload.brand_name ?? input.payload.brand ?? "Mingla",
  );

  for (const channel of cat.default_channels) {
    if (channel === "inapp" || channel === "push") continue; // no user → no inbox/push
    const contactForChannel = channel === "email"
      ? contactEmail
      : channel === "sms"
      ? contactPhone
      : null;
    if (!contactForChannel) continue;

    const { data: allowedData } = await client.rpc("can_send", {
      p_user_id: null,
      p_category_key: input.category_key,
      p_channel: channel,
      p_contact: contactForChannel,
    });
    if (allowedData !== true) {
      // Record the suppression in the ledger too (no silent gap). A dedupe
      // collision here is harmless — the row already exists.
      await insertGuestDelivery(
        client,
        input.idempotency_key,
        channel,
        contactForChannel,
        "suppressed",
        // #1537 — attributable to the market that would have carried it.
        providerForChannel(channel, contactForChannel),
        "can_send_denied",
        null,
        null,
      );
      deliveries.push({
        channel,
        status: "suppressed",
        providerMessageId: null,
      });
      continue;
    }

    // Claim the (idempotency_key, channel) dedupe slot BEFORE sending. A 23505
    // means a prior/concurrent drain tick already sent this channel → skip.
    const claim = await insertGuestDelivery(
      client,
      input.idempotency_key,
      channel,
      contactForChannel,
      "queued",
      // #1537 — the claim row is labelled from the destination before the send,
      // so a row that never gets reconciled (crash between claim and update)
      // still names the market it belonged to. The adapter re-reports the same
      // value on reconcile below, derived by the same function on the same
      // number, so the two cannot disagree.
      providerForChannel(channel, contactForChannel),
      null,
      null,
      null,
    );
    if (claim.duplicate) {
      deliveries.push({
        channel,
        status: "duplicate",
        providerMessageId: null,
      });
      continue;
    }

    if (channel === "email") {
      const r = await emailAdapter.send({
        to: contactEmail!,
        title: rendered.email.subject,
        body: rendered.email.body,
      });
      await updateGuestDelivery(
        client,
        input.idempotency_key,
        channel,
        r.status,
        r.providerMessageId ?? null,
        r.error ?? null,
        undefined,
        CHANNEL_PROVIDER.email,
      );
      deliveries.push({
        channel: "email",
        status: r.status,
        providerMessageId: r.providerMessageId,
      });
    } else if (channel === "sms") {
      const r = await smsAdapter.send({
        to: contactPhone!,
        brandName,
        message: rendered.sms,
        countryCode: input.country_code,
      });
      await updateGuestDelivery(
        client,
        input.idempotency_key,
        channel,
        r.status,
        r.providerMessageId ?? null,
        r.error ?? null,
        r.segments,
        // #1537 — reconcile the claim row with the provider the adapter really
        // used, so a guest Nigerian send lands as `termii` rather than
        // inheriting a channel constant.
        r.provider,
      );
      deliveries.push({
        channel: "sms",
        status: r.status,
        providerMessageId: r.providerMessageId,
        segments: r.segments,
      });
    }
  }

  return { success: true, notificationId: null, deliveries };
}

// Insert a CONTACT-KEYED guest delivery row (notification_id NULL). Returns
// duplicate=true on a 23505 (the dedupe slot is already taken → caller skips the
// send). Any other insert error is non-fatal (logged), never throws — the ledger
// is observability, not the send gate (the can_send chokepoint already ran).
async function insertGuestDelivery(
  client: MinimalClient,
  idempotencyKey: string,
  channel: string,
  contact: string,
  status: string,
  provider: string | null,
  failedReason: string | null,
  providerMessageId: string | null,
  segments: number | null,
): Promise<{ duplicate: boolean }> {
  const res = (await client.from("notification_deliveries").insert({
    notification_id: null,
    contact: contact.toLowerCase(),
    idempotency_key: idempotencyKey,
    channel,
    status,
    provider,
    provider_message_id: providerMessageId,
    failed_reason: failedReason,
    delivered_at: status === "delivered" ? new Date().toISOString() : null,
    segments,
  })) as unknown as { error: { code?: string } | null };
  if (res?.error) {
    if (res.error.code === "23505") return { duplicate: true };
    console.error("[notifyV2] guest delivery insert failed:", res.error);
  }
  return { duplicate: false };
}

// Reconcile the guest delivery row (claimed 'queued') with the provider result.
async function updateGuestDelivery(
  client: MinimalClient,
  idempotencyKey: string,
  channel: string,
  status: string,
  providerMessageId: string | null,
  failedReason: string | null,
  segments?: number,
  // #1537 — the provider the adapter reported. Written on reconcile alongside
  // provider_message_id so the pair a webhook matches on is always consistent.
  provider?: string | null,
): Promise<void> {
  const table = client.from("notification_deliveries");
  if (!table.update) return; // fake clients without update — non-fatal
  await table.update({
    status,
    provider,
    provider_message_id: providerMessageId,
    failed_reason: failedReason,
    delivered_at: status === "delivered" ? new Date().toISOString() : null,
    segments: segments ?? null,
    attempt_at: new Date().toISOString(),
  })
    .eq("idempotency_key", idempotencyKey)
    .eq("channel", channel);
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
  // #1537 — the contact this row concerns, when recording it is what makes the
  // row actionable (the `no_contact` skip). Stored RAW and lowercased, the SAME
  // convention `insertGuestDelivery` already applies to this exact column: the
  // ledger's normal content is raw E.164 and raw lowercased email, so masking
  // only these rows would make one column bimodal and silently drop them out of
  // any contact-keyed lookup — a vacuity trap of the same family as the bug
  // being fixed, for no privacy gain, since a successful send to the same
  // handset sits unmasked in the next row. The table is RLS-protected and the
  // codebase's only recipient-fingerprinting helper
  // (NOTIFICATION_RECIPIENT_HMAC_SECRET) exists to derive idempotency keys, not
  // to redact storage — repurposing it would be inventing a new convention.
  contact?: string | null,
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
    contact: contact ? contact.trim().toLowerCase() : null,
  });
}
