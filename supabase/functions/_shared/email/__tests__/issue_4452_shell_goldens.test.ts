// #4452 T-5.9 / SC-83 (rework 1, P1-8): one golden HTML file per email template, rendered
// through each public render entry with fixed inputs, a frozen clock and a seeded random.
// Any unreviewed change to a template fails here.
//
//   Review a change:  GOLDEN_UPDATE=1 deno test -A _shared/email/__tests__/issue_4452_shell_goldens.test.ts
//   then read the diff under _shared/email/__tests__/goldens/issue_4452/ before committing.
//
// G-1  every template matches its golden.
// G-2  SC-83: the rebranded frame (paper #F5F4F0 body, the logo pill PNG, the Instrument Serif headline).
// G-3  a11y on every shell document: lang, role="presentation" on every layout table, alt on every
//      img, and button text contrast >= 4.5.
// G-5  P2-B: every text colour in every shell document reads at >= 4.5:1 on both the white card and
//      the paper footer (WCAG AA for body-size text).
// G-4  SC-86: a booked-call confirmation carries the app button only (no call button); a tool report
//      and a form welcome carry both; a team alert carries none.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { FakeTime } from "https://deno.land/std@0.224.0/testing/time.ts";

Deno.env.set("DENO_TESTING", "1");
Deno.env.set("MINGLA_LOGO_URL", "https://usemingla.com/brand/email/mingla-wordmark-email.png");
Deno.env.set("MINGLA_FOOTER_ADDRESS", "Mingla, hello@usemingla.com");
Deno.env.set("RESEND_TICKET_FROM", "Mingla <tickets@usemingla.com>");
Deno.env.set("RESEND_ADMIN_FROM", "Mingla <hello@usemingla.com>");
Deno.env.set("RESEND_SYSTEM_FROM", "Mingla <notifications@usemingla.com>");

const { renderTransactionalEmail } = await import("../index.ts");
const { renderShell } = await import("../shell.ts");
const { renderEventUpdatedEmail } = await import("../eventUpdatedEmail.ts");
const { renderContactCodeEmail } = await import("../contactCodeEmail.ts");
const { renderFollowConfirmEmail, renderFollowConfirmedEmail, renderFollowInviteEmail } = await import("../followByEmailBodies.ts");
const { buildInviteEmail } = await import("../../brandInviteEmail.ts");
const { renderMarketingEmail } = await import("../../marketingEmailRender.ts");
const { buildRsvpPassMessage } = await import("../../rsvpPassMessage.ts");
const { buildApplicantEmail, buildNotifyEmail } = await import("../../../careers-apply/index.ts");
const { buildToolReportEmail, TOOL_ICP } = await import("../../../growth-tools-gate/toolEmail.ts");
const { buildNoticeEmail } = await import("../../../growth-tools-calendar-sync/sync.ts");
const { renderBookingConfirmation } = await import("../../../growth-tools-book/bookingConfirmation.ts");
const { sendBookingEmails } = await import("../../../growth-tools-book/index.ts");
const { parseBookingContext } = await import("../../../growth-tools-book/bookingContext.ts");
const { renderFormEmail } = await import("../../../forms-automation-sender/sender.ts");

const DIR = new URL("./goldens/issue_4452/", import.meta.url);
const UPDATE = Deno.env.get("GOLDEN_UPDATE") === "1";
const NOW = Date.UTC(2026, 10, 16, 15, 0, 0);
const LOGO = "https://usemingla.com/brand/email/mingla-wordmark-email.png";

/** Every render runs with the same frozen clock and a seeded random. */
async function frozen<T>(fn: () => T | Promise<T>): Promise<T> {
  const fake = new FakeTime(NOW);
  const random = Math.random;
  let seed = 4452;
  Math.random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  try {
    return await fn();
  } finally {
    Math.random = random;
    fake.restore();
  }
}

