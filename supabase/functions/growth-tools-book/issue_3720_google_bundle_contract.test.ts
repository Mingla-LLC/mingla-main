import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import { parseCalendarKeys } from "./index.ts";

Deno.test("#3720 extended Google bundle preserves Calendar's original three credentials", () => {
  const expected = { clientId: "calendar-id", clientSecret: "calendar-secret", refresh: "calendar-refresh" };
  assertEquals(parseCalendarKeys("calendar-id|calendar-secret|calendar-refresh"), expected);
  assertEquals(parseCalendarKeys("calendar-id|calendar-secret|calendar-refresh|opaque-drive-segment"), expected);
  assertEquals(parseCalendarKeys("calendar-id|calendar-secret"), null);
  assertEquals(parseCalendarKeys("calendar-id||calendar-refresh|opaque-drive-segment"), null);
});
