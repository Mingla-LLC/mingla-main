// issue #4508 1.16-1.21 — the RSVP guest link in the app: deep-link parsing,
// the OneLink after install, and every claim outcome mapped to a designed
// screen with a way forward. Deno-runnable (all three modules are pure).
//
// FAILS-ON-REVERT: drop the rsvp_guest OneLink case -> L-2 fails; drop the
// phone_unproved branch -> C-2 fails; let a resolved-but-claimed link read as
// claimable -> R-2 fails.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { parseDeepLink } from "../deepLinkService.ts";
import { resolveOneLinkDestination } from "../oneLinkResolver.ts";
import {
  claimOutcomeScreen,
  friendshipSentence,
  inAppEventPath,
  inviteMode,
  normalizeRsvpGuestCode,
  parseRsvpGuestClaim,
  parseRsvpGuestResolve,
  releaseOutcomeMessage,
  resolvedInfoScreen,
  rsvpGuestRoutePath,
} from "../../utils/rsvpGuestClaim.ts";

const OPEN = {
  status: "open",
  guestId: "g-1",
  rsvpId: "r-1",
  inviterName: "Ada O.",
  inviterFirstName: "Ada",
  inviterHasAccount: true,
  phoneLast4: "4567",
  claimedByViewer: false,
  viewerCanClaim: false,
  viewerIsInviter: false,
  event: {
    id: "e-1",
    title: "Rooftop Sessions",
    startsAt: "2028-11-22T20:00:00Z",
    endsAt: null,
    timezone: "Africa/Lagos",
    venueLine: "Lagos",
    brandName: "Sunset Club",
    eventUrl: "https://host.usemingla.com/e/sunset/rooftop",
  },
};

Deno.test("L-1 usemingla.com/c/<CODE> and the app scheme reach the claim handler", () => {
  assertEquals(parseDeepLink("https://usemingla.com/c/ab12cd34ef"), { kind: "claim", code: "AB12CD34EF" });
  assertEquals(parseDeepLink("com.mingla.app.v2://c/AB12CD34EF"), { kind: "claim", code: "AB12CD34EF" });
  assertEquals(parseDeepLink("com.mingla.app.v2://rsvp-guest/ab12cd34ef"), {
    kind: "route",
    path: "/rsvp-guest/AB12CD34EF",
  });
  assertEquals(parseDeepLink("com.mingla.app.v2://rsvp-guest/AB12CD34EI"), null, "I is not in the claim alphabet");
});

Deno.test("L-2 deep_link_value=rsvp_guest after install carries the code, never a half-formed one", () => {
  assertEquals(
    resolveOneLinkDestination({ deep_link_value: "rsvp_guest", deep_link_sub1: "ab12cd34ef" }),
    { kind: "rsvp_guest", code: "AB12CD34EF" },
  );
  assertEquals(resolveOneLinkDestination({ deep_link_value: "rsvp_guest", deep_link_sub1: "short" }), null);
  assertEquals(resolveOneLinkDestination({ deep_link_value: "rsvp_guest", deep_link_sub1: "AB12CD34EU" }), null);
});

Deno.test("L-3 the friend-is-going push mingla://event/<id> opens that event", () => {
  const id = "11111111-2222-4333-8444-555555555555";
  assertEquals(parseDeepLink(`mingla://event/${id}`), { kind: "route", path: `/event/${id}` });
  assertEquals(parseDeepLink("mingla://event/not-an-id"), { kind: "page", page: "home" });
});

Deno.test("L-4 codes and routes", () => {
  assertEquals(normalizeRsvpGuestCode(" ab12cd34ef "), "AB12CD34EF");
  assertEquals(normalizeRsvpGuestCode("AB12CD34E"), null);
  assertEquals(normalizeRsvpGuestCode(42), null);
  assertEquals(rsvpGuestRoutePath("AB12CD34EF"), "/rsvp-guest/AB12CD34EF");
  assertEquals(inAppEventPath("https://host.usemingla.com/e/sunset/rooftop"), "/e/sunset/rooftop");
  assertEquals(inAppEventPath("https://evil.example/e/a/b"), null);
});

