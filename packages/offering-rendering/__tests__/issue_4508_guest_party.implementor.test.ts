// issue #4508 — "Bring a friend with just their number": the RSVP form's guest
// model (spec 1.1-1.8 with amendments 1-4). Deno-runnable: rsvpGuestPartyModel.ts is
// pure.
//
// FAILS-ON-REVERT: send name / email / phone guests again (the pre-#4508 shape)
// -> P-1 fails; drop the own-number check -> R-2 fails; drop the cross-route
// de-duplication -> D-1 / D-2 fail; drop the limit -> L-1 fails.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  RSVP_GUEST_LIMIT_REACHED,
  RSVP_GUEST_OWN_NUMBER,
  RSVP_PARTY_COPY,
  addPartyGuest,
  addableFromPreview,
  friendChips,
  friendGuest,
  numberPreview,
  rsvpAlreadyListed,
  rsvpNoFriendMatch,
  rsvpPartyHelper,
  searchFriends,
  type RsvpFriendOption,
  type RsvpGuestLookupResult,
  type RsvpPartyGuest,
} from "../rsvpGuestPartyModel.ts";
import {
  buildGuestInviteMessage,
  buildGuestPayload,
  rsvpGoingButtonLabel,
  submittedGuestLabel,
  submittedGuestStatus,
} from "../rsvpGuestParty.ts";
import { parseSubmittedGuests } from "../rsvpGuestParse.ts";
import { rsvpGuestErrorMessage } from "../rsvpGuestErrors.ts";

const NOT_ON: RsvpGuestLookupResult = {
  valid: true,
  isYou: false,
  onMingla: false,
  alreadyOnList: false,
  released: false,
};
const ADA_USER = {
  id: "11111111-1111-4111-8111-111111111111",
  displayName: "Ada Lovelace",
  username: "ada",
  avatarUrl: null,
};
const ON_ADA: RsvpGuestLookupResult = { ...NOT_ON, onMingla: true, user: ADA_USER };

const friends: RsvpFriendOption[] = [
  { userId: "f-1", displayName: "Zoë Ámara", username: "zoe_a", avatarUrl: null, closeFriend: false },
  { userId: ADA_USER.id, displayName: "Ada Lovelace", username: "ada", avatarUrl: null, closeFriend: true },
  { userId: "f-3", displayName: "Grace Hopper", username: "amazing.grace", avatarUrl: null, closeFriend: false },
  { userId: "f-4", displayName: "Tunde Bakare", username: null, avatarUrl: null, closeFriend: true },
];

const preview = (
  phone: string,
  party: RsvpPartyGuest[] = [],
  result: RsvpGuestLookupResult = NOT_ON,
  own: string[] = ["+15550000000"],
) =>
  numberPreview({
    phone,
    phoneCountryIso: "US",
    party,
    ownPhones: own,
    lookup: { state: "done", result },
  });

Deno.test("P-1 happy path: a number-only guest is sent as { phone, phoneCountryIso } with no name or email", () => {
  const p = preview("+15551234567");
  assertEquals(p.kind, "ready");
  const guest = addableFromPreview(p);
  assert(guest !== null);
  const party = addPartyGuest([], guest, 3);
  assertEquals(buildGuestPayload(party), [{ phone: "+15551234567", phoneCountryIso: "US" }]);
  assertEquals(Object.keys(buildGuestPayload(party)[0]).sort(), ["phone", "phoneCountryIso"]);
});

Deno.test("P-1b label: a guest is labelled once when added, by name when known, else the grouped number", () => {
  const byNumber = addableFromPreview(preview("+15551234567"));
  assert(byNumber !== null);
  assertEquals(byNumber.label, "+1 555 123 4567");
  const named = addableFromPreview(preview("+15551234568", [], ON_ADA));
  assert(named !== null);
  assertEquals(named.label, "Ada Lovelace");
  assertEquals(friendGuest(friends[0]).label, "Zoë Ámara");
});

Deno.test("P-2 preview: not on Mingla shows the number and the invite line; on Mingla shows the account name", () => {
  const off = preview("+15551234567");
  assert(off.kind === "ready");
  assertEquals(off.line, "Not on Mingla yet · We'll text them an invite");
  assertEquals(off.title, "+1 555 123 4567");
  const on = preview("+15551234567", [], ON_ADA);
  assert(on.kind === "ready");
  assertEquals(on.title, "Ada Lovelace");
  assertEquals(on.line, "On Mingla · @ada");
  assertEquals(on.guest.userId, ADA_USER.id);
});

