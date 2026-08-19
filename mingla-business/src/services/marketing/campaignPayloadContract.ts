/**
 * issue #2291 — THE single source of truth, RN side, for what a
 * `marketing_campaigns` `channel_payload` must contain per channel.
 *
 * BEHAVIOURALLY IDENTICAL to `supabase/functions/_shared/campaignPayloadContract.ts`.
 * React Native cannot import from `supabase/functions/`, so the rule exists
 * twice; both copies are driven by the SAME case table in their tests
 * (`__tests__/campaignPayloadContract.test.ts` here,
 * `_shared/issue_2291_payload_contract.test.ts` there) so drift shows up as a
 * red test rather than as an email nobody can read.
 *
 * REPLACES `validateChannelPayload` in `marketingRenderingService.ts`, which
 * checked exactly the right things and had ZERO production callers, and which
 * carried two defects of its own: it dereferenced `payload.subject.trim()`
 * without a guard — so it would have THROWN on the malformed payload it existed
 * to reject — and its SMS arm still answered "SMS channel not yet enabled"
 * though SMS has been live since META-ORCH-1161.
 *
 * CONTRACT: never throws. It is called on rows read back from the database,
 * where `undefined`, `null`, an array, or a missing `kind` are all possible.
 * A validator that throws turns a bad row into a crashed screen, which is
 * exactly the composer failure this issue is about.
 */

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
      break;
    }
    default:
      issues.push(`unsupported channel kind: ${kind}`);
  }
  return issues;
}

/** Convenience predicate for call sites that only need a yes/no. */
export function isCampaignPayloadSendable(payload: unknown): boolean {
  return campaignPayloadIssues(payload).length === 0;
}

/**
 * The banner an operator sees when a stored draft cannot be sent as it stands.
 * Copy is deliberately about what THEY do next, not about what the payload is
 * missing — they did not write the payload, Ari may have.
 */
export const CAMPAIGN_DRAFT_INCOMPLETE_BANNER =
  "This draft is missing its message. Add your text below before sending.";
