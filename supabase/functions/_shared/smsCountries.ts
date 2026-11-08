// #4273 — where and when Mingla may send a marketing text, per country.
//
// One table for every country e164Country can map (the 35 payout countries:
// 34 Stripe + NG). Each row says:
//   - zones:  the IANA zones a number in that country can be in. A number is
//             inside the window only when it is inside it in EVERY listed zone,
//             so a country or area code that spans zones is held to the
//             strictest local time (never texted at 7 AM anywhere).
//             "nanp_area_code" (US, CA) resolves the zone from the area code.
//   - window: local start/end (minutes after midnight) and, where the law
//             restricts days, the allowed days (0 = Sunday).
//   - sender/registrationRequired/replyable: the Twilio sender facts that
//             decide whether "Reply STOP" can work (replyable) or the message
//             must carry an opt-out link instead.
//
// A country missing from this table is not textable for marketing: the caller
// fails it closed (unknown_timezone), exactly as before. A guard test fails if
// e164Country maps a country this table lacks.
//
// Sender facts: Twilio's per-country SMS guidelines
// (https://www.twilio.com/en-us/guidelines/<iso2>/sms), read 2026-11-08.
// Twilio console (2026-11-08): the "Mingla Marketing" Messaging Service holds
// one alphanumeric sender "Mingla" and no number; the toll-free number lives
// in the transactional service. So:
//   - toll_free:    US, CA — the transactional service (two-way: STOP works).
//   - termii:       NG — Termii, unchanged.
//   - alphanumeric: the marketing service (TWILIO_MARKETING_MESSAGING_SERVICE_SID).
//                   One-way, so the text carries an opt-out link. If that
//                   secret is missing the country is NOT textable — never
//                   sent from the toll-free number instead.
//   - needs_number: no alphanumeric sender works; not textable until a local
//                   number is added to the marketing service.
// registrationRequired: "Mingla" must be pre-registered with Twilio before the
// country's switch goes on (unregistered traffic is blocked or marked spam).

export type SmsSender =
  | "toll_free"
  | "alphanumeric"
  | "needs_number"
  | "termii";

export interface SmsCountryProfile {
  zones: readonly string[] | "nanp_area_code";
  window: { start: number; end: number; days?: readonly number[] };
  sender: SmsSender;
  /** The alpha sender must be registered with Twilio before the switch goes on. */
  registrationRequired: boolean;
  /** A "STOP" reply reaches Mingla (two-way sender). False → opt-out link. */
  replyable: boolean;
  /** Twilio guideline note for the operator (never shown to hosts). */
  note?: string;
}

const H = (hour: number, minute = 0): number => hour * 60 + minute;
const DAY = { start: H(8), end: H(21) } as const;
const eu = (
  zones: readonly string[],
  extra: Partial<SmsCountryProfile> = {},
): SmsCountryProfile => ({
  zones,
  window: DAY,
  sender: "alphanumeric",
  registrationRequired: false,
  replyable: false,
  ...extra,
});
const REG = { registrationRequired: true } as const;