// ---------------------------------------------------------------------------
// Fixtures
const fixes3 = [
  { title: "Add a Book button above the fold", change: "Most visitors are on phones.", impact: "high", effort: "this_week" },
  { title: "Make the site load in under 2 seconds", change: "It takes 4.8 seconds on a phone today.", impact: "medium", effort: "this_month" },
  { title: "Put the menu in text, not a PDF", change: "Google can read it.", impact: "medium", effort: "project" },
];
const TOOL_REPORTS = {
  venues: { venue: { name: "Angus Barn" }, scores: { overall: 74, grade: "B" }, percentile: { city: "Raleigh", better_than_pct: 75 }, site_signals: { checks: [{ status: "fail" }, { status: "pass" }] }, fixes: fixes3 },
  events: { event: { title: "Afrobeats Rooftop Sessions", currency: "NGN" }, forecast: { total_low: 280, total_high: 340, capacity: 400, confidence: "medium" }, plan: { kind: "paid_optimized", currency: "NGN", ads_worth_it: true, recommended_budget: 180000 }, competitors: [{}, {}, {}], fixes: fixes3 },
  trips: { trip: { title: "Marrakech, 4 nights", destination: "Marrakech", days: 5, group_size: 10, currency: "USD" }, plan: { currency: "USD", recommended_price_per_person: 1240, recommended_margin_pct: 18, group_profit: 2232, cost_lines: [{ per_person: 600 }, { per_person: 400 }] }, fixes: fixes3 },
  experiences: { experience: { description: "Pasta supper club", currency: "GBP" }, audit: { currency: "GBP", verdict: "underpriced", extra_per_head: 14, cost_per_head: 31, recommended_price: 49, monthly_upside: 672 }, comps: [{ price_pp: 45 }, { price_pp: 60 }], fixes: fixes3 },
} as const;

function formGate(kind: "confirmation" | "follow_up" | "team_alert") {
  return {
    action: "send", send_id: `4452e000-0000-4000-8000-0000000000${kind === "confirmation" ? "a1" : kind === "follow_up" ? "a2" : "a3"}`,
    run_id: "4452e000-0000-4000-8000-0000000000bb", attempts: 1, email_kind: kind, to: "ada@example.org", is_test: false,
    step: kind === "team_alert"
      ? { id: "t1", type: "email", to: "owner", from: "creators", subject: "", include_answers: true }
      : {
        id: kind === "confirmation" ? "c0" : "s2", type: "email", from: "creators",
        subject: kind === "confirmation" ? "Welcome, {first_name}" : "Your first gig, {first_name}", action_bar: "auto",
        doc: [{ type: "paragraph", text: kind === "confirmation" ? "Thanks for applying. We read every one." : "Book a 20-minute call and we'll find your first gig." }],
        show_answers: kind === "confirmation",
      },
    person: { email: "ada@example.org", name: "Ada Okafor", answers: { what_do_you_make: "Video", city: { label: "Lagos" } }, page: "/creators", spot: "after-hero",
      utm_source: "instagram", utm_campaign: "creators-nov", label: "creator", ads_allowed: true, click_source: "meta", time_zone: "Africa/Lagos" },
    form: { id: "f", key: "creators-join", name: "Creators: join", audience: "creator", fields: [
      { key: "name", type: "name", label: "Your name" }, { key: "email", type: "email", label: "Email" },
      { key: "what_do_you_make", type: "single", label: "What do you make?" }, { key: "city", type: "dropdown", label: "Your city" },
    ] },
  };
}

function ticketReceipt() {
  return renderTransactionalEmail({
    variant: "ticket_confirmation_paid",
    recipient: { name: "Buyer", email: "buyer@example.com" },
    body: {
      variant: "ticket_confirmation_paid",
      event: { title: "Sunset Sail", coverMediaUrl: "https://cdn.usemingla.com/events/sunset.jpg", coverMediaType: "image", locationText: "Brighton Marina",
        isOnline: false, startAt: "2026-06-12T18:00:00Z", endAt: "2026-06-12T20:00:00Z", timezone: "Europe/London" },
      brand: { name: "Coastline Co", profilePhotoUrl: null },
      order: { id: "order_fixture_123", shortId: "abcd1234", totalCents: 5000, currency: "GBP", buyerName: "Buyer Name",
        lineItems: [{ ticketName: "General", quantity: 2, unitPriceCents: 2500, totalCents: 5000 }],
        tickets: [{ ticketId: "t1", ticketName: "General" }, { ticketId: "t2", ticketName: "General" }] },
    },
  } as never).html;
}

