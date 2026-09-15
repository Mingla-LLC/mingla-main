/**
 * Public RSVP page — guest-facing fixes (host.usemingla.com/e/{brand}/{event},
 * the Business app's in-app public page, and mobile web).
 *
 * WHY this file lives here: the code under test is in packages/offering-rendering
 * (shared by every surface), but this default business jest run is the suite
 * that runs on every PR, and its roots stop at mingla-business/src. The pure
 * modules are imported by DEEP specifier, because the package barrel is mapped
 * to a manual mock in this config and would prove nothing.
 *
 * What each block pins:
 *   1. "Not on sale yet" on a free RSVP — replaced by a countdown / live / full
 *      state computed from absolute instants (timezone-independent).
 *   2. Capacity is shown at zero going ("Be the first to RSVP · 80 spots") and
 *      stays hidden when the host hides the spots-left count.
 *   3. The line under the decision follows "Who can find this".
 *   4. A blocked Going / Maybe tap names what is missing, next to the control.
 *   5. The anonymous guest's reply survives the chip-in redirect (tab-scoped).
 *   6. The floating decision bar only shows once the inline row is scrolled past.
 *
 * The rendered components are exercised in rsvp_public_guest_page_render.test.tsx
 * and the page adapter in rsvp_public_page_status_and_restore.test.tsx.
 */

import {
  DAY_MS,
  HOUR_MS,
  MINUTE_MS,
  formatRsvpStartsIn,
  resolveRsvpStatusBanner,
  rsvpStatusBannerRefreshDelayMs,
} from "@mingla/offering-rendering/rsvpStatusBanner";
import {
  buildRsvpValidationHint,
  rsvpAudienceMicrocopy,
  rsvpContactIssues,
} from "@mingla/offering-rendering/rsvpGuestCopy";
import {
  RSVP_GUEST_SNAPSHOT_MAX_AGE_MS,
  parseRsvpGuestSnapshot,
  rsvpGuestSnapshotStorageKey,
  rsvpGuestSnapshotVerification,
  serializeRsvpGuestSnapshot,
  type RsvpGuestSnapshot,
} from "@mingla/offering-rendering/rsvpGuestSnapshot";
import {
  isInlineRsvpDecisionVisible,
  rsvpInlineDecisionPosition,
  rsvpRevealScrollOffset,
  shouldShowRsvpFloatingBar,
} from "@mingla/offering-rendering/rsvpFloatingDecision";
import {
  deriveMomentum,
  rsvpMomentumSubLabel,
} from "@mingla/offering-rendering/rsvpMomentum";
import { resolveOfferingCta } from "@mingla/offering-rendering/offeringCta";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9\s()-]{7,20}$/;

// The demo event: Sat 26 Sept 2026, 7 PM – 10 PM America/New_York.
const START = "2026-09-26T23:00:00+00:00";
const END = "2026-09-27T02:00:00+00:00";
const startMs = Date.parse(START);
const endMs = Date.parse(END);

const banner = (nowMs: number, over: Partial<Parameters<typeof resolveRsvpStatusBanner>[0]> = {}) =>
  resolveRsvpStatusBanner({
    startAtUtc: START,
    endAtUtc: END,
    nowMs,
    capacityFull: false,
    waitlistEnabled: true,
    manualApproval: false,
    ...over,
  });

