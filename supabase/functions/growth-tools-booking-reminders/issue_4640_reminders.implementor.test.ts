import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { reminderEmail, type ReminderJob } from "./index.ts";

const JOB: ReminderJob = {
  id: "46400000-0000-4000-8000-000000000010",
  booking_id: "46400000-0000-4000-8000-000000000011",
  kind: "24h",
  name: "Ada Host",
  email: "ada@example.com",
  call_at: "2026-12-02T15:00:00.000Z",
  booker_time_zone: "Africa/Lagos",
  meet_url: "https://meet.google.com/abc-defg-hij",
  venue: "Ada Hall",
  audience: "host",
};

Deno.test("#4640 each reminder says when, includes the first-party call link and replies to support", () => {
  for (const kind of ["24h", "2h", "15m"] as const) {
    const email = reminderEmail({ ...JOB, kind });
    assertEquals(email.to, [JOB.email]);
    assertStringIncludes(email.text, "Wednesday, December 2");
    assertStringIncludes(email.text, JOB.meet_url!);
    assertStringIncludes(email.html, "Join the video call");
    assert(email.replyTo?.endsWith("@usemingla.com"));
  }
});

Deno.test("#4640 no Meet link produces an honest calendar-invite reminder", () => {
  const email = reminderEmail({ ...JOB, meet_url: null, kind: "15m" });
  assert(!email.html.includes("Join the video call"));
  assertStringIncludes(email.text, "Reply if your plans changed.");
});
