/*
 * #2829 W3 — the CMS's publication result names the artifact generation it
 * wrote; the callback shape-checks it before Core validates the pairs. The
 * original v1-only result keeps working (null = the 8-argument call).
 */
import { publicationGeneration } from "../sitesContracts.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("#2829 a v2 result passes its generation, design and font warnings through", () => {
  const warnings = [{ slot: "display", requested: "Fraunces", used: "Oswald", code: "FONT_FETCH_FAILED" }];
  const generation = publicationGeneration({
    artifact_schema_version: 2, renderer_key: "sites-v2", design_key: "atelier", design_version: 1, font_warnings: warnings,
  });
  assert(generation !== null, "generation dropped");
  assert(generation.p_artifact_schema_version === 2 && generation.p_renderer_key === "sites-v2", JSON.stringify(generation));
  assert(generation.p_design_key === "atelier" && generation.p_design_version === 1, JSON.stringify(generation));
  assert(generation.p_font_warnings === warnings, "warnings changed");
});

Deno.test("#2829 an original result is the v1 call; a v1 rollback names no design", () => {
  assert(publicationGeneration({ publication_id: "x" }) === null, "old shape should be null");
  const v1 = publicationGeneration({ artifact_schema_version: 1, renderer_key: "restaurant-website-v1" });
  assert(v1 !== null && v1.p_design_key === null && v1.p_design_version === null && v1.p_font_warnings === null, JSON.stringify(v1));
});

Deno.test("#2829 malformed generation fields are refused before Core", () => {
  for (const bad of [
    { artifact_schema_version: 3, renderer_key: "sites-v2" },
    { artifact_schema_version: "2", renderer_key: "sites-v2" },
    { artifact_schema_version: 2 },
    { artifact_schema_version: 2, renderer_key: "sites-v2", design_key: 7 },
    { artifact_schema_version: 2, renderer_key: "sites-v2", design_version: 1.5 },
    { artifact_schema_version: 2, renderer_key: "sites-v2", font_warnings: "x" },
    { artifact_schema_version: 2, renderer_key: "sites-v2", font_warnings: [1, 2, 3, 4] },
  ]) {
    let refused = false;
    try {
      publicationGeneration(bad);
    } catch (error) {
      refused = (error as Error).message === "VALIDATION_FAILED";
    }
    assert(refused, `accepted ${JSON.stringify(bad)}`);
  }
});

Deno.test("#2829 the callback forwards the generation to the 13-argument completion", async () => {
  const source = await Deno.readTextFile(new URL("../../brand-site-cms-callback/index.ts", import.meta.url));
  assert(source.includes("const generation = publicationGeneration(parsed);"), "callback does not read the generation");
  assert(source.includes("...(generation ?? {}),"), "callback does not forward the generation");
});
