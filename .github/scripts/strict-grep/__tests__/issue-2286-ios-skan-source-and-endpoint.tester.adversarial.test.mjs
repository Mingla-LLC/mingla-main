// #2286 tester-owned adversarial guard.
//
// The implementor gate validates the two app plists against REQUIRED_NETWORKS,
// but its evaluator does not validate REQUIRED_NETWORKS.source itself. This
// companion therefore pins the evidence behind the allowlist: every rostered
// identifier must still map to the exact first-party HTTPS page, independently
// of whether both apps and the in-repo allowlist drift together.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../../..");
const GATE = path.join(ROOT, ".github/scripts/strict-grep/i-2286-ios-skadnetwork-roster-parity.mjs");
const APPS = [path.join(ROOT, "app-mobile/app.json"), path.join(ROOT, "mingla-business/app.json")];
const ENDPOINT = "https://appsflyer-skadnetwork.com/";
const EXPECTED = {
  meta: {
    source: "https://developers.facebook.com/docs/setting-up/platform-setup/ios/SKAdNetwork",
    host: "developers.facebook.com",
    ids: ["v9wttpbfk9.skadnetwork", "n38lu8286q.skadnetwork"],
  },
  google: {
    source: "https://developers.google.com/admob/ios/3p-skadnetworks",
    host: "developers.google.com",
    ids: ["cstr6suwn9.skadnetwork"],
  },
};

function readRoster() {
  const source = fs.readFileSync(GATE, "utf8");
  const match = source.match(
    /export const REQUIRED_NETWORKS\s*=\s*(\{[\s\S]*?\n\});\n\n\/\*\*\n \* The networks/,
  );
  assert.ok(match, "REQUIRED_NETWORKS must remain a statically inspectable object literal");
  return vm.runInNewContext(`(${match[1]})`, Object.create(null));
}

test("first-party evidence is exact, HTTPS, and one-to-one with every rostered id", () => {
  const roster = readRoster();
  assert.deepEqual(Object.keys(roster).sort(), Object.keys(EXPECTED).sort());

  const seen = new Set();
  for (const [network, expected] of Object.entries(EXPECTED)) {
    const actual = roster[network];
    assert.equal(actual.source, expected.source, `${network} must retain its reviewed first-party source`);
    const parsed = new URL(actual.source);
    assert.equal(parsed.protocol, "https:", `${network} source must use HTTPS`);
    assert.equal(parsed.hostname, expected.host, `${network} source must stay on the first-party host`);
    assert.deepEqual(Array.from(actual.ids), expected.ids, `${network} identifier roster changed`);
    for (const id of actual.ids) {
      assert.equal(seen.has(id), false, `${id} is attributed to more than one network`);
      seen.add(id);
    }
  }
});

test("both app configs independently match the sourced roster and exact single endpoint", () => {
  const expectedIds = Object.values(EXPECTED).flatMap((network) => network.ids);
  for (const file of APPS) {
    const plist = JSON.parse(fs.readFileSync(file, "utf8")).expo.ios.infoPlist;
    assert.equal(plist.NSAdvertisingAttributionReportEndpoint, ENDPOINT, `${file} endpoint drifted`);
    assert.deepEqual(
      plist.SKAdNetworkItems,
      expectedIds.map((id) => ({ SKAdNetworkIdentifier: id })),
      `${file} roster must exactly match the independently sourced order and shape`,
    );
  }
});
