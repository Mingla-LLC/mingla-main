#!/usr/bin/env node
/**
 * issue #2286 [Paid iOS ads can only be attributed to Meta] — strict-grep gate.
 *
 * WHAT THIS GATE IS, AND WHAT IT IS NOT.
 *
 * It asserts that `ios.infoPlist.SKAdNetworkItems` in BOTH app.json files
 * declares the SAME, COMPLETE roster of ad-network identifiers, each one
 * sourced from that network's OWN published list (URLs recorded per network
 * below). Before #2286 both apps declared exactly ONE id — Meta's
 * `v9wttpbfk9.skadnetwork` — and nothing anywhere in CI noticed, or would have
 * noticed if it had been deleted.
 *
 * It is NOT a claim that a missing id breaks attribution for the advertised
 * app. #2286's investigation established the opposite, from Apple's own
 * documentation:
 *
 *   - "Configuring a source app": "Only ads from ad networks that have an entry
 *     in the app's Info.plist file are eligible for install validation."
 *   - "Configuring an advertised app": "The advertised app doesn't require any
 *     configuration to participate in install validation."
 *
 * `SKAdNetworkItems` is a SOURCE/PUBLISHER-app key. Mingla ships no ad-serving
 * SDK in either app, so today the array is inert. It is declared anyway because
 * that is what each network's own integration page asks an iOS project to
 * carry, because the day either app monetises with ads the array is already
 * right, and because a one-entry array that says "Meta" and nothing else is the
 * exact ambiguity that produced this issue. The array must therefore be
 * complete and identical across the two apps, or it is worse than useless — it
 * is misleading.
 *
 * ASSERTIONS
 *   A1 both apps expose a non-empty `expo.ios.infoPlist.SKAdNetworkItems` array
 *   A2 every element is `{ SKAdNetworkIdentifier: "<string>" }` and nothing else
 *   A3 every id matches /^[a-z0-9]+\.skadnetwork$/ — Apple: "Lowercase the ad
 *      network ID string; otherwise, the system doesn't recognize it as valid."
 *   A4 no duplicate ids within an app
 *   A5 every id of every REQUIRED_NETWORKS entry is present in BOTH apps
 *      (named per network, so a whole network cannot be dropped quietly)
 *   A6 the two apps' id SETS are IDENTICAL (no drift between consumer and
 *      business — they are separate Expo projects that cannot share a constant)
 *   A7 vacuity guard: an empty roster, or an empty parsed array, FAILS. A gate
 *      that checks nothing must never be green (see #2113's 60 no-info checks).
 *   A8 the roster is an EXACT allowlist: an id declared in either app with no
 *      REQUIRED_NETWORKS entry FAILS. Growth must carry a first-party source
 *      URL, so an aggregator's list cannot be pasted in unattributed. A8 also
 *      catches the mode A6 cannot: both apps growing the SAME wrong way.
 *
 * Exit 0 clean, 1 on violation. Supports --self-test.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..", "..");

/**
 * The roster. Each entry's ids come from that NETWORK'S OWN published page —
 * never a third-party aggregator, never a blog. `source` is the page the id was
 * read from, so a future reader can re-verify rather than trust this file.
 *
 * Shrinking this map, or removing an id from it, is a visible diff in a file
 * `tests-append-only.yml` ratchets. That is the "cannot silently shrink" half of
 * #2286's done-definition.
 */
export const REQUIRED_NETWORKS = {
  meta: {
    label: "Meta (Facebook / Instagram)",
    source: "https://developers.facebook.com/docs/setting-up/platform-setup/ios/SKAdNetwork",
    ids: ["v9wttpbfk9.skadnetwork", "n38lu8286q.skadnetwork"],
  },
  google: {
    label: "Google Ads / Google Mobile Ads",
    // Google's page lists 50 ids: its own, plus 49 third-party BUYERS who may
    // bid into an AdMob/Ad Manager publisher's inventory. Mingla is not a
    // publisher, so only Google's own identifier belongs here. Declaring the
    // other 49 would name 49 companies Mingla has no relationship with.
    source: "https://developers.google.com/admob/ios/3p-skadnetworks",
    ids: ["cstr6suwn9.skadnetwork"],
  },
};

