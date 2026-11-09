// #4339 calendar sync (Seth approved, 9 Nov) — growth-tools-calendar-sync with
// a mocked Google Calendar API, a mocked Resend and an in-memory database that
// applies changes the way book_call_apply_calendar_changes does.
//
//   CS-01 auth: no bearer, a wrong bearer and a GET are refused before any
//         database or Google call.
//   CS-02 moved: a booking event's new start moves the call (call_at is the new
//         time, original_call_at keeps the booked time); the stored
//         nextSyncToken is used by the next run; the same change again is a
//         no-op.
//   CS-03 cancelled: a cancelled event marks the call cancelled.
//   CS-04 declined: the booker's own "declined" (any letter case) marks it
//         declined; another guest declining does not.
//   CS-05 an unrelated event is ignored: never applied, and no title, guest or
//         id of it is logged; the listing asks Google only for id, status,
//         start and attendees.
//   CS-06 410 Gone: the stale syncToken is dropped and a full resync runs in
//         the same call, storing the new token.
//   CS-07 pages: a long listing is followed page by page, and a run that hits
//         its page cap stores the page token for the next run.
//   CS-08 a busy lease skips the run; a failed listing records the error and
//         keeps the token.
//   CS-09 notices: a cancelled call is emailed once to the "New Mingla call"
//         recipients; a failed send gives the claim back.
//
// FAILS-ON-REVERT: dropping start_at from eventChange fails CS-02; dropping
// `cancelled = event.status === "cancelled"` fails CS-03; dropping the bearer
// comparison in handleCalendarSync fails CS-01.
//
// Run: deno test --allow-env --allow-net --allow-read --no-check supabase/functions/growth-tools-calendar-sync/

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildListUrl,
  type CalendarChange,
  type ChangeNotice,
  eventChange,
  type FinishInput,
  handleCalendarSync,
  type SyncDb,
  type SyncDeps,
} from "./sync.ts";

const SERVICE_KEY = "service-role-test-key";
const KEYS = "client-id|client-secret|refresh-token";
const BOOKED = "2031-03-11T15:00:00.000Z";
const MOVED = "2031-03-12T17:20:00.000Z";

interface Lead {
  id: string;
  email: string;
  call_at: string;
  original_call_at: string | null;
  status: string;
}

/** The in-memory database: book_call_apply_calendar_changes' derivation. */
class FakeDb implements SyncDb {
  leads = new Map<string, Lead>();
  state = { sync_token: null as string | null, page_token: null as string | null, busy: false };
  finished: FinishInput[] = [];
  applied: CalendarChange[][] = [];
  bookingLookups: string[][] = [];
  notices: ChangeNotice[] = [];
  released: string[] = [];
  begins = 0;

  add(eventId: string, email: string, callAt = BOOKED) {
    this.leads.set(eventId, { id: `lead-${eventId}`, email, call_at: callAt, original_call_at: null, status: "booked" });
  }
  begin() {
    this.begins += 1;
    if (this.state.busy) return Promise.resolve({ busy: true });
    return Promise.resolve({ busy: false, sync_token: this.state.sync_token, page_token: this.state.page_token });
  }
  finish(input: FinishInput) {
    this.finished.push(input);
    this.state.sync_token = input.syncToken;
    this.state.page_token = input.pageToken;
    return Promise.resolve();
  }
  bookings(ids: string[]) {
    this.bookingLookups.push(ids);
    return Promise.resolve(ids.filter((id) => this.leads.has(id)).map((id) => ({ calendar_event_id: id, email: this.leads.get(id)!.email })));
  }
  apply(changes: CalendarChange[]) {
    this.applied.push(changes);
    let matched = 0;
    let updated = 0;
    for (const c of changes) {
      const lead = this.leads.get(c.event_id);
      if (!lead) continue;
      matched += 1;
      const callAt = !c.cancelled && c.start_at ? c.start_at : lead.call_at;
      const original = callAt !== lead.call_at ? lead.original_call_at ?? lead.call_at : lead.original_call_at;
      const status = c.cancelled ? "cancelled" : c.booker_declined ? "declined" : original && callAt !== original ? "moved" : "booked";
      if (callAt !== lead.call_at || status !== lead.status) {
        Object.assign(lead, { call_at: callAt, original_call_at: original, status });
        updated += 1;
      }
    }
    return Promise.resolve({ matched, updated });
  }
  claimNotices() {
    const out = this.notices;
    this.notices = [];
    return Promise.resolve(out);
  }
  releaseNotice(notice: ChangeNotice) {
    this.released.push(notice.id);
    return Promise.resolve();
  }
}

