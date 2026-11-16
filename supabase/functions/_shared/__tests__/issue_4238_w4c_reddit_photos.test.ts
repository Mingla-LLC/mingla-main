/**
 * #4238 W4c (sub-item 2, T-9): Reddit takes a Host photo. create_version
 * freezes the photo's public master link on the plan (canonical
 * .creative_image_url, inside the hash), and Reddit's create reads the kind
 * and the link from the reviewed plan version — never from the request body.
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  HOST_IMAGE_PLATFORMS,
  hostImageRefusedPlatform,
} from "../../ad-plan/index.ts";

const read = (path: string) => Deno.readTextFile(new URL(path, import.meta.url));

Deno.test("a photo plan can include Reddit; TikTok and Google still need a video", () => {
  assert(HOST_IMAGE_PLATFORMS.has("reddit"));
  assertEquals(hostImageRefusedPlatform("image", ["meta", "reddit"]), null);
  assertEquals(hostImageRefusedPlatform("image", ["reddit", "tiktok"]), "tiktok");
  assertEquals(hostImageRefusedPlatform("image", ["google"]), "google");
});

Deno.test("create_version freezes the photo link for Reddit (https only) and refuses a photo without one", async () => {
  const src = await read("../../ad-plan/index.ts");
  assert(src.includes('"id,brand_id,kind,status,source,source_brand_id,purged_at,source_url"'));
  assert(src.includes("/^https:\\/\\//i.test(creative.source_url.trim())"));
  const at = src.indexOf("delete canonical.creative_image_url;");
  assert(at > 0);
  const block = src.slice(at, at + 500);
  assert(block.includes('platforms.includes("reddit")'));
  assert(block.includes('detail: "host_image_link_missing:reddit"'));
  assert(block.includes("canonical.creative_image_url = firstCreativeImageUrl;"));
  // Frozen before the hash: the line sits before the plan hash is computed.
  assert(at < src.indexOf("canonical.retarget_by_platform = Object.fromEntries("));
  assertEquals(src.includes("canonicalInput.creative_image_url"), false);
});

Deno.test("Reddit create reads a Host plan's kind and photo link from the bound plan, not the request", async () => {
  const src = await read("../../admin-ad-create-campaign/index.ts");
  assert(src.includes(`const hostFrozenR = requestedOwnerKind === "host"
      ? (boundCanonicalPlan ?? {}) as Record<string, unknown>
      : null;`));
  assert(src.includes(`? (hostFrozenR.creative_kind === "image" ? "image" : "video")`));
  assert(src.includes(`? (typeof hostFrozenR.creative_image_url === "string"
        ? hostFrozenR.creative_image_url.trim()`));
});
