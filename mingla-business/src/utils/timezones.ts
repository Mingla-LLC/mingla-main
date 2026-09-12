/**
 * IANA timezone helpers for the creator wizards' Timezone field + picker
 * (events, experiences, RSVPs — all through `CreatorStep2When`) and the venue
 * Availability timezone card.
 *
 * TWO HERMES FACTS THIS FILE IS BUILT AROUND (proven on the RN 0.81.5
 * hermes.framework running inside an iOS 26.5 simulator):
 *
 * 1. `Intl.supportedValuesOf` DOES NOT EXIST on Hermes (iOS or Android — the
 *    Intl object only carries the constructors + getCanonicalLocales). The old
 *    code fell back to a curated ~70-zone list, so a native picker offered no
 *    America/Detroit, no Asia/Kathmandu, and most of the world. The fallback is
 *    now EVERY canonical IANA zone (tzdata `zone.tab`), kept only where the
 *    runtime actually accepts the name.
 *
 * 2. Hermes-on-iOS `formatToParts` does not tokenise a formatted string by
 *    field; it splits on punctuation. "GMT-4" comes back as
 *    `{timeZoneName:"GMT"}, {literal:"-"}, {year:"4"}`. Reading the
 *    `timeZoneName` part of a `timeZoneName: "shortOffset"` format therefore
 *    yields a bare "GMT" for EVERY zone — which is how a Brooklyn event read
 *    "America/New_York (GMT)" and Lagos (GMT+1) also read "(GMT)". The offset
 *    is now DERIVED, never read: the zone's wall clock (numeric year / month /
 *    day / hour / minute, which every engine types correctly) minus UTC, at
 *    the instant that matters.
 *
 * THE INSTANT THAT MATTERS. A zone's offset is seasonal: New York is GMT-4 in
 * September and GMT-5 after 1 Nov. A label for an event on 6 Nov must say
 * GMT-5 even when the organiser is typing in September, so every formatter
 * here takes the moment to evaluate at — a `Date`, or the local date/time the
 * organiser typed (resolved in each candidate zone, so the picker rows are
 * right for the event too). Omitted = now, which is correct for things with
 * no date (a venue's standing timezone).
 */

/**
 * Every canonical IANA zone — tzdata 2026c `zone.tab`, one row per zone (418)
 * — grouped by area to keep the bundle small. `UTC` is added on top. Only used
 * when the runtime cannot enumerate zones itself.
 */