Deno.test("P-3 signed out: the lookup carries no user, so the preview never shows a name (1.8)", () => {
  const p = preview("+15551234567", [], { ...NOT_ON, onMingla: true });
  assert(p.kind === "ready");
  assertEquals(p.title, "+1 555 123 4567");
  assertEquals(p.line, "On Mingla");
});

Deno.test("R-1 an incomplete number previews nothing and cannot be added", () => {
  assertEquals(preview("+1555").kind, "idle");
  assertEquals(addableFromPreview(preview("")), null);
});

Deno.test("R-2 the inviter's own number is refused before any lookup", () => {
  const p = numberPreview({
    phone: "+15550000000",
    phoneCountryIso: "US",
    party: [],
    ownPhones: ["+1 (555) 000-0000"],
    lookup: { state: "none" },
  });
  assertEquals(p, { kind: "refused", message: "That's you. Enter a friend's number" });
  assertEquals(preview("+15551234567", [], { ...NOT_ON, isYou: true }, []).kind, "refused");
});

Deno.test("R-3 already on the list, released, invalid: refused with plain copy, no Add", () => {
  const listed = preview("+15551234567", [], { ...ON_ADA, alreadyOnList: true });
  assertEquals(listed, { kind: "refused", message: "Ada Lovelace is already on the list" });
  assertEquals(rsvpAlreadyListed(null), "This number is already on the list");
  const released = preview("+15551234567", [], { ...NOT_ON, released: true });
  assertEquals(released.kind, "refused");
  const invalid = preview("+15551234567", [], { ...NOT_ON, valid: false });
  assertEquals(invalid, { kind: "refused", message: "Enter a valid phone number" });
});

Deno.test("R-4 a failed lookup still lets the inviter add the number (the server re-checks)", () => {
  const p = numberPreview({
    phone: "+15551234567",
    phoneCountryIso: "US",
    party: [],
    ownPhones: [],
    lookup: { state: "failed" },
  });
  assertEquals(p.kind, "unchecked");
  assert(addableFromPreview(p) !== null);
  const checking = numberPreview({
    phone: "+15551234567",
    phoneCountryIso: "US",
    party: [],
    ownPhones: [],
    lookup: { state: "checking" },
  });
  assertEquals(checking.kind, "checking");
  assertEquals(addableFromPreview(checking), null);
});

Deno.test("D-1 a friend added from search cannot be added again by number (amendment 4)", () => {
  const party = addPartyGuest([], friendGuest(friends[1]), 3);
  const p = preview("+15551234567", party, ON_ADA);
  assertEquals(p, { kind: "refused", message: "Already coming with you" });
});

Deno.test("D-2 a number whose account is a friend hides that friend from search and chips", () => {
  const added = addableFromPreview(preview("+15551234567", [], ON_ADA));
  assert(added !== null);
  const party = addPartyGuest([], added, 3);
  assertEquals(searchFriends(friends, "ada", party), []);
  assert(!friendChips(friends, party).some((f) => f.userId === ADA_USER.id));
  // and the same number typed twice reads "Already coming with you"
  assertEquals(preview("+15551234567", party).kind, "refused");
});

Deno.test("D-3 adding the same person twice is a no-op", () => {
  const once = addPartyGuest([], friendGuest(friends[0]), 3);
  assertEquals(addPartyGuest(once, friendGuest(friends[0]), 3).length, 1);
});

Deno.test("L-1 the host's limit: nothing past the max", () => {
  let party: RsvpPartyGuest[] = [];
  for (const phone of ["+15551230001", "+15551230002", "+15551230003"]) {
    const g = addableFromPreview(preview(phone, party));
    assert(g !== null);
    party = addPartyGuest(party, g, 2);
  }
  assertEquals(party.length, 2);
  assertEquals(RSVP_PARTY_COPY.limitReached, "That's the most this host allows.");
  assertEquals(rsvpPartyHelper(1), "Up to 1 person. Just their number.");
  assertEquals(rsvpPartyHelper(4), "Up to 4 people. Just their number.");
});

