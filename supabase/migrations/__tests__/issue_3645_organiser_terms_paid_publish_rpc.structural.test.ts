/**
 * #3645 PR11d — structural contract for Organiser Terms on paid publish RPCs.
 *
 * Pins the migration that last-writes the helper + the four publish RPCs.
 * Fails-on-revert if a paid path drops `biz_require_current_organiser_terms`
 * or if free/draft paths incorrectly require it.
 */

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const migrationUrl = new URL(
  "../20270731003645_issue_3645_organiser_terms_paid_publish_rpc.sql",
  import.meta.url,
);
const migration = await Deno.readTextFile(migrationUrl);

function body(name: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${name}`;
  const start = migration.indexOf(marker);
  assert(start >= 0, `missing ${name}`);
  const next = migration.indexOf("CREATE OR REPLACE FUNCTION public.", start + 1);
  const slice = migration.slice(start, next < 0 ? undefined : next);
  // Stay is last: stop at its dollar-quote terminator so the trailing self-verify
  // DO block (which repeats the helper name) is not counted as part of the body.
  const asMatch = slice.match(/AS\s+(\$[a-zA-Z0-9_]*\$)/i);
  if (!asMatch) return slice;
  const tag = asMatch[1];
  const asIdx = slice.indexOf(asMatch[0]);
  const closeIdx = slice.indexOf(tag, asIdx + asMatch[0].length);
  if (closeIdx < 0) return slice;
  return slice.slice(0, closeIdx + tag.length);
}

Deno.test("#3645 PR11d: helper pins server-owned Organiser Terms 1.0", () => {
  const helper = body("biz_require_current_organiser_terms");
  assert(helper.includes("mingla_tos_version_accepted"));
  assert(helper.includes("mingla_tos_accepted_at"));
  assert(helper.includes("removed_at IS NULL"));
  assert(helper.includes("accepted_at IS NOT NULL"));
  assert(helper.includes("IS DISTINCT FROM '1.0'"));
  assert(helper.includes("v_accepted_at IS NULL"));
  assert(helper.includes("mingla_tos_not_accepted"));
  assert(helper.includes("organiser_terms_version_required=1.0"));
  assert(helper.includes("auth.role() = 'service_role'"));
  assert(migration.includes("REVOKE ALL ON FUNCTION public.biz_require_current_organiser_terms"));
  assert(migration.includes("REVOKE EXECUTE ON FUNCTION public.biz_require_current_organiser_terms"));
  assert(migration.includes("FROM anon"));
});

const PAID_PUBLISH_RPCS = [
  "business_publish_event_draft",
  "business_publish_trip_draft",
  "biz_publish_experience",
  "biz_publish_stay",
] as const;

for (const name of PAID_PUBLISH_RPCS) {
  Deno.test(`#3645 PR11d: ${name} requires current Organiser Terms on paid publish`, () => {
    const definition = body(name);
    assert(
      definition.includes("biz_require_current_organiser_terms"),
      `${name}: missing biz_require_current_organiser_terms`,
    );
    assertEquals(
      (definition.match(/biz_require_current_organiser_terms/g) ?? []).length,
      1,
      `${name}: expected exactly one ToS require call`,
    );
  });
}

Deno.test("#3645 PR11d: experience keeps draft/free exemption shape", () => {
  const experience = body("biz_publish_experience");
  // Paid-only gate: require sits inside p_publish + not free + total > 0.
  assert(
    experience.includes(
      "IF p_publish AND NOT v_is_free AND v_resolved_total > 0 THEN",
    ),
  );
  const paidIdx = experience.indexOf(
    "IF p_publish AND NOT v_is_free AND v_resolved_total > 0 THEN",
  );
  const requireIdx = experience.indexOf("biz_require_current_organiser_terms");
  assert(requireIdx > paidIdx, "ToS require must sit inside the paid publish IF");
});

Deno.test("#3645 PR11d: event ToS require sits inside paid-online IF", () => {
  const event = body("business_publish_event_draft");
  const paidIdx = event.indexOf("IF COALESCE(v_paid_online, false) THEN");
  const requireIdx = event.indexOf("biz_require_current_organiser_terms");
  assert(paidIdx >= 0 && requireIdx > paidIdx);
});
