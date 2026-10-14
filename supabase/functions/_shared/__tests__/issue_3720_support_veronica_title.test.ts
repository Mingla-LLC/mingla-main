/**
 * #3720 — notify-support staff→host push title uses Veronica.
 * Source contract (Deno); fails if the title branch is removed.
 */
// Match notify-support's Deno std pin (0.168.0), not a second std major.
import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { SUPPORT_HOST_FACING_AGENT } from "../supportHostFacing.ts";

Deno.test("#3720 Veronica constant is the approved host-facing name", () => {
  assertEquals(SUPPORT_HOST_FACING_AGENT, "Veronica from Mingla");
});

Deno.test("#3720 notify-support source pins Veronica staff reply title", () => {
  const src = Deno.readTextFileSync(
    new URL("../../notify-support/index.ts", import.meta.url),
  );
  assertStringIncludes(src, "SUPPORT_HOST_FACING_AGENT");
  assertStringIncludes(src, "senderIsStaff === true");
  assertStringIncludes(src, "${SUPPORT_HOST_FACING_AGENT} replied");
});