const IANA_ZONE_LOCATIONS: Readonly<Record<string, readonly string[]>> = {
  Africa: [
    "Abidjan Accra Addis_Ababa Algiers Asmara Bamako Bangui Banjul",
    "Bissau Blantyre Brazzaville Bujumbura Cairo Casablanca Ceuta",
    "Conakry Dakar Dar_es_Salaam Djibouti Douala El_Aaiun Freetown",
    "Gaborone Harare Johannesburg Juba Kampala Khartoum Kigali Kinshasa",
    "Lagos Libreville Lome Luanda Lubumbashi Lusaka Malabo Maputo",
    "Maseru Mbabane Mogadishu Monrovia Nairobi Ndjamena Niamey",
    "Nouakchott Ouagadougou Porto-Novo Sao_Tome Tripoli Tunis Windhoek",
  ],
  America: [
    "Adak Anchorage Anguilla Antigua Araguaina Argentina/Buenos_Aires",
    "Argentina/Catamarca Argentina/Cordoba Argentina/Jujuy",
    "Argentina/La_Rioja Argentina/Mendoza Argentina/Rio_Gallegos",
    "Argentina/Salta Argentina/San_Juan Argentina/San_Luis",
    "Argentina/Tucuman Argentina/Ushuaia Aruba Asuncion Atikokan Bahia",
    "Bahia_Banderas Barbados Belem Belize Blanc-Sablon Boa_Vista Bogota",
    "Boise Cambridge_Bay Campo_Grande Cancun Caracas Cayenne Cayman",
    "Chicago Chihuahua Ciudad_Juarez Costa_Rica Coyhaique Creston",
    "Cuiaba Curacao Danmarkshavn Dawson Dawson_Creek Denver Detroit",
    "Dominica Edmonton Eirunepe El_Salvador Fort_Nelson Fortaleza",
    "Glace_Bay Goose_Bay Grand_Turk Grenada Guadeloupe Guatemala",
    "Guayaquil Guyana Halifax Havana Hermosillo Indiana/Indianapolis",
    "Indiana/Knox Indiana/Marengo Indiana/Petersburg Indiana/Tell_City",
    "Indiana/Vevay Indiana/Vincennes Indiana/Winamac Inuvik Iqaluit",
    "Jamaica Juneau Kentucky/Louisville Kentucky/Monticello Kralendijk",
    "La_Paz Lima Los_Angeles Lower_Princes Maceio Managua Manaus",
    "Marigot Martinique Matamoros Mazatlan Menominee Merida Metlakatla",
    "Mexico_City Miquelon Moncton Monterrey Montevideo Montserrat",
    "Nassau New_York Nome Noronha North_Dakota/Beulah",
    "North_Dakota/Center North_Dakota/New_Salem Nuuk Ojinaga Panama",
    "Paramaribo Phoenix Port-au-Prince Port_of_Spain Porto_Velho",
    "Puerto_Rico Punta_Arenas Rankin_Inlet Recife Regina Resolute",
    "Rio_Branco Santarem Santiago Santo_Domingo Sao_Paulo Scoresbysund",
    "Sitka St_Barthelemy St_Johns St_Kitts St_Lucia St_Thomas",
    "St_Vincent Swift_Current Tegucigalpa Thule Tijuana Toronto Tortola",
    "Vancouver Whitehorse Winnipeg Yakutat",
  ],
  Antarctica: [
    "Casey Davis DumontDUrville Macquarie Mawson McMurdo Palmer Rothera",
    "Syowa Troll Vostok",
  ],
  Arctic: ["Longyearbyen"],
  Asia: [
    "Aden Almaty Amman Anadyr Aqtau Aqtobe Ashgabat Atyrau Baghdad",
    "Bahrain Baku Bangkok Barnaul Beirut Bishkek Brunei Chita Colombo",
    "Damascus Dhaka Dili Dubai Dushanbe Famagusta Gaza Hebron",
    "Ho_Chi_Minh Hong_Kong Hovd Irkutsk Jakarta Jayapura Jerusalem",
    "Kabul Kamchatka Karachi Kathmandu Khandyga Kolkata Krasnoyarsk",
    "Kuala_Lumpur Kuching Kuwait Macau Magadan Makassar Manila Muscat",
    "Nicosia Novokuznetsk Novosibirsk Omsk Oral Phnom_Penh Pontianak",
    "Pyongyang Qatar Qostanay Qyzylorda Riyadh Sakhalin Samarkand Seoul",
    "Shanghai Singapore Srednekolymsk Taipei Tashkent Tbilisi Tehran",
    "Thimphu Tokyo Tomsk Ulaanbaatar Urumqi Ust-Nera Vientiane",
    "Vladivostok Yakutsk Yangon Yekaterinburg Yerevan",
  ],
  Atlantic: [
    "Azores Bermuda Canary Cape_Verde Faroe Madeira Reykjavik",
    "South_Georgia St_Helena Stanley",
  ],
  Australia: [
    "Adelaide Brisbane Broken_Hill Darwin Eucla Hobart Lindeman",
    "Lord_Howe Melbourne Perth Sydney",
  ],
  Europe: [
    "Amsterdam Andorra Astrakhan Athens Belgrade Berlin Bratislava",
    "Brussels Bucharest Budapest Busingen Chisinau Copenhagen Dublin",
    "Gibraltar Guernsey Helsinki Isle_of_Man Istanbul Jersey",
    "Kaliningrad Kirov Kyiv Lisbon Ljubljana London Luxembourg Madrid",
    "Malta Mariehamn Minsk Monaco Moscow Oslo Paris Podgorica Prague",
    "Riga Rome Samara San_Marino Sarajevo Saratov Simferopol Skopje",
    "Sofia Stockholm Tallinn Tirane Ulyanovsk Vaduz Vatican Vienna",
    "Vilnius Volgograd Warsaw Zagreb Zurich",
  ],
  Indian: [
    "Antananarivo Chagos Christmas Cocos Comoro Kerguelen Mahe Maldives",
    "Mauritius Mayotte Reunion",
  ],
  Pacific: [
    "Apia Auckland Bougainville Chatham Chuuk Easter Efate Fakaofo Fiji",
    "Funafuti Galapagos Gambier Guadalcanal Guam Honolulu Kanton",
    "Kiritimati Kosrae Kwajalein Majuro Marquesas Midway Nauru Niue",
    "Norfolk Noumea Pago_Pago Palau Pitcairn Pohnpei Port_Moresby",
    "Rarotonga Saipan Tahiti Tarawa Tongatapu Wake Wallis",
  ],
};