/**
 * The networks #2286 named that CANNOT be added, with the reason, measured
 * 2026-08-18. This block is documentation with teeth: A8 makes the roster an
 * exact allowlist, so anyone who later pastes an MMP's or an aggregator's
 * 60-identifier list gets a RED gate and lands here to find out why.
 *
 * Do not "complete" the roster from a third-party list. If one of these
 * networks starts publishing an id first-party, move it into REQUIRED_NETWORKS
 * with its source URL — that is the only legitimate way this list grows.
 */
export const PUBLISHES_NO_IDENTIFIER = {
  tiktok:
    "TikTok for Business publishes NO .skadnetwork identifier on any advertiser " +
    "or developer page. Its own iOS integration guide covers Info.plist twice " +
    "(NSUserTrackingUsageDescription, SKIncludeConsumableInAppPurchaseHistory) and " +
    "never mentions SKAdNetworkItems. TikTok states placements 'share the same " +
    "Network ID under SKAN' without ever printing it. The only ByteDance ids in " +
    "public are Pangle's, on Pangle's PUBLISHER monetisation page — irrelevant to " +
    "an app that shows no Pangle ads. " +
    "https://business-api.tiktok.com/portal/docs?id=1739585432134657",
  snap:
    "Snap publishes NO .skadnetwork identifier. Its advertiser SKAN setup is a " +
    "Snap App ID + the Ads Manager opt-in toggle + MMP SDK — no plist step exists. " +
    "Snap Audience Network (the publisher SDK that would have carried an id) is " +
    "sunset. https://businesshelp.snapchat.com/s/article/skad-network-campaign",
  appleAds:
    "Apple Ads (Search Ads) has NO .skadnetwork identifier and structurally cannot: " +
    "it identifies in postbacks as 'com.apple.ads', and its ads run inside the App " +
    "Store, which is Apple's own source app. ASA attribution runs on the AdServices " +
    "framework (AAAttribution.attributionToken()) forwarded by the MMP, plus " +
    "SKAdNetwork 1-3 participation registered 2025-04-10. Nothing goes in Info.plist. " +
    "https://ads.apple.com/app-store/help/reporting/0028-apple-ads-attribution-api",
};

const APPS = {
  consumer: "app-mobile/app.json",
  business: "mingla-business/app.json",
};

const ID_SHAPE = /^[a-z0-9]+\.skadnetwork$/;

/**
 * Pure checker. Both apps' raw `SKAdNetworkItems` values are injected so
 * --self-test can drive every failure mode without touching the real files.
 *
 * @param {unknown} consumerItems raw app-mobile SKAdNetworkItems
 * @param {unknown} businessItems raw mingla-business SKAdNetworkItems
 * @param {Record<string, {label: string, ids: string[]}>} [required]
 * @returns {string[]} violations
 */
