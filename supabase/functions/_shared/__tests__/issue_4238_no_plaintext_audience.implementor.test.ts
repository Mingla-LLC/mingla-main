// Issue #4238 wave 2 — T15 (SC-2): the audience worker and modules never read
// a plaintext identifier column and never log hash arrays. Hashing happens in
// Postgres (ad_list_audience_refresh); see the pg17 suite for the CHECKs.
// Invariant I-4238-AUDIENCE-HASH-ONLY is declared in
// supabase/migrations/__tests__/issue_4238_ad_list_audiences.implementor.pg17.test.sql.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const FILES = [
  "../../admin-ad-audiences/index.ts",
  "../adListAudienceProvider.ts",
  "../adListAudienceRules.ts",
];
const PLAINTEXT = new Set([
  "email",
  "phone",
  "buyer_email",
  "buyer_phone",
  "buyer_phone_e164",
  "guest_email",
  "guest_phone",
  "guest_phone_e164",
  "holder_email",
  "holder_phone_e164",
  "attendee_email",
  "normalized_value",
  "phone_e164",
  "contact_email",
  "contact_phone",
]);

async function source(path: string): Promise<string> {
  return await Deno.readTextFile(new URL(path, import.meta.url));
}

Deno.test("T15 no audience code selects a plaintext identifier column", async () => {
  for (const file of FILES) {
    const text = await source(file);
    for (const match of text.matchAll(/\.select\(\s*(["'`])([^"'`]*)\1/g)) {
      const columns = match[2].split(",").map((part) => part.trim().split(/[:(]/)[0].trim());
      for (const column of columns) {
        assert(!PLAINTEXT.has(column), `${file} selects plaintext column "${column}"`);
      }
    }
    // No direct reads of the identifier source tables either.
    for (const table of ["orders", "tickets", "event_rsvps", "profiles", "brand_person_contact_methods", "reservations", "venue_orders"]) {
      assert(!text.includes(`from("${table}")`), `${file} reads ${table} directly`);
    }
  }
});

Deno.test("T15 no console call carries hash arrays, members or provider bodies", async () => {
  for (const file of FILES) {
    const text = await source(file);
    for (const match of text.matchAll(/console\.(log|error|warn|info|debug)\(([^;]*?)\);/gs)) {
      const args = match[2];
      for (const word of ["hashes", "members", "email_sha256", "phone_sha256", "payload", "body", "request"]) {
        assert(!new RegExp(`\\b${word}\\b`).test(args), `${file} logs ${word}: ${args.slice(0, 80)}`);
      }
    }
  }
});

Deno.test("T15 the list sync logs exactly {audience_key, platform, adds, removes, error_code}", async () => {
  const text = await source("../adListAudienceProvider.ts");
  const logs = [...text.matchAll(/\blog\(\{([^}]*)\}\)/g)].map((m) => m[1].replace(/\s+/g, " ").trim());
  assertEquals(logs, ["audience_key: def.audience_key, platform, adds, removes, error_code: errorCode"]);
});
