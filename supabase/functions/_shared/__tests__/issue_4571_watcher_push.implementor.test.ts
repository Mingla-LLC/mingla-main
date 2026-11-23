// #4571 W3 — a host or creator card's watcher hears about a stage move. The
// server queues business.team_mention with source_kind crm_record and the
// record's name (crm_notify_watchers, 20281126034571); the push title names
// who moved which card, never "mentioned you".
//
// FAILS-ON-REVERT: removing the crm_record branch from renderTeamMessage in
// teamNotifications.ts makes the title "Kunle mentioned you" (both tests red).
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { renderTeamMessage } from "../teamNotifications.ts";

Deno.test("#4571 W3: a watcher's push names who moved which card", () => {
  const out = renderTeamMessage("business.team_mention", {
    source_kind: "crm_record", reason: "work_update", team_sender: "Kunle",
    record_name: "Island Vinyl", team_excerpt: "Kunle moved Island Vinyl to Replied",
  });
  assertEquals(out.push.title, "Kunle moved Island Vinyl");
  assertEquals(out.push.body, "Kunle moved Island Vinyl to Replied");
});

Deno.test("#4571 W3: with no record name the title still says a watched card moved", () => {
  const out = renderTeamMessage("business.team_mention", { source_kind: "crm_record", team_sender: "Kunle" });
  assertEquals(out.push.title, "Kunle moved a card you watch");
});