/**
 * Zones IANA renamed where an older runtime may only know the previous name.
 * If the runtime refuses the current name but accepts the old one, the picker
 * offers the old one rather than dropping the place.
 */
const PREVIOUS_ZONE_NAMES: Readonly<Record<string, string>> = {
  "Africa/Asmara": "Africa/Asmera",
  "America/Argentina/Buenos_Aires": "America/Buenos_Aires",
  "America/Argentina/Catamarca": "America/Catamarca",
  "America/Argentina/Cordoba": "America/Cordoba",
  "America/Argentina/Jujuy": "America/Jujuy",
  "America/Argentina/Mendoza": "America/Mendoza",
  "America/Atikokan": "America/Coral_Harbour",
  "America/Indiana/Indianapolis": "America/Indianapolis",
  "America/Kentucky/Louisville": "America/Louisville",
  "America/Nuuk": "America/Godthab",
  "Asia/Ho_Chi_Minh": "Asia/Saigon",
  "Asia/Kathmandu": "Asia/Katmandu",
  "Asia/Kolkata": "Asia/Calcutta",
  "Asia/Yangon": "Asia/Rangoon",
  "Atlantic/Faroe": "Atlantic/Faeroe",
  "Europe/Kyiv": "Europe/Kiev",
  "Pacific/Chuuk": "Pacific/Truk",
  "Pacific/Kanton": "Pacific/Enderbury",
  "Pacific/Pohnpei": "Pacific/Ponape",
};

/** The full IANA list, before any runtime check. Exported for tests. */
export const listIanaTimezones = (): string[] => {
  const zones: string[] = ["UTC"];
  for (const area of Object.keys(IANA_ZONE_LOCATIONS)) {
    for (const line of IANA_ZONE_LOCATIONS[area]) {
      for (const location of line.split(" ")) {
        zones.push(`${area}/${location}`);
      }
    }
  }
  return zones;
};

// One wall-clock formatter per zone, reused for every instant. `null` records
// a zone the runtime refused, so it is not re-tried on every row render.
const wallClockFormatters = new Map<string, Intl.DateTimeFormat | null>();

const getWallClockFormatter = (tz: string): Intl.DateTimeFormat | null => {
  const cached = wallClockFormatters.get(tz);
  if (cached !== undefined) return cached;
  let formatter: Intl.DateTimeFormat | null = null;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    formatter = null; // RangeError: the runtime does not know this zone
  }
  wallClockFormatters.set(tz, formatter);
  return formatter;
};

const isRuntimeZone = (tz: string): boolean => getWallClockFormatter(tz) !== null;

let cachedTimezones: string[] | null = null;

