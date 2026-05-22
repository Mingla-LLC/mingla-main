#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd(), "..");

const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const checks = [];
const assertCheck = (name, pass, detail) => {
  checks.push({ name, pass, detail });
};

const connectionsPage = read("app-mobile/src/components/ConnectionsPage.tsx");
const messageInterface = read("app-mobile/src/components/MessageInterface.tsx");
const tripBanner = read("app-mobile/src/components/chat/TripCountdownBanner.tsx");
const chatListItem = read("app-mobile/src/components/connections/ChatListItem.tsx");
const messagingService = read("app-mobile/src/services/messagingService.ts");

assertCheck(
  "T-01 event metadata is fetched for trip/event conversations",
  /fetchGroupEventMetaByIds/.test(connectionsPage) &&
    /business_public_events_view/.test(connectionsPage) &&
    /\.from\('brands'\)/.test(connectionsPage) &&
    /account_id/.test(connectionsPage),
  "ConnectionsPage must batch-load public event title, cover, brand, public card, and brand account metadata.",
);

assertCheck(
  "T-02 event title supersedes stale conversation name",
  /const conversationName = eventMeta\?\.title\?\.trim\(\)/.test(connectionsPage),
  "Trip/event group chats must render the event/trip title instead of stale draft names.",
);

assertCheck(
  "T-03 event cover is passed as group avatar",
  /eventCoverMediaUrl: eventMeta\?\.coverMediaUrl/.test(connectionsPage) &&
    /friend\.eventCoverMediaUrl/.test(messageInterface) &&
    /conversation\.eventCoverMediaUrl/.test(chatListItem),
  "The event/trip cover image must reach both the chat header and chat list row.",
);

assertCheck(
  "T-04 public event and trip URLs are built distinctly",
  /const routePrefix = linkedEntityType === 'trip' \? 't' : 'e'/.test(connectionsPage) &&
    /BUSINESS_BUYER_DOMAIN/.test(connectionsPage) &&
    /eventPublicUrl/.test(messageInterface),
  "Banner taps must route trips to /t/:brand/:slug and events to /e/:brand/:slug.",
);

assertCheck(
  "T-05 countdown banner opens the in-app public event sheet",
  /TouchableOpacity/.test(tripBanner) &&
    /onPress\?: \(\) => void/.test(tripBanner) &&
    /accessibilityRole="button"/.test(tripBanner) &&
    /ExpandedBusinessEventSheet/.test(messageInterface) &&
    /setShowGroupEventSheet\(true\)/.test(messageInterface) &&
    /eventPublicCard/.test(connectionsPage) &&
    !/WebBrowser\.openBrowserAsync\(friend\.eventPublicUrl as string\)/.test(messageInterface),
  "TripCountdownBanner must expose an accessible press target and open the existing in-app public page sheet, not an external browser.",
);

assertCheck(
  "T-06 brand-account messages display the brand name",
  /eventBrandAccountId/.test(messageInterface) &&
    /msg\.senderId === brandAccountId/.test(messageInterface) &&
    /msg\.marketingCampaignId/.test(messageInterface) &&
    /getMessageSenderName\(item\.message\)/.test(messageInterface),
  "Consumer chat bubbles must show the brand name for planner/blast messages.",
);

assertCheck(
  "T-07 marketing campaign id is preserved through message mapping",
  /marketing_campaign_id/.test(messagingService) &&
    /marketingCampaignId: msg\.marketing_campaign_id \?\? null/.test(connectionsPage),
  "The client must preserve marketing_campaign_id so blast messages can render as brand voice.",
);

assertCheck(
  "T-08 broadcast-only flag is preserved through conversation mapping",
  /is_broadcast_only/.test(messagingService) &&
    /is_broadcast_only: Boolean\(\(conv as any\)\.is_broadcast_only\)/.test(connectionsPage) &&
    /isBroadcastOnly: Boolean\(conversationMeta\.is_broadcast_only\)/.test(connectionsPage),
  "The consumer chat must receive the server broadcast-only flag from list and selected-conversation paths.",
);