/** The two emails growth-tools-book sends, captured from the real send path. */
async function bookingEmails(): Promise<{ booker: string; team: string }> {
  const saved = Deno.env.get("RESEND_API_KEY");
  Deno.env.set("RESEND_API_KEY", "re-local");
  const realFetch = globalThis.fetch;
  const sent: Array<{ to: string[]; html: string }> = [];
  globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)));
    return Promise.resolve(Response.json({ id: "re_local" }));
  }) as typeof fetch;
  try {
    const parsed = parseBookingContext({ audience: "host", icp: "events", social_platform: "instagram", social_handle: "afrobeatsrooftop", website: "https://afrobeats.example" });
    assert(parsed.ok);
    await sendBookingEmails({
      startMs: Date.UTC(2026, 10, 19, 16, 0, 0), name: "Ada Okafor", email: "ada@example.org", venue: "Rooftop Lagos",
      reportUrl: "https://usemingla.com/tools/events/report?id=r1&t=tok", source: "tool_events", context: parsed.context,
      timeZone: "Africa/Lagos", meetUrl: "https://meet.google.com/abc-defg-hij", eventUrl: null,
    } as never);
  } finally {
    globalThis.fetch = realFetch;
    saved === undefined ? Deno.env.delete("RESEND_API_KEY") : Deno.env.set("RESEND_API_KEY", saved);
  }
  assertEquals(sent.length, 2, "the booker confirmation and the team notice");
  const booker = sent.find((s) => s.to.includes("ada@example.org"));
  const team = sent.find((s) => !s.to.includes("ada@example.org"));
  assert(booker && team);
  return { booker: booker.html, team: team.html };
}

const notice = (status: "moved" | "cancelled") => buildNoticeEmail({
  id: "n1", notice_key: "k1", previous_key: null, status, audience: "creator", name: "Ada Okafor", venue: null,
  call_at: "2026-11-20T15:00:00Z", original_call_at: status === "moved" ? "2026-11-19T15:00:00Z" : null,
  booker_time_zone: "Africa/Lagos", event_url: "https://calendar.google.com/event?eid=abc",
}, { notifyTo: "seth@usemingla.com", timeZone: "America/New_York" }).html;

function toolEmail(tool: keyof typeof TOOL_REPORTS): string {
  const built = buildToolReportEmail({ tool, report: TOOL_REPORTS[tool] as unknown as Record<string, unknown>,
    reportLink: `https://usemingla.com/tools/${tool}/report?id=r1&t=tok`, tips: true });
  // The same composition as growth-tools-gate/index.ts.
  return renderShell({ preheader: built.preheader, bodyHtml: built.bodyHtml, label: built.label,
    actionBar: { kind: "host", icp: TOOL_ICP[tool] }, supportEmail: "support@usemingla.com", logoUrl: LOGO,
    footerAddress: "Mingla, hello@usemingla.com" });
}

const formDeps = { signUnsubscribe: () => Promise.resolve("TOKEN"), trackBase: "https://local-test.supabase.invalid/functions/v1/forms-track", env: () => undefined };