describe("1. RSVP status pill replaces 'Not on sale yet'", () => {
  it("root cause: the ticket CTA machine says 'Not on sale yet' for an event with no tickets", () => {
    const cta = resolveOfferingCta({
      variant: "published",
      bookable: true,
      tickets: [],
      currency: "USD",
    });
    expect(cta).toMatchObject({ kind: "unavailable", title: "Not on sale yet" });
  });

  it("counts down in whole days, then hours, then minutes, then 'Starting soon'", () => {
    expect(banner(Date.parse("2026-09-15T07:00:00Z"))?.label).toBe("Starts in 11 days");
    expect(banner(startMs - 2 * DAY_MS)?.label).toBe("Starts in 2 days");
    expect(banner(startMs - 2 * DAY_MS + 1)?.label).toBe("Starts in 1 day");
    expect(banner(startMs - DAY_MS)?.label).toBe("Starts in 1 day");
    expect(banner(startMs - DAY_MS + 1)?.label).toBe("Starts in 23 hours");
    expect(banner(startMs - 2 * HOUR_MS)?.label).toBe("Starts in 2 hours");
    expect(banner(startMs - HOUR_MS)?.label).toBe("Starts in 1 hour");
    expect(banner(startMs - HOUR_MS + 1)?.label).toBe("Starts in 59 minutes");
    expect(banner(startMs - MINUTE_MS)?.label).toBe("Starts in 1 minute");
    expect(banner(startMs - 30_000)).toEqual({ kind: "starting_soon", label: "Starting soon" });
  });

  it("says 'Happening now' between start and end, and 'Ended' from the end instant", () => {
    expect(banner(startMs)).toEqual({ kind: "happening_now", label: "Happening now" });
    expect(banner(endMs - 1)?.label).toBe("Happening now");
    expect(banner(endMs)).toEqual({ kind: "ended", label: "Ended" });
  });

  it("uses guest-list-full wording before the start, honouring the waitlist and approval settings", () => {
    const soon = startMs - 3 * DAY_MS;
    expect(banner(soon, { capacityFull: true, waitlistEnabled: true })?.label).toBe(
      "Guest list full · Join the waitlist",
    );
    expect(banner(soon, { capacityFull: true, waitlistEnabled: false })?.label).toBe(
      "Guest list full",
    );
    // Manual approval never hard-blocks a full list, so the countdown stays.
    expect(
      banner(soon, { capacityFull: true, waitlistEnabled: false, manualApproval: true })?.label,
    ).toBe("Starts in 3 days");
    // A live event is live, full or not.
    expect(banner(startMs + 1, { capacityFull: true })?.label).toBe("Happening now");
  });

  it("is computed from the start INSTANT, so every offset spelling gives the same copy", () => {
    const now = Date.parse("2026-09-26T20:30:00Z");
    const utc = banner(now);
    const newYork = banner(now, { startAtUtc: "2026-09-26T19:00:00-04:00", endAtUtc: "2026-09-26T22:00:00-04:00" });
    const lagos = banner(now, { startAtUtc: "2026-09-27T00:00:00+01:00", endAtUtc: "2026-09-27T03:00:00+01:00" });
    expect(utc?.label).toBe("Starts in 2 hours");
    expect(newYork).toEqual(utc);
    expect(lagos).toEqual(utc);
  });

  it("renders nothing rather than guessing when the start is missing or malformed", () => {
    expect(banner(0, { startAtUtc: null })).toBeNull();
    expect(banner(0, { startAtUtc: "not a date" })).toBeNull();
    expect(formatRsvpStartsIn(-5)).toBe("Starting soon");
  });

  it("refreshes at the next unit boundary, clamped to 1s..60s", () => {
    const delay = (nowMs: number) =>
      rsvpStatusBannerRefreshDelayMs({ startAtUtc: START, endAtUtc: END, nowMs });
    expect(delay(startMs - 11 * DAY_MS)).toBe(60_000);
    expect(delay(startMs - 90_500)).toBe(30_501);
    expect(delay(startMs - MINUTE_MS)).toBe(60_000);
    expect(delay(startMs - 500)).toBe(1_000);
    expect(delay(startMs + 1)).toBe(60_000);
    expect(delay(endMs - 5_000)).toBe(5_000);
  });
});

