/**
 * ORCH-1116 [Hub multi-select draft delete] — migration + wiring source guards.
 *
 * Mirrors serverDraftLifecycleGuards.test.ts:200's migration-source grep style.
 * Asserts:
 *   - the batch RPC replicates the single-RPC's auth/rank/draft-status/brand
 *     guards PER ROW, is SKIP-and-report, and is REVOKE'd PUBLIC/anon +
 *     GRANT'd authenticated/service_role only
 *     (I-PROPOSED-ORCH-1116-BATCH-RPC-RANK-GATED / -MULTISELECT-DRAFTS-ONLY).
 *   - $function$; terminator appears BEFORE the GRANT (migration-baseline CI).
 *   - each Hub tab wires long-press → enterWith, drafts-only selectable, the
 *     DraftSelectBar, the count-aware ConfirmDialog copy, and the verbatim
 *     bulk toast tally (I-PROPOSED-ORCH-1116-NO-SILENT-PARTIAL-FAILURE /
 *     -EVENTS-LOCAL-SERVER-SPLIT / -LONGPRESS-FIRES).
 *
 * fails-on-revert: deleting the RPC body / the partition wiring / the toast
 * strings makes the relevant assertions fail.
 */

import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

const repoFile = (relativePath: string): string =>
  readFileSync(path.join(process.cwd(), relativePath), "utf8");

const MIGRATION =
  "../supabase/migrations/20260928000000_orch_1116_batch_discard_offering_drafts.sql";

describe("ORCH-1116 batch discard RPC — source guards", () => {
  test("RPC replicates per-row auth/draft/rank/brand guards, SKIP-and-report", () => {
    const sql = repoFile(MIGRATION);

    expect(sql).toContain(
      "CREATE OR REPLACE FUNCTION public.business_discard_offering_drafts",
    );
    expect(sql).toContain("p_event_ids uuid[]");
    expect(sql).toContain("RETURNS TABLE");
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("SET search_path TO 'public', 'pg_temp'");

    // auth present
    expect(sql).toContain("v_user_id := auth.uid();");
    expect(sql).toContain("RAISE EXCEPTION 'not_authenticated'");

    // per-row iteration + lock
    expect(sql).toContain("FOR v_id IN SELECT DISTINCT unnest(p_event_ids)");
    expect(sql).toContain("FOR UPDATE");

    // drafts-only (defense in depth) + SKIP-and-report outcomes
    expect(sql).toContain("v_event.status <> 'draft'");
    expect(sql).toContain("'skipped_not_draft'");
    expect(sql).toContain("'skipped_not_found'");
    expect(sql).toContain("'forbidden'");
    expect(sql).toContain("'deleted'");
    expect(sql).toContain("RETURN NEXT");

    // per-row rank gate (mirrors single RPC)
    expect(sql).toContain(
      "biz_brand_effective_rank(v_event.brand_id, v_user_id)",
    );
    expect(sql).toContain("biz_role_rank('event_manager'");

    // brand exists + not deleted
    expect(sql).toContain("FROM public.brands");
    expect(sql).toContain("deleted_at IS NULL");

    // soft-delete (idempotent guard)
    expect(sql).toContain("SET deleted_at = now(), updated_at = now()");
    expect(sql).toContain(
      "WHERE id = v_id AND status = 'draft' AND deleted_at IS NULL",
    );
  });

  test("$function$; terminator precedes GRANT; REVOKE PUBLIC/anon + GRANT authenticated/service_role", () => {
    const sql = repoFile(MIGRATION);
    const terminatorIdx = sql.indexOf("$function$;");
    const grantIdx = sql.indexOf(
      "GRANT EXECUTE ON FUNCTION public.business_discard_offering_drafts(uuid[]) TO authenticated, service_role",
    );
    expect(terminatorIdx).toBeGreaterThan(-1);
    expect(grantIdx).toBeGreaterThan(-1);
    expect(terminatorIdx).toBeLessThan(grantIdx);

    expect(sql).toContain(
      "REVOKE ALL ON FUNCTION public.business_discard_offering_drafts(uuid[]) FROM PUBLIC",
    );
    expect(sql).toContain(
      "REVOKE ALL ON FUNCTION public.business_discard_offering_drafts(uuid[]) FROM anon",
    );
  });
});

