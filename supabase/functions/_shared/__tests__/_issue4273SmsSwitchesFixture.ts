// #4273 (country switches) — test fixture: a parsed snapshot of
// public.sms_country_switches, shaped like the migration seed (US and NG on,
// every other country off) unless told otherwise. Tests pass it to
// marketing-send as `options.smsSwitches` so a send pass never reads the DB.
import { MAPPED_COUNTRIES } from "../e164Country.ts";
import { SMS_COUNTRIES } from "../smsCountries.ts";
import {
  parseSmsCountrySwitches,
  type SmsCountrySwitchesSnapshot,
} from "../smsCountrySwitches.ts";

export const TEST_MARKETING_SERVICE_SID = "MG9d42785c51834395018b52144736b9a7";

export function seededSmsSwitches(
  options: {
    on?: readonly string[];
    master?: { US: boolean; NG: boolean };
    sid?: string | null;
  } = {},
): SmsCountrySwitchesSnapshot {
  const on = new Set(options.on ?? ["US", "NG"]);
  const parsed = parseSmsCountrySwitches(
    {
      marketingServiceSid: options.sid === undefined
        ? TEST_MARKETING_SERVICE_SID
        : options.sid,
      countries: MAPPED_COUNTRIES.map((country) => {
        const profile = SMS_COUNTRIES[country];
        return {
          country,
          marketingEnabled: on.has(country),
          sender: profile.sender === "toll_free"
            ? "toll_free"
            : profile.sender === "termii"
            ? "termii"
            : profile.sender === "needs_number"
            ? "needs_local_number"
            : "marketing_service",
          registrationRequired: profile.registrationRequired,
          // A test that switches a registration country on has registered it.
          registrationDone: profile.registrationRequired && on.has(country),
        };
      }),
    },
    options.master ?? { US: true, NG: true },
  );
  if (parsed === null) throw new Error("fixture_invalid");
  return parsed;
}