Deno.test("S-1 friend search: first name, last name, username, accents and case; up to five", () => {
  assertEquals(searchFriends(friends, "ada", []).map((f) => f.userId), [ADA_USER.id]);
  assertEquals(searchFriends(friends, "LOVE", []).map((f) => f.userId), [ADA_USER.id]);
  assertEquals(searchFriends(friends, "grace", []).map((f) => f.userId), ["f-3"]);
  assertEquals(searchFriends(friends, "amazing", []).map((f) => f.userId), ["f-3"]);
  assertEquals(searchFriends(friends, "zoe", []).map((f) => f.userId), ["f-1"]);
  assertEquals(searchFriends(friends, "amara", []).map((f) => f.userId), ["f-1"]);
  assertEquals(searchFriends(friends, "xyz", []), []);
  const many = Array.from({ length: 9 }, (_, i) => ({
    userId: `m-${i}`,
    displayName: `Sam ${i}`,
    username: null,
    avatarUrl: null,
    closeFriend: false,
  }));
  assertEquals(searchFriends(many, "sam", []).length, 5);
  assertEquals(rsvpNoFriendMatch("xyz"), 'No friend called "xyz". Add them by phone number above.');
});

Deno.test("S-2 chips: three, close friends first, people already coming left out", () => {
  assertEquals(friendChips(friends, []).map((f) => f.userId), [ADA_USER.id, "f-4", "f-1"]);
  const party = addPartyGuest([], friendGuest(friends[3]), 3);
  assertEquals(friendChips(friends, party).map((f) => f.userId), [ADA_USER.id, "f-1", "f-3"]);
});

Deno.test("S-3 blocked users never appear: the server omits them from the circle, and search only reads the circle", () => {
  // get_user_circle excludes blocked pairs; the client never adds anyone else.
  const withoutBlocked = friends.filter((f) => f.userId !== "f-3");
  assertEquals(searchFriends(withoutBlocked, "grace", []), []);
});

Deno.test("B-1 button: Going alone, RSVP for N (you included) with guests", () => {
  assertEquals(rsvpGoingButtonLabel(0), "Going");
  assertEquals(rsvpGoingButtonLabel(2), "RSVP for 3");
});

Deno.test("M-1 Send it yourself too: the exact message, with the guest's own link", () => {
  assertEquals(
    buildGuestInviteMessage({
      eventName: "Rooftop Sessions",
      dateLine: "Sat 22 Nov · 8:00 PM",
      area: "Lagos, Nigeria",
      online: false,
      link: "https://usemingla.com/c/ABCDEFGHJK",
    }),
    "I've put you down for Rooftop Sessions with me, Sat 22 Nov, 8:00 PM in Lagos, Nigeria. Your pass is waiting in the Mingla app, grab it here: https://usemingla.com/c/ABCDEFGHJK",
  );
});

Deno.test("E-1 the server's guest refusals map to plain copy", () => {
  assertEquals(rsvpGuestErrorMessage("rsvp_plus_ones_exceeded"), "That's the most this host allows.");
  assertEquals(rsvpGuestErrorMessage("rsvp_guest_own_number"), "That's you. Enter a friend's number");
  assert(rsvpGuestErrorMessage("rsvp_guest_daily_cap") !== null);
  assertEquals(rsvpGuestErrorMessage("rsvp_full"), null);
});

Deno.test("I-1 submit response guests are parsed defensively; willText alone decides \"couldn't text\"", () => {
  const parsed = parseSubmittedGuests([
    { guestId: "g1", phoneLast4: "4567", onMingla: false, displayName: null, claimed: false, inviteUrl: "https://usemingla.com/c/X", inviteCode: "X" },
    { guestId: "g2", phoneLast4: "9999", onMingla: false, displayName: null, claimed: false, inviteUrl: null, willText: false },
    "junk",
  ]);
  assertEquals(parsed.length, 2);
  assertEquals(submittedGuestStatus(parsed[0], "going"), "Text on its way");
  assertEquals(submittedGuestStatus(parsed[1], "going"), "We couldn't text this number");
  assertEquals(submittedGuestStatus(parsed[0], "pending"), "We'll text them once you're in");
});

