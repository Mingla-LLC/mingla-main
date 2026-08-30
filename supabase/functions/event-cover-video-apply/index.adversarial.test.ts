// ORCH-0989 [Unified cover picker sheet] — TESTER adversarial regression #2.
//
// Attacks the NEW brand-cover-video TARGET BOUNDARY — a different angle and a
// different layer than:
//   * the implementor's happy-path jest test (coverProviderBrowseService.test.ts
//     — asserts apply WRITES brands.cover_media_url on the SUCCESS path), and
//   * tester adversarial #1 (event-cover-pexels-curated/index.adversarial.test.ts
//     — curated edge-fn error/boundary/no-orientation invariants).
//
// This file guards the migration-level INVARIANTS that make a brand video target
// SAFE (SPEC §8 Option A LOCKED) and that the live DB CHECK constraints enforce
// (verified live by the tester via Management API on 2026-05-29: brand+event_id
// rejected by target_kind_event_id; event+NULL rejected by target_kind_event_id;
// invalid kind 'venue' rejected by target_kind_check; brand+NULL accepted):
//
//   B1. target_kind discriminator constrained to exactly {event, brand}
//       (no third kind can ever be authored — closes the 'venue' attack).
//   B2. event_id made NULLABLE (brand jobs have no events-row).
//   B3. row-coherence CHECK: (event => event_id NOT NULL) AND
//       (brand => event_id NULL). This is the boundary an attacker would try to
//       cross (a brand job smuggling an event_id, or an event job with no
//       event_id) — both MUST be rejected at the DB layer, not just the edge fn.
//   B4. "one active job per brand" partial unique index exists so the
//       upload-intent supersede step has a brand-side guard mirroring the event
//       guard (no two concurrent active brand jobs).
//   B5. RLS keeps the event predicate BYTE-FOR-BYTE (event_manager, events join,
//       deleted_at IS NULL) — SC-17 no-weakening — AND adds a brand branch gated
//       by brand_admin (SC-16). The brand branch MUST NOT touch the events table.
//   B6. apply edge authorizes the exact target, then delegates the brand/event
//       write and replay-safe receipt to the atomic cover_video_apply_once RPC.
//
// Static-SQL + static-source assertion: deterministic, runs in CI with no DB
// credentials. The live DB probe (tester report §Backend) proves the SAME
// invariants are actually enforced on the remote.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATION_URL = new URL(
  "../../migrations/20260801000000_orch_0989_brand_cover_video_target.sql",
  import.meta.url,
);
const APPLY_URL = new URL("./index.ts", import.meta.url);
const ISSUE_2715_MIGRATION_URL = new URL(
  "../../migrations/20270604002715_issue_2715_deterministic_cover_video_jobs.sql",
  import.meta.url,
);

const migration = await Deno.readTextFile(MIGRATION_URL);
const apply = await Deno.readTextFile(APPLY_URL);
const issue2715 = (await Deno.readTextFile(ISSUE_2715_MIGRATION_URL)).replace(
  /\s+/g,
  " ",
);

// Collapse whitespace for robust substring matching against multi-line SQL.
const sql = migration.replace(/\s+/g, " ");

Deno.test("B1: target_kind is constrained to exactly {event, brand}", () => {
  assert(
    /CHECK \(target_kind IN \('event', 'brand'\)\)/.test(sql),
    "target_kind CHECK must restrict to event|brand (blocks invalid kinds like 'venue')",
  );
});

Deno.test("B2: event_id is made nullable for brand jobs", () => {
  assert(
    /ALTER COLUMN event_id DROP NOT NULL/.test(sql),
    "event_id must DROP NOT NULL so brand jobs can carry NULL event_id",
  );
});

Deno.test("B3: row-coherence CHECK rejects mismatched target/event_id pairs", () => {
  // The exact boundary an attacker crosses: brand-with-event_id or
  // event-without-event_id. Both must be impossible.
  assert(
    /\(target_kind = 'event' AND event_id IS NOT NULL\)/.test(sql),
    "event branch must require event_id IS NOT NULL",
  );
  assert(
    /\(target_kind = 'brand' AND event_id IS NULL\)/.test(sql),
    "brand branch must require event_id IS NULL",
  );
  assert(
    /CONSTRAINT event_cover_video_jobs_target_kind_event_id/.test(sql),
    "the coherence CHECK must be a named constraint",
  );
});

