// #4273 — text every payout country (34 Stripe + NG), one switch per country.
//
// T-A every payout country maps from its calling code (Canada split from +1 by
//     area code); Ghana, South Africa, the Philippines and Kenya stay unmapped.
// T-B the price rule and the sender rule are ONE rule (smsProviderForCountry).
// T-C one switch per country: an absent key is OFF, US does not carry GB or CA.
// T-D every mapped country has a quiet-hours window and a sender route.
// T-E windows: France never on Sunday and until 21:30; Toronto 07:30 is held;
//     a number that can be in two zones is held to the stricter one.
// T-F a text to an alphanumeric-sender country ends with the opt-out link, the
//     quote measures it, and it routes through the marketing service only.
// T-G (superseded by item 10: prices no longer expire; see
//     issue_4273_sms_price_table.implementor.test.ts for the staleness alert).
// T-H the book validator refuses wrong routes, duplicates and unmapped
//     countries, and accepts the ready-to-paste entry list.
// MINGLA-INVARIANT: I-4273-ONE-SMS-SWITCH-PER-COUNTRY | issue #4273 | Each mapped country has its own sms_live_enabled.<cc> switch, off when absent; a switched-off country is skipped as "can't text their country yet", never sent.
// MINGLA-INVARIANT: I-4273-ALPHA-COUNTRIES-NEVER-USE-TOLL-FREE | issue #4273 | A marketing text to an alphanumeric-sender country goes only through TWILIO_MARKETING_MESSAGING_SERVICE_SID; without it the country is not textable; US and CA stay on the toll-free service.
// MINGLA-INVARIANT: I-4273-OPT-OUT-LINK-WHERE-NO-REPLY | issue #4273 | A marketing text whose sender cannot take a STOP reply ends with a branded opt-out link, and the quote measures the same link length.
import {
  assert,
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  CANADIAN_AREA_CODES,
  countryFromE164,
  MAPPED_COUNTRIES,
} from "../e164Country.ts";
import {
  isWithinSmsWindow,
  msUntilSmsWindowOpens,
  SMS_COUNTRIES,
  smsMarketingRoute,
} from "../smsCountries.ts";
import {
  composeSmsBody,
  computeSegments,
  resolveMarketKillSwitch,
  smsProviderForCountry,
} from "../adapters/smsAdapter.ts";
import { resolveSmsCountryLive } from "../secretBundle.ts";
import {
  smsCountryTextableNow,
  smsRateForPhone,
  type SmsRateV1,
  validatedSmsRates,
} from "../smsPriceBook.ts";
import {
  buildMarketingBookQuote,
  marketingBookSmsWireBody,
  smsNeedsOptOutLink,
} from "../marketingBookQuote.ts";
import {
  signSmsUnsubscribeToken,
  verifyUnsubscribeToken,
} from "../marketingTokens.ts";

const STRIPE_COUNTRIES = [
  "US",
  "GB",
  "CA",
  "CH",
  "AT",
  "BE",
  "BG",
  "CY",
  "CZ",
  "DE",
  "DK",
  "EE",
  "ES",
  "FI",
  "FR",
  "GR",
  "HR",
  "HU",
  "IE",
  "IS",
  "IT",
  "LI",
  "LT",
  "LU",
  "LV",
  "MT",
  "NL",
  "NO",
  "PL",
  "PT",
  "RO",
  "SE",
  "SI",
  "SK",
];
const PAYOUT = [...STRIPE_COUNTRIES, "NG"].sort();
// One plausible handset per country (fake numbers, never real people).
const SAMPLE: Record<string, string> = {
  US: "+12025550142",
  CA: "+14165550142",
  GB: "+447700900142",
  IE: "+353851234567",
  FR: "+33612345678",
  BE: "+32470123456",
  DE: "+4915112345678",
  ES: "+34612345678",
  NL: "+31612345678",
  IT: "+393123456789",
  PT: "+351912345678",
  AT: "+436641234567",
  CH: "+41791234567",
  BG: "+359881234567",
  CY: "+35796123456",
  CZ: "+420601123456",
  DK: "+4520123456",
  EE: "+3725123456",
  FI: "+358401234567",
  GR: "+306912345678",
  HR: "+385911234567",
  HU: "+36201234567",
  IS: "+3546111234",
  LI: "+4237811234",
  LT: "+37061234567",
  LU: "+352621123456",
  LV: "+37121234567",
  MT: "+35679123456",
  NO: "+4791234567",
  PL: "+48601234567",
  RO: "+40712345678",
  SE: "+46701234567",
  SI: "+38631234567",
  SK: "+421901123456",
  NG: "+2348031104273",
};
const flags = (sms: Record<string, boolean>) => (name: string) =>
  name === "MINGLA_DELIVERY_FLAGS_JSON"
    ? JSON.stringify({
      schema_version: 1,
      marketing_send_live_enabled: true,
      sms_live_enabled: { ng: false, us: false, ...sms },
    })
    : name === "TWILIO_MARKETING_MESSAGING_SERVICE_SID"
    ? "MGtest"
    : undefined;

