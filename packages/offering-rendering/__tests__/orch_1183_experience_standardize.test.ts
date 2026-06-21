// ORCH-1183 [experience-standardize] — implementor-owned source-contract
// regression (the established offering-rendering deno-readfile style). These
// assertions FAIL-ON-REVERT:
//   §1 — ExperienceOfferingBody is gorhom-safe (NO ScrollView/BottomSheetScrollView)
//        and NEVER wraps ParallaxCoverShell (the surface owns the shell).
//   §2 — package isolation: the shared body + StopSpine + types import ZERO app src/.
//   §3 — the body renders ONE combined all-in price — NEVER a per-stop price; the
//        all-in display path reads priceAllInCents (orch-1153-no-bare-base).
//   §4 — fork convergence: BOTH surfaces import the shared body; the consumer
//        screen converged onto the shared TripReserveBar (one reserve bar) and the
//        shared body (the hand-mirrored sections retired); web/business mounts it
//        inside ParallaxCoverShell.
//   §5 — ONE vibe-label map (EXPERIENCE_VIBE_LABELS) for the canonical 4 ids.
//   §6 — the new read RPC + consumer route + by-slug hook exist; the web service
//        repoints to the RPC; the venue timezone hardcode is removed.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const read = async (rel: string): Promise<string> =>
  await Deno.readTextFile(new URL(rel, import.meta.url));
const exists = async (rel: string): Promise<boolean> => {
  try {
    await Deno.stat(new URL(rel, import.meta.url));
    return true;
  } catch {
    return false;
  }
};

const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");

// ---------------------------------------------------------------------------
// §1 — gorhom-safe shell-agnostic body.
// ---------------------------------------------------------------------------
Deno.test("§1 ExperienceOfferingBody is NOT a scroll root (gorhom-safe)", async () => {
  const code = stripComments(await read("../ExperienceOfferingBody.tsx"));
  assert(
    !/ScrollView|BottomSheetScrollView/.test(code),
    "the shared body must NOT host a scroll root (the surface owns scroll).",
  );
  assert(
    !/ParallaxCoverShell/.test(code),
    "the shared body must NEVER wrap ParallaxCoverShell (re-triggers the consumer scroll freeze).",
  );
});