const TEMPLATES: Array<[string, () => string | Promise<string>]> = [
  ["booking_confirmation_host", () => renderBookingConfirmation({ when: "Thursday, November 19 at 11:00 AM EST", meetUrl: "https://meet.google.com/abc-defg-hij", audience: "host", supportEmail: "support@usemingla.com", logoUrl: LOGO, footerAddress: "Mingla, hello@usemingla.com" }).html],
  ["booking_confirmation_creator", () => renderBookingConfirmation({ when: "Thursday, November 19 at 11:00 AM EST", meetUrl: null, audience: "creator", supportEmail: "support@usemingla.com", logoUrl: LOGO, footerAddress: "Mingla, hello@usemingla.com" }).html],
  ["booking_confirmation_local", () => renderBookingConfirmation({ when: "Thursday, November 19 at 11:00 AM EST", meetUrl: null, audience: "local", supportEmail: "support@usemingla.com", logoUrl: LOGO, footerAddress: "Mingla, hello@usemingla.com" }).html],
  ["booking_send_path_booker", async () => (await bookingEmails()).booker],
  ["booking_team_notify", async () => (await bookingEmails()).team],
  ["calendar_moved", () => notice("moved")],
  ["calendar_cancelled", () => notice("cancelled")],
  ["tool_report_venues", () => toolEmail("venues")],
  ["tool_report_events", () => toolEmail("events")],
  ["tool_report_trips", () => toolEmail("trips")],
  ["tool_report_experiences", () => toolEmail("experiences")],
  ["ticket_receipt", () => ticketReceipt()],
  ["purchase_body", () => renderTransactionalEmail({ variant: "purchase_message", recipient: { name: "Amara Okafor", email: "amara@example.test" },
    body: buildRsvpPassMessage({ reason: "going", guest: false, title: "Bachata Takeover", brandName: "Bachata Lagos", recipientName: "Amara Okafor",
      recipientEmail: "amara@example.test", recipientPhoneLast4: "0123", leadName: null, claimed: false, buttonUrl: "https://usemingla.com/c/AB12CD34EF",
      smsLink: "usemingla.com/c/AB12CD34EF", date: "Sat 25 Oct", time: "7:30 PM", when: "Sat 25 Oct, 7:30 PM" } as never).body } as never).html],
  ["generic_adapter", () => renderTransactionalEmail({ variant: "generic_notification", recipient: { name: null, email: "ada@example.org" },
    body: { variant: "generic_notification", title: "Your payout is on its way", paragraphs: ["We sent ₦120,000 to your bank.", "It usually lands within a day."], cta: null } } as never).html],
  ["event_updated", () => renderEventUpdatedEmail({ kind: "event", eventName: "Sunset Sessions: Lagos Rooftop Supper", brandName: "Casa Lenta Retreats",
    recipientName: "Adaeze", timezone: "Africa/Lagos", reason: "The original venue has a power fault, so we have moved nearby.",
    eventUrl: "https://host.usemingla.com/e/casa-lenta/sunset-sessions",
    changes: [{ field: "venue", old: "Waterside Event Centre", new: "The Deck at Landmark" }] } as never).html],
  ["contact_code", () => renderContactCodeEmail({ code: "042731", supportEmail: "support@usemingla.com", logoUrl: LOGO, footerAddress: "Mingla, Raleigh, NC",
    sender: { name: "Mingla", address: "noreply@usemingla.com" } } as never).html],
  ["follow_confirm", () => renderFollowConfirmEmail({ brandName: "Lantern Room", confirmUrl: "https://example.test/confirm/tok" }).html],
  ["follow_confirmed", () => renderFollowConfirmedEmail({ brandName: "Lantern Room", brandUrl: "https://host.usemingla.com/b/lanternroom" }).html],
  ["follow_invite", () => renderFollowInviteEmail({ brandName: "Lantern Room", oneLinkUrl: "https://go.usemingla.com/w36m?deep_link_value=follow_invite" }).html],
  ["brand_invite", () => buildInviteEmail({ inviteeName: "Tunde", inviteeEmail: "tunde@example.com", brandName: "Acme Events", inviterName: "Seth",
    role: "event_manager", acceptUrl: "https://host.usemingla.com/accept-brand-invitation?token=abc.def", from: "Mingla <noreply@usemingla.com>" }).html],
  ["marketing_email", () => renderMarketingEmail({ variables: {} as never, embedded_events: [], unsubscribe_url: "https://usemingla.com/u/tok",
    subject: "This weekend in Lagos", brand_name: "Test Brand", body_html: "First para.\n\nSecond para." } as never).html],
  ["careers_applicant", () => buildApplicantEmail("Ada Lovelace", "Multimedia Designer", "ada@example.com", "Mingla <notifications@usemingla.com>").html],
  ["careers_notify", () => buildNotifyEmail({ full_name: "Ada Lovelace", email: "ada@example.com", whatsapp_phone: "+2348031234567",
    preferred_salary: "₦200,000", portfolio_url: "https://ada.design" }, "Multimedia Designer", "Mingla <notifications@usemingla.com>", "2026-11-16T15:00:00Z").html],
  ["form_welcome", async () => (await renderFormEmail(formGate("confirmation") as never, formDeps)).html],
  ["form_follow_up", async () => (await renderFormEmail(formGate("follow_up") as never, formDeps)).html],
  ["form_team_alert", async () => (await renderFormEmail(formGate("team_alert") as never, formDeps)).html],
];