interface Google {
  pages: Array<{ status?: number; body?: unknown }>;
  listUrls: string[];
  emails: Array<{ to: string[]; subject: string; text: string }>;
  resendOk: boolean;
  tokenCalls: number;
}

function fakeFetch(google: Google): typeof fetch {
  return ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      google.tokenCalls += 1;
      return Promise.resolve(Response.json({ access_token: "google-access" }));
    }
    if (url.startsWith("https://www.googleapis.com/calendar/v3/calendars/")) {
      google.listUrls.push(url);
      const next = google.pages.shift();
      if (!next) return Promise.resolve(new Response("no more pages", { status: 500 }));
      return Promise.resolve(Response.json(next.body ?? {}, { status: next.status ?? 200 }));
    }
    if (url === "https://api.resend.com/emails") {
      const body = JSON.parse(String(init?.body));
      google.emails.push({ to: body.to, subject: body.subject, text: body.text });
      return Promise.resolve(google.resendOk ? Response.json({ id: "email" }) : new Response("nope", { status: 500 }));
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
}

function setup(pages: Google["pages"] = [], opts: { notify?: boolean; maxPages?: number } = {}) {
  const db = new FakeDb();
  const google: Google = { pages, listUrls: [], emails: [], resendOk: true, tokenCalls: 0 };
  const deps: SyncDeps = {
    serviceRoleKey: SERVICE_KEY,
    calendarKeysPacked: KEYS,
    calendarId: "primary",
    db,
    notify: opts.notify === false ? null : { resendKey: "resend-test", notifyTo: "seth@usemingla.com", timeZone: "America/New_York" },
    fetchImpl: fakeFetch(google),
    maxPages: opts.maxPages,
  };
  return { db, google, deps };
}

const cron = () =>
  new Request("http://localhost/growth-tools-calendar-sync", {
    method: "POST",
    headers: { authorization: `Bearer ${SERVICE_KEY}`, "content-type": "application/json" },
    body: "{}",
  });

async function captureLogs<T>(fn: () => Promise<T>): Promise<{ result: T; logs: string }> {
  const lines: string[] = [];
  const saved = { log: console.log, warn: console.warn, error: console.error };
  const grab = (...args: unknown[]) => lines.push(args.map(String).join(" "));
  console.log = grab;
  console.warn = grab;
  console.error = grab;
  try {
    return { result: await fn(), logs: lines.join("\n") };
  } finally {
    Object.assign(console, saved);
  }
}

// ── CS-01 ────────────────────────────────────────────────────────────────────
Deno.test("#4339 CS-01: a caller without the service role bearer is refused before any work", async () => {
  const { db, google, deps } = setup();
  for (const headers of [{}, { authorization: "Bearer not-the-key" }, { authorization: SERVICE_KEY }] as Record<string, string>[]) {
    const res = await handleCalendarSync(new Request("http://localhost/x", { method: "POST", headers, body: "{}" }), deps);
    assertEquals(res.status, 401);
    assertEquals(await res.json(), { error: "unauthorized" });
  }
  assertEquals((await handleCalendarSync(new Request("http://localhost/x"), deps)).status, 405);
  const unset = await handleCalendarSync(cron(), { ...deps, serviceRoleKey: "" });
  assertEquals(unset.status, 401, "no configured key refuses everyone");
  assertEquals(db.begins, 0);
  assertEquals(google.tokenCalls + google.listUrls.length, 0);
});