Deno.test("R-1 (third rework) a signed-out guest has no id or link and still reads as texted", () => {
  // What public-submit-rsvp sends a signed-out caller, for a new number and
  // for one already on the list alike.
  const parsed = parseSubmittedGuests([
    { guestId: null, phoneLast4: "4567", onMingla: false, displayName: null, claimed: false, inviteUrl: null, inviteCode: null, addedFromFriend: false, willText: true, notTextedReason: null },
  ]);
  assertEquals(parsed[0].guestId, null);
  assertEquals(parsed[0].inviteUrl, null);
  assertEquals(submittedGuestStatus(parsed[0], "going"), "Text on its way");
  assertEquals(submittedGuestLabel(parsed[0]), "Number ending 4567");
  // No 409 code is left for those cases, so no line is kept for one.
  assertEquals(rsvpGuestErrorMessage("rsvp_guest_unavailable"), null);
});

// ── contract v2 (#4508 wave A rework) ──
Deno.test("C1 payload: a friend picked from the list is sent as { userId } alone; a typed number as { phone }", () => {
  const friend = friendGuest({
    userId: "u-fay",
    displayName: "Fay Ford",
    username: "fay",
    avatarUrl: null,
    closeFriend: true,
  } as Parameters<typeof friendGuest>[0]);
  const typed = addableFromPreview(preview("+15551234567", [], ON_ADA));
  assert(typed !== null);
  const party = addPartyGuest(addPartyGuest([], friend, 3), typed, 3);
  assertEquals(buildGuestPayload(party), [
    { userId: "u-fay" },
    { phone: "+15551234567", phoneCountryIso: "US" },
  ]);
  // A typed number that matched an account still goes as the number.
  assert(!("userId" in buildGuestPayload(party)[1]));
  assertEquals(
    rsvpGuestErrorMessage("rsvp_guest_not_friend"),
    "You can only add people from your friends list. Add them by phone number instead.",
  );
});

Deno.test("C3 status: a guest the server will not text reads \"We couldn't text this number\" at once", () => {
  const parsed = parseSubmittedGuests([
    { guestId: "g1", phoneLast4: null, onMingla: true, displayName: "Fin", claimed: false, inviteUrl: "https://usemingla.com/c/X", inviteCode: "X", willText: false, notTextedReason: "no_phone" },
    { guestId: "g2", phoneLast4: "1111", onMingla: false, displayName: null, claimed: false, inviteUrl: "https://usemingla.com/c/Y", inviteCode: "Y", willText: true },
    { guestId: "g3", phoneLast4: "2222", onMingla: false, displayName: null, claimed: false, inviteUrl: "https://usemingla.com/c/Z", inviteCode: "Z" },
  ]);
  assertEquals(submittedGuestStatus(parsed[0], "going"), "We couldn't text this number");
  assertEquals(submittedGuestStatus(parsed[1], "going"), "Text on its way");
  // An older server sends no willText: still "on its way", never invented as failed.
  assertEquals(submittedGuestStatus(parsed[2], "going"), "Text on its way");
});


