// @ts-nocheck — Deno-runtime source-contract suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4114 Wave 2b — the friends sheet, one Add a friend flow, and text
// invites with a working link. The rules themselves are covered in
// connections/__tests__/issue_4114_friends_sheet_model.implementor.happy.test.ts,
// the resolver in services/__tests__/issue_4114_friend_invite_resolver..., the
// server in supabase/functions/__tests__/issue_4114_send_pair_request_add_friend...
// and the claim in supabase/migrations/__tests__/issue_4114_friend_invite_token...
// This suite pins the WIRING so a revert of any call site fails CI.
//
// FAILS-ON-REVERT: the 65%-white empty text back in any of the three views;
// the friends sheet back to theme="light"; the tab=requests effect removed;
// AddFriendView back on createPendingInvite or not on send-pair-request; New
// message's Add a friend back on PairRequestModal; the combined Accept or the
// moved analytics removed; the swallowed pair limit in useFriendActions; the
// dead invite domain back in either edge function; the friend_invite dispatch
// or the onboarding claim removed.

const root = new URL("../../", import.meta.url);
const repo = new URL("../../../../", import.meta.url);
const read = (path: string) => Deno.readTextFile(new URL(path, root));
const readRepo = (path: string) => Deno.readTextFile(new URL(path, repo));
const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function block(source: string, startPattern: RegExp, length = 2400): string {
  const match = startPattern.exec(source);
  assert(match, `missing ${startPattern}`);
  return source.slice(match.index, match.index + length);
}

Deno.test("W-1 the friends sheet is dark and no empty state is 65% white on white", async () => {
  for (const file of [
    "components/connections/FriendsManagementList.tsx",
    "components/connections/RequestsView.tsx",
    "components/connections/BlockedUsersView.tsx",
  ]) {
    const source = strip(await read(file));
    assert(!/rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*0\.65\s*\)/.test(source), `${file}: the invisible 65% white empty text is back`);
    assert(/glass\.discover\.chatList/.test(source), `${file}: must take its colours from the dark chat-list tokens`);
  }
  const page = strip(await read("components/ConnectionsPage.tsx"));
  const sheet = block(page, /<BaseBottomSheet\s+visible=\{showFriendsModal && !anyFriendsChildOpen\}/, 600);
  assert(/theme="dark"/.test(sheet), "the friends sheet must be theme=\"dark\"");
  assert(!/theme="light"/.test(sheet), "the friends sheet must not be light");
  assert(/\["friend-list", "requests"\]/.test(page), "exactly two segmented tabs: Friends and Requests");
});

Deno.test("W-2 mingla://connections?tab=requests opens the friends sheet on Requests", async () => {
  const page = strip(await read("components/ConnectionsPage.tsx"));
  const effect = block(page, /deepLinkParams\.tab !== 'requests'/, 400);
  assert(/setFriendsModalTab\("requests"\)/.test(effect), "the effect must select Requests");
  assert(/setShowFriendsModal\(true\)/.test(effect), "the effect must open the friends sheet");
  assert(/onDeepLinkHandled\?\.\(\)/.test(effect), "the deep link must be marked handled");
});

