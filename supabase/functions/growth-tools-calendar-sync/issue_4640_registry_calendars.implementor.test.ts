import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildNoticeEmail,
  handleCalendarRegistrySync,
  loadCalendarSyncProfiles,
  type SyncDb,
} from "./sync.ts";

Deno.test("#4640 each change notice uses its own scheduler destination and time zone", () => {
  const email = buildNoticeEmail({
    id: "lead-1",
    notice_key: "cancelled",
    previous_key: null,
    status: "cancelled",
    audience: "host",
    name: "Amara Okafor",
    venue: "Ark Lounge",
    call_at: "2026-11-30T08:20:00Z",
    original_call_at: null,
    booker_time_zone: "Africa/Lagos",
    event_url: null,
    notify_to: "kunle@usemingla.com",
    scheduler_time_zone: "Africa/Lagos",
  }, {
    notifyTo: "seth@usemingla.com",
    timeZone: "America/New_York",
  });
  assertEquals(email.to, ["kunle@usemingla.com", "info@usemingla.com"]);
  assertEquals(email.subject.includes("9:20 AM GMT+1"), true);
});

Deno.test("#4640 enabled scheduler profiles become distinct calendar sync lanes", async () => {
  const profiles = await loadCalendarSyncProfiles(
    {
      supabaseUrl: "https://example.supabase.co",
      serviceKey: "service-key",
      defaultCalendarId: "shared@example.com",
      defaultNotifyTo: "seth@usemingla.com",
      defaultTimeZone: "America/New_York",
    },
    (() =>
      Promise.resolve(Response.json([
        {
          calendar_id: "environment-default",
          notify_to: "seth@usemingla.com",
          time_zone: "America/New_York",
        },
        {
          calendar_id: "environment-default",
          notify_to: "kunle@usemingla.com",
          time_zone: "Africa/Lagos",
        },
        {
          calendar_id: "lagos@example.com",
          notify_to: "kunle@usemingla.com",
          time_zone: "Africa/Lagos",
        },
      ]))) as typeof fetch,
  );
  assertEquals(profiles, [
    {
      calendarId: "shared@example.com",
      notifyTo: "seth@usemingla.com",
      timeZone: "America/New_York",
    },
    {
      calendarId: "lagos@example.com",
      notifyTo: "kunle@usemingla.com",
      timeZone: "Africa/Lagos",
    },
  ]);
});

Deno.test("#4640 registry sync authenticates before touching any calendar", async () => {
  let began = 0;
  const db: SyncDb = {
    begin: () => {
      began += 1;
      return Promise.resolve({ busy: false });
    },
    finish: () => Promise.resolve(),
    bookings: () => Promise.resolve([]),
    apply: () => Promise.resolve({ matched: 0, updated: 0 }),
    claimNotices: () => Promise.resolve([]),
    releaseNotice: () => Promise.resolve(),
  };
  const res = await handleCalendarRegistrySync(
    new Request("http://local", { method: "POST" }),
    {
      serviceRoleKey: "secret",
      calendarKeysPacked: "",
      profiles: [{
        calendarId: "lagos@example.com",
        notifyTo: "kunle@usemingla.com",
        timeZone: "Africa/Lagos",
      }],
      db,
      resendKey: "",
    },
  );
  assertEquals(res.status, 401);
  assertEquals(began, 0);
});