export function evaluate(consumerItems, businessItems, required = REQUIRED_NETWORKS) {
  const violations = [];

  // A7 (roster half) — a gate whose expectations are empty asserts nothing.
  const rosterIds = Object.values(required).flatMap((n) => n.ids ?? []);
  if (Object.keys(required).length === 0 || rosterIds.length === 0) {
    violations.push(
      "A7 vacuity: REQUIRED_NETWORKS is empty (or every network has zero ids). " +
        "This gate would pass against any Info.plist. Refusing to be green.",
    );
    return violations;
  }

  /** @type {Record<string, string[]>} */
  const parsed = {};

  for (const [app, items] of [
    ["consumer", consumerItems],
    ["business", businessItems],
  ]) {
    const path = APPS[app];

    // A1
    if (!Array.isArray(items)) {
      violations.push(`A1 ${app} (${path}): ios.infoPlist.SKAdNetworkItems is missing or not an array.`);
      parsed[app] = [];
      continue;
    }
    if (items.length === 0) {
      violations.push(`A1 ${app} (${path}): SKAdNetworkItems is an EMPTY array.`);
      parsed[app] = [];
      continue;
    }

    const ids = [];
    for (const [i, entry] of items.entries()) {
      // A2
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        violations.push(`A2 ${app} (${path}): SKAdNetworkItems[${i}] is not a dictionary.`);
        continue;
      }
      const keys = Object.keys(entry);
      if (keys.length !== 1 || keys[0] !== "SKAdNetworkIdentifier") {
        violations.push(
          `A2 ${app} (${path}): SKAdNetworkItems[${i}] must have exactly one key ` +
            `"SKAdNetworkIdentifier"; found [${keys.join(", ")}].`,
        );
        continue;
      }
      const id = entry.SKAdNetworkIdentifier;
      if (typeof id !== "string") {
        violations.push(`A2 ${app} (${path}): SKAdNetworkItems[${i}].SKAdNetworkIdentifier is not a string.`);
        continue;
      }
      // A3 — Apple requires lowercase; a capitalised id is silently ignored by iOS.
      if (!ID_SHAPE.test(id)) {
        violations.push(
          `A3 ${app} (${path}): "${id}" is not a valid identifier. Apple requires ` +
            `lowercase [a-z0-9] followed by ".skadnetwork".`,
        );
        continue;
      }
      ids.push(id);
    }

    // A4
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    for (const d of [...new Set(dupes)]) {
      violations.push(`A4 ${app} (${path}): "${d}" is declared more than once.`);
    }

    parsed[app] = ids;
  }

  // A7 (parse half) — both apps yielding nothing usable is a vacuous pass risk.
  if (parsed.consumer.length === 0 && parsed.business.length === 0) {
    violations.push(
      "A7 vacuity: NEITHER app yielded a single usable identifier. " +
        "Every downstream assertion would be trivially true.",
    );
    return violations;
  }

  // A5 — per-network, so dropping a whole network names that network.
  for (const [key, net] of Object.entries(required)) {
    for (const id of net.ids ?? []) {
      for (const app of ["consumer", "business"]) {
        if (!parsed[app].includes(id)) {
          violations.push(
            `A5 ${app} (${APPS[app]}): missing ${net.label} identifier "${id}" ` +
              `(network key "${key}"). Sourced from ${net.source}.`,
          );
        }
      }
    }
  }

  // A8 — the roster is an EXACT allowlist, not a floor. An id with no
  // first-party source recorded in REQUIRED_NETWORKS must not ship: that is how
  // an aggregator's list gets pasted in and nobody can say where it came from.
  const allowed = new Set(rosterIds);
  for (const app of ["consumer", "business"]) {
    for (const id of new Set(parsed[app])) {
      if (!allowed.has(id)) {
        violations.push(
          `A8 ${app} (${APPS[app]}): "${id}" is declared but has no entry in ` +
            `REQUIRED_NETWORKS. Every identifier must carry a first-party source URL. ` +
            `If a network started publishing one, add it there — do not paste an ` +
            `aggregator's list (see PUBLISHES_NO_IDENTIFIER).`,
        );
      }
    }
  }

  // A6 — the two apps must not drift.
  const cSet = new Set(parsed.consumer);
  const bSet = new Set(parsed.business);
  const onlyConsumer = [...cSet].filter((id) => !bSet.has(id)).sort();
  const onlyBusiness = [...bSet].filter((id) => !cSet.has(id)).sort();
  if (onlyConsumer.length > 0) {
    violations.push(
      `A6 drift: declared in ${APPS.consumer} but NOT in ${APPS.business}: ${onlyConsumer.join(", ")}.`,
    );
  }
  if (onlyBusiness.length > 0) {
    violations.push(
      `A6 drift: declared in ${APPS.business} but NOT in ${APPS.consumer}: ${onlyBusiness.join(", ")}.`,
    );
  }

  return violations;
}

/** Build a well-formed SKAdNetworkItems array from a list of ids. */
const items = (ids) => ids.map((id) => ({ SKAdNetworkIdentifier: id }));