describe("ORCH-1116 Hub tab wiring — source guards", () => {
  const eventsSource = repoFile("app/(tabs)/hub/events.tsx");
  const tripsSource = repoFile("app/(tabs)/hub/trips.tsx");
  const experiencesSource = repoFile("app/(tabs)/hub/experiences.tsx");
  const eventCard = repoFile("src/components/event/EventListCard.tsx");
  const tripCard = repoFile("src/components/trip/TripListCard.tsx");
  const offeringCard = repoFile("src/components/offering/OfferingListCard.tsx");

  test("events: long-press → enterWith (drafts only), partition, server-id-only RPC, toast tally", () => {
    expect(eventsSource).toContain("useDraftMultiSelect");
    expect(eventsSource).toContain("useDiscardOfferingDrafts");
    expect(eventsSource).toContain("HapticFeedback.selectionEnter()");
    expect(eventsSource).toContain("selection.enterWith(item.event.id)");
    // partition: local-only vs server (the Zustand trap)
    expect(eventsSource).toContain("selected.filter(isLocalOnlyDraft)");
    expect(eventsSource).toContain("localOnlyDraftIds: localOnly");
    expect(eventsSource).toContain("serverEventIds: serverIds");
    // drafts-only selectable
    expect(eventsSource).toContain('item.kind === "draft"');
    expect(eventsSource).toContain("selectable={isDraftRow}");
    // verbatim toast tally
    expect(eventsSource).toContain("couldn't be deleted.");
    expect(eventsSource).toContain("You may not have permission.");
    // bar + count-aware confirm copy
    expect(eventsSource).toContain("DraftSelectBar");
    expect(eventsSource).toContain("Delete this draft?");
    expect(eventsSource).toContain("drafts?");
    expect(eventsSource).toContain('cancelLabel="Keep"');
  });

  test("trips: bulk path converges on the rank-checked RPC + adds a Toast", () => {
    expect(tripsSource).toContain("useDraftMultiSelect");
    expect(tripsSource).toContain("useDiscardOfferingDrafts");
    expect(tripsSource).toContain('kind: "trip"');
    expect(tripsSource).toContain('t.status === "draft"');
    expect(tripsSource).toContain("DraftSelectBar");
    expect(tripsSource).toContain("HapticFeedback.selectionEnter()");
    // trips had no Toast before — must add one
    expect(tripsSource).toContain("<Toast");
    expect(tripsSource).toContain("couldn't be deleted.");
  });

  test("experiences: long-press gated to draft rows, no new filter pills", () => {
    expect(experiencesSource).toContain("useDraftMultiSelect");
    expect(experiencesSource).toContain("useDiscardOfferingDrafts");
    expect(experiencesSource).toContain('kind: "experience"');
    expect(experiencesSource).toContain('exp.status === "draft"');
    expect(experiencesSource).toContain("DraftSelectBar");
    expect(experiencesSource).toContain("HapticFeedback.selectionEnter()");
    expect(experiencesSource).toContain("couldn't be deleted.");
  });

  test("cards: long-press fires (delayLongPress) + drafts-only checkbox + a11y role", () => {
    for (const card of [eventCard, tripCard, offeringCard]) {
      expect(card).toContain("onLongPress");
      expect(card).toContain("delayLongPress={350}");
      expect(card).toContain("DraftSelectCheckbox");
      expect(card).toContain("DraftSelectOverlay");
      // non-draft long-press is an honest no-op (null-shake), never silent
      expect(card).toContain("playNullShake");
      // row becomes role=checkbox while selecting a draft
      expect(card).toContain('isCheckboxRow ? "checkbox" : "button"');
    }
  });
});