// ── CS-02 ────────────────────────────────────────────────────────────────────
Deno.test("#4339 CS-02: a new start moves the call; the next run resumes from the syncToken; repeating it changes nothing", async () => {
  const { db, google, deps } = setup([
    { body: { items: [{ id: "evt-move", status: "confirmed", start: { dateTime: "2031-03-12T13:20:00-04:00" } }], nextSyncToken: "sync-1" } },
    { body: { items: [{ id: "evt-move", status: "confirmed", start: { dateTime: "2031-03-12T13:20:00-04:00" } }], nextSyncToken: "sync-2" } },
  ]);
  db.add("evt-move", "booker@example.org");
  const first = await handleCalendarSync(cron(), deps);
  assertEquals(first.status, 200);
  const body = await first.json();
  assertEquals(body.bookings_updated, 1);
  assertEquals(body.full_sync, true);
  const lead = db.leads.get("evt-move")!;
  assertEquals(lead.call_at, MOVED, "call_at is the new time");
  assertEquals(lead.original_call_at, BOOKED, "the booked time is kept");
  assertEquals(lead.status, "moved");
  assertEquals(db.applied[0][0], { event_id: "evt-move", cancelled: false, start_at: MOVED, booker_declined: false });
  assertEquals(db.state.sync_token, "sync-1");
  assertEquals(db.finished[0].fullSync, true);
  assertEquals(db.finished[0].error, null);
  assert(!new URL(google.listUrls[0]).searchParams.has("syncToken"), "the first run is a full sync");

  const second = await handleCalendarSync(cron(), deps);
  assertEquals((await second.json()).bookings_updated, 0, "the same change again is a no-op");
  assertEquals(new URL(google.listUrls[1]).searchParams.get("syncToken"), "sync-1");
  assertEquals(db.state.sync_token, "sync-2");
  assertEquals(db.finished[1].fullSync, false);
  assertEquals(lead.call_at, MOVED);
});

// ── CS-03 ────────────────────────────────────────────────────────────────────
Deno.test("#4339 CS-03: a cancelled event marks the call cancelled and keeps its time", async () => {
  const { db, deps } = setup([{ body: { items: [{ id: "evt-cancel", status: "cancelled" }], nextSyncToken: "s" } }]);
  db.add("evt-cancel", "booker@example.org");
  const res = await handleCalendarSync(cron(), deps);
  assertEquals(res.status, 200);
  assertEquals(db.applied[0], [{ event_id: "evt-cancel", cancelled: true, start_at: null, booker_declined: false }]);
  assertEquals(db.leads.get("evt-cancel")!.status, "cancelled");
  assertEquals(db.leads.get("evt-cancel")!.call_at, BOOKED);
});

// ── CS-04 ────────────────────────────────────────────────────────────────────
Deno.test("#4339 CS-04: only the booker declining marks the call declined", async () => {
  const { db, deps } = setup([{
    body: {
      items: [
        {
          id: "evt-decline",
          status: "confirmed",
          start: { dateTime: BOOKED },
          attendees: [{ email: "info@usemingla.com", responseStatus: "accepted" }, { email: "Booker@Example.org", responseStatus: "declined" }],
        },
        {
          id: "evt-other-guest",
          status: "confirmed",
          start: { dateTime: BOOKED },
          attendees: [{ email: "info@usemingla.com", responseStatus: "declined" }, { email: "second@example.org", responseStatus: "accepted" }],
        },
      ],
      nextSyncToken: "s",
    },
  }]);
  db.add("evt-decline", "booker@example.org");
  db.add("evt-other-guest", "second@example.org");
  await handleCalendarSync(cron(), deps);
  assertEquals(db.leads.get("evt-decline")!.status, "declined");
  assertEquals(db.leads.get("evt-other-guest")!.status, "booked", "another guest declining is not the booker declining");
  assertEquals(eventChange({ id: "x", status: "cancelled", attendees: [{ email: "b@x.org", responseStatus: "declined" }] }, "b@x.org")?.booker_declined, false,
    "a cancelled event is cancelled, not declined");
});

