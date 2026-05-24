// T-WL-10 — waitlist_spot_open dispatcher adversarial contract.
//
// Source-introspection keeps this repo-running without provider secrets while
// pinning the failure branches that production relies on.

import {
  assert,
  assertEquals,
  assertMatch,
  assertStringIncludes,
} from "https://deno.land/std@0.208.0/assert/mod.ts";

const SOURCE = await Deno.readTextFile(new URL("../index.ts", import.meta.url));

function extractFunctionBody(src: string, fnName: string): string {
  const declRe = new RegExp(
    `(?:async\\s+function|function)\\s+${fnName}\\s*\\([\\s\\S]*?\\)\\s*(?::\\s*[^\\{]*?)?\\{`,
  );
  const match = declRe.exec(src);
  assert(match !== null, `${fnName} must exist`);
  const openIdx = match.index + match[0].length - 1;
  let depth = 1;
  for (let i = openIdx + 1; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(openIdx + 1, i);
    }
  }
  throw new Error(`Could not extract ${fnName}`);
}

const waitlistDelivery = extractFunctionBody(
  SOURCE,
  "deliverWaitlistSpotOpenNotification",
);
const waitlistDispatch = extractFunctionBody(
  SOURCE,
  "handleWaitlistNotificationDispatch",
);

Deno.test("T-WL-10a: malformed waitlist_spot_open payload fails terminally, not retryable", () => {
  assertStringIncludes(waitlistDelivery, "payload.waitlist_entry_id");
  assertStringIncludes(waitlistDelivery, "payload.event_id");
  assertStringIncludes(waitlistDelivery, "payload.ticket_type_id");
  assertMatch(
    waitlistDelivery,
    /if\s*\(\s*!waitlistEntryId\s*\|\|\s*!eventId\s*\|\|\s*!ticketTypeId\s*\)\s*\{[\s\S]*?markNotificationTerminal\([\s\S]*?"waitlist_payload_invalid"[\s\S]*?return\s+"failed_terminal"/,
    "missing waitlist_entry_id/event_id/ticket_type_id must mark the notification failed_terminal",
  );
});

Deno.test("T-WL-10b: SMS-only waitlist path renders SMS and sends through Twilio", () => {
  assertMatch(
    waitlistDelivery,
    /if\s*\(\s*notification\.channel\s*===\s*"sms"\s*\)\s*\{[\s\S]*?sendTwilioMessage\([\s\S]*?renderWaitlistSpotOpenSms\(/,
    "sms waitlist notifications must use the waitlist SMS renderer and Twilio sender",
  );
  assertMatch(
    waitlistDelivery,
    /provider:\s*"twilio"[\s\S]*?provider_message_id:\s*sent\.sid[\s\S]*?return\s+"sent"/,
    "successful SMS delivery must mark provider/provider_message_id and return sent",
  );
});

Deno.test("T-WL-10c: provider errors remain retryable until max attempts", () => {
  assertStringIncludes(SOURCE, "class ProviderSendError extends Error");
  assertStringIncludes(SOURCE, "this.retryable = failure.retryable");
  assertMatch(
    waitlistDispatch,
    /const\s+retryable\s*=\s*err\s+instanceof\s+ProviderSendError\s*\?\s*err\.retryable\s*:\s*true/,
    "waitlist notification dispatch must preserve provider retryability classification",
  );
  assertMatch(
    waitlistDispatch,
    /status:\s*terminal\s*\?\s*"failed_terminal"\s*:\s*"failed_retryable"/,
    "retryable provider failures must be marked failed_retryable before the terminal attempt",
  );
});

Deno.test("T-WL-10d: waitlist branch is routed before unknown-template terminal fail", () => {
  const waitlistIdx = SOURCE.indexOf('templateKey === "waitlist_spot_open"');
  const unknownIdx = SOURCE.indexOf("unknown_template_key", waitlistIdx);
  assert(waitlistIdx > -1, "waitlist_spot_open branch must exist");
  assert(unknownIdx > waitlistIdx, "unknown-template fail must stay after waitlist branch");
  assertEquals(
    SOURCE.includes("deliverWaitlistSpotOpenNotification("),
    true,
    "waitlist branch must delegate to the waitlist delivery helper",
  );
});