export const SMS_COUNTRIES: Readonly<Record<string, SmsCountryProfile>> = {
  US: {
    zones: "nanp_area_code",
    window: DAY,
    sender: "toll_free",
    registrationRequired: false,
    replyable: true,
  },
  CA: {
    zones: "nanp_area_code",
    window: DAY,
    sender: "toll_free",
    registrationRequired: false,
    replyable: true,
  },
  NG: {
    zones: ["Africa/Lagos"],
    window: { start: H(8), end: H(20) },
    sender: "termii",
    registrationRequired: false,
    replyable: true,
  },
  GB: eu(["Europe/London"], {
    note: "generic IDs blocked; protected brand IDs need MEF registration",
  }),
  // France: 08:00–21:30, never on Sunday.
  FR: eu(["Europe/Paris"], {
    window: { start: H(8), end: H(21, 30), days: [1, 2, 3, 4, 5, 6] },
  }),
  DE: eu(["Europe/Berlin"]),
  NL: eu(["Europe/Amsterdam"], {
    note: "guideline table ambiguous; confirm alpha support",
  }),
  IE: eu(["Europe/Dublin"], {
    ...REG,
    note: "about 2 weeks; unregistered shows 'Likely Scam'",
  }),
  ES: eu(["Europe/Madrid", "Atlantic/Canary"], {
    ...REG,
    note: "up to 4 weeks; no dynamic alpha",
  }),
  AT: eu(["Europe/Vienna"], {
    ...REG,
    note: "up to 4 weeks; proof of entitlement; no dynamic alpha",
  }),
  CZ: eu(["Europe/Prague"], {
    ...REG,
    note: "3 weeks; unregistered blocked on T-Mobile and O2",
  }),
  RO: eu(["Europe/Bucharest"], {
    ...REG,
    note: "4 weeks; Telekom Romania needs it, others overwrite",
  }),
  BG: eu(["Europe/Sofia"], {
    ...REG,
    note: "4 weeks; unregistered overwritten (Vivacom)",
  }),
  FI: eu(["Europe/Helsinki"], {
    ...REG,
    note: "up to 3 weeks; unregistered marked spam from 2026-11-02",
  }),
  // No alphanumeric sender: stays off until a local number is added.
  BE: eu(["Europe/Brussels"], {
    sender: "needs_number",
    note: "dynamic alpha not supported",
  }),
  HU: eu(["Europe/Budapest"], {
    sender: "needs_number",
    note: "operators overwrite alpha with a numeric sender",
  }),
  CH: eu(["Europe/Zurich"]),
  CY: eu(["Asia/Nicosia"]),
  DK: eu(["Europe/Copenhagen"]),
  EE: eu(["Europe/Tallinn"], { note: "guideline table ambiguous; confirm" }),
  GR: eu(["Europe/Athens"], { note: "generic IDs get blocked" }),
  HR: eu(["Europe/Zagreb"], { note: "A1 may overwrite with a generic alpha" }),
  IS: eu(["Atlantic/Reykjavik"], { note: "URLs may be filtered" }),
  IT: eu(["Europe/Rome"]),
  LI: eu(["Europe/Vaduz"]),
  LT: eu(["Europe/Vilnius"]),
  LU: eu(["Europe/Luxembourg"]),
  LV: eu(["Europe/Riga"]),
  MT: eu(["Europe/Malta"]),
  NO: eu(["Europe/Oslo"]),
  PL: eu(["Europe/Warsaw"], { note: "generic IDs filtered by operators" }),
  // Portugal: the Azores run an hour behind Lisbon.
  PT: eu(["Europe/Lisbon", "Atlantic/Azores"]),
  SE: eu(["Europe/Stockholm"], { note: "guideline table ambiguous; confirm" }),
  SI: eu(["Europe/Ljubljana"]),
  SK: eu(["Europe/Bratislava"]),
};

/**
 * #4273 — which Twilio Messaging Service a marketing text to this country
 * goes through: "toll_free" (TWILIO_MESSAGING_SERVICE_SID), "marketing"
 * (TWILIO_MARKETING_MESSAGING_SERVICE_SID, the alpha sender), "termii", or
 * null when no route exists (needs_number, unmapped, or the marketing service
 * is not configured). Null means not textable: "can't text their country yet".
 */
export function smsMarketingRoute(
  countryCode: string | null | undefined,
  marketingServiceConfigured: boolean,
): "toll_free" | "marketing" | "termii" | null {
  const profile = smsCountryProfile(countryCode);
  if (profile === null) return null;
  switch (profile.sender) {
    case "toll_free":
      return "toll_free";
    case "termii":
      return "termii";
    case "alphanumeric":
      return marketingServiceConfigured ? "marketing" : null;
    case "needs_number":
      return null;
  }
}

export function smsCountryProfile(
  countryCode: string | null | undefined,
): SmsCountryProfile | null {
  if (typeof countryCode !== "string") return null;
  return SMS_COUNTRIES[countryCode.toUpperCase()] ?? null;
}

/**
 * #4273 — Canadian area codes → zone(s). A code spanning zones lists each one
 * (807: Thunder Bay Eastern, Kenora Central; 867: the three territories).
 */
