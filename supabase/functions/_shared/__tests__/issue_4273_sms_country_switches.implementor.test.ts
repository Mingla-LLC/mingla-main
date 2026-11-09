// #4273 (country switches) — marketing SMS switches and the marketing sender
// come from the database, through ONE route rule.
//
// T-P1 the migration seed mirrors smsCountries.ts (sender class and
//      registration) for exactly the 35 mapped countries; US and NG on.
// T-R  smsMarketingRouteFromSwitches matrix: unreadable, missing row, off,
//      registration pending, US/NG master off, sender disagreeing with the
//      country's class, alpha with no SID; the three happy routes.
// T-L1 loadSmsCountrySwitches: RPC error or throw → null; malformed rows are
//      dropped; a bad SID or the transactional SID → marketingServiceSid null.
// T-G1 no production file under supabase/functions reads the old env SID, and
//      the adapter never imports the switches module (it never reads the DB).
//
// MINGLA-INVARIANT: I-4273-MARKETING-ROUTE-ONE-RULE | issue #4273 | smsMarketingRouteFromSwitches is the only marketing SMS route rule; an unreadable snapshot means nothing is textable; US and NG also require their bundle master switch.
// MINGLA-INVARIANT: I-4273-ONE-SMS-SWITCH-PER-COUNTRY | issue #4273 | Each mapped country has its own marketing_enabled row in public.sms_country_switches, off by default; a switched-off country is skipped as "can't text their country yet", never sent.
// MINGLA-INVARIANT: I-4273-ALPHA-COUNTRIES-NEVER-USE-TOLL-FREE | issue #4273 | A marketing text to an alphanumeric-sender country goes only through the database marketing Messaging Service SID (public.sms_marketing_sender_config); without it the country is not textable; US and CA stay on the toll-free service; the adapter refuses any other pairing (marketing_sender_mismatch).
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { MAPPED_COUNTRIES } from "../e164Country.ts";
import { SMS_COUNTRIES } from "../smsCountries.ts";
import {
  loadSmsCountrySwitches,
  marketingServiceSidFor,
  parseSmsCountrySwitches,
  type SmsCountrySwitchesSnapshot,
  smsCountryTextableFrom,
  smsMarketingRouteFromSwitches,
} from "../smsCountrySwitches.ts";
import { smsCountryTextableNow } from "../smsPriceBook.ts";

const MARKETING_SID = "MG9d42785c51834395018b52144736b9a7";
const TRANSACTIONAL_SID = "MG1942fbb549187fcf77c0e860405abf58";
const ROOT = new URL("../../../../", import.meta.url);
const MIGRATION = new URL(
  "supabase/migrations/20280526004273_issue_4273_sms_country_switches.sql",
  ROOT,
);

type Row = {
  country: string;
  marketingEnabled: boolean;
  sender: string;
  registrationRequired: boolean;
  registrationDone: boolean;
};

function row(country: string, over: Partial<Row> = {}): Row {
  const profile = SMS_COUNTRIES[country];
  return {
    country,
    marketingEnabled: true,
    sender: profile.sender === "toll_free"
      ? "toll_free"
      : profile.sender === "termii"
      ? "termii"
      : profile.sender === "needs_number"
      ? "needs_local_number"
      : "marketing_service",
    registrationRequired: profile.registrationRequired,
    registrationDone: profile.registrationRequired,
    ...over,
  };
}

function snap(
  rows: Row[],
  sid: unknown = MARKETING_SID,
  master = { US: true, NG: true },
): SmsCountrySwitchesSnapshot {
  const parsed = parseSmsCountrySwitches(
    { marketingServiceSid: sid, countries: rows },
    master,
  );
  assert(parsed !== null);
  return parsed;
}