Deno.test("#4273 T-A every payout country maps, Canada splits from +1, the four excluded stay unmapped", () => {
  assertEquals([...MAPPED_COUNTRIES].sort(), PAYOUT);
  for (const country of PAYOUT) {
    assertEquals(countryFromE164(SAMPLE[country]), country, country);
  }
  for (const code of CANADIAN_AREA_CODES) {
    assertEquals(countryFromE164(`+1${code}5550142`), "CA", code);
  }
  assertEquals(countryFromE164("+12125550142"), "US");
  for (
    const excluded of [
      "+233241234567",
      "+27821234567",
      "+639171234567",
      "+254712345678",
    ]
  ) {
    assertEquals(countryFromE164(excluded), null, excluded);
  }
});

Deno.test("#4273 T-B the price rule and the sender rule are one rule", () => {
  const rates = PAYOUT.map((country) => ({
    country,
    provider: smsProviderForCountry(country),
  }));
  for (const country of PAYOUT) {
    assertEquals(
      smsRateForPhone(SAMPLE[country], rates)?.provider,
      smsProviderForCountry(country),
    );
  }
  assertEquals(smsProviderForCountry("NG"), "termii");
  assertEquals(smsProviderForCountry("GB"), "twilio");
});

Deno.test("#4273 T-C one switch per country; absent is off; US carries nobody else", () => {
  const env = flags({ us: true, gb: true });
  assertEquals(resolveSmsCountryLive("US", env), true);
  assertEquals(resolveSmsCountryLive("GB", env), true);
  assertEquals(
    resolveSmsCountryLive("CA", env),
    false,
    "CA has its own switch",
  );
  assertEquals(resolveSmsCountryLive("FR", env), false, "absent key is off");
  assertEquals(resolveSmsCountryLive(null, env), false);
  assertEquals(resolveSmsCountryLive("GH", env), false);
  assertEquals(resolveMarketKillSwitch("GB"), "SMS_LIVE_ENABLED_GB");
  assertEquals(resolveMarketKillSwitch("CA"), "SMS_LIVE_ENABLED_CA");
  assertEquals(resolveMarketKillSwitch(null), null);
  assertEquals(resolveMarketKillSwitch("ZA"), null);
  // An unknown key invalidates the bundle (all-or-nothing): nothing new is on.
  const bad = (name: string) =>
    name === "MINGLA_DELIVERY_FLAGS_JSON"
      ? JSON.stringify({
        schema_version: 1,
        marketing_send_live_enabled: true,
        sms_live_enabled: { ng: true, us: true, gh: true },
      })
      : undefined;
  assertEquals(resolveSmsCountryLive("GB", bad), false);
});