function selfTest() {
  const ROSTER = { ...REQUIRED_NETWORKS };
  const all = Object.values(ROSTER).flatMap((n) => n.ids);
  /** @type {[string, boolean, string[]][]} */
  const cases = [];
  const record = (name, shouldPass, v) => cases.push([name, shouldPass, v]);

  // 1 — the shipped shape: complete, identical.
  record("complete + identical", true, evaluate(items(all), items(all)));

  // 2 — a network's id dropped from the consumer app only. Must trip BOTH the
  //     completeness assertion (A5) and the drift assertion (A6).
  record("consumer missing one required id", false, evaluate(items(all.slice(1)), items(all)));

  // 3 — dropped from the business app only.
  record("business missing one required id", false, evaluate(items(all), items(all.slice(0, -1))));

  // 4 — dropped from BOTH: no drift, but still incomplete. This is the
  //     "list silently shrank" mode, and A6 alone would not catch it.
  record("both apps shrank identically", false, evaluate(items(all.slice(1)), items(all.slice(1))));

  // 5 — drift by ADDITION, not removal.
  record("business has an extra id", false, evaluate(items(all), items([...all, "zz1234abcd.skadnetwork"])));

  // 6 — Apple's lowercase requirement.
  record("uppercase identifier", false, evaluate(items([...all.slice(1), all[0].toUpperCase()]), items(all)));

  // 7 — malformed suffix.
  record("wrong suffix", false, evaluate(items([...all.slice(1), "v9wttpbfk9.skadnet"]), items(all)));

  // 8 — duplicate within one app.
  record("duplicate id", false, evaluate(items([...all, all[0]]), items(all)));

  // 9 — key missing entirely.
  record("consumer key absent", false, evaluate(undefined, items(all)));

  // 10 — empty array.
  record("consumer empty array", false, evaluate([], items(all)));

  // 11 — entry is a bare string, not a dictionary.
  record("entry not a dictionary", false, evaluate([...items(all), "v9wttpbfk9.skadnetwork"], items(all)));

  // 12 — dictionary carries an extra/foreign key.
  record(
    "entry with a foreign key",
    false,
    evaluate([...items(all), { SKAdNetworkIdentifier: "zz1234abcd.skadnetwork", note: "x" }], items(all)),
  );

  // 13 — dictionary uses the wrong key name (a very easy typo).
  record("entry with wrong key name", false, evaluate([...items(all), { SKAdNetworkID: "zz1234abcd.skadnetwork" }], items(all)));

  // 14 — VACUITY: an emptied roster must fail even against a perfect plist.
  record("empty roster is not a pass", false, evaluate(items(all), items(all), {}));

  // 15 — VACUITY: a roster whose networks all carry zero ids must fail too.
  record("roster with no ids is not a pass", false, evaluate(items(all), items(all), { meta: { label: "m", source: "s", ids: [] } }));

  // 16 — both apps empty: the "checked nothing, went green" mode.
  record("both apps empty", false, evaluate([], []));

  // 17 — A8, the mode A6 CANNOT see: both apps grow identically with an id that
  //      has no first-party source. This is the "pasted an aggregator's list"
  //      failure, and drift-checking alone would call it clean.
  const aggregator = [...all, "424m5254lk.skadnetwork", "238da6jt44.skadnetwork"];
  record("both apps grew with unsourced ids", false, evaluate(items(aggregator), items(aggregator)));

  // 18 — A8 must not fire on the sanctioned roster itself (guards over-strictness).
  record("exact roster is not flagged as unsourced", true, evaluate(items(all), items(all)));

  let failed = 0;
  for (const [name, shouldPass, v] of cases) {
    const passed = v.length === 0;
    if (passed !== shouldPass) {
      failed += 1;
      console.error(
        `  ✗ ${name}: expected ${shouldPass ? "PASS" : "VIOLATIONS"}, got ` +
          `${passed ? "PASS" : `${v.length} violation(s): ${v[0]}`}`,
      );
    }
  }
  const ok = failed === 0;
  console.log(
    ok
      ? `[#2286 — i-2286-ios-skadnetwork-roster-parity] SELF-TEST PASS (${cases.length}/${cases.length} cases)`
      : `[#2286 — i-2286-ios-skadnetwork-roster-parity] SELF-TEST FAIL (${failed}/${cases.length} cases)`,
  );
  process.exit(ok ? 0 : 1);
}

if (process.argv.includes("--self-test")) selfTest();

function readItems(rel) {
  const json = JSON.parse(readFileSync(join(ROOT, rel), "utf8"));
  return json?.expo?.ios?.infoPlist?.SKAdNetworkItems;
}

const violations = evaluate(readItems(APPS.consumer), readItems(APPS.business));

if (violations.length > 0) {
  console.error("\n[#2286 — i-2286-ios-skadnetwork-roster-parity] VIOLATIONS:\n");
  for (const v of violations) console.error(`  • ${v}`);
  console.error(
    "\nBoth apps must declare the SAME, COMPLETE ad-network roster in " +
      "ios.infoPlist.SKAdNetworkItems. Ids come from each network's own published page " +
      "(see REQUIRED_NETWORKS in this file). This is a NATIVE change: it ships only in a build.\n",
  );
  process.exit(1);
}

const total = Object.values(REQUIRED_NETWORKS).flatMap((n) => n.ids).length;
console.log(
  `[#2286 — i-2286-ios-skadnetwork-roster-parity] PASS — both apps declare the same ` +
    `${total}-identifier roster across ${Object.keys(REQUIRED_NETWORKS).length} networks.`,
);
process.exit(0);