// ── CS-05 ────────────────────────────────────────────────────────────────────
Deno.test("#4339 CS-05: an unrelated event is ignored and never logged", async () => {
  const { db, google, deps } = setup([{
    body: {
      items: [{
        id: "private-dentist-appt",
        status: "cancelled",
        summary: "Dentist with Dr Secret",
        start: { dateTime: MOVED },
        attendees: [{ email: "secret.person@private.org", responseStatus: "declined" }],
      }],
      nextSyncToken: "s",
    },
  }]);
  const { result, logs } = await captureLogs(() => handleCalendarSync(cron(), deps));
  assertEquals(result.status, 200);
  assertEquals(db.applied.length, 0, "nothing is applied for an event that is not a booking");
  assertEquals(db.bookingLookups, [["private-dentist-appt"]], "only the id is asked about");
  for (const secret of ["Dentist", "Dr Secret", "secret.person", "private-dentist-appt"]) {
    assert(!logs.includes(secret), `the logs never carry ${secret}`);
  }
  const fields = new URL(google.listUrls[0]).searchParams.get("fields") ?? "";
  assertEquals(fields, "items(id,status,start,attendees(email,responseStatus)),nextPageToken,nextSyncToken");
  assert(!fields.includes("summary") && !fields.includes("description"), "the title is never requested");
  assertEquals(new URL(google.listUrls[0]).searchParams.get("showDeleted"), "true");
});

// ── CS-06 ────────────────────────────────────────────────────────────────────
Deno.test("#4339 CS-06: 410 Gone drops the stale token and runs a full resync in the same call", async () => {
  const { db, google, deps } = setup([
    { status: 410, body: { error: { code: 410, message: "Sync token is no longer valid" } } },
    { body: { items: [{ id: "evt-cancel", status: "cancelled" }], nextSyncToken: "fresh-token" } },
  ]);
  db.state.sync_token = "stale-token";
  db.add("evt-cancel", "booker@example.org");
  const res = await handleCalendarSync(cron(), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.resynced, true);
  assertEquals(body.full_sync, true);
  assertEquals(new URL(google.listUrls[0]).searchParams.get("syncToken"), "stale-token");
  assert(!new URL(google.listUrls[1]).searchParams.has("syncToken"), "the resync has no token");
  assertEquals(db.state.sync_token, "fresh-token");
  assertEquals(db.finished.at(-1)!.fullSync, true);
  assertEquals(db.leads.get("evt-cancel")!.status, "cancelled", "changes found by the resync are applied");

  const twice = setup([{ status: 410 }, { status: 410 }]);
  twice.db.state.sync_token = "stale";
  const failed = await handleCalendarSync(cron(), twice.deps);
  assertEquals(failed.status, 502);
  assertEquals(twice.db.finished.at(-1)!.error, "sync_token_gone_twice");
  assertEquals(twice.db.state.sync_token, null, "a token Google refused is never kept");
});

// ── CS-07 ────────────────────────────────────────────────────────────────────
Deno.test("#4339 CS-07: pages are followed, and a run at its page cap resumes next time", async () => {
  const { db, google, deps } = setup([
    { body: { items: [{ id: "a", status: "confirmed" }], nextPageToken: "p2" } },
    { body: { items: [{ id: "evt-cancel", status: "cancelled" }], nextPageToken: "p3" } },
    { body: { items: [], nextSyncToken: "done" } },
  ], { maxPages: 2 });
  db.add("evt-cancel", "booker@example.org");
  const first = await (await handleCalendarSync(cron(), deps)).json();
  assertEquals(first.pages, 2);
  assertEquals(first.complete, false);
  assertEquals(db.state.page_token, "p3", "the page token is stored for the next run");
  assertEquals(db.state.sync_token, null);
  assertEquals(db.finished[0].fullSync, false, "a full sync is only recorded once complete");
  assertEquals(new URL(google.listUrls[1]).searchParams.get("pageToken"), "p2");
  const second = await (await handleCalendarSync(cron(), deps)).json();
  assertEquals(new URL(google.listUrls[2]).searchParams.get("pageToken"), "p3");
  assertEquals(second.complete, true);
  assertEquals(db.state.sync_token, "done");
  assertEquals(db.state.page_token, null);
  assertEquals(db.finished[1].fullSync, true);
  assertEquals(db.leads.get("evt-cancel")!.status, "cancelled");
  assertStringIncludes(buildListUrl("team@group.calendar.google.com", "s", "p"), "/calendars/team%40group.calendar.google.com/events?");
});