Deno.test("R-1 open link: one tap when the account proved the number, confirm the number otherwise, sign in when signed out", () => {
  const resolved = parseRsvpGuestResolve(OPEN);
  assertEquals(resolvedInfoScreen(resolved), null);
  assertEquals(inviteMode(resolved, false), "sign_in");
  assertEquals(inviteMode(resolved, true), "confirm_number");
  assertEquals(inviteMode({ ...resolved, viewerCanClaim: true }, true), "one_tap");
  assertEquals(
    friendshipSentence("Ada"),
    "Getting your pass also makes you and Ada close friends on Mingla. You can change that anytime in Connections.",
  );
});

Deno.test("R-2 every non-open link has a designed state with a way forward", () => {
  const claimedOther = resolvedInfoScreen(parseRsvpGuestResolve({ ...OPEN, status: "claimed" }));
  assert(claimedOther !== null && claimedOther.kind === "info");
  assertEquals(resolvedInfoScreen(parseRsvpGuestResolve({ ...OPEN, status: "claimed", claimedByViewer: true })), {
    kind: "claimed",
    friendshipLine: null,
  });
  for (const status of ["released", "ended", "not_eligible", "not_found", "garbage"]) {
    const screen = resolvedInfoScreen(parseRsvpGuestResolve({ ...OPEN, status }));
    assert(screen !== null && screen.kind === "info", status);
    assert(screen.kind === "info" && screen.title.length > 0 && screen.body.length > 0, status);
  }
  const inviter = resolvedInfoScreen(parseRsvpGuestResolve({ ...OPEN, viewerIsInviter: true }));
  assert(inviter !== null && inviter.kind === "info");
});

Deno.test("C-1 claimed: the pass plus the friendship line", () => {
  const screen = claimOutcomeScreen(
    parseRsvpGuestClaim({ outcome: "claimed", guestId: "g-1", rsvpId: "r-1", friendship: "connected", closeFriend: true }),
    "Ada",
  );
  assertEquals(screen, { kind: "claimed", friendshipLine: "You and Ada are now close friends on Mingla." });
  assertEquals(claimOutcomeScreen(parseRsvpGuestClaim({ outcome: "claimed", friendship: "blocked" }), "Ada"), {
    kind: "claimed",
    friendshipLine: null,
  });
  assertEquals(claimOutcomeScreen(parseRsvpGuestClaim({ outcome: "already_claimed" }), "Ada").kind, "claimed");
});

Deno.test("C-2 phone_unproved asks the person to confirm the invited number with a code", () => {
  const result = parseRsvpGuestClaim({ ok: false, outcome: "phone_unproved", phoneLast4: "4567" });
  assertEquals(result.phoneLast4, "4567");
  assertEquals(claimOutcomeScreen(result, "Ada"), { kind: "verify_number" });
});

Deno.test("C-3 every refusal is a designed screen; transport failures offer a retry", () => {
  for (const outcome of ["claimed_by_other", "own_party", "already_on_list", "ineligible", "released", "not_found"]) {
    const screen = claimOutcomeScreen(parseRsvpGuestClaim({ outcome }), "Ada");
    assertEquals(screen.kind, "info", outcome);
  }
  assertEquals(claimOutcomeScreen(parseRsvpGuestClaim({ ok: false, error: "unauthorized" }, 401), "Ada"), {
    kind: "invite",
    mode: "sign_in",
  });
  for (const [body, status] of [[{ error: "conflict" }, 409], [{ error: "rate_limited" }, 429], [{}, null]] as const) {
    const screen = claimOutcomeScreen(parseRsvpGuestClaim(body, status), "Ada");
    assert(screen.kind === "info" && screen.primary === "retry");
  }
});

Deno.test("C-4 This isn't me: released, already claimed, gone", () => {
  assertEquals(releaseOutcomeMessage("released").title, "Thanks for letting us know");
  assertEquals(releaseOutcomeMessage("already_released").title, "Thanks for letting us know");
  assertEquals(releaseOutcomeMessage("already_claimed").title, "This pass is already claimed");
  assertEquals(releaseOutcomeMessage("not_found").title, "This link doesn't work any more");
});