export const getAllTimezones = (): string[] => {
  if (cachedTimezones !== null) return cachedTimezones;
  try {
    type IntlExt = typeof Intl & { supportedValuesOf?: (k: string) => string[] };
    const intlExt = Intl as IntlExt;
    if (typeof intlExt.supportedValuesOf === "function") {
      const tzs = intlExt.supportedValuesOf("timeZone");
      if (Array.isArray(tzs) && tzs.length > 0) {
        cachedTimezones = tzs.slice().sort();
        return cachedTimezones;
      }
    }
  } catch {
    /* fall through */
  }
  // Hermes (every native build) lands here.
  const offered = new Set<string>();
  for (const zone of listIanaTimezones()) {
    if (isRuntimeZone(zone)) {
      offered.add(zone);
      continue;
    }
    const previous = PREVIOUS_ZONE_NAMES[zone];
    if (previous !== undefined && isRuntimeZone(previous)) offered.add(previous);
  }
  cachedTimezones = Array.from(offered).sort();
  return cachedTimezones;
};

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const isPlausibleWallClock = (w: WallClock): boolean =>
  Number.isInteger(w.year) &&
  w.year >= 1000 &&
  Number.isInteger(w.month) &&
  w.month >= 1 &&
  w.month <= 12 &&
  Number.isInteger(w.day) &&
  w.day >= 1 &&
  w.day <= 31 &&
  Number.isInteger(w.hour) &&
  w.hour >= 0 &&
  w.hour <= 24 &&
  Number.isInteger(w.minute) &&
  w.minute >= 0 &&
  w.minute <= 59;

const readWallClock = (
  formatter: Intl.DateTimeFormat,
  instant: Date,
): WallClock | null => {
  // Typed parts first: numeric fields are typed correctly on V8, JSC, Hermes
  // Android (ICU field iterator) and Hermes iOS for this all-numeric pattern.
  try {
    const parts = formatter.formatToParts(instant);
    const field = (type: string): number => {
      const part = parts.find((p) => p.type === type);
      return part !== undefined && /^\d+$/.test(part.value)
        ? Number(part.value)
        : Number.NaN;
    };
    const wall: WallClock = {
      year: field("year"),
      month: field("month"),
      day: field("day"),
      hour: field("hour"),
      minute: field("minute"),
    };
    if (isPlausibleWallClock(wall)) return wall;
  } catch {
    /* fall through to the plain string */
  }
  // A runtime without usable parts: en-US numeric is always M/D/Y H:M.
  try {
    const digits = formatter.format(instant).match(/\d+/g);
    if (digits !== null && digits.length === 5) {
      const [month, day, year, hour, minute] = digits.map(Number);
      const wall: WallClock = { year, month, day, hour, minute };
      if (isPlausibleWallClock(wall)) return wall;
    }
  } catch {
    /* unreadable */
  }
  return null;
};

/**
 * Minutes `tz` is ahead of UTC at `when` (New York in winter → -300, Lagos →
 * 60, Kolkata → 330). Null when the runtime cannot resolve the zone.
 */
export const getTimezoneOffsetMinutes = (
  tz: string,
  when: Date = new Date(),
): number | null => {
  const ms = when.getTime();
  if (!Number.isFinite(ms)) return null;
  const formatter = getWallClockFormatter(tz);
  if (formatter === null) return null;
  // The wall clock is read to the minute, so compare against the same minute.
  const instant = Math.floor(ms / 60000) * 60000;
  const wall = readWallClock(formatter, new Date(instant));
  if (wall === null) return null;
  const wallAsUtc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour % 24,
    wall.minute,
  );
  const minutes = Math.round((wallAsUtc - instant) / 60000);
  // Real offsets live within ±14h; ECMAScript caps them at ±18h.
  return Math.abs(minutes) <= 18 * 60 ? minutes + 0 : null;
};

/**
 * A local date (and optionally time) as the organiser typed it — resolved in
 * whichever zone is being labelled.
 */
export interface LocalDateTime {
  /** ISO YYYY-MM-DD. */
  localDate: string;
  /** HH:MM 24-hour. Missing → midday, clear of every DST switch. */
  localTime?: string | null;
}

