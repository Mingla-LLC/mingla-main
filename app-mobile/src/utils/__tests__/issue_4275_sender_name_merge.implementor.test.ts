// Issue #4275 P3-A(2) — a failed name read never replaces a known name.
//
// A failed sender-name read gives "Unknown" (or nothing). mergeMessages is the one
// writer of a chat's list, in memory and from the persisted chat cache, so the rule
// lives there.
//
// FAILS-ON-REVERT: remove the senderName line from overlay in mergeMessages.ts and
// the first two tests fail.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { UNKNOWN_SENDER_NAME, mergeMessages } from "../mergeMessages.ts";

type Row = { id: string; timestamp: string; senderName?: string; content?: string };
const row = (senderName: string | undefined, content = "hi"): Row => ({ id: "m1", timestamp: "2026-01-01T00:00:00Z", senderName, content });

Deno.test("Unknown or empty from a failed read keeps the known name, and the rest of the row still updates", () => {
  for (const failed of [UNKNOWN_SENDER_NAME, "", "  "]) {
    const merged = mergeMessages([row("Stored Name")], [row(failed, "edited")]);
    assertEquals(merged[0].senderName, "Stored Name", `kept over ${JSON.stringify(failed)}`);
    assertEquals(merged[0].content, "edited");
  }
});

Deno.test("the persisted cache's name survives a refresh that could not read names", () => {
  const persisted = [row("Persisted Name")];
  const refreshed = mergeMessages(persisted, [row(UNKNOWN_SENDER_NAME)], { snapshot: { complete: true } });
  assertEquals(refreshed[0].senderName, "Persisted Name");
});

Deno.test("a real name still replaces Unknown, and a changed name still updates", () => {
  assertEquals(mergeMessages([row(UNKNOWN_SENDER_NAME)], [row("Real Name")])[0].senderName, "Real Name");
  assertEquals(mergeMessages([row("Old Name")], [row("New Name")])[0].senderName, "New Name");
  assertEquals(mergeMessages([], [row(UNKNOWN_SENDER_NAME)])[0].senderName, UNKNOWN_SENDER_NAME, "with nothing known, Unknown shows");
});
