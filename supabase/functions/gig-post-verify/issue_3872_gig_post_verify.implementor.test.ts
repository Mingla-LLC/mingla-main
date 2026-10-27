import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { verifyGigPost } from "../_shared/gigPostVerify.ts";
const base = {
  platform: "instagram",
  url: "https://instagram.com/reel/abc",
  expectedHandle: "maker",
  observedHandle: "@maker",
  caption: "Great night @usemingla @brand #ad",
  mustTags: ["@usemingla", "@brand"],
  postedAt: "2027-01-02T00:00:00Z",
  shootAt: "2027-01-01T00:00:00Z",
};
Deno.test("#3872 valid post evidence passes all checks", () =>
  assertEquals(verifyGigPost(base).result, "pass"));
Deno.test("#3872 author or caption mismatch is a hard fail", () => {
  assertEquals(
    verifyGigPost({ ...base, observedHandle: "other" }).result,
    "fail",
  );
  assertEquals(
    verifyGigPost({ ...base, caption: "no disclosure" }).result,
    "fail",
  );
});
Deno.test("#3872 blocked provider evidence is unknown, never pass", () =>
  assertEquals(
    verifyGigPost({
      ...base,
      observedHandle: null,
      caption: null,
      postedAt: null,
    }).result,
    "unknown",
  ));
Deno.test("#3872 unsupported URL and pre-shoot post fail", () => {
  assertEquals(
    verifyGigPost({ ...base, url: "https://example.com/post" }).result,
    "fail",
  );
  assertEquals(
    verifyGigPost({ ...base, postedAt: "2026-12-01T00:00:00Z" }).result,
    "fail",
  );
});
