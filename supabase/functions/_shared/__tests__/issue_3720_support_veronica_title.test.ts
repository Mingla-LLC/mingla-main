/**
 * #3720 — notify-support staff→host push title uses the actual sender name.
 * Source contract (Deno); fails if the title branch is removed.
 */
// Match notify-support's Deno std pin (0.168.0), not a second std major.
import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { SUPPORT_HOST_FACING_AGENT } from "../supportHostFacing.ts";

Deno.test("#3720 neutral Support fallback is approved", () => {
  // [TEST-MOD-APPROVED #3720] Wave 2 removes the fictional Support identity.
  assertEquals(SUPPORT_HOST_FACING_AGENT, "Mingla Support");
});

Deno.test("#3720 notify-support prefers the actual staff display name", () => {
  const src = Deno.readTextFileSync(
    new URL("../../notify-support/index.ts", import.meta.url),
  );
  assertStringIncludes(src, "SUPPORT_HOST_FACING_AGENT");
  assertStringIncludes(src, "senderDisplayName");
  assertStringIncludes(src, "senderIsStaff === true");
  assertStringIncludes(src, "${supportSender} replied");
});
