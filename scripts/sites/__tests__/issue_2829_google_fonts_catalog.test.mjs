// #2829 AD-3 — the Google Fonts catalogue owners choose from: generated from
// Google's public metadata, open-source families only, every name safe to put
// in CSS, sorted and unique, and the families the designs and the W3 proof use
// are present with their real weights.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { catalogRows, parseMetadata, renderModule, TARGET } from "../refresh-google-fonts-catalog.mjs";

const FAMILY = /^[A-Za-z0-9](?:[A-Za-z0-9 -]{0,62}[A-Za-z0-9])?$/;

function committedRows() {
  return fs.readFileSync(TARGET, "utf8")
    .split("\n")
    .filter((line) => line.startsWith("  [\""))
    .map((line) => JSON.parse(line.trim().replace(/,$/, "")));
}

test("#2829 metadata parsing keeps open-source families and their weights", () => {
  const raw = `)]}'\n${JSON.stringify({
    familyMetadataList: [
      { family: "Zeta Sans", category: "Sans Serif", isOpenSource: true, subsets: ["menu", "latin"], fonts: { "400": {}, "700": {}, "400i": {} } },
      { family: "Alpha Serif", category: "Serif", isOpenSource: true, subsets: ["latin-ext", "latin"], fonts: { "300": {} } },
      { family: "Closed Face", category: "Serif", isOpenSource: false, subsets: ["latin"], fonts: { "400": {} } },
      { family: "Bad\"Name", category: "Serif", isOpenSource: true, subsets: ["latin"], fonts: { "400": {} } },
      { family: "No Category", category: "Emoji", isOpenSource: true, subsets: ["latin"], fonts: { "400": {} } },
    ],
  })}`;
  assert.deepEqual(catalogRows(parseMetadata(raw)), [
    ["Alpha Serif", "serif", [300], [], ["latin", "latin-ext"]],
    ["Zeta Sans", "sans-serif", [400, 700], [400], ["latin"]],
  ]);
  assert.match(renderModule([["Zeta Sans", "sans-serif", [400], [], ["latin"]]], "2026-10-26"), /\["Zeta Sans","sans-serif",\[400\],\[\],\["latin"\]\],/);
});

test("#2829 the committed catalogue is complete, sorted, unique and CSS-safe", () => {
  const rows = committedRows();
  assert.ok(rows.length >= 1500, `only ${rows.length} families`);
  const names = rows.map((row) => row[0]);
  assert.deepEqual([...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)), names);
  assert.equal(new Set(names).size, names.length);
  for (const [family, category, weights, italic] of rows) {
    assert.match(family, FAMILY);
    assert.ok(["sans-serif", "serif", "display", "handwriting", "monospace"].includes(category));
    assert.ok(weights.length >= 1);
    for (const weight of [...weights, ...italic]) assert.ok(weight % 100 === 0 && weight >= 100 && weight <= 900);
  }
  const byName = new Map(rows.map((row) => [row[0], row]));
  assert.deepEqual(byName.get("Oswald")?.[2], [200, 300, 400, 500, 600, 700]);
  assert.ok(byName.get("Plus Jakarta Sans")?.[2].includes(800));
  assert.ok(byName.get("Fraunces")?.[2].includes(400));
  assert.ok(byName.get("Inter")?.[2].includes(400));
  assert.equal(byName.get("Just Another Hand")?.[1], "handwriting");
});
