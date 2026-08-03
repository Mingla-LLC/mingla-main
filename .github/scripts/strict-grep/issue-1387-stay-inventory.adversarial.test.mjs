import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const schema = fs.readFileSync(
  path.join(
    root,
    "supabase/migrations/20270131013807_issue_1387_stay_inventory_schema.sql",
  ),
  "utf8",
);
const management = fs.readFileSync(
  path.join(
    root,
    "supabase/migrations/20270131013808_issue_1387_stay_inventory_management.sql",
  ),
  "utf8",
);

test("Stay media attaches an owned storage object, never a caller URL", () => {
  assert.match(schema, /\bstorage_object_id uuid NOT NULL\b/);
  assert.doesNotMatch(schema, /\bmedia_url text\b/);
  assert.match(management, /\bFROM storage\.objects\b/);
  assert.match(management, /\bso\.bucket_id = 'brand_covers'/);
  assert.match(
    management,
    /split_part\(so\.name,\s*'\/',\s*1\) = p_brand_id::text/,
  );
  assert.doesNotMatch(management, /p_payload->>'mediaUrl'/);
});

test("a Room or Place cannot publish without authoritative availability", () => {
  const publishStart = management.indexOf(
    "IF lower(p_payload->>'status') = 'live' THEN",
  );
  const publishEnd = management.indexOf(
    "UPDATE public.stay_offerings",
    publishStart,
  );
  const publishBranch = management.slice(publishStart, publishEnd);
  assert.ok(publishStart >= 0 && publishEnd > publishStart);
  assert.match(publishBranch, /\bstay_room_nights\b/);
  assert.match(publishBranch, /\bstay_place_windows\b/);
  assert.match(publishBranch, /\bv_offering\.kind = 'room'/);
  assert.match(publishBranch, /\bv_offering\.kind = 'place'/);
  assert.match(publishBranch, /\bn\.local_date >=/);
  assert.match(publishBranch, /\bw\.ends_at > now\(\)/);
});

test("bulk idempotency is Stay-scoped and rejects payload-key reuse", () => {
  assert.match(
    schema,
    /UNIQUE\s*\(\s*venue_id\s*,\s*idempotency_key\s*\)/,
  );
  assert.match(schema, /\brequest_hash text NOT NULL\b/);
  assert.match(management, /\bstay_idempotency_conflict\b/);
  assert.match(management, /\bextensions\.digest\b/);
  assert.match(management, /\bv_job\.request_hash <> v_request_hash\b/);
});

test("Places carry explicit capacity, pricing, scheduling, and buffer semantics", () => {
  assert.match(
    schema,
    /inventory_basis IN \(\s*'pooled_units',\s*'exclusive_units',\s*'shared_capacity'\s*\)/,
  );
  assert.match(
    schema,
    /place_pricing_basis IN \(\s*'per_booking',\s*'per_unit',\s*'per_guest'\s*\)/,
  );
  assert.match(
    schema,
    /mode text NOT NULL CHECK \(\s*mode IN \(\s*'fixed_slots',\s*'repeating_windows',\s*'full_day'\s*\)/,
  );
  assert.match(schema, /\bslot_duration_minutes integer\b/);
  assert.match(schema, /\bslot_interval_minutes integer\b/);
  assert.match(schema, /\bbuffer_before_minutes integer NOT NULL\b/);
  assert.match(schema, /\bbuffer_after_minutes integer NOT NULL\b/);
  assert.match(schema, /\bmax_adults integer\b/);
  assert.match(schema, /\bmax_children integer\b/);
  assert.match(schema, /\bsellable_units integer\b/);
  assert.match(schema, /\bsellable_capacity integer\b/);
});