// ---------------------------------------------------------------------------
// §2 — package isolation (I-MOR-0827).
// ---------------------------------------------------------------------------
Deno.test("§2 the shared body + StopSpine + types import ZERO app src/", async () => {
  for (const f of [
    "../ExperienceOfferingBody.tsx",
    "../StopSpine.tsx",
    "../experienceOfferingTypes.ts",
  ]) {
    const code = stripComments(await read(f));
    assert(
      !/from\s+["'][^"']*(?:app-mobile|mingla-business)\/(?:src|app)\//.test(code),
      `${f} must not import from any app src/ (I-MOR-0827).`,
    );
    assert(
      !/\buseAuth\b|\.from\(|functions\.invoke\(|useQuery\(/.test(code),
      `${f} must be pure — no fetch / hooks-that-fetch.`,
    );
  }
});

// ---------------------------------------------------------------------------
// §3 — ONE combined all-in price, never a per-stop price.
// ---------------------------------------------------------------------------
Deno.test("§3 the body shows ONE all-in price (priceAllInCents) — never a per-stop price", async () => {
  const body = stripComments(await read("../ExperienceOfferingBody.tsx"));
  assertStringIncludes(
    body,
    "priceAllInCents",
    "the price label must read the server all-in (priceAllInCents).",
  );
  // The StopSpine must NOT render any stop price field.
  const spine = stripComments(await read("../StopSpine.tsx"));
  assert(
    !/priceCents|price_cents|stop\.price|\bprice\b/.test(spine),
    "the StopSpine must NEVER render a per-stop price (ORCH-1151 — one combined all-in).",
  );
  // The type has no per-stop price field.
  const types = await read("../experienceOfferingTypes.ts");
  const stopBlock = types.slice(
    types.indexOf("interface ExperienceOfferingStop"),
    types.indexOf("interface ExperienceOfferingTicket"),
  );
  assert(
    !/priceCents/.test(stopBlock),
    "ExperienceOfferingStop must carry NO priceCents (no per-stop price).",
  );
});

// ---------------------------------------------------------------------------
// §4 — fork convergence (both surfaces; ONE reserve bar; shell ownership).
// ---------------------------------------------------------------------------
Deno.test("§4 both surfaces mount the shared ExperienceOfferingBody", async () => {
  const web = await read(
    "../../../mingla-business/src/components/experience/ExperiencePreview.tsx",
  );
  assertStringIncludes(web, "ExperienceOfferingBody");
  assertStringIncludes(web, "ParallaxCoverShell"); // the surface owns the shell.

  const consumer = await read(
    "../../../app-mobile/src/screens/Experience/ConsumerExperienceDetailScreen.tsx",
  );
  assertStringIncludes(consumer, "ExperienceOfferingBody");
});

Deno.test("§4 the consumer experience screen converged onto the shared TripReserveBar", async () => {
  const consumer = stripComments(
    await read(
      "../../../app-mobile/src/screens/Experience/ConsumerExperienceDetailScreen.tsx",
    ),
  );
  assertStringIncludes(
    consumer,
    "TripReserveBar",
    "the consumer reserve bar must be the shared TripReserveBar.",
  );
  assert(
    !/ConsumerEventReserveBar/.test(consumer),
    "the prior forked ConsumerEventReserveBar must be retired from the experience screen.",
  );
  // The hand-mirrored stop spine + vibe/meta chip JSX must be gone (the body owns it).
  assert(
    !/itinSpine|stopDotText|vibeChipRow|metaChipRow/.test(consumer),
    "the hand-mirrored body sections must be retired (the shared body owns them).",
  );
});

// ---------------------------------------------------------------------------
// §5 — ONE vibe-label map.
// ---------------------------------------------------------------------------
Deno.test("§5 ONE canonical vibe-label map (EXPERIENCE_VIBE_LABELS)", async () => {
  const body = await read("../ExperienceOfferingBody.tsx");
  assertStringIncludes(body, "EXPERIENCE_VIBE_LABELS");
  for (const id of ["adventurous", "first-date", "romantic", "group-fun"]) {
    assertStringIncludes(body, id, `the vibe map must carry the canonical id ${id}.`);
  }
  const idx = await read("../index.ts");
  assertStringIncludes(idx, "EXPERIENCE_VIBE_LABELS");
  assertStringIncludes(idx, "ExperienceOfferingBody");
  assertStringIncludes(idx, "StopSpine");
});

// ---------------------------------------------------------------------------
// §6 — the ONE read RPC + consumer route + by-slug hook; web service repoint;
//      venue timezone hardcode removed.
// ---------------------------------------------------------------------------
Deno.test("§6 the canonical read RPC migration exists + grants anon", async () => {
  const mig = await read(
    "../../../supabase/migrations/20261115000000_orch_1183_pg_public_experience_by_slug.sql",
  );
  assertStringIncludes(mig, "CREATE FUNCTION public.pg_public_experience_by_slug");
  assertStringIncludes(mig, "SECURITY DEFINER");
  assertStringIncludes(mig, "GRANT EXECUTE ON FUNCTION public.pg_public_experience_by_slug(text, text) TO anon, authenticated");
  // address-privacy gating present.
  assertStringIncludes(mig, "hide_address");
  // one ticket all-in via the single owner.
  assertStringIncludes(mig, "compute_all_in_cents");
  // bookable flag.
  assertStringIncludes(mig, "pg_brand_can_charge");
});

Deno.test("§6 the consumer by-slug route + hook exist", async () => {
  assert(
    await exists("../../../app-mobile/app/exp/[brandSlug]/[experienceSlug].tsx"),
    "the consumer cold deep-link route must exist.",
  );
  const hook = await read(
    "../../../app-mobile/src/hooks/useConsumerExperienceDetail.ts",
  );
  assertStringIncludes(hook, "pg_public_experience_by_slug");
});

Deno.test("§6 the web service repoints to the RPC", async () => {
  const svc = stripComments(
    await read(
      "../../../mingla-business/src/services/publicExperienceService.ts",
    ),
  );
  // getPublicExperienceBySlug must call the RPC, not direct .from('events') reads.
  const bySlug = svc.slice(svc.indexOf("export async function getPublicExperienceBySlug"));
  assertStringIncludes(
    bySlug,
    'supabase.rpc("pg_public_experience_by_slug"',
    "the by-slug resolver must call the canonical RPC.",
  );
});

Deno.test("§6 the venue mapper no longer hardcodes timezone:\"UTC\"", async () => {
  const mapper = stripComments(
    await read("../../../app-mobile/src/utils/venueExperienceMapping.ts"),
  );
  assert(
    !/timezone:\s*"UTC"/.test(mapper),
    "the venue mapper must read the real timezone, not the hardcoded \"UTC\".",
  );
  assertStringIncludes(mapper, "row.timezone");
});

// ---------------------------------------------------------------------------
// ADVERSARIAL — these prove the gate would CATCH a regression.
// ---------------------------------------------------------------------------
Deno.test("ADVERSARIAL: a per-stop price in StopSpine would be caught", async () => {
  const spine = await read("../StopSpine.tsx");
  // simulate a reverted spine that renders a stop price.
  const reverted = spine.replace(
    "{stop.placeName}",
    "{stop.placeName}{stop.priceCents}",
  );
  assert(
    /priceCents/.test(stripComments(reverted)),
    "the simulated revert must contain priceCents (the §3 check would FAIL on it).",
  );
});

Deno.test("ADVERSARIAL: a ParallaxCoverShell re-wrap in the body would be caught", async () => {
  const body = await read("../ExperienceOfferingBody.tsx");
  const reverted =
    body + "\n// <ParallaxCoverShell> would re-trigger the scroll freeze\n";
  // The §1 check strips // comments, so a comment alone must NOT trip it (proving
  // the check gates on real code) — but a real JSX wrap WOULD.
  const realWrap = body.replace(
    "return (\n    <View testID={testID}>",
    "return (\n    <ParallaxCoverShell><View testID={testID}>",
  );
  assert(
    /ParallaxCoverShell/.test(stripComments(realWrap)),
    "a real ParallaxCoverShell wrap must be caught by the §1 check.",
  );
  assert(
    !/ParallaxCoverShell/.test(stripComments(reverted)),
    "a doc-comment mention must NOT trip §1 (it gates on real code).",
  );
});