Deno.test("#4273 T-D every mapped country has a window and a sender route", () => {
  assertEquals(Object.keys(SMS_COUNTRIES).sort(), PAYOUT);
  for (const country of PAYOUT) {
    assert(
      SMS_COUNTRIES[country].window.start < SMS_COUNTRIES[country].window.end,
    );
  }
  assertEquals(smsMarketingRoute("US", false), "toll_free");
  assertEquals(smsMarketingRoute("CA", true), "toll_free");
  assertEquals(smsMarketingRoute("NG", false), "termii");
  assertEquals(smsMarketingRoute("GB", true), "marketing");
  assertEquals(
    smsMarketingRoute("GB", false),
    null,
    "never the toll-free instead",
  );
  assertEquals(smsMarketingRoute("BE", true), null, "needs a local number");
  assertEquals(smsMarketingRoute("HU", true), null);
  const env = flags({ us: true, gb: true, be: true });
  assertEquals(smsCountryTextableNow("GB", env), true);
  assertEquals(
    smsCountryTextableNow("BE", env),
    false,
    "switched on but no sender",
  );
  assertEquals(
    smsCountryTextableNow(
      "GB",
      (name) =>
        name === "TWILIO_MARKETING_MESSAGING_SERVICE_SID"
          ? undefined
          : env(name),
    ),
    false,
    "no marketing service: GB is not textable",
  );
});

Deno.test("#4273 T-E windows: France, Canada, and two-zone countries", () => {
  // Sunday 2026-11-08 10:00 Paris (09:00 UTC) is never allowed.
  assertEquals(
    isWithinSmsWindow(SAMPLE.FR, "FR", new Date("2026-11-08T09:00:00Z")),
    false,
  );
  // Saturday 2026-11-07 21:15 Paris (20:15 UTC) is allowed; 21:45 is not.
  assertEquals(
    isWithinSmsWindow(SAMPLE.FR, "FR", new Date("2026-11-07T20:15:00Z")),
    true,
  );
  assertEquals(
    isWithinSmsWindow(SAMPLE.FR, "FR", new Date("2026-11-07T20:45:00Z")),
    false,
  );
  // Toronto 416 at 07:30 EST (12:30 UTC) is held; at 08:00 it opens.
  const toronto = "+14165550142";
  assertEquals(
    isWithinSmsWindow(toronto, "CA", new Date("2026-11-09T12:30:00Z")),
    false,
  );
  assertEquals(
    msUntilSmsWindowOpens(toronto, "CA", new Date("2026-11-09T12:30:00Z")),
    30 * 60 * 1000,
  );
  // Portugal: 08:30 Lisbon is 07:30 in the Azores, so it is held.
  assertEquals(
    isWithinSmsWindow(SAMPLE.PT, "PT", new Date("2026-11-09T08:30:00Z")),
    false,
  );
  assertEquals(
    isWithinSmsWindow(SAMPLE.PT, "PT", new Date("2026-11-09T09:30:00Z")),
    true,
  );
  // An unmapped country has no window.
  assertEquals(isWithinSmsWindow("+233241234567", null, new Date()), false);
});

Deno.test("#4273 T-F the opt-out link replaces STOP where no reply works, and the quote measures it", async () => {
  assertEquals(smsNeedsOptOutLink(SAMPLE.GB), true);
  assertEquals(smsNeedsOptOutLink(SAMPLE.US), false);
  assertEquals(smsNeedsOptOutLink(SAMPLE.NG), false);
  const origin = "https://usemingla.com/m";
  const sendBody = composeSmsBody(
    "Doors at 9",
    true,
    `${origin}/${crypto.randomUUID()}`,
  );
  assert(
    sendBody.endsWith(sendBody.slice(-50)) &&
      /\nStop: https:\/\/usemingla\.com\/m\/[0-9a-f-]{36}$/.test(sendBody),
  );
  assert(!sendBody.includes("Reply STOP"));
  const quoteBody = marketingBookSmsWireBody("Doors at 9", origin, true);
  assertEquals(quoteBody.length, sendBody.length, "same fixed-length link");
  assertEquals(computeSegments(quoteBody), computeSegments(sendBody));
  // A long body crosses a segment boundary only because of the link.
  const body = "x".repeat(130);
  const rates: SmsRateV1[] = ["GB", "US"].map((country) => ({
    rateId: `r-${country}`,
    provider: "twilio",
    country,
    currency: "USD",
    unit: "sms_segment",
    minorNumerator: 1,
    minorDenominator: 1,
    effectiveAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
    sourceReference: "test",
  }));
  const quote = await buildMarketingBookQuote(
    {
      brandId: "brand",
      channel: "sms",
      selectedCount: 2,
      content: { kind: "sms", body },
      candidates: [
        {
          brandPersonId: "p-gb",
          contactMethodId: "m-gb",
          normalizedContact: SAMPLE.GB,
          allowed: true,
          safeReasonCode: "allowed",
        },
        {
          brandPersonId: "p-us",
          contactMethodId: "m-us",
          normalizedContact: SAMPLE.US,
          allowed: true,
          safeReasonCode: "allowed",
        },
      ],
    },
    new Date("2026-11-08T12:00:00.000Z"),
    {
      smsRates: rates,
      trackingOrigin: origin,
      smsCountryLive: () => true,
    },
  );
  const gb = quote.candidates.find((c) => c.brandPersonId === "p-gb")!;
  const us = quote.candidates.find((c) => c.brandPersonId === "p-us")!;
  assertEquals(
    gb.segments,
    computeSegments(marketingBookSmsWireBody(body, origin, true)),
  );
  assertEquals(
    us.segments,
    computeSegments(marketingBookSmsWireBody(body, origin)),
  );
  assert(gb.segments > us.segments, "the link is counted");
});

