// @ts-nocheck
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FAILS_ON_REVERT_COMMIT = '818b5f8b746e';

function resolveRepoFile(relPath) {
  const appMobilePath = path.resolve(process.cwd(), relPath);
  if (fs.existsSync(appMobilePath)) return appMobilePath;
  return path.resolve(process.cwd(), 'app-mobile', relPath);
}

function readSource(relPath) {
  return fs.readFileSync(resolveRepoFile(relPath), 'utf8');
}

function readJson(relPath) {
  return JSON.parse(readSource(relPath));
}

function listLocaleFiles() {
  const localesRoot = resolveRepoFile('src/i18n/locales');
  return fs
    .readdirSync(localesRoot)
    .map((lang) => path.join(localesRoot, lang, 'notifications.json'))
    .filter((file) => fs.existsSync(file));
}

function countMatches(source, pattern) {
  return (source.match(pattern) || []).length;
}

function runNotificationsSheetTest() {
  const sheet = readSource('src/components/NotificationsSheet.tsx');
  const homePage = readSource('src/components/HomePage.tsx');
  const designSystem = readSource('src/constants/designSystem.ts');
  const fixtures = readSource('src/components/__tests__/__fixtures__/notificationsFixtures.ts');

  assert.equal(
    FAILS_ON_REVERT_COMMIT,
    '818b5f8b746e',
    'document the pre-ORCH-0975 fail-on-revert anchor commit',
  );

  assert.match(sheet, /from '@gorhom\/bottom-sheet'/, 'SC-01..06 sheet must import bottom-sheet');
  assert.match(sheet, /\bBottomSheetSectionList\b/, 'SC-04 list must use BottomSheetSectionList');
  assert.doesNotMatch(sheet, /import\s+\{[^}]*\bModal\b[^}]*\}\s+from\s+['"]react-native['"]/, 'SC-01/C1 RN Modal import must not remain in NotificationsSheet');
  assert.doesNotMatch(sheet, /<Modal\b/, 'SC-01/C1 RN Modal render wrapper must not remain in NotificationsSheet');
  assert.doesNotMatch(sheet, /notifications-filter-chip|filters\.|FILTER_TAB_KEYS|activeFilter/, 'SC-07 filter chip state/rendering must be deleted');
  assert.doesNotMatch(sheet, /ScrollView/, 'SC-07 old horizontal filter ScrollView must not remain');

  assert.match(sheet, /header\.newCount/, 'SC-08 header must use the new-count pill locale');
  assert.match(sheet, /header\.subtitle/, 'SC-08 header subtitle must render');
  assert.match(sheet, /showMarkAllRead = unreadCount > 0/, 'SC-09..11 mark-all-read must hide when unreadCount is zero');
  assert.match(sheet, /showClearAll = notifications\.length > 0/, 'SC-10..11 clear-all must hide when empty');
  assert.match(sheet, /showActionRow = showMarkAllRead \|\| showClearAll/, 'SC-11 action row must hide when both halves are hidden');

  assert.match(sheet, /groupNotificationsByDate\(notifications, t\)/, 'SC-12 date grouping must consume the full unfiltered list');
  assert.match(sheet, /categoryLabels\.\$\{category\}/, 'SC-13 category pill must use categoryLabels namespace');
  assert.match(sheet, /avatarStatusDot/, 'SC-13 unread avatar status dot must exist');
  assert.match(sheet, /unreadDotRight/, 'SC-13 right-side unread dot must exist');
  assert.match(sheet, /cardUnreadBg/, 'SC-13 unread peach card tint must exist');
  assert.match(sheet, /ACTIONABLE_TYPES/, 'SC-14 actionable type registry must remain');
  for (const type of [
    'friend_request_received',
    'pair_request_received',
    'collaboration_invite_received',
    'trial_ending',
    'visit_feedback_prompt',
  ]) {
    assert.match(sheet, new RegExp(type), `SC-14 action button coverage for ${type}`);
  }

  assert.match(sheet, /onDeleteNotification\(notification\.id\)/, 'SC-15 non-actionable tap must still delete');
  assert.match(sheet, /onMarkAsRead\(notification\.id\)/, 'SC-15 actionable tap must still mark read');
  assert.match(sheet, /emptyState\.title/, 'SC-16 empty state title must remain');
  assert.match(sheet, /skeletonCard/, 'SC-17 skeleton cards must exist');
  assert.match(sheet, /errorState\.title/, 'SC-18 error state title must remain');
  assert.match(sheet, /offlineBanner/, 'SC-19 offline banner must exist');

  assert.match(sheet, /function getFilterCategory/, 'SC-22 getFilterCategory must remain');
  for (const type of [
    'friend_request_received',
    'friend_request_accepted',
    'pair_request_received',
    'pair_request_accepted',
    'paired_user_saved_card',
    'paired_user_visited',
    'collaboration_invite_received',
    'collaboration_invite_accepted',
    'collaboration_invite_declined',
    'session_member_joined',
    'session_member_left',
    'board_card_saved',
    'board_card_voted',
    'board_card_rsvp',
    'direct_message_received',
    'board_message_received',
    'board_message_mention',
    'board_card_message',
    'calendar_reminder_tomorrow',
    'calendar_reminder_today',
    'visit_feedback_prompt',
    'holiday_reminder',
    'trial_ending',
    'referral_credited',
    'weekly_digest',
  ]) {
    assert.match(sheet, new RegExp(type), `SC-36 all active notification types render via registry: ${type}`);
  }

  for (const file of listLocaleFiles()) {
    const locale = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(locale.filters, undefined, `SC-23 ${file} must not contain filters`);
    assert.deepEqual(
      Object.keys(locale.categoryLabels).sort(),
      ['all', 'messages', 'sessions', 'social'],
      `SC-23 ${file} must contain all category labels`,
    );
    assert.equal(locale.header.subtitle, 'Stay updated on what matters.');
    assert.equal(locale.header.newCount, '{{count}} new');
  }

  assert.match(homePage, /import NotificationsSheet from "\.\/NotificationsSheet"/, 'SC-25 HomePage import must point at NotificationsSheet');
  assert.match(homePage, /<NotificationsSheet/, 'SC-25 HomePage JSX must render NotificationsSheet');
  assert.doesNotMatch(homePage, /import NotificationsModal|<NotificationsModal/, 'SC-25 HomePage must not import or render the old component name');

  assert.match(designSystem, /notificationsSheet:/, 'SC-13 tokens must include glass.notificationsSheet');
  assert.match(designSystem, /categoryPill:[\s\S]*social:[\s\S]*sessions:[\s\S]*messages:[\s\S]*all:/, 'SC-13 category pill tokens must exist');

  assert.match(sheet, /function renderTitleWithBoldActor\(\s*title: string,\s*data: Record<string, unknown>,\s*\)/, 'SC-37 addendum title helper signature must take data');
  assert.match(sheet, /data\?\.inviterName[\s\S]*data\?\.senderName[\s\S]*data\?\.userName[\s\S]*data\?\.fromUserName/, 'SC-37 title split may use only explicit data name fields');
  assert.doesNotMatch(sheet, /senderUsername|actorName|title\.split|parse/i, 'SC-37 no heuristic title parsing or username inference');
  assert.match(sheet, /testID="notifications-title-bold-actor"/, 'SC-37 bold actor span must be explicit and testable');

  assert.doesNotMatch(sheet, /getNotificationLocation|notifications-location-chain|fromLocationName|toLocationName|placeName|locationName/, 'SC-38 location-chain row must not ship in v1');
  assert.match(sheet, /v1 renders body only; location-chain waits for structured data/, 'SC-38 code must document the v1 location deferral');

  assert.match(sheet, /getAvatarUrl\(item\.data \|\| \{\}\)/, 'SC-30 avatar URL must resolve from notification data');
  assert.match(sheet, /getIconConfig\(item\.type\)/, 'SC-30 avatar fallback must use type-matched icon');
  assert.doesNotMatch(sheet, /useActorAvatar|profiles\.avatar_url|actor profile/i, 'SC-30/37 no actor-avatar lookup hook in v1');
  assert.doesNotMatch(sheet, />\?\?</, 'SC-30 no fabricated placeholder initials render');

  assert.match(sheet, /accessibilityLabel="Close notifications"/, 'SC-32 close button must be accessible');
  assert.match(sheet, /accessibilityHint="Marks every unread notification as read"/, 'SC-32 mark-all-read hint must exist');
  assert.match(sheet, /accessibilityHint="Removes all notifications"/, 'SC-32 clear-all hint must exist');
  assert.match(sheet, /accessibilityLabel=\{`\$\{item\.title\}/, 'SC-32 card accessibility label must include notification content');

  assert.match(sheet, /export \{ NotificationsSheet as NotificationsModal \}/, 'SC-34 one-cycle named re-export shim must exist');
  assert.match(sheet, /export type NotificationsModalProps = NotificationsSheetProps/, 'SC-34 one-cycle type alias must exist');

  const fixtureIds = [
    'n-collab-invite',
    'n-friend-req',
    'n-pair-visit',
    'n-dm',
    'n-cal-tomorrow',
    'n-feedback',
    'n-digest',
    'n-referral',
  ];
  for (const id of fixtureIds) {
    assert.match(fixtures, new RegExp(id), `SC-36 fixture ${id} must exist`);
  }
  assert.equal(countMatches(fixtures, /baseFields\('/g), 8, 'SC-36 fixture set must contain exactly 8 notifications');
  assert.match(fixtures, /inviterName: 'Marcus Rivera'/, 'SC-37 fixture includes the only v1 bold-split case');
  assert.match(fixtures, /paired_user_visited/, 'SC-38 fixture covers body-only paired activity');

  const appPackage = readJson('package.json');
  assert.equal(appPackage.dependencies['@gorhom/bottom-sheet'], '^5.2.8', 'SC-35 bottom-sheet was already installed');
}

if (require.main === module) {
  try {
    runNotificationsSheetTest();
    console.log(`PASS ORCH-0975 NotificationsSheet structural regression suite; fails-on-revert anchor ${FAILS_ON_REVERT_COMMIT}`);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
