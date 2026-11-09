// Issue #4273 (country switches) — the words on Mingla Admin's "SMS countries"
// page. Pure functions, so node --test can check every one.
//
// Each row comes from admin_sms_country_switches_list(): a payout country's
// marketing switch, its sender, its registration state and its price (from
// sms_country_prices). Verification codes, tickets and RSVP texts never read
// these switches.

let regionNames = null;
try {
  regionNames = new Intl.DisplayNames(["en"], { type: "region" });
} catch {
  regionNames = null;
}

/** "United Kingdom" for "GB"; the code itself when the name is unknown. */
export function countryName(cc) {
  const code = String(cc || "").toUpperCase();
  if (!code) return "";
  try {
    const name = regionNames?.of(code);
    return name && name !== code ? name : code;
  } catch {
    return code;
  }
}

/**
 * "$0.0560 per text" / "₦5.00 per text" / "No price yet". The stored value is
 * minorNumerator / minorDenominator MINOR units per segment.
 */
export function formatSmsPrice(price) {
  if (!price || typeof price !== "object") return "No price yet";
  const num = Number(price.minorNumerator);
  const den = Number(price.minorDenominator);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0 || num <= 0) {
    return "No price yet";
  }
  const major = num / den / 100;
  const currency = String(price.currency || "").toUpperCase();
  if (currency === "USD") return `$${major.toFixed(4)} per text`;
  if (currency === "NGN") return `₦${major.toFixed(2)} per text`;
  return `${major.toFixed(4)} ${currency} per text`;
}

const SENDER_WORDS = {
  toll_free: "Toll-free number (+1)",
  marketing_service: "Mingla (letters)",
  termii: "Termii",
  needs_local_number: "Needs a local number",
};

export function senderLabel(sender) {
  return SENDER_WORDS[sender] || "Unknown";
}

/** "Not needed" / "Needed, not done" / "Done 9 Nov 2026". */
export function registrationLabel(row) {
  if (!row?.registrationRequired) return "Not needed";
  if (!row.registrationDoneAt) return "Needed, not done";
  const when = new Date(row.registrationDoneAt);
  if (Number.isNaN(when.getTime())) return "Done";
  return `Done ${when.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
}

const BLOCKED_WORDS = {
  needs_local_number: "Add a local number in Twilio first.",
  registration_pending: 'Register "Mingla" with Twilio first.',
  unpriced: "No price yet.",
};

/** Why a country cannot be turned on yet, or null when nothing blocks it. */
export function blockedWords(reason) {
  return BLOCKED_WORDS[reason] || null;
}

const ERROR_WORDS = [
  [/sms_country_switch_stale|PT409/, "Someone changed this country just now. Reload and try again."],
  [/not_authorized|42501/, "Only the owner and admins can change SMS countries."],
  [/sms_country_needs_local_number/, "Add a local number in Twilio first."],
  [/sms_country_registration_pending/, 'Register "Mingla" with Twilio first, then mark it done here.'],
  [/sms_country_unpriced/, "This country has no SMS price yet, so it can't be turned on."],
  [/reason_required/, "Add a reason first."],
  [/unknown_country/, "That country isn't one Mingla can text. Reload the page."],
  [/state_required/, "Choose on or off."],
  [/no_change/, "Nothing changed: it's already set that way."],
  [/registration_not_required/, "This country doesn't need its sender registered."],
  [/sender_not_changeable/, "This country's sender can't be changed here."],
  [/switch_off_first/, "Turn marketing texts off for this country first."],
];

/** Plain English for every error the SMS country RPCs raise. */
export function smsCountryErrorWords(error) {
  const text = [error?.code, error?.message, typeof error === "string" ? error : ""]
    .filter(Boolean)
    .join(" ");
  for (const [pattern, words] of ERROR_WORDS) {
    if (pattern.test(text)) return words;
  }
  return "Something went wrong saving that. Try again.";
}

/** "Mingla Marketing (MG9d…b7a7)" — the sender, with the SID shortened. */
export function marketingSenderWords(service) {
  if (!service?.sid) return "not set";
  const sid = String(service.sid);
  const short = sid.length > 8 ? `${sid.slice(0, 4)}…${sid.slice(-4)}` : sid;
  return `${service.label || "Mingla Marketing"} (${short})`;
}

/** Can the reason box be sent? (The server checks again.) */
export function reasonOk(reason) {
  return String(reason || "").trim().length > 0;
}

const FIXED_SENDER = new Set(["US", "CA", "NG"]);

/** US, Canada and Nigeria keep their own sender; every other country can switch. */
export function senderChangeable(country) {
  return !FIXED_SENDER.has(String(country || "").toUpperCase());
}

/**
 * What would block turning this country ON, given the drawer's choices
 * (prospective sender and registration), or null. Same precedence as the
 * server: local number, then registration, then price.
 */
export function prospectiveBlock(row, form) {
  const sender = form?.sender ?? row?.sender;
  const registrationDone = form?.registrationDone ?? Boolean(row?.registrationDoneAt);
  if (sender === "needs_local_number") return "needs_local_number";
  if (row?.registrationRequired && !registrationDone) return "registration_pending";
  if (!row?.price) return "unpriced";
  return null;
}

/**
 * The server calls one Save makes, in a safe order: turning OFF goes first (a
 * country that is on can't change its readiness), turning ON goes last (it
 * needs the readiness saved first).
 * Returns { steps: [{ kind: "switch" | "readiness", ... }], blocked }.
 */
export function planSmsCountryChange(row, form) {
  const steps = [];
  const wantOn = Boolean(form?.on);
  const isOn = Boolean(row?.marketingEnabled);
  const currentDone = Boolean(row?.registrationDoneAt);
  const readiness = {};
  if (row?.registrationRequired && typeof form?.registrationDone === "boolean" && form.registrationDone !== currentDone) {
    readiness.registrationDone = form.registrationDone;
  }
  if (senderChangeable(row?.country) && form?.sender && form.sender !== row?.sender) {
    readiness.sender = form.sender;
  }
  const readinessStep = Object.keys(readiness).length > 0 ? { kind: "readiness", ...readiness } : null;
  const blocked = wantOn && !isOn ? prospectiveBlock(row, form) : null;
  if (wantOn !== isOn && !wantOn) steps.push({ kind: "switch", on: false });
  if (readinessStep) steps.push(readinessStep);
  if (wantOn !== isOn && wantOn) steps.push({ kind: "switch", on: true });
  return { steps, blocked };
}