describe("2. capacity is communicated (and hidden only when the host hides it)", () => {
  it("shows the real capacity at zero going", () => {
    expect(rsvpMomentumSubLabel(0, 80)).toBe("Be the first to RSVP · 80 spots");
    expect(rsvpMomentumSubLabel(0, 1)).toBe("Be the first to RSVP · 1 spot");
  });

  it("keeps the bare zero-state when capacity is unlimited or hidden (display capacity null)", () => {
    expect(rsvpMomentumSubLabel(0, null)).toBe("Be the first to RSVP");
    expect(rsvpMomentumSubLabel(0, 0)).toBe("Be the first to RSVP");
  });

  it("leaves every going>0 line to deriveMomentum, except a full list whose waitlist is off", () => {
    expect(rsvpMomentumSubLabel(2, 80)).toBe(deriveMomentum(2, 80).subLabel);
    expect(rsvpMomentumSubLabel(2, 80)).toBe("78 spots left · filling up");
    expect(rsvpMomentumSubLabel(80, 80, { waitlistEnabled: true })).toBe("Full · waitlist open");
    expect(rsvpMomentumSubLabel(80, 80)).toBe("Full · waitlist open");
    expect(rsvpMomentumSubLabel(80, 80, { waitlistEnabled: false })).toBe("Full");
    // 199/200 rounds the meter to 100% but one spot is still open.
    expect(rsvpMomentumSubLabel(199, 200, { waitlistEnabled: false })).toBe(
      "1 spot left · filling fast",
    );
  });
});

describe("3. the line under the decision follows 'Who can find this'", () => {
  it("never tells a public or feed-listed event's guests it is link-only", () => {
    expect(rsvpAudienceMicrocopy({ visibility: "public", discoverable: true, manualApproval: false })).toBe(
      "Listed on Mingla · anyone can RSVP.",
    );
    expect(rsvpAudienceMicrocopy({ visibility: "public", discoverable: false, manualApproval: false })).toBe(
      "Public event · anyone can RSVP.",
    );
    expect(rsvpAudienceMicrocopy({ visibility: "unlisted", discoverable: true, manualApproval: false })).toBe(
      "Listed on Mingla · anyone can RSVP.",
    );
  });

  it("keeps the link-only line for unlisted events and for surfaces that do not know the setting", () => {
    expect(rsvpAudienceMicrocopy({ visibility: "unlisted", discoverable: false, manualApproval: false })).toBe(
      "Anyone with the link can RSVP.",
    );
    expect(rsvpAudienceMicrocopy({ manualApproval: false })).toBe("Anyone with the link can RSVP.");
  });

  it("says requests are reviewed on approval events, and private events are for invited guests", () => {
    expect(rsvpAudienceMicrocopy({ visibility: "public", discoverable: true, manualApproval: true })).toBe(
      "The host reviews each request before you're in.",
    );
    expect(rsvpAudienceMicrocopy({ visibility: "private", manualApproval: true })).toBe(
      "Private event · the host reviews each request.",
    );
    expect(rsvpAudienceMicrocopy({ visibility: "private", manualApproval: false })).toBe(
      "Private event · for invited guests.",
    );
  });
});