export const CA_AREACODE_TZ: Readonly<Record<string, readonly string[]>> =
  (() => {
    const m: Record<string, readonly string[]> = {};
    const add = (zones: readonly string[], codes: string[]) => {
      for (const c of codes) m[c] = zones;
    };
    add(["America/Vancouver"], ["236", "250", "257", "604", "672", "778"]);
    add(["America/Edmonton"], ["368", "403", "587", "780", "825"]);
    add(["America/Regina"], ["306", "474", "639"]);
    add(["America/Winnipeg"], ["204", "431", "584"]);
    add(["America/Toronto"], [
      "226",
      "249",
      "289",
      "343",
      "365",
      "382",
      "416",
      "437",
      "519",
      "548",
      "613",
      "647",
      "683",
      "705",
      "742",
      "753",
      "905",
      "942",
      // Quebec runs on the same (Eastern) clock.
      "263",
      "354",
      "367",
      "418",
      "428",
      "438",
      "450",
      "468",
      "514",
      "579",
      "581",
      "819",
      "873",
    ]);
    add(["America/Toronto", "America/Winnipeg"], ["807"]);
    add(["America/Halifax"], ["506", "782", "902"]);
    add(["America/St_Johns"], ["709", "879"]);
    add([
      "America/Whitehorse",
      "America/Edmonton",
      "America/Winnipeg",
      "America/Toronto",
    ], ["867"]);
    return m;
  })();

// META-ORCH-1161 go-live-prep (P3-1 carry-forward) — US NANP area-code → IANA
// timezone. The prior quiet-hours logic anchored EVERY US number to
// America/New_York, so a +1 West-Coast recipient was evaluated at Eastern time
// and could be texted at 5 AM local (8 AM ET). FCC/TCPA quiet hours are
// RECIPIENT-LOCAL (8 AM–9 PM), so we derive the actual zone from the area code.
// Covers the 50 states + DC + PR/VI; an area code NOT in the map → unknown → the
// caller conservatively DENIES (defer) rather than guess. Codes that straddle a
// DST/standard quirk (AZ no-DST) get their correct IANA zone (Phoenix).
export const US_AREACODE_TZ: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  const add = (tz: string, codes: string[]) => {
    for (const c of codes) m[c] = tz;
  };
  // Eastern.
  add("America/New_York", [
    "201",
    "202",
    "203",
    "207",
    "212",
    "215",
    "216",
    "219",
    "220",
    "223",
    "224",
    "229",
    "234",
    "239",
    "240",
    "267",
    "272",
    "276",
    "283",
    "301",
    "302",
    "304",
    "305",
    "321",
    "330",
    "339",
    "340",
    "347",
    "351",
    "352",
    "380",
    "386",
    "401",
    "404",
    "407",
    "410",
    "412",
    "413",
    "419",
    "434",
    "440",
    "443",
    "445",
    "464",
    "470",
    "475",
    "478",
    "484",
    "508",
    "513",
    "516",
    "517",
    "518",
    "540",
    "551",
    "557",
    "561",
    "564",
    "567",
    "570",
    "571",
    "585",
    "586",
    "588",
    "603",
    "606",
    "607",
    "609",
    "610",
    "614",
    "616",
    "617",
    "631",
    "646",
    "667",
    "678",
    "680",
    "681",
    "689",
    "703",
    "704",
    "706",
    "716",
    "717",
    "718",
    "724",
    "727",
    "732",
    "734",
    "737",
    "740",
    "743",
    "754",
    "757",
    "762",
    "770",
    "772",
    "774",
    "781",
    "786",
    "787",
    "802",
    "803",
    "804",
    "810",
    "813",
    "814",
    "828",
    "835",
    "843",
    "845",
    "848",
    "850",
    "856",
    "857",
    "860",
    "862",
    "863",
    "864",
    "878",
    "901",
    "904",
    "910",
    "912",
    "914",
    "917",
    "919",
    "920",
    "929",
    "937",
    "939",
    "941",
    "947",
    "954",
    "959",
    "978",
    "980",
    "984",
  ]);
  // Central.
  add("America/Chicago", [
    "205",
    "210",
    "214",
    "217",
    "218",
    "224",
    "225",
    "228",
    "254",
    "256",
    "262",
    "270",
    "281",
    "309",
    "312",
    "314",
    "318",
    "319",
    "320",
    "331",
    "334",
    "337",
    "361",
    "380",
    "402",
    "405",
    "409",
    "414",
    "417",
    "430",
    "432",
    "447",
    "456",
    "469",
    "479",
    "501",
    "504",
    "507",
    "512",
    "515",
    "531",
    "539",
    "563",
    "573",
    "580",
    "601",
    "608",
    "612",
    "615",
    "618",
    "620",
    "630",
    "636",
    "641",
    "651",
    "657",
    "660",
    "662",
    "682",
    "708",
    "713",
    "715",
    "731",
    "737",
    "763",
    "769",
    "773",
    "779",
    "785",
    "806",
    "815",
    "816",
    "817",
    "830",
    "832",
    "847",
    "850",
    "870",
    "901",
    "903",
    "913",
    "915",
    "920",
    "930",
    "931",
    "936",
    "940",
    "952",
    "956",
    "972",
    "979",
    "985",
  ]);
  // Mountain (DST-observing).
  add("America/Denver", [
    "303",
    "307",
    "308",
    "385",
    "406",
    "435",
    "505",
    "575",
    "719",
    "720",
    "970",
    "984",
  ]);
  // Arizona (no DST — distinct zone).
  add("America/Phoenix", ["480", "520", "602", "623", "928"]);
  // Pacific.
  add("America/Los_Angeles", [
    "209",
    "213",
    "279",
    "310",
    "323",
    "341",
    "350",
    "408",
    "415",
    "424",
    "442",
    "510",
    "530",
    "559",
    "562",
    "619",
    "626",
    "628",
    "650",
    "657",
    "661",
    "669",
    "707",
    "714",
    "747",
    "760",
    "805",
    "818",
    "820",
    "831",
    "858",
    "909",
    "916",
    "925",
    "949",
    "951",
  ]);
  // Alaska / Hawaii.
  add("America/Anchorage", ["907"]);
  add("Pacific/Honolulu", ["808"]);
  return m;
})();