assertCheck(
  "T-09 broadcast-only consumer channels hide the composer",
  /const isBroadcastOnlyConsumerChannel =/.test(messageInterface) &&
    /const showComposer =/.test(messageInterface) &&
    /!isBroadcastOnlyConsumerChannel/.test(messageInterface) &&
    /\{showComposer && \(/.test(messageInterface) &&
    /Broadcast-only:/.test(messageInterface),
  "Broadcast-only trip/event chats must remove the input field and replace it with read-only channel context.",
);

assertCheck(
  "T-10 trip/event chats render broadcast-channel chrome",
  /Event broadcast/.test(messageInterface) &&
    /Trip broadcast/.test(messageInterface) &&
    /channelLine/.test(messageInterface) &&
    /broadcastChannelLine/.test(messageInterface) &&
    /styles\.broadcastChannelBanner/.test(messageInterface) &&
    /styles\.broadcastOnlyChannelBanner/.test(messageInterface) &&
    /eventChannelHeaderStack/.test(messageInterface) &&
    /eventChannelHeaderDivider/.test(messageInterface) &&
    /broadcastChannelIconShell/.test(messageInterface) &&
    /stackedWithChannel/.test(messageInterface) &&
    /backgroundColor: "#f97316"/.test(messageInterface),
  "Trip/event chats must visibly read as one premium event/channel header, not two generic group-chat bars.",
);

assertCheck(
  "T-12 event header copy is one-line and punchy",
    /Today ·/.test(tripBanner) &&
    /days'\} out ·/.test(tripBanner) &&
    /displayCopy/.test(tripBanner) &&
    /Icon name="calendar"/.test(tripBanner) &&
    /stackedText/.test(tripBanner) &&
    /fontSize: 15/.test(tripBanner) &&
    /fontWeight: '700'/.test(tripBanner) &&
    /color: '#FFFFFF'/.test(tripBanner) &&
    !/Today is/.test(tripBanner) &&
    !/actionText/.test(tripBanner) &&
    !/broadcastChannelTitle/.test(messageInterface) &&
    !/broadcastChannelDetail/.test(messageInterface),
  "Countdown and broadcast header copy must be compact one-line copy, not title/subtitle blocks.",
);

assertCheck(
  "T-11 broadcast-only bottom chrome reserves scroll clearance",
  /BROADCAST_COMPOSER_NOTICE_HEIGHT/.test(messageInterface) &&
    /broadcastComposerContentClearance/.test(messageInterface) &&
    /messageListBottomClearance = showComposer/.test(messageInterface) &&
    /bottomContentInset=/.test(messageInterface) &&
    /bottomContentInset\?: number/.test(read("app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx")),
  "Broadcast-only notice must not cover the newest message or public event sheet ticket actions.",
);

assertCheck(
  "T-13 chat list distinguishes direct, collaboration, and event broadcast rows",
  /eventContainer/.test(chatListItem) &&
    /collaborationContainer/.test(chatListItem) &&
    /directContainer/.test(chatListItem) &&
    /rowTypePill/.test(chatListItem) &&
    /\$\{eventKind\} broadcast/.test(chatListItem) &&
    /Collab session/.test(chatListItem) &&
    /formatEventListCountdown/.test(chatListItem) &&
    /formatEventListDate/.test(chatListItem) &&
    /otherParticipant\?\.avatar_url/.test(chatListItem) &&
    /p\.avatar_url/.test(chatListItem),
  "Chat list rows must have distinct default states and pass real profile avatars into direct and collaboration group renders.",
);

assertCheck(
  "T-14 event/trip chat list visibility requires buyer attendance",
  /fetchAttendableEventIdsForUser/.test(connectionsPage) &&
    /\.from\('orders'\)/.test(connectionsPage) &&
    /\.eq\('buyer_user_id', userId\)/.test(connectionsPage) &&
    /\.in\('payment_status', \['paid', 'partial_refund'\]\)/.test(connectionsPage) &&
    /visibleConversations/.test(connectionsPage) &&
    /attendingEventIds\.has\(eventId\)/.test(connectionsPage),
  "Consumer event/trip chat rows must only render when the user has a paid attendance order for that event/trip.",
);

assertCheck(
  "T-15 chat list rows align text after a fixed avatar lane with internal breathing room",
  /avatarColumn/.test(chatListItem) &&
    /width: 82/.test(chatListItem) &&
    /minHeight: 100/.test(chatListItem) &&
    /paddingVertical: 18/.test(chatListItem) &&
    /marginVertical: 4/.test(chatListItem) &&
    /marginBottom: 8/.test(chatListItem),
  "Chat list rows must keep cards close together while giving title, pill, preview, and timestamp a uniform internal rhythm.",
);

assertCheck(
  "T-16 trailing row chrome hides while archive/delete swipe actions are visible",
  /const \[isSwipeInteracting, setIsSwipeInteracting\] = useState\(false\)/.test(chatListItem) &&
    /onSwipeableOpenStartDrag=\{hideTrailingChromeForSwipe\}/.test(chatListItem) &&
    /onSwipeableWillOpen=\{hideTrailingChromeForSwipe\}/.test(chatListItem) &&
    /onSwipeableClose=\{restoreTrailingChromeAfterSwipe\}/.test(chatListItem) &&
    /isSwipeInteracting && styles\.trailingRowElementHidden/.test(chatListItem) &&
    /styles\.preview,[\s\S]*?isSwipeInteracting && styles\.trailingRowElementHidden/.test(chatListItem) &&
    /styles\.seenAgo, isSwipeInteracting && styles\.trailingRowElementHidden/.test(chatListItem) &&
    /trailingRowElementHidden:\s*\{\s*opacity: 0,/s.test(chatListItem),
  "The broadcast/collab pill, preview text, timestamp, and direct pair controls must not paint over archive/delete during a swipe gesture.",
);

assertCheck(
  "T-17 event/trip channel header opens an attendee/traveller profile sheet",
  /const eventAudienceKind = friend\.linkedEntityType === "trip" \? "travelling" : "attending"/.test(messageInterface) &&
    /const eventAudienceTitle = friend\.linkedEntityType === "trip" \? "Travellers" : "Attendees"/.test(messageInterface) &&
    /\? eventAudienceSubtitle\s*:\s*`\$\{headerParticipantCount\}/.test(messageInterface) &&
    /const \[showEventAudienceSheet, setShowEventAudienceSheet\] = useState\(false\)/.test(messageInterface) &&
    /const handleHeaderMorePress = \(\) => \{[\s\S]*?if \(isTripEventGroupChat\)/.test(messageInterface) &&
    /setShowEventAudienceSheet\(true\)/.test(messageInterface) &&
    /handleOpenAudienceProfile/.test(messageInterface) &&
    /onViewProfile\?\.\(participantId\)/.test(messageInterface) &&
    /visible=\{Boolean\(isTripEventGroupChat && showEventAudienceSheet\)\}/.test(messageInterface) &&
    /headerParticipants\.map\(\(participant\) =>/.test(messageInterface),
  "Event/trip broadcast channels must not say generic people-in-chat copy, and their header more action must open attendees/travellers with profile taps.",
);

const failed = checks.filter((check) => !check.pass);
for (const check of checks) {
  console.log(`${check.pass ? "PASS" : "FAIL"} ${check.name}`);
  if (!check.pass) console.log(`  ${check.detail}`);
}

if (failed.length > 0) {
  console.error(`ORCH-0897 consumer chat polish check failed: ${failed.length}/${checks.length}`);
  process.exit(1);
}

console.log(`ORCH-0897 consumer chat polish check passed: ${checks.length}/${checks.length}`);