describe("4. a blocked decision tap says what is missing, next to the control", () => {
  const issues = (primary: { name: string; email: string; phone: string }, guests: { name: string; email: string; phone: string }[] = [], primaryRequired = true) =>
    rsvpContactIssues({ primary, primaryRequired, guests, emailPattern: EMAIL_RE, phonePattern: PHONE_RE });

  it("lists unfinished fields in on-screen order", () => {
    expect(issues({ name: "", email: "bad", phone: "" }, [{ name: "", email: "a@b.co", phone: "+1 555 123 4567" }])).toEqual([
      { guestIndex: null, field: "name", problem: "missing" },
      { guestIndex: null, field: "email", problem: "invalid" },
      { guestIndex: null, field: "phone", problem: "missing" },
      { guestIndex: 0, field: "name", problem: "missing" },
    ]);
    expect(issues({ name: "", email: "", phone: "" }, [], false)).toEqual([]);
  });

  it("pins the hint copy", () => {
    const hint = (p: { name: string; email: string; phone: string }, g: { name: string; email: string; phone: string }[] = []) =>
      buildRsvpValidationHint(issues(p, g));
    expect(hint({ name: "", email: "", phone: "" })).toBe("Add your name, email and phone number above to RSVP.");
    expect(hint({ name: "", email: "", phone: "+1 555 123 4567" })).toBe("Add your name and email above to RSVP.");
    expect(hint({ name: "Ada", email: "ada@", phone: "+1 555 123 4567" })).toBe("Add a valid email above to RSVP.");
    expect(hint({ name: "Ada", email: "ada@", phone: "" })).toBe("Add a valid email and your phone number above to RSVP.");
    expect(hint({ name: "", email: "", phone: "12" })).toBe(
      "Add your name, email and a valid phone number above to RSVP.",
    );
    expect(
      hint({ name: "Ada", email: "ada@x.io", phone: "+1 555 123 4567" }, [{ name: "", email: "", phone: "" }]),
    ).toBe("Finish Guest 1's details above to RSVP.");
    expect(hint({ name: "Ada", email: "ada@x.io", phone: "+1 555 123 4567" })).toBeNull();
  });
});

describe("5. the anonymous guest's reply survives the chip-in redirect", () => {
  const EVENT = "413fdcd0-5f33-40dc-b5a4-6a93897db01f";
  const now = Date.parse("2026-09-15T08:00:00Z");
  const snapshot: RsvpGuestSnapshot = {
    version: 1,
    eventId: EVENT,
    rsvpId: "rsvp-1",
    guestStatus: "going",
    guestApproval: "approved",
    details: {
      eventName: "Neighbors Night on Wythe",
      dateLine: "Sat 26 Sept · 7 PM – 10 PM",
      venueLine: "Lantern Room, 61 Wythe Avenue",
      guestName: "Seth",
      status: "going",
      plusGuests: [],
      confirmationToken: "mingla:v1:rsvp:abc",
      credentials: [
        { entityType: "primary", entityId: "rsvp-1", displayName: "Seth", qrCode: "qr", pdfFetchRef: "ref" },
      ],
      anonymousRecovery: [
        { entityType: "primary", entityId: "rsvp-1", recoveryToken: "tok", recoveryUrl: null },
      ],
    },
    savedAtMs: now - 60_000,
  };

  it("round-trips for the same event and keys storage per event", () => {
    const raw = serializeRsvpGuestSnapshot(snapshot);
    expect(parseRsvpGuestSnapshot(raw, EVENT, now)).toEqual(snapshot);
    expect(rsvpGuestSnapshotStorageKey(EVENT)).toBe(`mingla.rsvp.guest.v1:${EVENT}`);
  });

  it("refuses another event's, an expired, a future-dated, a malformed or a tampered snapshot", () => {
    const raw = serializeRsvpGuestSnapshot(snapshot);
    expect(parseRsvpGuestSnapshot(raw, "another-event", now)).toBeNull();
    expect(parseRsvpGuestSnapshot(raw, EVENT, snapshot.savedAtMs + RSVP_GUEST_SNAPSHOT_MAX_AGE_MS + 1)).toBeNull();
    expect(parseRsvpGuestSnapshot(raw, EVENT, snapshot.savedAtMs - 1)).toBeNull();
    expect(parseRsvpGuestSnapshot("{not json", EVENT, now)).toBeNull();
    expect(parseRsvpGuestSnapshot(null, EVENT, now)).toBeNull();
    const tampered = JSON.parse(raw);
    tampered.details.credentials[0].entityType = "admin";
    expect(parseRsvpGuestSnapshot(JSON.stringify(tampered), EVENT, now)).toBeNull();
    const wrongStatus = { ...JSON.parse(raw), guestStatus: "vip" };
    expect(parseRsvpGuestSnapshot(JSON.stringify(wrongStatus), EVENT, now)).toBeNull();
  });

  it("verifies only a going+approved reply, with the primary guest's recovery token", () => {
    expect(rsvpGuestSnapshotVerification(snapshot)).toEqual({
      entityType: "primary",
      entityId: "rsvp-1",
      recoveryToken: "tok",
    });
    expect(rsvpGuestSnapshotVerification({ ...snapshot, guestStatus: "maybe", details: null })).toBeNull();
    expect(rsvpGuestSnapshotVerification({ ...snapshot, guestApproval: "pending" })).toBeNull();
  });
});

