/**
 * issue #3281 PR7 — public event Head prefers next start for SEO tags.
 * [TEST-MOD-APPROVED #3281]
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test("PublicEventPage buyerStartAtUtc prefers nextStartAtUtc for meta tags", () => {
  const src = Deno.readTextFileSync(
    "mingla-business/src/components/event/PublicEventPage.tsx",
  );
  assertEquals(src.includes("buyerStartAtUtc"), true);
  assertEquals(src.includes("nextStartAtUtc"), true);
  assertEquals(src.includes('property="event:start_time"'), true);
  assertEquals(src.includes('itemProp="startDate"'), true);
  // Structured start tags must bind buyerStartAtUtc, not raw master only.
  assertEquals(
    /property="event:start_time"\s+content=\{buyerStartAtUtc\}/.test(src),
    true,
  );
  assertEquals(
    /itemProp="startDate"\s+content=\{buyerStartAtUtc\}/.test(src),
    true,
  );
});