// ── CS-08 ────────────────────────────────────────────────────────────────────
Deno.test("#4339 CS-08: a busy run is skipped; a failed listing records the error and keeps the token", async () => {
  const busy = setup();
  busy.db.state.busy = true;
  const skipped = await handleCalendarSync(cron(), busy.deps);
  assertEquals(await skipped.json(), { ok: true, skipped: "busy" });
  assertEquals(busy.google.tokenCalls, 0);

  const failing = setup([{ status: 500, body: {} }]);
  failing.db.state.sync_token = "keep-me";
  const res = await handleCalendarSync(cron(), failing.deps);
  assertEquals(res.status, 502);
  assertEquals(failing.db.finished[0].error, "list_failed:500");
  assertEquals(failing.db.state.sync_token, "keep-me");

  const unconfigured = setup();
  const noKeys = await handleCalendarSync(cron(), { ...unconfigured.deps, calendarKeysPacked: "" });
  assertEquals(noKeys.status, 503);
  assertEquals(unconfigured.db.begins, 0);
});

// ── CS-09 ────────────────────────────────────────────────────────────────────
const NOTICE: ChangeNotice = {
  id: "lead-1",
  notice_key: "cancelled",
  previous_key: null,
  status: "cancelled",
  audience: "creator",
  name: "Ada Okafor",
  venue: null,
  call_at: BOOKED,
  original_call_at: null,
  booker_time_zone: "Africa/Lagos",
  event_url: "https://calendar.google.com/event?eid=x",
};

Deno.test("#4339 CS-09: a cancelled call is emailed once to the New Mingla call recipients; a failed send gives the claim back", async () => {
  const { db, google, deps } = setup([{ body: { items: [], nextSyncToken: "s" } }]);
  db.notices = [NOTICE];
  const body = await (await handleCalendarSync(cron(), deps)).json();
  assertEquals(body.notices_sent, 1);
  assertEquals(google.emails.length, 1);
  assertEquals(google.emails[0].to, ["seth@usemingla.com", "info@usemingla.com"]);
  assertStringIncludes(google.emails[0].subject, "Call cancelled");
  assertStringIncludes(google.emails[0].subject, "Creator call: Ada Okafor");
  assertStringIncludes(google.emails[0].text, "was cancelled in Google Calendar");
  assertEquals(db.released, []);

  const failing = setup([{ body: { items: [], nextSyncToken: "s" } }]);
  failing.google.resendOk = false;
  failing.db.notices = [{ ...NOTICE, status: "moved", notice_key: `moved@${MOVED}`, call_at: MOVED, original_call_at: BOOKED }];
  const failed = await (await handleCalendarSync(cron(), failing.deps)).json();
  assertEquals(failed.notices_failed, 1);
  assertEquals(failing.db.released, ["lead-1"], "the claim is given back for the next run");
  assertStringIncludes(failing.google.emails[0].subject, "Call moved");

  const quiet = setup([{ body: { items: [], nextSyncToken: "s" } }], { notify: false });
  quiet.db.notices = [NOTICE];
  await handleCalendarSync(cron(), quiet.deps);
  assertEquals(quiet.google.emails.length, 0, "no Resend key: nothing is claimed or sent");
  assertEquals(quiet.db.notices.length, 1);
});
