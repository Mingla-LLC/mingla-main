/**
 * issue #2291 — THE single source of truth for what a `marketing_campaigns`
 * `channel_payload` must contain, per channel.
 *
 * WHY THIS FILE EXISTS. The rule was previously written down in three places
 * and enforced in none that mattered:
 *
 *   1. `mingla-business/src/services/marketing/marketingRenderingService.ts`
 *      exported `validateChannelPayload`, which checked EXACTLY the right
 *      things and had ZERO production callers — its only references in the
 *      whole monorepo were its own definition and its own test. It also
 *      dereferenced without a guard, so it would have thrown on the very
 *      payload it existed to reject.
 *   2. `compose.tsx` reimplemented the same readiness rule inline, from local
 *      component state, so it could never see a stored row.
 *   3. The database CHECK validated only the `kind` discriminator and nothing
 *      it discriminates.
 *
 * Result: `draft_campaign` wrote `{kind:"email", body:"..."}` — a key no email
 * reader looks at — and every layer stored it, read it back as `""`, and
 * carried on.
 *
 * CONTRACT. `campaignPayloadIssues` NEVER THROWS. It is called on untrusted
 * stored rows, so `null`, `undefined`, arrays, primitives, and a missing or
 * non-string `kind` all come back as an ISSUE, never as an exception. A
 * validator that can throw is a validator that turns a bad row into a crashed
 * screen — which is precisely #2291's Q4.
 *
 * Mirrored for React Native at
 * `mingla-business/src/services/marketing/campaignPayloadContract.ts` (RN
 * cannot import from `supabase/functions/`). The two must stay behaviourally
 * identical; both are driven by the same case table in their tests.
 *
 * SCOPE NOTE — `subject`. This module requires a non-empty subject for email,
 * matching the composer's own send-readiness rule and the `email_subject_empty`
 * guard in `marketing-send`. The DB CHECK deliberately does NOT: nine live
 * drafts carry a blank subject and must stay editable. Validity AT REST is
 * looser than validity AT SEND, on purpose.
 */

/** The channels that can actually be dispatched today. `rcs` is not one. */
export const DISPATCHABLE_CHANNEL_KINDS = ["email", "sms"] as const;
export type DispatchableChannelKind = typeof DISPATCHABLE_CHANNEL_KINDS[number];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Returns `[]` when the payload satisfies its own channel's contract, else a
 * list of human-readable problems. Never throws.
 */
export function campaignPayloadIssues(payload: unknown): string[] {
  if (!isPlainObject(payload)) {
    return [
      `channel_payload must be an object, got ${
        payload === null
          ? "null"
          : Array.isArray(payload)
          ? "array"
          : typeof payload
      }`,
    ];
  }

  const kind = payload.kind;
  if (typeof kind !== "string" || kind.length === 0) {
    return [
      `unsupported channel kind: ${
        kind === undefined ? "(missing)" : String(kind)
      }`,
    ];
  }

  const issues: string[] = [];
  switch (kind) {
    case "email": {
      if (!nonEmptyString(payload.subject)) {
        issues.push("Email campaigns need a subject line.");
      }
      if (!nonEmptyString(payload.body_html)) {
        // Named explicitly: `body` is the SMS key and writing it on an email
        // payload is the #2291 defect itself.
        issues.push(
          "Email campaigns need a message body in `body_html` (not `body` — that key is SMS-only and is never read on the email path).",
        );
      }
      break;
    }
    case "sms": {
      if (!nonEmptyString(payload.body)) {
        issues.push("SMS campaigns need a message body in `body`.");
      }
      if (
        Object.hasOwn(payload, "include_follow_cta") &&
        typeof payload.include_follow_cta !== "boolean"
      ) {
        issues.push("SMS `include_follow_cta` must be true or false.");
      }
      break;
    }
    default:
      // Includes `rcs`: the DB CHECK allows the discriminator, but
      // `dispatchByKind` in marketing-send has no arm for it and throws
      // `unknown_channel_kind`, so an rcs campaign can only ever be claimed
      // and then failed. Refusing it at the writer is the honest answer.
      issues.push(`unsupported channel kind: ${kind}`);
  }
  return issues;
}

/** Validate Ari's draft tool arguments before an approval card is created. */
export function campaignDraftPayloadIssues(args: unknown): string[] {
  if (!isPlainObject(args)) {
    return ["Campaign draft details must be provided as an object."];
  }
  const channel = args.channel === undefined ? "email" : args.channel;
  if (channel === "email") {
    return campaignPayloadIssues({
      kind: "email",
      subject: args.subject,
      body_html: args.body,
    });
  }
  if (channel === "sms") {
    return campaignPayloadIssues({ kind: "sms", body: args.body });
  }
  return campaignPayloadIssues({ kind: channel, body: args.body });
}

/** Reject common factual, offer and urgency claims the host never supplied. */
export function campaignDraftCopyIssues(
  args: unknown,
  trustedUserText: string,
): string[] {
  if (!isPlainObject(args) || !trustedUserText.trim()) return [];
  const rawCopy = [args.title, args.subject, args.body]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  const copy = rawCopy.replace(/<[^>]*>/g, " ");
  const claims: Array<[string, RegExp]> = [
    ["event history", /\b(?:back again|is back|returns? to|returning)\b/i],
    [
      "scarcity or urgency",
      /\b(?:before it sells out|selling out|sold out|limited spots?|last chance|be one of the first|first \d+ people|priority (?:entry|access))\b/i,
    ],
    [
      "unverified performance details",
      /\blive\s+(?:music|bands?|djs?|performances?|artists?|sets?)\b/i,
    ],
    ["unverified event setting", /\bunder the stars\b/i],
  ];
  const issues = claims.flatMap(([label, pattern]) => {
    const match = copy.match(pattern)?.[0];
    return match && !pattern.test(trustedUserText)
      ? [`Remove the unsupported ${label} claim (“${match}”).`]
      : [];
  });
  const urls = rawCopy.match(/https?:\/\/[^\s<>"']+/gi) ?? [];
  for (const url of urls) {
    if (!trustedUserText.includes(url)) {
      issues.push(`Use no campaign link the host did not provide (“${url}”).`);
    }
  }
  return issues;
}

/** Build a plain, source-grounded draft when a model proposal adds risky claims. */
export function buildGroundedCampaignDraft(
  args: Record<string, unknown>,
  trustedUserText: string,
  brandName: string,
): Record<string, unknown> | null {
  const eventMatch = trustedUserText.match(/\bpromote\s+(.+?)\s+to\b/i);
  const eventName = eventMatch?.[1]?.trim().replace(/^["“”']+|["“”']+$/g, "") ||
    null;
  const offerMatch = trustedUserText.match(
    /\b(?:early[- ]bird access|group admission|two-person entry|gear checklist)\b/i,
  );
  const offer = offerMatch?.[0] ?? null;
  const channel = args.channel;
  if (
    !eventName || !offer || !brandName.trim() ||
    (channel !== "email" && channel !== "sms")
  ) return null;

  const safeTitle = `${eventName} — ${offer}`;
  const body = channel === "email"
    ? `<p>Hello,</p><p>Join ${brandName} for ${eventName}.</p><p>Ask ${brandName} about the ${offer} offer.</p>`
    : `Join ${brandName} for ${eventName}. Ask ${brandName} about the ${offer} offer.`;
  return {
    ...args,
    title: safeTitle,
    subject: safeTitle,
    body,
  };
}

/** Convenience predicate for call sites that only need a yes/no. */
export function isCampaignPayloadSendable(payload: unknown): boolean {
  return campaignPayloadIssues(payload).length === 0;
}