Deno.test("W-3 every Add a friend goes through send-pair-request, with one invite record", async () => {
  const view = strip(await read("components/connections/AddFriendView.tsx"));
  assert(/useSendPairRequest\(\)/.test(view), "AddFriendView must send with useSendPairRequest");
  assert(/addFriendRequestBody\(/.test(view), "AddFriendView must build the body with addFriendRequestBody");
  assert(!/createPendingInvite/.test(view), "AddFriendView must not write a second invite record");
  assert(!/Alert\.alert/.test(view), "results show inline, not as alerts");
  for (const file of ["components/PairRequestModal.tsx", "components/onboarding/OnboardingFriendsAndPairingStep.tsx"]) {
    assert(!/createPendingInvite/.test(strip(await read(file))), `${file}: one invite record (send-pair-request), no createPendingInvite`);
  }
  const onboarding = strip(await read("components/onboarding/OnboardingFriendsAndPairingStep.tsx"));
  assert(!/from\('friend_requests'\)/.test(onboarding), "onboarding's add must not write friend_requests directly");
  assert(/sendPairMutation\.mutateAsync\(\{ friendUserId: lookupUser\.id \}\)/.test(onboarding), "onboarding's add must use send-pair-request");
  assert(/"send-pair-request"/.test(await read("services/pairingService.ts")), "the service calls the send-pair-request edge function");
});

Deno.test("W-4 New message's Add a friend opens the one Add a friend sheet", async () => {
  const page = strip(await read("components/ConnectionsPage.tsx"));
  const onAdd = block(page, /onAddFriend=\{\(\) => \{/, 300);
  assert(/openAddFriendSheet\(\)/.test(onAdd), "New message → Add a friend sheet");
  assert(!/setShowPairRequestModal\(true\)/.test(onAdd), "no longer the temporary PairRequestModal hookup");
  assert(/<AddFriendSheet\b/.test(page), "the Add a friend sheet is mounted");
  assert(/onPress=\{openAddFriendSheet\}/.test(page), "the friends sheet's Add opens it too");
});

Deno.test("W-5 ONE Accept runs both accepts and the accept analytics moved into the sheet", async () => {
  const page = strip(await read("components/ConnectionsPage.tsx"));
  const accept = block(page, /const handleAcceptReceived = useCallback/, 2600);
  assert(/runCombinedAccept\(row/.test(accept), "the combined row uses runCombinedAccept");
  assert(/acceptFriend: acceptFriendRequest/.test(accept), "friend accept = accept_friend_request_atomic path");
  assert(/acceptPairRequestMutation\.mutateAsync\(pairRequestId\)/.test(accept), "pair accept = accept_pair_request_atomic path");
  assert(/openPairingPaywall\(\)/.test(accept), "my limit opens the paywall");
  assert(/trackFriendRequestAccepted\(/.test(page), "mixpanel friend_request_accepted moved here");
  assert(/logAppsFlyerEvent\('friend_request_accepted'/.test(page), "AppsFlyer friend_request_accepted moved here");
});

Deno.test("W-6 the paywall opens on every pair-limit hit", async () => {
  const actions = strip(await read("hooks/useFriendActions.ts"));
  assert(/msg === "pairing_limit_reached"[\s\S]{0,200}setPaywallVisible\(true\)/.test(actions), "useFriendActions must open the paywall on the limit (it used to swallow it)");
  const sheet = strip(await read("components/friends/FriendActionsSheet.tsx"));
  assert(/<CustomPaywallScreen[\s\S]{0,120}feature="pairing"/.test(sheet), "FriendActionsSheet renders the pairing paywall");
  const card = strip(await read("components/IncomingPairRequestCard.tsx"));
  assert(/err\.message === "pairing_limit_reached"[\s\S]{0,80}onPairingLimitReached\?\.\(\)/.test(card), "IncomingPairRequestCard opens the paywall on the limit");
  const page = strip(await read("components/ConnectionsPage.tsx"));
  assert((page.match(/onPairingLimitReached=\{/g) ?? []).length >= 2, "PairRequestModal and IncomingPairRequestCard both get the paywall");
});

Deno.test("W-7 one confirmation after a pair send (no alert on top of the toast)", async () => {
  const modal = strip(await read("components/PairRequestModal.tsx"));
  assert(!/Alert\.alert\(t\('social:pairRequestSent'\)/.test(modal), "PairRequestModal must not alert as well as the parent's toast");
});

Deno.test("W-8 both invite texts link to the go.usemingla.com OneLink, never the dead domain", async () => {
  for (const fn of ["send-pair-request", "send-phone-invite"]) {
    const source = await readRepo(`supabase/functions/${fn}/index.ts`);
    assert(!/https?:\/\/mingla\.app/.test(source), `${fn}: the dead mingla.app link is back`);
    assert(/from "\.\.\/_shared\/friendInviteLink\.ts"/.test(source), `${fn}: must build the link with the shared OneLink builder`);
  }
  const builder = await readRepo("supabase/functions/_shared/friendInviteLink.ts");
  assert(/"https:\/\/go\.usemingla\.com\/w36m"/.test(builder), "the Explorer OneLink: go.usemingla.com, template w36m");
  assert(/FRIEND_INVITE_SMS_TEMPLATE\s*=/.test(builder), "the SMS words live in ONE constant for Seth to approve");
  const pair = strip(await readRepo("supabase/functions/send-pair-request/index.ts"));
  assert(/smsStatus,/.test(pair) && /inviteLink,/.test(pair), "the Tier-3 response returns the SMS outcome and the link");
});

Deno.test("W-9 a friend_invite link is held through sign-up and claimed after the phone is verified", async () => {
  const index = strip(await readRepo("app-mobile/app/index.tsx"));
  const branch = block(index, /case 'friend_invite': \{/, 1400);
  assert(/setPendingFriendInvite\(dest\.token\)/.test(branch), "the token is stashed like follow_invite");
  assert(/persistValidatedReferralCode\(dest\.referralCode\)/.test(branch), "the referral code is kept like referral");
  assert(/claimPendingFriendInvite\(\)/.test(branch), "signed in: claim straight away");
  assert(/mingla:\/\/connections\?tab=requests/.test(branch), "signed in: open Requests");
  const flow = strip(await read("components/OnboardingFlow.tsx"));
  const verify = block(flow, /const result = await verifyOtp\(buildE164\(\), code\)/, 4000);
  assert(/claimPendingFriendInvite\(\)/.test(verify), "onboarding claims the invite after the phone is verified");
  const step = strip(await read("components/onboarding/OnboardingFriendsAndPairingStep.tsx"));
  assert(/claimPendingFriendInvite\(\)/.test(step), "the friends step claims again (idempotent)");
  assert(/runCombinedAccept\(/.test(step), "the inviter card's ONE Accept does friend + pair");
});

Deno.test("W-10 a paired friend's 1:1 menu opens their birthday, holidays and saves", async () => {
  const chat = strip(await read("components/MessageInterface.tsx"));
  assert(/isPairedFriend && onOpenPairedProfile/.test(chat), "the row shows only for a paired friend");
  assert(/t\('connections:chat_menu_paired_view'\)/.test(chat), "the row label is translated");
  const page = strip(await read("components/ConnectionsPage.tsx"));
  assert(/onNavigateToFriendProfile\?\.\(friendUserId, \{ focus: "paired" \}\)/.test(page), "it opens the profile at the paired view");
  const profile = strip(await read("components/profile/ViewFriendProfileScreen.tsx"));
  assert(/initialFocus !== 'paired'/.test(profile), "the profile scrolls to the paired view on focus");
});
