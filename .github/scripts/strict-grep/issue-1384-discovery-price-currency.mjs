#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const required = {
  migration: [
    "CREATE TABLE public.place_discovery_price_ranges",
    "CREATE TABLE public.fx_rate_snapshots",
    "CREATE OR REPLACE FUNCTION public.issue_1384_save_discovery_price_range",
    "CREATE OR REPLACE FUNCTION public.issue_1384_reconcile_bank_currency",
    "CREATE OR REPLACE FUNCTION public.pg_brand_can_charge",
    "CREATE OR REPLACE FUNCTION public.pg_brand_can_collect",
  ],
  discover: [
    "priceLevel: null",
    "priceTier: null",
    "sourceMinMinor:",
    "displayCurrencyCode:",
    "fxSnapshotId:",
    "attachDiscoveryPrices(",
    "priceFilterCurrency",
    "FX_UNAVAILABLE",
  ],
  mobile: [
    "canonicalDiscoveryPriceLabel",
    "priceTier: undefined",
    "displayCurrency: params.displayCurrency",
    "priceFilterCurrency: params.priceFilterCurrency",
  ],
  business: [
    "getBrandDiscoveryCurrencyState",
    "setBrandProvisionalCurrency",
    "saveDiscoveryPriceRange",
  ],
  admin: [
    "source_min_minor",
    "source_currency_code",
    "issue_1384_save_discovery_price_range",
    "place_discovery_price_range_revisions",
    "p_actor_reason: \"admin_edit\"",
  ],
};

export function violations(files) {
  const failures = [];
  for (const [name, tokens] of Object.entries(required)) {
    const source = files[name] ?? "";
    for (const token of tokens) {
      if (!source.includes(token)) failures.push(`${name}: missing ${token}`);
    }
  }
  if (/priceRange:\s*[^,;]+\|\|\s*['"]Free['"]/.test(files.mobile ?? "")) {
    failures.push("mobile: absent canonical data must not become Free");
  }
  return failures;
}

function selfTest() {
  const valid = Object.fromEntries(
    Object.entries(required).map(([name, tokens]) => [name, tokens.join("\n")]),
  );
  if (violations(valid).length !== 0) throw new Error("valid fixture rejected");
  for (const [name, tokens] of Object.entries(required)) {
    for (const token of tokens) {
      const broken = { ...valid, [name]: valid[name].replace(token, "") };
      if (!violations(broken).some((item) => item.includes(`missing ${token}`))) {
        throw new Error(`deletion was not caught: ${name}/${token}`);
      }
    }
  }
  const fabricated = { ...valid, mobile: `${valid.mobile}\npriceRange: card.priceRange || 'Free'` };
  if (!violations(fabricated).some((item) => item.includes("must not become Free"))) {
    throw new Error("fabricated Free was not caught");
  }
  console.log("issue-1384 self-test PASS");
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const files = {
    migration: fs.readFileSync(path.join(
      root,
      "supabase/migrations/20270129001384_issue_1384_discovery_price_currency.sql",
    ), "utf8"),
    discover: fs.readFileSync(
      path.join(root, "supabase/functions/discover-cards/index.ts"),
      "utf8",
    ),
    mobile: fs.readFileSync(
      path.join(root, "app-mobile/src/services/deckService.ts"),
      "utf8",
    ),
    business: fs.readFileSync(
      path.join(root, "mingla-business/src/services/businessPlaceAuthoringService.ts"),
      "utf8",
    ),
    admin: [
      fs.readFileSync(
        path.join(root, "mingla-admin/src/pages/PlacePoolManagementPage.jsx"),
        "utf8",
      ),
      fs.readFileSync(
        path.join(root, "mingla-admin/src/lib/deckCardPreviewRules.js"),
        "utf8",
      ),
    ].join("\n"),
  };
  const failures = violations(files);
  if (failures.length > 0) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
  console.log("issue-1384 discovery price currency gate PASS");
}
