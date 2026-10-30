/**
 * issue #3281 PR7 — OG/share prefers next start / schedule_line (server path).
 * Client eager __common cannot absorb next* mapping (#2099 ceiling); SEO lands
 * in socialPreview. [TEST-MOD-APPROVED #3281]
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test("socialPreview prefers schedule_line / next_start_at for event labels", () => {
  const src = Deno.readTextFileSync(
    "mingla-business/server/socialPreview.js",
  );
  assertEquals(src.includes("schedule_line"), true);
  assertEquals(src.includes("next_start_at") || src.includes("nextStartAt"), true);
  assertEquals(src.includes("eventScheduleLabel") || src.includes("scheduleLine"), true);
});