// N-7: the lazily loaded guest block holds its section's height while it
// loads, and a failed chunk load shows "Couldn't load the guest section." with
// "Try again" (a fresh loader) instead of breaking the RSVP page. A source
// check: the body is a React Native component this Deno lane cannot mount.
Deno.test("N-7 the guest block has a loading slot and a retry when its chunk fails", async () => {
  const src = await Deno.readTextFile(new URL("../RsvpOfferingBody.tsx", import.meta.url));
  const forms = src.slice(src.indexOf("const guestForms = showGuestStepper ?"));
  const suspense = forms.slice(0, forms.indexOf("<RsvpGuestPartyBlock"));
  assert(!suspense.includes("<Suspense fallback={null}>"), "the guest block no longer suspends to nothing");
  assert(
    suspense.includes("<Suspense fallback={<View style={[styles.guestSlot, surface.card]} />}>"),
    "a loading slot that reserves the section's height",
  );
  assert(/guestSlot: \{ minHeight: 160,/.test(src), "the slot keeps the block's height");
  assert(
    /import\("\.\/RsvpGuestPartyBlock"\)\.catch\(\(\) => \(\{\s*default:/.test(src) &&
      src.includes("Couldn't load the guest section. Try again") && /onPress=\{retry\}/.test(src),
    "a failed chunk load resolves to a slot that retries, not to an error",
  );
  assert(
    /loadGuestBlock\(\(\) => setGuestBlockTry\(\(n: number\) => n \+ 1\)\)/.test(src) &&
      /\[guestBlockTry\],/.test(src),
    "Try again makes a fresh loader",
  );
});

// The server's limit and own-number refusals read exactly as the form's own
// inline lines, though the two live in separate on-demand chunks.
Deno.test("refusal copy: the server's and the form's limit and own-number lines are the same words", () => {
  assertEquals(rsvpGuestErrorMessage("rsvp_plus_ones_exceeded"), RSVP_GUEST_LIMIT_REACHED);
  assertEquals(rsvpGuestErrorMessage("rsvp_guest_own_number"), RSVP_GUEST_OWN_NUMBER);
  assertEquals(RSVP_PARTY_COPY.limitReached, RSVP_GUEST_LIMIT_REACHED);
  assertEquals(RSVP_PARTY_COPY.own, RSVP_GUEST_OWN_NUMBER);
});

// ---- Fix round 4 -----------------------------------------------------------
// FAILS-ON-REVERT: mount the guest block for a signed-out viewer again -> T1-C
// fails; drop the unsupported_region branch -> P3-R fails; drop the new codes
// from rsvpGuestErrorMessage -> T1-E / P3-O fail.

Deno.test("T1-C signed out: the body shows the Bring someone card (lazy), never the guest block", async () => {
  // The card is React Native (not Deno-importable); its copy is pinned from
  // source. It lives in the guest section's own on-demand module.
  const cardSrc = await Deno.readTextFile(new URL("../RsvpGuestPartyBlock.tsx", import.meta.url));
  assert(cardSrc.includes('RSVP_BRING_SOMEONE_TITLE = "Bring someone"'), "title");
  assert(
    cardSrc.includes(`"Add a friend with just their number in the Mingla app. They'll get their own pass."`),
    "body",
  );
  assert(cardSrc.includes('RSVP_BRING_SOMEONE_CTA = "Get the app"') && cardSrc.includes('accessibilityRole="button"'),
    "a real button");
  const src = await Deno.readTextFile(new URL("../RsvpOfferingBody.tsx", import.meta.url));
  assert(
    /<RsvpGuestPartyBlock\s+\/\/[^\n]*\n\s+\/\/[^\n]*\n\s+signedOut=\{!isLoggedIn\}\s+onGetApp=\{props\.onGetApp\}/.test(src),
    "signed out: the guest section (loaded on demand) renders the card, with the surface's Get the app",
  );
  assert(
    /p\.signedOut === true \? \(\s*<RsvpBringSomeoneCard/.test(cardSrc) &&
      /export default RsvpGuestSection;/.test(cardSrc),
    "the section picks the card when signed out, the party panel otherwise",
  );
  assert(!/^import .*RsvpBringSomeoneCard/m.test(src), "no eager import of the card");
  assert(!/[\u{1F300}-\u{1FAFF}]/u.test(cardSrc), "no emoji");
});

Deno.test("T1-E / P3-O refusals: sign in, has a pass, and an older server in plain words", () => {
  assertEquals(rsvpGuestErrorMessage("rsvp_guest_sign_in_required"), "Update or open the Mingla app to bring someone");
  assertEquals(rsvpGuestErrorMessage("rsvp_guest_has_pass"), "You already have a pass for this event from a friend.");
  assertEquals(rsvpGuestErrorMessage("rsvp_guest_contact_required"), "Bringing someone isn't available yet. Try again soon.");
  assertEquals(rsvpGuestErrorMessage("rsvp_guest_keys_invalid"), "Bringing someone isn't available yet. Try again soon.");
});

Deno.test("P3-R a number we cannot text yet says so, with the paste text as the way", () => {
  const [g] = parseSubmittedGuests([{
    guestId: "g1",
    phoneLast4: "4567",
    willText: false,
    notTextedReason: "unsupported_region",
    inviteUrl: "https://usemingla.com/c/ABCDEFGHJK",
  }]);
  assertEquals(g.notTextedReason, "unsupported_region");
  assertEquals(
    submittedGuestStatus(g, "going"),
    "We can't text this number yet. Send them your invite yourself.",
  );
  const [other] = parseSubmittedGuests([{ guestId: "g2", willText: false, notTextedReason: "suppressed" }]);
  assertEquals(submittedGuestStatus(other, "going"), "We couldn't text this number");
  const [texted] = parseSubmittedGuests([{ guestId: "g3", willText: true }]);
  assertEquals(texted.notTextedReason, null);
  assertEquals(submittedGuestStatus(texted, "going"), "Text on its way");
});
