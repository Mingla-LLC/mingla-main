// Issue #3697 (C-13) — archiving hides a creative from NEW selection only. A
// plan version already frozen with it (matched by id AND hash) keeps working
// in provider create, native-app create, preview and prepare; a new selection,
// a validate-only probe or a draft change still refuses it.
// Invariant I-CREATIVE-ARCHIVE-NOT-DELETE (declared in supabase/migrations/__tests__/issue_3697_creative_library_lifecycle.implementor.pg17.test.sql)
//
// FAILS ON REVERT: make frozenPlanCarriesCreative ignore the hash or the
// creative id, let creativeSelectionError accept archived without `frozen`,
// or put back a bare `status !== "active"` check in any of the frozen paths.
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  creativeSelectionError,
  frozenPlanCarriesCreative,
} from "../adCreativeLifecycle.ts";
import { FakeAdPlanDb } from "../../ad-plan/__tests__/fakeAdPlanDb.ts";

const CREATIVE = "c0000000-0000-4000-8000-000000000031";
const OTHER = "c0000000-0000-4000-8000-000000000032";
const VERSION = "b0000000-0000-4000-8000-000000000031";
const HASH = "a".repeat(64);
const ARCHIVED = { id: CREATIVE, status: "archived", purged_at: null };

const db = () =>
  new FakeAdPlanDb({
    ad_plan_versions: [{
      id: VERSION,
      plan_hash: HASH,
      canonical_plan: { creative_library_id: CREATIVE },
    }],
  });

Deno.test("#3697 archived + the frozen plan version that carries it → accepted", async () => {
  const frozen = await frozenPlanCarriesCreative(db(), {
    planVersionId: VERSION,
    planHash: HASH.toUpperCase(),
    creativeId: CREATIVE,
  });
  assertEquals(frozen, true);
  assertEquals(creativeSelectionError(ARCHIVED, { frozen }), null);
});

Deno.test("#3697 archived + a new selection (no, wrong or other plan) → refused", async () => {
  for (
    const input of [
      { planVersionId: undefined, planHash: undefined, creativeId: CREATIVE },
      { planVersionId: VERSION, planHash: "b".repeat(64), creativeId: CREATIVE },
      { planVersionId: VERSION, planHash: HASH, creativeId: OTHER },
      { planVersionId: "not-a-uuid", planHash: HASH, creativeId: CREATIVE },
      { planVersionId: "b0000000-0000-4000-8000-000000000099", planHash: HASH, creativeId: CREATIVE },
    ]
  ) {
    const frozen = await frozenPlanCarriesCreative(db(), input);
    assertEquals(frozen, false, JSON.stringify(input));
    assertEquals(creativeSelectionError(ARCHIVED, { frozen })?.error, "creative_archived");
  }
  // A purged creative has no media, frozen or not.
  assertEquals(
    creativeSelectionError({ ...ARCHIVED, purged_at: "2026-10-19T00:00:00Z" }, { frozen: true })?.error,
    "creative_purged",
  );
});

const read = (path: string) => Deno.readTextFile(new URL(path, import.meta.url));

Deno.test("#3697 every frozen-plan path accepts archived through the shared rule", async () => {
  const create = await read("../../admin-ad-create-campaign/index.ts");
  // Host video: frozen only with a real (not validate-only) bound version.
  assertStringIncludes(create, "body.validate_only !== true &&\n      await frozenPlanCarriesCreative(supabase, {");
  assertStringIncludes(create, "creativeSelectionError(hostCreativeRow, { frozen: hostCreativeFrozen })");
  // Mingla video: frozen only for the creative of the verified version.
  assertStringIncludes(create, "libCreative.id === frozenCreativeLibraryId");
  assert(!/hostCreativeRow\.status !== "active"|libCreative\.status !== "active"/.test(create));

  const native = await read("../../admin-ad-create-native-app-campaign/index.ts");
  assertStringIncludes(native, "creativeSelectionError(creative, { frozen: true })");
  assertStringIncludes(native, "nativeAppCreativeIdFromCanonicalPlan(version.canonical_plan)");
  assert(!/creative\.status !== "active"/.test(native));

  const preview = await read("../../admin-ad-preview/index.ts");
  assertStringIncludes(preview, '"plan_version_id",');
  assertStringIncludes(preview, "creativeSelectionError(creative, { frozen: previewFrozen })");
  assert(!/creative\.status !== "active"/.test(preview));

  const prepare = await read("../../admin-ad-creative-prepare/index.ts");
  assertStringIncludes(prepare, '["active", "archived"].includes(String(creative.status))');
});

Deno.test("#3697 a new Ari plan (new selection) still refuses an archived creative", async () => {
  const ari = await read("../agentDomainTools.ts");
  assertStringIncludes(
    ari,
    'creative.kind !== "video" || creative.status !== "active"',
  );
});
