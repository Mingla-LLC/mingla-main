import { composeSmsBody, computeSegments } from "./adapters/smsAdapter.ts";
import { countryFromE164 } from "./e164Country.ts";
import { resolveOfferingInviteSmsPriceBook } from "./runtimeConfig.ts";

export const OFFERING_INVITE_LINK_MARKER = "__MINGLA_OFFERING_INVITE_URL_V1__";
const HEX = /^[0-9a-f]{64}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SAFE_SUPPRESSION_REASONS = new Set(["can_send_denied", "suppressed"]);

type Channel = "email" | "push" | "sms";
type Purpose = "invitation" | "reminder" | "retry_delivery";

export interface QuoteCandidateRow {
  brandPersonId: string;
  inviteId: string | null;
  predecessorAttemptId: string | null;
  channel: Channel;
  contactMethodId: string | null;
  recipientUserId: string | null;
  normalizedContact: string | null;
  allowed: boolean;
  safeReasonCode: string | null;
  lastContactAt: string | null;
  /** Service-only canonical event URL; never copied into the snapshot. */
  eventUrl?: string;
}

export interface PersistedOfferingPushV1 {
  payloadVersion: 1;
  payloadHash: string;
  title: string;
  body: string;
  eventId: string;
}

export interface SmsRateV1 {
  rateId: string;
  provider: "twilio" | "termii";
  country: string;
  currency: string;
  unit: "sms_segment";
  minorNumerator: number;
  minorDenominator: number;
  effectiveAt: string;
  expiresAt: string;
  sourceReference: string;
}

export interface ExecutionCandidateV1 {
  candidateKey: string;
  brandPersonId: string;
  inviteId: string | null;
  predecessorAttemptId: string | null;
  channel: Channel;
  contactMethodId: string | null;
  recipientUserId: string | null;
  outcome: "queued" | "suppressed";
  safeReasonCode: string | null;
  attemptKind: "initial" | "reminder" | "retry";
  smsQuote: null | {
    segments: number;
    rateId: string;
    provider: "twilio" | "termii";
    country: string;
    currency: string;
    minorNumerator: number;
    minorDenominator: number;
    allocatedCostMinor: number;
  };
}