Deno.test("#4273 T-F2 the SMS opt-out token names the number and nothing else", async () => {
  const previous = Deno.env.get("UNSUBSCRIBE_TOKEN_SECRET");
  Deno.env.set(
    "UNSUBSCRIBE_TOKEN_SECRET",
    "issue-4273-test-secret-not-a-real-key-0123456789",
  );
  try {
    const token = await signSmsUnsubscribeToken({
      campaign_id: "c",
      recipient_phone: SAMPLE.GB,
      brand_id: "b",
    });
    const payload = await verifyUnsubscribeToken(token);
    assertEquals(payload.channel, "sms");
    assertEquals(payload.recipient_phone, SAMPLE.GB);
    assertEquals(payload.recipient_email, "");
  } finally {
    if (previous === undefined) Deno.env.delete("UNSUBSCRIBE_TOKEN_SECRET");
    else Deno.env.set("UNSUBSCRIBE_TOKEN_SECRET", previous);
  }
});

Deno.test("#4273 T-H the book validator: routes, duplicates, unmapped; the paste-ready list passes", async () => {
  const now = new Date("2026-11-09T00:00:00.000Z");
  const entry = (country: string, provider: "twilio" | "termii") => ({
    rateId: `${provider}-${country}`,
    provider,
    country,
    currency: "USD",
    unit: "sms_segment",
    minorNumerator: 1,
    minorDenominator: 1,
    effectiveAt: "2026-11-01T00:00:00.000Z",
    expiresAt: "2026-12-08T00:00:00.000Z",
    sourceReference: "test",
  });
  assertThrows(
    () => validatedSmsRates(now, [entry("NG", "twilio")]),
    Error,
    "sms_rate_book_invalid",
  );
  assertThrows(
    () => validatedSmsRates(now, [entry("GB", "termii")]),
    Error,
    "sms_rate_book_invalid",
  );
  assertThrows(
    () =>
      validatedSmsRates(now, [entry("GB", "twilio"), entry("GB", "twilio")]),
    Error,
    "sms_rate_book_invalid",
  );
  assertThrows(
    () => validatedSmsRates(now, [entry("GH", "twilio")]),
    Error,
    "sms_rate_book_invalid",
  );
  assertEquals(
    validatedSmsRates(now, [entry("GB", "twilio"), entry("NG", "termii")])
      .length,
    2,
  );
  // The ready-to-paste list (kept outside the repo) validates when present.
  const path = `${
    Deno.env.get("HOME")
  }/.mingla-private/4273/price_book_entries.json`;
  let list: unknown[] | null = null;
  try {
    list = JSON.parse(await Deno.readTextFile(path));
  } catch {
    list = null;
  }
  if (list !== null) {
    const rates = validatedSmsRates(now, list);
    assertEquals(rates.length, PAYOUT.length);
    assertEquals(rates.map((rate) => rate.country).sort(), PAYOUT);
  }
});