describe("6. the floating decision bar never doubles the inline row", () => {
  const viewport = { y: 0, height: 812 };

  it("treats the inline row as visible once half of it (or 48px) is on screen", () => {
    expect(isInlineRsvpDecisionVisible({ y: 400, height: 90 }, viewport)).toBe(true);
    expect(isInlineRsvpDecisionVisible({ y: 812 - 45, height: 90 }, viewport)).toBe(true);
    expect(isInlineRsvpDecisionVisible({ y: 812 - 44, height: 90 }, viewport)).toBe(false);
    expect(isInlineRsvpDecisionVisible({ y: 1300, height: 90 }, viewport)).toBe(false);
    expect(isInlineRsvpDecisionVisible({ y: -80, height: 90 }, viewport)).toBe(false);
    // Unmeasured ⇒ not visible, so the guest always has a way to reply.
    expect(isInlineRsvpDecisionVisible({ y: 0, height: 0 }, viewport)).toBe(false);
    expect(isInlineRsvpDecisionVisible(null, viewport)).toBe(false);
  });

  it("knows whether the row is above, on, or below the screen", () => {
    expect(rsvpInlineDecisionPosition({ y: 400, height: 90 }, viewport)).toBe("visible");
    expect(rsvpInlineDecisionPosition({ y: -300, height: 90 }, viewport)).toBe("above");
    expect(rsvpInlineDecisionPosition({ y: 1300, height: 90 }, viewport)).toBe("below");
    expect(rsvpInlineDecisionPosition({ y: 0, height: 0 }, viewport)).toBe("unmeasured");
  });

  it("shows the bar only on phone, while replies are open, once the guest has scrolled past the inline row", () => {
    const base = {
      isPhoneLayout: true,
      acquisitionOpen: true,
      inlineDecisionPosition: "above" as const,
      decisionAttempted: false,
    };
    expect(shouldShowRsvpFloatingBar(base)).toBe(true);
    expect(shouldShowRsvpFloatingBar({ ...base, inlineDecisionPosition: "visible" })).toBe(false);
    expect(shouldShowRsvpFloatingBar({ ...base, isPhoneLayout: false })).toBe(false);
    expect(shouldShowRsvpFloatingBar({ ...base, acquisitionOpen: false })).toBe(false);
    // First load: the row is further down the page, so nothing covers the date card.
    expect(shouldShowRsvpFloatingBar({ ...base, inlineDecisionPosition: "below" })).toBe(false);
    expect(shouldShowRsvpFloatingBar({ ...base, inlineDecisionPosition: "unmeasured" })).toBe(false);
    // After a blocked tap scrolled the guest up to a field, the bar carries the hint.
    expect(
      shouldShowRsvpFloatingBar({ ...base, inlineDecisionPosition: "below", decisionAttempted: true }),
    ).toBe(true);
    expect(
      shouldShowRsvpFloatingBar({ ...base, inlineDecisionPosition: "visible", decisionAttempted: true }),
    ).toBe(false);
  });

  it("scrolls a revealed field to a quarter of the way down the viewport", () => {
    expect(rsvpRevealScrollOffset({ y: 1500, height: 48 }, viewport, 900)).toBe(2197);
    expect(rsvpRevealScrollOffset({ y: 10, height: 48 }, viewport, 0)).toBe(0);
  });
});