Deno.test("#4273 T-P1 the migration seed mirrors smsCountries.ts for the 35 mapped countries", async () => {
  const sql = await Deno.readTextFile(MIGRATION);
  const seed = sql.slice(
    sql.indexOf("INSERT INTO public.sms_country_switches"),
    sql.indexOf("ON CONFLICT (country) DO NOTHING"),
  );
  const rows = [
    ...seed.matchAll(
      /\('([A-Z]{2})',\s*(true|false),\s*'([a-z_]+)',\s*(true|false),/g,
    ),
  ].map((m) => ({
    country: m[1],
    on: m[2] === "true",
    sender: m[3],
    registrationRequired: m[4] === "true",
  }));
  assertEquals(rows.map((r) => r.country).sort(), [...MAPPED_COUNTRIES]);
  assertEquals(Object.keys(SMS_COUNTRIES).sort(), [...MAPPED_COUNTRIES]);
  for (const r of rows) {
    const profile = SMS_COUNTRIES[r.country];
    const expected = profile.sender === "alphanumeric"
      ? "marketing_service"
      : profile.sender === "needs_number"
      ? "needs_local_number"
      : profile.sender;
    assertEquals(r.sender, expected, `${r.country} sender`);
    assertEquals(
      r.registrationRequired,
      profile.registrationRequired,
      `${r.country} registration`,
    );
  }
  assertEquals(
    rows.filter((r) => r.on).map((r) => r.country).sort(),
    ["NG", "US"],
    "only today's live countries start on",
  );
  // The seed note column mirrors the operator notes too.
  for (const country of MAPPED_COUNTRIES) {
    const note = SMS_COUNTRIES[country].note;
    if (note !== undefined) {
      assert(
        seed.includes(`'${note.replaceAll("'", "''")}'`),
        `${country} note`,
      );
    }
  }
});

Deno.test("#4273 T-R the one marketing route rule", () => {
  const everyone = MAPPED_COUNTRIES.map((c) => row(c));
  const all = snap(everyone);
  // R1 unreadable snapshot: nothing.
  assertEquals(smsMarketingRouteFromSwitches("US", null), null);
  assertEquals(smsCountryTextableNow("NG", null), false);
  // R2 missing row.
  assertEquals(
    smsMarketingRouteFromSwitches(
      "GB",
      snap(everyone.filter((r) => r.country !== "GB")),
    ),
    null,
  );
  // R3 switched off.
  assertEquals(
    smsMarketingRouteFromSwitches(
      "GB",
      snap([row("GB", { marketingEnabled: false })]),
    ),
    null,
  );
  // R4 registration pending.
  assertEquals(
    smsMarketingRouteFromSwitches(
      "IE",
      snap([row("IE", { registrationDone: false })]),
    ),
    null,
  );
  assertEquals(
    smsMarketingRouteFromSwitches(
      "IE",
      snap([row("IE", { registrationDone: true })]),
    ),
    "marketing",
  );
  // R5 / R6 US and NG master kill (SC-9).
  assertEquals(
    smsMarketingRouteFromSwitches(
      "US",
      snap(everyone, MARKETING_SID, { US: false, NG: true }),
    ),
    null,
  );
  assertEquals(
    smsMarketingRouteFromSwitches(
      "NG",
      snap(everyone, MARKETING_SID, { US: true, NG: false }),
    ),
    null,
  );
  assertEquals(
    smsMarketingRouteFromSwitches(
      "CA",
      snap(everyone, MARKETING_SID, { US: false, NG: false }),
    ),
    "toll_free",
    "the US master does not govern Canada",
  );
  // R7 the DB sender disagrees with the country's class.
  assertEquals(
    smsMarketingRouteFromSwitches(
      "US",
      snap([row("US", { sender: "marketing_service" })]),
    ),
    null,
  );
  assertEquals(
    smsMarketingRouteFromSwitches("NG", snap([row("NG", { sender: "toll_free" })])),
    null,
  );
  assertEquals(
    smsMarketingRouteFromSwitches("GB", snap([row("GB", { sender: "toll_free" })])),
    null,
  );
  assertEquals(
    smsMarketingRouteFromSwitches("BE", all),
    null,
    "needs a local number",
  );
  assertEquals(
    smsMarketingRouteFromSwitches(
      "BE",
      snap([row("BE", { sender: "marketing_service" })]),
    ),
    "marketing",
    "a local number added: the marketing service carries it",
  );
  // R8 alpha country with no marketing SID.
  assertEquals(smsMarketingRouteFromSwitches("GB", snap(everyone, null)), null);
  // Happy routes.
  assertEquals(smsMarketingRouteFromSwitches("GB", all), "marketing");
  assertEquals(smsMarketingRouteFromSwitches("gb", all), "marketing");
  assertEquals(smsMarketingRouteFromSwitches("US", all), "toll_free");
  assertEquals(smsMarketingRouteFromSwitches("NG", all), "termii");
  assertEquals(smsMarketingRouteFromSwitches("JM", all), null, "unmapped");
  assertEquals(smsMarketingRouteFromSwitches(null, all), null);
  assertEquals(marketingServiceSidFor("GB", all), MARKETING_SID);
  assertEquals(marketingServiceSidFor("US", all), null);
  assertEquals(marketingServiceSidFor("NG", all), null);
  assertEquals(smsCountryTextableFrom(all)("GB"), true);
  assertEquals(smsCountryTextableFrom(null)("GB"), false);
});

Deno.test("#4273 T-L1 the loader fails closed and parses strictly", async () => {
  const quiet = console.error;
  const logged: string[] = [];
  console.error = (line: string) => logged.push(String(line));
  try {
    const master = () => ({ US: true, NG: true });
    assertEquals(
      await loadSmsCountrySwitches(
        { rpc: () => Promise.resolve({ data: null, error: { message: "x" } }) },
        master,
      ),
      null,
    );
    assertEquals(
      await loadSmsCountrySwitches(
        { rpc: () => Promise.reject(new Error("timeout")) },
        master,
      ),
      null,
    );
    assertEquals(
      await loadSmsCountrySwitches(
        { rpc: () => Promise.resolve({ data: { countries: "no" }, error: null }) },
        master,
      ),
      null,
    );
    assert(
      logged.every((line) =>
        JSON.parse(line).event === "sms_country_switches_unreadable"
      ) && logged.length === 3,
    );
    let called = "";
    const loaded = await loadSmsCountrySwitches(
      {
        rpc: (name: string) => {
          called = name;
          return Promise.resolve({
            data: {
              marketingServiceSid: MARKETING_SID,
              countries: [
                row("GB"),
                { ...row("FR"), marketingEnabled: "yes" },
                { ...row("DE"), sender: "pigeon" },
                row("US", { country: "ZZ" }),
                row("US"),
                row("US", { marketingEnabled: false }),
                null,
              ],
            },
            error: null,
          });
        },
      },
      () => ({ US: false, NG: true }),
    );
    assertEquals(called, "sms_marketing_switches_v1");
    assert(loaded !== null);
    assertEquals([...loaded.countries.keys()], ["GB", "US"]);
    assertEquals(loaded.countries.get("US")?.marketingEnabled, true, "first row wins");
    assertEquals(loaded.masterOn, { US: false, NG: true });
    assertEquals(loaded.marketingServiceSid, MARKETING_SID);
    for (const bad of [TRANSACTIONAL_SID, "MGshort", "", null, 42, "MG" + "G".repeat(32)]) {
      assertEquals(
        parseSmsCountrySwitches(
          { marketingServiceSid: bad, countries: [] },
          { US: true, NG: true },
        )?.marketingServiceSid,
        null,
        `bad SID ${String(bad)}`,
      );
    }
    assertEquals(parseSmsCountrySwitches(null, { US: true, NG: true }), null);
    assertEquals(parseSmsCountrySwitches([], { US: true, NG: true }), null);
  } finally {
    console.error = quiet;
  }
});

Deno.test("#4273 T-G1 no production code reads the old env SID; the adapter never reads the DB switches", async () => {
  const functionsRoot = new URL("supabase/functions/", ROOT);
  const offenders: string[] = [];
  const walk = async (dir: URL, rel: string) => {
    for await (const entry of Deno.readDir(dir)) {
      const childRel = `${rel}${entry.name}`;
      if (entry.isDirectory) {
        if (entry.name === "__tests__" || entry.name === "node_modules") continue;
        await walk(new URL(`${entry.name}/`, dir), `${childRel}/`);
      } else if (
        entry.isFile && /\.(ts|tsx|js|mjs)$/.test(entry.name) &&
        !/\.test\.|_test\./.test(entry.name)
      ) {
        const text = await Deno.readTextFile(new URL(entry.name, dir));
        if (text.includes("TWILIO_MARKETING_MESSAGING_SERVICE_SID")) {
          offenders.push(childRel);
        }
      }
    }
  };
  await walk(functionsRoot, "");
  assertEquals(offenders, []);
  const adapter = await Deno.readTextFile(
    new URL("_shared/adapters/smsAdapter.ts", functionsRoot),
  );
  assert(!adapter.includes("smsCountrySwitches"), "adapter must not import the switches module");
  assert(!adapter.includes("resolveSmsCountryLive"), "adapter must not read the bundle per-country switch");
});