Deno.test("G-1 SC-83 every template matches its golden", async () => {
  if (UPDATE) await Deno.mkdir(DIR, { recursive: true });
  const missing: string[] = [];
  const changed: string[] = [];
  for (const [name, render] of TEMPLATES) {
    const html = await frozen(render);
    const file = new URL(`${name}.html`, DIR);
    if (UPDATE) {
      await Deno.writeTextFile(file, html);
      continue;
    }
    let golden: string;
    try {
      golden = await Deno.readTextFile(file);
    } catch {
      missing.push(name);
      continue;
    }
    if (golden !== html) changed.push(name);
  }
  assertEquals(missing, [], "goldens missing (GOLDEN_UPDATE=1 writes them)");
  assertEquals(changed, [], "an unreviewed template change (review the diff, then GOLDEN_UPDATE=1)");
  // A stale golden for a template that no longer renders is an error too.
  const names = new Set(TEMPLATES.map(([n]) => n));
  for await (const e of Deno.readDir(DIR)) {
    if (e.name.endsWith(".html")) assert(names.has(e.name.replace(/\.html$/, "")), `orphan golden ${e.name}`);
  }
});

function hex(c: string): [number, number, number] {
  const h = c.replace("#", "");
  const full = h.length === 3 ? h.split("").map((x) => x + x).join("") : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255) as [number, number, number];
}
function lum(c: string): number {
  const [r, g, b] = hex(c).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

Deno.test("G-2 / G-3 SC-83 the rebranded frame and its a11y rules on every shell document", async () => {
  for (const [name, render] of TEMPLATES) {
    const html = await frozen(render);
    if (!html.startsWith("<!doctype html>")) continue; // the calendar notices are plain team notes
    assert(/<html[^>]*\blang="en"/.test(html), `${name}: lang`);
    assert(html.includes("#F5F4F0"), `${name}: paper body background`);
    for (const t of html.match(/<table\b[^>]*>/g) ?? []) assert(/role="presentation"/.test(t), `${name}: layout table without role="presentation": ${t.slice(0, 80)}`);
    for (const img of html.match(/<img\b[^>]*>/g) ?? []) assert(/\balt="/.test(img), `${name}: img without alt: ${img.slice(0, 80)}`);
    for (const a of html.match(/<a\b[^>]*style="[^"]*background:#[0-9A-Fa-f]{3,6}[^"]*"[^>]*>/g) ?? []) {
      const bg = /background:(#[0-9A-Fa-f]{3,6})/.exec(a)?.[1];
      const fg = /[;"]color:(#[0-9A-Fa-f]{3,6})/.exec(a)?.[1];
      if (bg && fg) assert(contrast(bg, fg) >= 4.5, `${name}: button contrast ${contrast(bg, fg).toFixed(2)} (${fg} on ${bg})`);
    }
  }
  const welcome = await frozen(TEMPLATES.find(([n]) => n === "form_welcome")![1]);
  assert(welcome.includes("font-family:'Instrument Serif',Georgia"), "the serif headline face");
});

Deno.test("G-4 SC-86 the action bar per email: app-only after booking a call", async () => {
  const bar = (html: string) => {
    const at = html.indexOf('class="mingla-ab"');
    return at === -1 ? null : html.slice(at, html.indexOf("</table>\n  </td>", at) + 1 || undefined);
  };
  for (const name of ["booking_confirmation_host", "booking_confirmation_creator", "booking_confirmation_local", "booking_send_path_booker"]) {
    const html = await frozen(TEMPLATES.find(([n]) => n === name)![1]);
    const b = bar(html);
    assert(b, `${name}: has the action bar`);
    assert(/Get Mingla/.test(b), `${name}: the app button`);
    assert(!/Book a 20-minute call/.test(html), `${name}: no call button (they booked one)`);
  }
  for (const name of ["tool_report_events", "form_welcome"]) {
    const b = bar(await frozen(TEMPLATES.find(([n]) => n === name)![1]));
    assert(b && /Book a 20-minute call/.test(b), `${name}: app and call`);
  }
  assertEquals(bar(await frozen(TEMPLATES.find(([n]) => n === "form_team_alert")![1])), null, "a team alert has no bar");
  assertEquals(bar(await frozen(TEMPLATES.find(([n]) => n === "booking_team_notify")![1])), null, "the team notice has no bar");
});

Deno.test("G-5 P2-B text contrast: every text colour on a shell document is >= 4.5:1 on white and on the paper footer", async () => {
  const BACKGROUNDS = ["#FFFFFF", "#F5F4F0"];
  // The brand oranges are decorative accents (the ticket receipt label and links), predate this
  // rework and are not secondary text; white text sits on a dark surface set by a parent (G-3 covers buttons). Out of P2-B's scope and called out in the rework report.
  const DECORATIVE_ACCENT = new Set(["#EB7825", "#FF6B2C", "#FFFFFF"]);
  const seen = new Set<string>();
  for (const [name, render] of TEMPLATES) {
    const html = await frozen(render);
    if (!html.startsWith("<!doctype html>")) continue;
    // Every inline style that sets a text colour and no background of its own (buttons and bars set theirs).
    for (const m of html.matchAll(/style="([^"]*)"/g)) {
      const style = m[1];
      if (/background:/.test(style)) continue;
      const fg = /(?:^|;)\s*color:(#[0-9A-Fa-f]{6})\b/.exec(style)?.[1];
      if (!fg) continue;
      if (DECORATIVE_ACCENT.has(fg.toUpperCase())) continue;
      seen.add(fg.toUpperCase());
      for (const bg of BACKGROUNDS) {
        const ratio = contrast(fg, bg);
        assert(ratio >= 4.5, `${name}: text ${fg} on ${bg} is ${ratio.toFixed(2)}:1, below 4.5:1`);
      }
    }
  }
  assert(seen.has("#6B675F"), "the muted secondary-text colour is exercised");
});

Deno.test("G-6 P3-D the booked-call plain-text part carries the same app link as the HTML bar, and no call link", async () => {
  const base = { when: "Thursday, November 19 at 11:00 AM EST", meetUrl: null, supportEmail: "support@usemingla.com", logoUrl: LOGO, footerAddress: "Mingla, hello@usemingla.com" };
  const expected = { host: "https://usemingla.com/host/get", creator: "https://usemingla.com/download", local: "https://usemingla.com/download" } as const;
  for (const audience of ["host", "creator", "local"] as const) {
    const { html, text } = renderBookingConfirmation({ ...base, audience });
    assert(text.includes(expected[audience]), `${audience}: the text part has the app link`);
    assert(html.includes(`href="${expected[audience]}"`), `${audience}: the HTML bar has the same link`);
    assert(!/schedule/.test(text), `${audience}: no call link in the text`);
    const file = new URL(`booking_confirmation_${audience}.txt`, DIR);
    if (UPDATE) await Deno.writeTextFile(file, text);
    assertEquals(text, await Deno.readTextFile(file), `${audience}: the text golden`);
  }
  const withMeet = renderBookingConfirmation({ ...base, audience: "host", meetUrl: "https://meet.google.com/abc-defg-hij" }).text;
  assert(withMeet.includes("Meet: https://meet.google.com/abc-defg-hij") && withMeet.includes("Get Mingla Host: https://usemingla.com/host/get"));
});
