// deno-lint-ignore-file no-explicit-any
import { fireAdConversion } from "./adConversionFire.ts";

type ServiceClient = any;

type StripeEvent = {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
};

function metadataOf(value: Record<string, unknown>): Record<string, unknown> {
  const metadata = value.metadata;
  return metadata && typeof metadata === "object"
    ? metadata as Record<string, unknown>
    : {};
}

export function isStayStripePaymentEvent(event: StripeEvent): boolean {
  return metadataOf(event.data.object).mingla_purpose === "stay_reservation";
}

function objectId(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (value && typeof value === "object") {
    const id = (value as Record<string, unknown>).id;
    return typeof id === "string" && id.length > 0 ? id : null;
  }
  return null;
}

export async function handleStayStripePaymentEvent(
  client: ServiceClient,
  event: StripeEvent,
): Promise<string | null> {
  const intent = event.data.object;
  const paymentRef = objectId(intent.id);
  if (!paymentRef) throw new Error("stay_payment_identity_missing");

  const metadata = metadataOf(intent);
  const attemptId = typeof metadata.stay_payment_attempt_id === "string"
    ? metadata.stay_payment_attempt_id
    : null;
  if (!attemptId) throw new Error("stay_payment_attempt_identity_missing");
  const groupId = typeof metadata.stay_group_id === "string"
    ? metadata.stay_group_id
    : null;

  if (event.type === "payment_intent.succeeded") {
    const charges = intent.charges as
      | { data?: Array<Record<string, unknown>> }
      | undefined;
    const latestCharge = objectId(
      intent.latest_charge ?? charges?.data?.[0] ?? null,
    );
    const amount = Number(intent.amount_received ?? intent.amount);
    const currency = typeof intent.currency === "string"
      ? intent.currency.toUpperCase()
      : "";
    if (
      !Number.isSafeInteger(amount) || amount <= 0 ||
      !/^[A-Z]{3}$/.test(currency)
    ) {
      throw new Error("stay_provider_evidence_invalid");
    }
    const { error } = await client.rpc("issue_1389_finalize_payment", {
      p_provider: "stripe",
      p_provider_event_id: event.id,
      p_provider_event_type: event.type,
      p_provider_payment_ref: paymentRef,
      p_provider_charge_ref: latestCharge,
      p_amount_minor: amount,
      p_currency_code: currency,
      p_provider_fee_minor: null,
      p_event_fingerprint: null,
    });
    if (error) {
      throw new Error(`stay_payment_finalize_failed:${error.message}`);
    }
    if (groupId) {
      await fireAdConversion(client, {
        stayGroupId: groupId,
        surface: "web",
        lane: "consumer",
      });
    }
  } else {
    const { error } = await client.rpc(
      "issue_1389_record_payment_create_failure",
      {
        p_attempt_id: attemptId,
        p_failure_code: event.type === "payment_intent.canceled"
          ? "provider_payment_cancelled"
          : "provider_payment_failed",
        p_ambiguous: false,
      },
    );
    if (error) {
      throw new Error(`stay_payment_failure_commit_failed:${error.message}`);
    }
  }

  const { data } = await client.from("stay_reservation_groups")
    .select("brand_id")
    .eq("id", groupId ?? "")
    .maybeSingle();
  return typeof data?.brand_id === "string" ? data.brand_id : null;
}

export async function handleStayStripeDispute(
  client: ServiceClient,
  event: StripeEvent,
): Promise<string | null> {
  const dispute = event.data.object;
  const chargeRef = objectId(dispute.charge ?? dispute.payment_intent);
  const disputeRef = objectId(dispute.id);
  const amount = Number(dispute.amount);
  const currency = String(dispute.currency ?? "").toUpperCase();
  const status = String(dispute.status ?? "unknown").toLowerCase();
  if (
    !chargeRef ||
    !disputeRef ||
    !Number.isSafeInteger(amount) ||
    amount < 0 ||
    !/^[A-Z]{3}$/.test(currency)
  ) return null;
  const { data, error } = await client.rpc(
    "issue_1389_record_stay_dispute",
    {
      p_provider_event_id: event.id,
      p_provider_event_type: event.type,
      p_provider_charge_ref: chargeRef,
      p_dispute_ref: disputeRef,
      p_amount_minor: amount,
      p_currency_code: currency,
      p_status: status,
    },
  );
  if (error) {
    throw new Error(`stay_dispute_commit_failed:${error.message}`);
  }
  return data?.matched === true && typeof data.brandId === "string"
    ? data.brandId
    : null;
}

export function isStayPaystackCharge(data: Record<string, unknown>): boolean {
  const reference = typeof data.reference === "string" ? data.reference : "";
  const metadata = metadataOf(data);
  return reference.startsWith("mingla_stay_") ||
    metadata.mingla_purpose === "stay_reservation";
}

export async function handleStayPaystackChargeSuccess(
  client: ServiceClient,
  envelopeData: Record<string, unknown>,
  providerEventId: string,
  verify: (
    reference: string,
  ) => Promise<Record<string, unknown>>,
): Promise<string | null> {
  const reference = typeof envelopeData.reference === "string"
    ? envelopeData.reference
    : "";
  if (!reference) throw new Error("stay_payment_identity_missing");

  const verified = await verify(reference);
  const metadata = metadataOf(verified);
  if (
    String(verified.status ?? "").toLowerCase() !== "success" ||
    (
      metadata.mingla_purpose !== "stay_reservation" &&
      !reference.startsWith("mingla_stay_")
    )
  ) {
    throw new Error("stay_provider_evidence_invalid");
  }
  const amount = Number(verified.amount);
  const currency = String(verified.currency ?? "").toUpperCase();
  const fees = verified.fees == null ? null : Number(verified.fees);
  if (
    !Number.isSafeInteger(amount) ||
    amount <= 0 ||
    !/^[A-Z]{3}$/.test(currency) ||
    (fees !== null && (!Number.isSafeInteger(fees) || fees < 0))
  ) {
    throw new Error("stay_provider_evidence_invalid");
  }
  const { error } = await client.rpc("issue_1389_finalize_payment", {
    p_provider: "paystack",
    p_provider_event_id: providerEventId,
    p_provider_event_type: "charge.success",
    p_provider_payment_ref: reference,
    p_provider_charge_ref: String(verified.id ?? ""),
    p_amount_minor: amount,
    p_currency_code: currency,
    p_provider_fee_minor: fees,
    p_event_fingerprint: null,
  });
  if (error) throw new Error(`stay_payment_finalize_failed:${error.message}`);

  const groupId = typeof metadata.stay_group_id === "string"
    ? metadata.stay_group_id
    : null;
  if (!groupId) return null;
  await fireAdConversion(client, {
    stayGroupId: groupId,
    surface: "web",
    lane: "consumer",
  });
  const { data } = await client.from("stay_reservation_groups")
    .select("brand_id")
    .eq("id", groupId)
    .maybeSingle();
  return typeof data?.brand_id === "string" ? data.brand_id : null;
}