Deno.test("B4: one-active-job-per-brand partial unique index exists", () => {
  assert(
    /CREATE UNIQUE INDEX IF NOT EXISTS idx_event_cover_video_jobs_one_active_per_brand_target/
      .test(sql),
    "brand supersede guard (partial unique index) must exist",
  );
  assert(
    /WHERE target_kind = 'brand' AND status NOT IN \('failed', 'cancelled', 'applied'\)/
      .test(sql),
    "the brand active-job index must exclude terminal statuses",
  );
});

Deno.test("B5: RLS keeps event predicate byte-for-byte AND adds brand_admin branch", () => {
  // SC-17: event predicate unchanged (event_manager, events join, deleted_at).
  assert(
    /e\.deleted_at IS NULL/.test(sql) &&
      /biz_role_rank\('event_manager'::text\)/.test(sql),
    "event RLS predicate must remain (event_manager + deleted_at IS NULL)",
  );
  assert(
    /FROM public\.events e/.test(sql),
    "event branch must still join the events table",
  );
  // SC-16: brand branch gated by brand_admin, and it MUST NOT join events.
  const brandBranch = sql.slice(sql.indexOf("Brand-target rows"));
  assert(
    /biz_role_rank\('brand_admin'::text\)/.test(sql),
    "brand RLS branch must be gated by brand_admin",
  );
  assertEquals(
    /Brand-target rows[\s\S]*?FROM public\.events/.test(sql),
    false,
    "brand RLS branch must NOT touch the events table (brand jobs have no events-row)",
  );
});

Deno.test("B6: apply authorizes the exact target and atomically writes only its branch", () => {
  // [TEST-MOD-APPROVED #2715] Target-aware edge auth precedes the locked,
  // replay-safe SQL owner; the edge never becomes a second write authority.
  const code = apply.replace(/\s+/g, " ");
  assert(
    /requireCoverVideoTargetManager\(supabase, \{ targetKind: job\.target_kind, eventId: job\.event_id, brandId: job\.brand_id, venueId: job\.venue_id, draftOwnerKey: job\.draft_owner_key, requestedBy: job\.requested_by, \}, userId\)/
      .test(code),
    "edge auth must use the exact job target identity",
  );
  assert(
    /supabase\.rpc\( "cover_video_apply_once"/.test(code),
    "edge must delegate to cover_video_apply_once",
  );
  assertEquals(
    /\.from\("(?:brands|events)"\)/.test(apply),
    false,
    "edge must not directly mutate brand or event targets",
  );

  const eventBranch = issue2715.slice(
    issue2715.indexOf("IF v_job.target_kind='event'"),
    issue2715.indexOf("ELSIF v_job.target_kind='brand'"),
  );
  const brandBranch = issue2715.slice(
    issue2715.indexOf("ELSIF v_job.target_kind='brand'"),
    issue2715.indexOf(
      "UPDATE public.event_cover_video_jobs SET status='applied'",
    ),
  );
  assert(
    /UPDATE public\.events[\s\S]*WHERE id=v_job\.event_id/.test(eventBranch),
    "event branch must bind its write to v_job.event_id",
  );
  assert(
    /UPDATE public\.brands[\s\S]*WHERE id=v_job\.brand_id/.test(brandBranch) &&
      /cover_media_type='video'/.test(brandBranch) &&
      /cover_media_url=v_job\.processed_url/.test(brandBranch) &&
      /cover_media_poster_url=v_job\.processed_poster_url/.test(brandBranch),
    "brand branch must bind id/url/poster/video type to the brand job",
  );
  assert(
    /WHERE id=p_job_id FOR UPDATE/.test(issue2715) &&
      /IF v_job\.status='applied' THEN RETURN v_job/.test(issue2715) &&
      /application_version=application_version\+1/.test(issue2715) &&
      /application_receipt=jsonb_build_object/.test(issue2715),
    "RPC must lock, replay safely, and record one atomic receipt/version",
  );
  assert(
    /processedUrl: job\.processed_url/.test(apply) &&
      /posterUrl: job\.processed_poster_url/.test(apply) &&
      /status: mapEventCoverVideoStatus\(job\)/.test(apply) &&
      /processedUrl: applied\.processed_url/.test(apply) &&
      /posterUrl: applied\.processed_poster_url/.test(apply) &&
      /status: mapEventCoverVideoStatus\(applied\)/.test(apply),
    "success and replay responses must preserve safe authoritative fields",
  );
});