// ── wave B app surfaces: source contracts (these files import react-native) ──
const src = (rel: string) => Deno.readTextFile(new URL(`../../${rel}`, import.meta.url));

Deno.test("S-1 Connections: an RSVP close friend reads 'through {event}' (1.23)", async () => {
  const circle = await src("services/circleService.ts");
  assert(/value === 'rsvp_guest'/.test(circle), "rsvp_guest is a known relationship source");
  const tile = await src("components/profile/circle/CircleAvatarTile.tsx");
  assert(/relationshipSource !== 'rsvp_guest'/.test(tile) && /`through \$\{title\}`/.test(tile));
});

Deno.test("S-2 pass sheet: claimed / not claimed and Nudge with the guest's own link, no system text (1.24)", async () => {
  const deck = await src("services/rsvpDeckService.ts");
  assert(/typeof row\.invite_status === "string"/.test(deck), "only the owner's rows carry invite status");
  const invites = await src("components/activity/RsvpPartyInvites.tsx");
  assert(/"Claimed" : guest\.claimed === false \? "Not claimed yet"/.test(invites));
  assert(/shareMessage\(buildGuestInviteMessage\(\{ \.\.\.message, link \}\)\)/.test(invites), "Nudge opens the paste message");
  assert(!/functions\.invoke|rsvp-notify/.test(invites.split("export function RsvpBringSomeone")[0]), "Nudge sends nothing itself");
});

Deno.test("S-3 Bring someone too only when the host allows it (2.5)", async () => {
  const sheet = await src("components/activity/RsvpPassSheet.tsx");
  assert(/isGuest && canBring && row\.guestId !== null/.test(sheet));
  const deck = await src("services/rsvpDeckService.ts");
  assert(/op: "guest_bring"/.test(deck));
});

Deno.test("S-4 friends-going toggle writes notification_preferences.friends_going (2.3)", async () => {
  const settings = await src("components/profile/AccountSettings.tsx");
  assert(/updateNotifPref\('friends_going'/.test(settings));
});

Deno.test("S-5 Who's going shows Brought by only when the server row carries it (2.4)", async () => {
  const sheet = await src("components/EventGuestListSheet.tsx");
  assert(/typeof guest\.broughtByName === "string"/.test(sheet));
});

// ── contract v2 (#4508 wave A rework) ──
Deno.test("C1 the friends route is on: friends picked from the list are sent by account", async () => {
  const screen = await src("screens/Event/ConsumerEventDetailScreen.tsx");
  assert(/const RSVP_FRIEND_GUESTS_SERVER_READY = true;/.test(screen), "the friends route is switched on");
});

Deno.test("C2 Bring someone too reads the host setting from the guest's own pass row", async () => {
  const deck = await src("services/rsvpDeckService.ts");
  assert(!/\.from\("events"\)\s*\.select\("rsvp_guests_can_bring"\)/.test(deck), "no direct events read");
  assert(/row\.guests_can_bring === true/.test(deck), "read from fetch_user_rsvp_party_passes");
  const sheet = await src("components/activity/RsvpPassSheet.tsx");
  assert(/setCanBring\(isGuest && row\.guestId !== null && details\.guestsCanBring\)/.test(sheet));
  assert(!/fetchRsvpGuestsCanBring/.test(sheet));
});

Deno.test("C4 Who's going shows +N guests from unclaimedGuestCount", async () => {
  const sheet = await src("components/EventGuestListSheet.tsx");
  assert(/guest\.unclaimedGuestCount/.test(sheet) && /\+\$\{unclaimed\} \$\{unclaimed === 1 \? "guest" : "guests"\}/.test(sheet));
});

// ── second rework (#4508) ──
Deno.test("R-6 Bring someone too needs a claimed pass, not just a matched one", async () => {
  const deck = await src("services/rsvpDeckService.ts");
  assert(
    /row\.entity_type === "guest" &&\s+row\.guests_can_bring === true &&\s+row\.claimed === true/.test(deck),
    "an unclaimed matched row never turns Bring someone too on",
  );
});
