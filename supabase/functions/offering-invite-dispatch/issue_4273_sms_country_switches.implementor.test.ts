// #4273 (country switches) — the invite wizard and the invite quote read each
// country's switch from public.sms_country_switches (one snapshot per request).
//
// W-1 unreadable switches: the wizard offers no SMS.
// W-2 GB switched on (and nothing else): SMS is offered; all off: not offered.
// W-3 the invite quote with reachable SMS and no switches snapshot fails
//     closed (cost_unavailable); with one, a switched-off country is skipped.
import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { currentWizardDeliveryPolicy } from "./index.ts";
import {
  buildOfferingExecutionSnapshot,
  type QuoteCandidateRow,
} from "../_shared/offeringInviteQuote.ts";
import type { SmsRateV1 } from "../_shared/smsPriceBook.ts";
import { smsCountryTextableFrom } from "../_shared/smsCountrySwitches.ts";
import { seededSmsSwitches } from "../_shared/__tests__/_issue4273SmsSwitchesFixture.ts";

const FLAGS = JSON.stringify({
  schema_version: 1,
  marketing_send_live_enabled: true,
  sms_live_enabled: { us: true, ng: true },
});

function withFlags<T>(fn: () => T): T {
  const saved = Deno.env.get("MINGLA_DELIVERY_FLAGS_JSON");
  Deno.env.set("MINGLA_DELIVERY_FLAGS_JSON", FLAGS);
  try {
    return fn();
  } finally {
    if (saved === undefined) Deno.env.delete("MINGLA_DELIVERY_FLAGS_JSON");
    else Deno.env.set("MINGLA_DELIVERY_FLAGS_JSON", saved);
  }
}

Deno.test("#4273 W-1 unreadable switches: the wizard offers no SMS", () => {
  withFlags(() => {
    assertEquals(currentWizardDeliveryPolicy(null).channels, ["email", "push"]);
  });
});

Deno.test("#4273 W-2 SMS is offered when any country is switched on, never when none is", () => {
  withFlags(() => {
    const gbOnly = seededSmsSwitches({ on: ["GB"], master: { US: false, NG: false } });
    assertEquals(currentWizardDeliveryPolicy(gbOnly).channels, ["email", "push", "sms"]);
    const seeded = seededSmsSwitches();
    assertEquals(currentWizardDeliveryPolicy(seeded).channels, ["email", "push", "sms"]);
    const none = seededSmsSwitches({ on: [] });
    assertEquals(currentWizardDeliveryPolicy(none).channels, ["email", "push"]);
    // US and NG on in the database, but both bundle master switches off.
    const masterOff = seededSmsSwitches({ master: { US: false, NG: false } });
    assertEquals(currentWizardDeliveryPolicy(masterOff).channels, ["email", "push"]);
  });
});

Deno.test("#4273 W-3 the invite quote fails closed without a switches snapshot", async () => {
  const rate = (country: string, provider: "twilio" | "termii", currency: string): SmsRateV1 => ({
    rateId: `${provider}-${country.toLowerCase()}`,
    provider,
    country,
    currency,
    unit: "sms_segment",
    minorNumerator: 79,
    minorDenominator: 1,
    effectiveAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
    sourceReference: "test",
  });
  const rates = [rate("US", "twilio", "USD"), rate("GB", "twilio", "USD")];
  const row = (n: string, phone: string): QuoteCandidateRow => ({
    brandPersonId: `42730000-0000-4000-8000-00000000010${n}`,
    inviteId: null,
    predecessorAttemptId: null,
    channel: "sms",
    contactMethodId: `42730000-0000-4000-8000-00000000020${n}`,
    recipientUserId: null,
    normalizedContact: phone,
    allowed: true,
    safeReasonCode: null,
    lastContactAt: null,
    eventUrl: "https://host.usemingla.com/e/brand/night",
  });
  const rows = [row("1", "+12025550142"), row("2", "+447700900123")];
  const input = {
    eventId: "42730000-0000-4000-8000-0000000000e1",
    brandId: "42730000-0000-4000-8000-0000000000b1",
    purpose: "invitation" as const,
    channels: ["sms" as const],
    selectionHash: "a".repeat(64),
    candidates: rows,
    content: {},
    now: new Date("2026-11-09T12:00:00.000Z"),
    smsRates: rates,
  };
  await assertRejects(
    () => buildOfferingExecutionSnapshot(input),
    Error,
    "cost_unavailable",
  );
  const snapshot = await buildOfferingExecutionSnapshot({
    ...input,
    smsCountryLive: smsCountryTextableFrom(seededSmsSwitches()),
  });
  const byContact = Object.fromEntries(
    snapshot.candidates.map((c) => [c.contactMethodId, c.outcome]),
  );
  assertEquals(byContact[String(rows[0].contactMethodId)], "queued", "US is on");
  assertEquals(byContact[String(rows[1].contactMethodId)], "suppressed", "GB is off: skipped, not priced");
});
