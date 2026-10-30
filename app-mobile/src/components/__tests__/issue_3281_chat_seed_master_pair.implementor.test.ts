/**
 * issue #3281 PR7 — chat publicCard keeps the true master pair.
 * [TEST-MOD-APPROVED #3281]
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test("chat seed maps master end from master_end_at, not next_end_at", () => {
  const src = Deno.readTextFileSync(
    "app-mobile/src/components/ConnectionsPage.tsx",
  );
  // Separated nights must not cross-pair master start with next end.
  assertEquals(
    /masterEndAtUtc:\s*event\.master_end_at/.test(src),
    true,
  );
  assertEquals(
    /masterEndAtUtc:\s*event\.next_end_at/.test(src),
    false,
  );
  assertEquals(src.includes("nextStartAtUtc: event.next_start_at"), true);
  assertEquals(src.includes("nextEndAtUtc: event.next_end_at"), true);
  // Brand-channel fold must order by next occurrence, not past master.
  assertEquals(src.includes("eventMeta?.publicCard?.nextStartAtUtc"), true);
  assertEquals(src.includes("eventMeta?.publicCard?.nextEndAtUtc"), true);
});
