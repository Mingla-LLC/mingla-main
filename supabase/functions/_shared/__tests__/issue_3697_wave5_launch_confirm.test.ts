/**
 * toward #3697 Wave 5 — challenge-based LAUNCH (#3704).
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  isLaunchConfirmPhrase,
  LAUNCH_CONFIRM_PHRASE,
} from "../adLaunchConfirm.ts";

Deno.test("LAUNCH confirm phrase is exactly LAUNCH", () => {
  assertEquals(LAUNCH_CONFIRM_PHRASE, "LAUNCH");
  assertEquals(isLaunchConfirmPhrase("LAUNCH"), true);
  assertEquals(isLaunchConfirmPhrase("launch"), false);
  assertEquals(isLaunchConfirmPhrase("LAUNCH "), false);
  assertEquals(isLaunchConfirmPhrase(""), false);
  assertEquals(isLaunchConfirmPhrase(null), false);
  assertEquals(isLaunchConfirmPhrase(undefined), false);
  assertEquals(isLaunchConfirmPhrase({ phrase: "LAUNCH" }), false);
});

Deno.test("admin-ad-campaign-action fail-closes launch without confirm_phrase", async () => {
  const src = await Deno.readTextFile(
    new URL("../../admin-ad-campaign-action/index.ts", import.meta.url),
  );
  assertEquals(src.includes("isLaunchConfirmPhrase"), true);
  assertEquals(src.includes("launch_confirm_required"), true);
  assertEquals(src.includes("confirm_phrase_must_be_LAUNCH"), true);
  assertEquals(src.includes("reason_required"), true);
  // Pause must not require the challenge.
  assertEquals(src.includes('action === "launch" && !isLaunchConfirmPhrase'), true);
});