export type TimezoneOffsetAt = Date | LocalDateTime;

/** The When-step fields that decide which moment a Timezone label describes. */
export interface WhenStepSchedule {
  whenMode: string;
  date: string | null;
  doorsOpen: string | null;
  multiDates: ReadonlyArray<{ date: string; startTime: string }> | null;
}

/**
 * The moment the When step's Timezone field describes: the first start as the
 * organiser typed it (single + recurring: the date and doors time; multi-date:
 * the earliest date). Null = nothing picked yet — label at now.
 * `lockSingleDate` mirrors the RSVP wizard, which only renders the single body.
 */
export const whenStepTimezoneReference = (
  schedule: WhenStepSchedule,
  lockSingleDate = false,
): LocalDateTime | null => {
  if (!lockSingleDate && schedule.whenMode === "multi_date") {
    let earliest: { date: string; startTime: string } | null = null;
    for (const entry of schedule.multiDates ?? []) {
      if (
        earliest === null ||
        `${entry.date}T${entry.startTime}` <
          `${earliest.date}T${earliest.startTime}`
      ) {
        earliest = entry;
      }
    }
    return earliest === null
      ? null
      : { localDate: earliest.date, localTime: earliest.startTime };
  }
  return schedule.date === null
    ? null
    : { localDate: schedule.date, localTime: schedule.doorsOpen };
};

const LOCAL_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_TIME_RE = /^(\d{2}):(\d{2})$/;

const resolveInstant = (tz: string, at: TimezoneOffsetAt): Date | null => {
  if (at instanceof Date) return at;
  const d = LOCAL_DATE_RE.exec(at.localDate);
  if (d === null) return null;
  const t = LOCAL_TIME_RE.exec(at.localTime ?? "");
  const wallAsUtc = Date.UTC(
    Number(d[1]),
    Number(d[2]) - 1,
    Number(d[3]),
    t === null ? 12 : Number(t[1]),
    t === null ? 0 : Number(t[2]),
  );
  if (!Number.isFinite(wallAsUtc)) return null;
  // Two passes: the first guess uses the offset at the naive instant; the
  // second re-reads it at the corrected instant, which settles wall times that
  // sit within hours of a DST switch.
  const first = getTimezoneOffsetMinutes(tz, new Date(wallAsUtc));
  if (first === null) return null;
  const guess = wallAsUtc - first * 60000;
  const second = getTimezoneOffsetMinutes(tz, new Date(guess));
  if (second === null || second === first) return new Date(guess);
  return new Date(wallAsUtc - second * 60000);
};

/** "GMT-5", "GMT+1", "GMT+5:30", "GMT+0". */
export const formatGmtOffset = (offsetMinutes: number): string => {
  const sign = offsetMinutes < 0 ? "-" : "+";
  const abs = Math.abs(offsetMinutes);
  const hours = Math.floor(abs / 60);
  const minutes = abs % 60;
  return minutes === 0
    ? `GMT${sign}${hours}`
    : `GMT${sign}${hours}:${String(minutes).padStart(2, "0")}`;
};

/**
 * Short offset label for `tz` at `at` (default: now), e.g. "GMT-5". Empty
 * string if the runtime can't compute it.
 */
export const formatTimezoneOffset = (
  tz: string,
  at: TimezoneOffsetAt = new Date(),
): string => {
  const instant = resolveInstant(tz, at);
  if (instant === null) return "";
  const minutes = getTimezoneOffsetMinutes(tz, instant);
  return minutes === null ? "" : formatGmtOffset(minutes);
};

/**
 * "America/New_York (GMT-5)" — IANA name + the offset in force at `at`
 * (default: now). Pass the event's start so the label matches the event.
 */
export const formatTimezoneLabel = (
  tz: string,
  at: TimezoneOffsetAt = new Date(),
): string => {
  const offset = formatTimezoneOffset(tz, at);
  return offset.length > 0 ? `${tz} (${offset})` : tz;
};