/**
 * #4273 — the zones a recipient's number can be in, or null when Mingla
 * cannot establish its local time (an unmapped country, or a US/CA number
 * whose area code is not in the table). Null fails the text closed.
 */
export function smsLocalZones(
  phone: string,
  countryCode: string | null,
): readonly string[] | null {
  const profile = smsCountryProfile(countryCode);
  if (profile === null) return null;
  if (profile.zones !== "nanp_area_code") return profile.zones;
  const digits = phone.replace(/[^0-9]/g, "");
  const national = digits.startsWith("1") ? digits.slice(1) : digits;
  const areaCode = national.slice(0, 3);
  if ((countryCode ?? "").toUpperCase() === "CA") {
    return CA_AREACODE_TZ[areaCode] ?? null;
  }
  const us = US_AREACODE_TZ[areaCode];
  return us === undefined ? null : [us];
}

function localClock(
  zone: string,
  at: Date,
): { minutes: number; day: number } | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hour: "numeric",
      minute: "numeric",
      weekday: "short",
      hour12: false,
    }).formatToParts(at);
    const get = (type: string) =>
      parts.find((part) => part.type === type)?.value;
    const hour = Number(get("hour")) % 24;
    const minute = Number(get("minute"));
    const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
      get("weekday") ?? "",
    );
    if (!Number.isFinite(hour) || !Number.isFinite(minute) || day < 0) {
      return null;
    }
    return { minutes: hour * 60 + minute, day };
  } catch {
    return null;
  }
}

/**
 * #4273 — true only when `at` is inside the country's marketing window in
 * EVERY zone the number can be in. Unknown zone or country → false (deny).
 */
export function isWithinSmsWindow(
  phone: string,
  countryCode: string | null,
  at: Date,
): boolean {
  const profile = smsCountryProfile(countryCode);
  const zones = smsLocalZones(phone, countryCode);
  if (profile === null || zones === null || zones.length === 0) return false;
  return zones.every((zone) => {
    const clock = localClock(zone, at);
    if (clock === null) return false;
    const { start, end, days } = profile.window;
    if (days !== undefined && !days.includes(clock.day)) return false;
    return clock.minutes >= start && clock.minutes < end;
  });
}

/**
 * #4273 — milliseconds until the window next opens for this number, found by
 * stepping forward in 15-minute steps (up to 8 days). Null when it never
 * opens in that time (unknown zone, or no allowed day).
 */
export function msUntilSmsWindowOpens(
  phone: string,
  countryCode: string | null,
  at: Date,
): number | null {
  const step = 15 * 60 * 1000;
  for (let delta = 0; delta <= 8 * 24 * 60 * 60 * 1000; delta += step) {
    if (isWithinSmsWindow(phone, countryCode, new Date(at.getTime() + delta))) {
      return delta;
    }
  }
  return null;
}