export interface ExecutionSnapshotV1 {
  schemaVersion: 1;
  eventId: string;
  brandId: string;
  purpose: Purpose;
  channels: Channel[];
  selectionHash: string;
  eligibilityHash: string;
  quotedAt: string;
  quote: {
    quoteHash: string;
    smsSegments: number;
    estimatedCostMinor: number;
    currency: string | null;
    rateIds: string[];
  };
  campaigns: Record<Channel, Record<string, unknown> | null>;
  candidates: ExecutionCandidateV1[];
  executionSnapshotHash: string;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(
    parts.reduce((sum, part) => sum + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

export function frame(value: string | number | null): Uint8Array {
  if (value === null) return new Uint8Array([0]);
  const bytes = new TextEncoder().encode(String(value));
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, bytes.length, false);
  return concat(new Uint8Array([1]), length, bytes);
}

async function digest(parts: Uint8Array[]): Promise<string> {
  const input = concat(...parts).slice().buffer as ArrayBuffer;
  const value = new Uint8Array(
    await crypto.subtle.digest("SHA-256", input),
  );
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export async function hashOfferingSelection(
  selection: Record<string, unknown>,
): Promise<string> {
  const keys = Object.keys(selection).sort();
  const kind = selection.kind;
  if (kind === "all_brand_people" || kind === "invited_people") {
    if (keys.join(",") !== "kind") {
      throw new Error("offering_send_selection_invalid");
    }
    return await digest([
      frame("mingla:offering-selection:v1"),
      frame(kind),
    ]);
  }
  if (
    (kind === "resolved_brand_people_v1" || kind === "failed_attempts_v1") &&
    typeof selection.selectionHash === "string" &&
    HEX.test(selection.selectionHash) &&
    selection.source === "guest_roster_actions"
  ) return selection.selectionHash;
  throw new Error("offering_send_selection_invalid");
}

function f(...values: Array<string | number | null>): Uint8Array[] {
  return values.map(frame);
}

function candidateIdentityParts(candidate: ExecutionCandidateV1): Uint8Array[] {
  return f(
    candidate.candidateKey,
    candidate.brandPersonId,
    candidate.inviteId,
    candidate.predecessorAttemptId,
    candidate.channel,
    candidate.contactMethodId,
    candidate.recipientUserId,
    candidate.outcome,
    candidate.safeReasonCode,
    candidate.attemptKind,
  );
}

function executionCandidateParts(
  candidate: ExecutionCandidateV1,
): Uint8Array[] {
  return f(
    candidate.candidateKey,
    candidate.brandPersonId,
    candidate.inviteId,
    candidate.predecessorAttemptId,
    candidate.channel,
    candidate.contactMethodId,
    candidate.recipientUserId,
    candidate.outcome,
    candidate.attemptKind,
  );
}

function smsQuoteParts(candidate: ExecutionCandidateV1): Uint8Array[] {
  const quote = candidate.smsQuote;
  return quote === null ? [frame(null)] : f(
    quote.segments,
    quote.rateId,
    quote.provider,
    quote.country,
    quote.currency,
    quote.minorNumerator,
    quote.minorDenominator,
    quote.allocatedCostMinor,
  );
}

async function payloadHash(
  channel: Channel,
  payload: Record<string, unknown> | null,
): Promise<string | null> {
  if (payload === null) return null;
  const fields = channel === "email"
    ? [
      payload.payloadVersion,
      payload.subject,
      payload.bodyHtml,
      payload.bodyText,
      ...((payload.embeddedEventIds as string[]) ?? []),
      payload.volatileLinkMarker,
    ]
    : channel === "sms"
    ? [
      payload.payloadVersion,
      payload.body,
      ...((payload.embeddedEventIds as string[]) ?? []),
      payload.volatileLinkMarker,
    ]
    : [payload.payloadVersion, payload.title, payload.body, payload.eventId];
  return await digest([
    frame("mingla:offering-payload:v1"),
    frame(channel),
    ...fields.map((value) => frame(value as string | number | null)),
  ]);
}

function canonicalTimestamp(now: Date): string {
  return now.toISOString().replace(/\.(\d{3})Z$/, ".$1000Z");
}

function validatedRates(now: Date): SmsRateV1[] {
  const raw = resolveOfferingInviteSmsPriceBook();
  if (!Array.isArray(raw)) throw new Error("cost_unavailable");
  return raw.map((entry) => {
    const rate = entry as SmsRateV1;
    if (
      typeof rate?.rateId !== "string" ||
      (rate.provider !== "twilio" && rate.provider !== "termii") ||
      !/^[A-Z]{2}$/.test(rate.country) || !/^[A-Z]{3}$/.test(rate.currency) ||
      rate.unit !== "sms_segment" ||
      !Number.isSafeInteger(rate.minorNumerator) ||
      rate.minorNumerator <= 0 ||
      !Number.isSafeInteger(rate.minorDenominator) ||
      rate.minorDenominator <= 0 ||
      !Number.isFinite(Date.parse(rate.effectiveAt)) ||
      !Number.isFinite(Date.parse(rate.expiresAt)) ||
      Date.parse(rate.effectiveAt) > now.getTime() ||
      Date.parse(rate.expiresAt) <= now.getTime() ||
      typeof rate.sourceReference !== "string" ||
      rate.sourceReference.length === 0
    ) throw new Error("cost_unavailable");
    return rate;
  });
}

function assertContent(value: string, maxBytes: number): void {
  if (
    new TextEncoder().encode(value).length > maxBytes ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) ||
    /(?:oi=|javascript:|data:)/i.test(value)
  ) throw new Error("offering_execution_content_invalid");
  for (const match of value.matchAll(/(?:https?:)?\/\/[^\s"'<>]+/gi)) {
    let url: URL;
    try {
      url = new URL(match[0].startsWith("//") ? `https:${match[0]}` : match[0]);
    } catch {
      throw new Error("offering_execution_content_invalid");
    }
    if (
      url.protocol !== "https:" ||
      ![
        "business.usemingla.com",
        "cdn.usemingla.com",
        "mingla.app",
        "usemingla.com",
        "www.usemingla.com",
      ].includes(url.hostname)
    ) throw new Error("offering_execution_content_invalid");
  }
}

export async function validatePersistedOfferingPushV1(
  value: unknown,
): Promise<PersistedOfferingPushV1 | null> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const payload = value as Record<string, unknown>;
  if (
    Object.keys(payload).sort().join(",") !==
      "body,eventId,payloadHash,payloadVersion,title" ||
    payload.payloadVersion !== 1 || typeof payload.payloadHash !== "string" ||
    !HEX.test(payload.payloadHash) || typeof payload.title !== "string" ||
    typeof payload.body !== "string" || typeof payload.eventId !== "string" ||
    !UUID.test(payload.eventId)
  ) return null;
  try {
    assertContent(payload.title, 200);
    assertContent(payload.body, 10000);
  } catch {
    return null;
  }
  const computed = await payloadHash("push", payload);
  return computed === payload.payloadHash
    ? payload as unknown as PersistedOfferingPushV1
    : null;
}

export async function buildOfferingExecutionSnapshot(input: {
  eventId: string;
  brandId: string;
  purpose: Purpose;
  channels: Channel[];
  selectionHash: string;
  candidates: QuoteCandidateRow[];
  content: {
    subject?: string;
    bodyHtml?: string;
    bodyText?: string;
    body?: string;
    pushTitle?: string;
    pushBody?: string;
  };
  /** Service-authorized predecessor payload. Required for a push retry. */
  retryPushPayload?: PersistedOfferingPushV1 | null;
  now?: Date;
  allowEmptyPreview?: boolean;
}): Promise<ExecutionSnapshotV1> {
  const now = input.now ?? new Date();
  if (
    !UUID.test(input.eventId) || !UUID.test(input.brandId) ||
    !HEX.test(input.selectionHash)
  ) {
    throw new Error("offering_execution_snapshot_invalid");
  }
  const channels = [...new Set(input.channels)].sort() as Channel[];
  if (
    channels.length === 0 || channels.join(",") !== input.channels.join(",")
  ) {
    throw new Error("offering_execution_snapshot_invalid");
  }
  const authored = Object.values(input.content).filter((
    value,
  ): value is string => typeof value === "string");
  if (authored.some((value) => value.includes(OFFERING_INVITE_LINK_MARKER))) {
    throw new Error("offering_execution_content_invalid");
  }
  if (
    input.candidates.some((candidate) =>
      candidate.normalizedContact !== null &&
      authored.some((value) =>
        value.toLocaleLowerCase("en-US").includes(
          candidate.normalizedContact!.toLocaleLowerCase("en-US"),
        )
      )
    )
  ) throw new Error("offering_execution_content_invalid");
  const retryPush = input.purpose === "retry_delivery"
    ? input.retryPushPayload ?? null
    : null;
  if (
    input.purpose === "retry_delivery" && channels.includes("push") &&
    (retryPush === null || Object.keys(retryPush).sort().join(",") !==
        "body,eventId,payloadHash,payloadVersion,title" ||
      retryPush.payloadVersion !== 1 || retryPush.eventId !== input.eventId ||
      !HEX.test(retryPush.payloadHash))
  ) throw new Error("retry_payload_mismatch");
  const campaigns: ExecutionSnapshotV1["campaigns"] = {
    email: channels.includes("email")
      ? {
        payloadVersion: 1,
        payloadHash: "",
        subject: input.content.subject ?? "You're invited",
        bodyHtml: `${
          input.content.bodyHtml ?? ""
        }<p><a href="${OFFERING_INVITE_LINK_MARKER}">Open event</a></p>`,
        bodyText: `${
          input.content.bodyText ?? input.content.body ??
            "You're invited on Mingla."
        }\n\n${OFFERING_INVITE_LINK_MARKER}`,
        embeddedEventIds: [input.eventId],
        volatileLinkMarker: OFFERING_INVITE_LINK_MARKER,
      }
      : null,
    sms: channels.includes("sms")
      ? {
        payloadVersion: 1,
        payloadHash: "",
        body: `${
          input.content.body ?? input.content.bodyText ??
            "You're invited on Mingla."
        } ${OFFERING_INVITE_LINK_MARKER}`,
        embeddedEventIds: [input.eventId],
        volatileLinkMarker: OFFERING_INVITE_LINK_MARKER,
      }
      : null,
    push: channels.includes("push")
      ? retryPush ?? {
        payloadVersion: 1,
        payloadHash: "",
        title: input.content.pushTitle ?? input.content.subject ??
          "You're invited",
        body: input.content.pushBody ?? input.content.body ??
          input.content.bodyText ?? "Open Mingla for details.",
        eventId: input.eventId,
      }
      : null,
  };
  if (campaigns.email !== null) {
    assertContent(String(campaigns.email.subject), 200);
    assertContent(String(campaigns.email.bodyHtml), 50000);
    assertContent(String(campaigns.email.bodyText), 10000);
  }
  if (campaigns.sms !== null) assertContent(String(campaigns.sms.body), 10000);
  if (campaigns.push !== null) {
    assertContent(String(campaigns.push.title), 200);
    assertContent(String(campaigns.push.body), 10000);
  }
  for (const channel of channels) {
    const value = campaigns[channel];
    if (value === null) throw new Error("offering_execution_content_invalid");
    const computed = await payloadHash(channel, value);
    if (
      input.purpose === "retry_delivery" && channel === "push" &&
      value.payloadHash !== computed
    ) throw new Error("retry_payload_mismatch");
    value.payloadHash = computed;
  }
  const candidates: ExecutionCandidateV1[] = input.candidates.map(
    (row): ExecutionCandidateV1 => {
      const targetId = row.channel === "push"
        ? row.recipientUserId
        : row.contactMethodId;
      if (
        !UUID.test(row.brandPersonId) || targetId === null ||
        !UUID.test(targetId) ||
        (row.inviteId !== null && !UUID.test(row.inviteId)) ||
        (row.predecessorAttemptId !== null &&
          !UUID.test(row.predecessorAttemptId))
      ) {
        throw new Error("offering_execution_candidate_invalid");
      }
      if (
        !row.allowed &&
        !SAFE_SUPPRESSION_REASONS.has(row.safeReasonCode ?? "")
      ) throw new Error("offering_execution_candidate_invalid");
      if (
        (input.purpose !== "invitation" && row.inviteId === null) ||
        (input.purpose === "retry_delivery" &&
          row.predecessorAttemptId === null) ||
        (input.purpose !== "retry_delivery" &&
          row.predecessorAttemptId !== null)
      ) throw new Error("offering_execution_candidate_invalid");
      return {
        candidateKey: `${row.brandPersonId}:${row.channel}:${targetId}`,
        brandPersonId: row.brandPersonId,
        inviteId: row.inviteId,
        predecessorAttemptId: row.predecessorAttemptId,
        channel: row.channel,
        contactMethodId: row.channel === "push" ? null : row.contactMethodId,
        recipientUserId: row.channel === "push" ? row.recipientUserId : null,
        outcome: row.allowed ? "queued" : "suppressed",
        safeReasonCode: row.allowed ? null : row.safeReasonCode ?? "suppressed",
        attemptKind: input.purpose === "invitation"
          ? "initial"
          : input.purpose === "reminder"
          ? "reminder"
          : "retry",
        smsQuote: null,
      };
    },
  ).sort((left, right) => left.candidateKey.localeCompare(right.candidateKey));
  if (
    candidates.length > 500 ||
    (candidates.length < 1 && !input.allowEmptyPreview)
  ) {
    throw new Error("offering_execution_candidate_invalid");
  }
  const rowByKey = new Map<string, QuoteCandidateRow>(
    input.candidates.map((row) => {
      const target = row.channel === "push"
        ? row.recipientUserId
        : row.contactMethodId;
      return [`${row.brandPersonId}:${row.channel}:${target}`, row] as const;
    }),
  );
  const hasReachableSms = candidates.some((candidate) =>
    candidate.channel === "sms" && candidate.outcome === "queued"
  );
  const rates = hasReachableSms ? validatedRates(now) : [];
  const fractions: Array<
    { candidate: ExecutionCandidateV1; numerator: bigint; denominator: bigint }
  > = [];
  for (const candidate of candidates) {
    if (candidate.channel !== "sms" || candidate.outcome !== "queued") continue;
    const source = rowByKey.get(candidate.candidateKey);
    if (source?.normalizedContact === null || source === undefined) {
      throw new Error("cost_unavailable");
    }
    const country = countryFromE164(source.normalizedContact);
    if (country === null) throw new Error("cost_unavailable");
    // orch-strict-grep-allow stripe-country-out-of-scope — This selects the
    // Nigeria SMS provider; it does not create or configure a Stripe account.
    const provider = country === "NG" ? "termii" : "twilio";
    const rate = rates.find((entry) =>
      entry.country === country && entry.provider === provider
    );
    if (rate === undefined) throw new Error("cost_unavailable");
    if (source.eventUrl === undefined) throw new Error("cost_unavailable");
    const eventUrl = new URL(source.eventUrl);
    if (
      eventUrl.protocol !== "https:" ||
      eventUrl.hostname !== "business.usemingla.com" ||
      !eventUrl.pathname.startsWith("/e/") || eventUrl.search !== "" ||
      eventUrl.hash !== "" || eventUrl.username !== "" ||
      eventUrl.password !== ""
    ) throw new Error("cost_unavailable");
    eventUrl.searchParams.set("oi", "A".repeat(43));
    const body = String(campaigns.sms?.body ?? "").replace(
      OFFERING_INVITE_LINK_MARKER,
      eventUrl.toString(),
    );
    const segments = computeSegments(composeSmsBody(body, true));
    candidate.smsQuote = {
      segments,
      rateId: rate.rateId,
      provider,
      country,
      currency: rate.currency,
      minorNumerator: rate.minorNumerator,
      minorDenominator: rate.minorDenominator,
      allocatedCostMinor: 0,
    };
    fractions.push({
      candidate,
      numerator: BigInt(segments) * BigInt(rate.minorNumerator),
      denominator: BigInt(rate.minorDenominator),
    });
  }
  const currencies = new Set(
    fractions.map((entry) => entry.candidate.smsQuote?.currency),
  );
  if (currencies.size > 1) throw new Error("mixed_currency_cost_unsupported");
  let floorTotal = 0n;
  let exactNumerator = 0n;
  let exactDenominator = 1n;
  for (const entry of fractions) {
    floorTotal += entry.numerator / entry.denominator;
    exactNumerator = exactNumerator * entry.denominator +
      entry.numerator * exactDenominator;
    exactDenominator *= entry.denominator;
  }
  const aggregate = fractions.length === 0
    ? 0n
    : (exactNumerator + exactDenominator - 1n) / exactDenominator;
  for (const entry of fractions) {
    if (entry.candidate.smsQuote !== null) {
      entry.candidate.smsQuote.allocatedCostMinor = Number(
        entry.numerator / entry.denominator,
      );
    }
  }
  let remainder = Number(aggregate - floorTotal);
  fractions.sort((left, right) => {
    const leftRem = left.numerator % left.denominator;
    const rightRem = right.numerator % right.denominator;
    const comparison = leftRem * right.denominator -
      rightRem * left.denominator;
    return comparison === 0n
      ? left.candidate.candidateKey.localeCompare(right.candidate.candidateKey)
      : comparison > 0n
      ? -1
      : 1;
  });
  for (const entry of fractions) {
    if (remainder <= 0) break;
    if (entry.candidate.smsQuote !== null) {
      entry.candidate.smsQuote.allocatedCostMinor += 1;
    }
    remainder -= 1;
  }
  candidates.sort((left, right) =>
    left.candidateKey.localeCompare(right.candidateKey)
  );
  const selectionHash = input.selectionHash;
  const eligibilityHash = await digest([
    frame("mingla:offering-eligibility:v1"),
    ...f(input.eventId, input.brandId, input.purpose, selectionHash),
    ...candidates.flatMap(candidateIdentityParts),
  ]);
  const payloadHashes = await Promise.all(
    channels.map((channel) => payloadHash(channel, campaigns[channel])),
  );
  const smsSegments = candidates.reduce(
    (sum, candidate) => sum + (candidate.smsQuote?.segments ?? 0),
    0,
  );
  const rateIds = [
    ...new Set(
      candidates.flatMap((candidate) =>
        candidate.smsQuote === null ? [] : [candidate.smsQuote.rateId]
      ),
    ),
  ].sort();
  const currency = fractions.length === 0
    ? null
    : (fractions[0].candidate.smsQuote?.currency ?? null);
  const quoteHash = await digest([
    frame("mingla:offering-quote:v1"),
    ...f(input.eventId, input.purpose),
    ...channels.map(frame),
    frame(eligibilityHash),
    ...f(Number(smsSegments), Number(aggregate), currency),
    ...rateIds.map(frame),
    ...payloadHashes.map(frame),
    ...candidates.flatMap((candidate) => [
      ...f(candidate.candidateKey, candidate.outcome),
      ...smsQuoteParts(candidate),
    ]),
  ]);
  const executionSnapshotHash = await digest([
    frame("mingla:offering-execution:v1"),
    ...f(1, input.eventId, input.brandId, input.purpose),
    ...channels.map(frame),
    ...f(selectionHash, eligibilityHash, quoteHash),
    ...payloadHashes.map(frame),
    ...candidates.flatMap(executionCandidateParts),
  ]);
  const snapshot: ExecutionSnapshotV1 = {
    schemaVersion: 1,
    eventId: input.eventId,
    brandId: input.brandId,
    purpose: input.purpose,
    channels,
    selectionHash,
    eligibilityHash,
    quotedAt: canonicalTimestamp(now),
    quote: {
      quoteHash,
      smsSegments,
      estimatedCostMinor: Number(aggregate),
      currency,
      rateIds,
    },
    campaigns,
    candidates,
    executionSnapshotHash,
  };
  if (new TextEncoder().encode(JSON.stringify(snapshot)).length > 262144) {
    throw new Error("offering_execution_snapshot_too_large");
  }
  return snapshot;
}

export async function hashPushVector(input: {
  eventId: string;
  brandId: string;
  brandPersonId: string;
  recipientUserId: string;
  selectionHash: string;
  quotedAt: string;
}): Promise<
  {
    payloadHash: string;
    eligibilityHash: string;
    quoteHash: string;
    executionSnapshotHash: string;
  }
> {
  const candidate: ExecutionCandidateV1 = {
    candidateKey: `${input.brandPersonId}:push:${input.recipientUserId}`,
    brandPersonId: input.brandPersonId,
    inviteId: null,
    predecessorAttemptId: null,
    channel: "push",
    contactMethodId: null,
    recipientUserId: input.recipientUserId,
    outcome: "queued",
    safeReasonCode: null,
    attemptKind: "initial",
    smsQuote: null,
  };
  const payload = {
    payloadVersion: 1,
    title: "You are invited",
    body: "Open Mingla for details.",
    eventId: input.eventId,
  };
  const pushHash = (await payloadHash("push", payload))!;
  const eligibilityHash = await digest([
    frame("mingla:offering-eligibility:v1"),
    ...f(input.eventId, input.brandId, "invitation", input.selectionHash),
    ...candidateIdentityParts(candidate),
  ]);
  const quoteHash = await digest([
    frame("mingla:offering-quote:v1"),
    ...f(input.eventId, "invitation", "push", eligibilityHash, 0, 0, null),
    frame(pushHash),
    ...f(candidate.candidateKey, candidate.outcome),
    ...smsQuoteParts(candidate),
  ]);
  const executionSnapshotHash = await digest([
    frame("mingla:offering-execution:v1"),
    ...f(
      1,
      input.eventId,
      input.brandId,
      "invitation",
      "push",
      input.selectionHash,
      eligibilityHash,
      quoteHash,
      pushHash,
    ),
    ...executionCandidateParts(candidate),
  ]);
  return {
    payloadHash: pushHash,
    eligibilityHash,
    quoteHash,
    executionSnapshotHash,
  };
}
