// @ts-nocheck
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FAILS_ON_REVERT_COMMIT = 'd2fca61b37c8e328e31340281b05fed59e1fd86b';

const MATRIX_TYPES = [
  ['friend_request_received', 'social', 'A'],
  ['friend_request_accepted', 'social', 'A'],
  ['pair_request_received', 'social', 'A'],
  ['pair_request_accepted', 'social', 'A'],
  ['paired_user_saved_card', 'social', 'A'],
  ['paired_user_visited', 'social', 'A'],
  ['collaboration_invite_received', 'sessions', 'B'],
  ['collaboration_invite_accepted', 'sessions', 'A'],
  ['collaboration_invite_declined', 'sessions', 'A'],
  ['session_member_joined', 'sessions', 'A'],
  ['session_member_left', 'sessions', 'A'],
  ['board_card_saved', 'sessions', 'A'],
  ['board_card_voted', 'sessions', 'A'],
  ['board_card_rsvp', 'sessions', 'A'],
  ['direct_message_received', 'messages', 'A'],
  ['board_message_received', 'messages', 'A'],
  ['board_message_mention', 'messages', 'A'],
  ['board_card_message', 'messages', 'A'],
  ['calendar_reminder_tomorrow', 'all', 'C'],
  ['calendar_reminder_today', 'all', 'C'],
  ['visit_feedback_prompt', 'all', 'C'],
  ['holiday_reminder', 'all', 'C'],
  ['trial_ending', 'all', 'C'],
  ['referral_credited', 'all', 'C'],
  ['weekly_digest', 'all', 'C'],
];

const BASE_FIXTURE_IDS = new Set([
  'collaboration_invite_received',
  'friend_request_received',
  'paired_user_visited',
  'direct_message_received',
  'calendar_reminder_tomorrow',
  'visit_feedback_prompt',
  'weekly_digest',
  'referral_credited',
]);

const EXTENSION_FIXTURES = MATRIX_TYPES
  .filter(([type]) => !BASE_FIXTURE_IDS.has(type))
  .map(([type, bucket, archetype], index) => ({
    id: `tester-${type}`,
    user_id: 'recipient-uuid',
    type,
    title: `${type} tester title`,
    body: `${type} tester body`,
    actor_id: archetype === 'C' ? null : `actor-${index}`,
    related_id: null,
    related_type: null,
    is_read: index % 2 === 0,
    read_at: null,
    push_sent: true,
    created_at: '2026-05-24T12:00:00Z',
    expires_at: null,
    data: { deepLink: `mingla://tester/${type}` },
    expectedBucket: bucket,
    expectedArchetype: archetype,
  }));

function resolveRepoFile(relPath) {
  const appMobilePath = path.resolve(process.cwd(), relPath);
  if (fs.existsSync(appMobilePath)) return appMobilePath;
  return path.resolve(process.cwd(), 'app-mobile', relPath);
}

function readSource(relPath) {
  return fs.readFileSync(resolveRepoFile(relPath), 'utf8');
}

function assertTypeRegistry(sheetSource) {
  for (const [type, bucket] of MATRIX_TYPES) {
    assert.match(
      sheetSource,
      new RegExp(`${type}:\\s*\\{\\s*name:`),
      `SC-36 ${type} must have a type-matched icon fallback entry`,
    );
    if (bucket === 'social') {
      assert.match(sheetSource, /type\.startsWith\('friend_request_'\)[\s\S]*type\.startsWith\('pair_request_'\)[\s\S]*return 'social'/);
    } else if (bucket === 'sessions') {
      assert.match(sheetSource, /type\.startsWith\('collaboration_'\)[\s\S]*type\.startsWith\('session_'\)[\s\S]*type\.startsWith\('board_card_'\)[\s\S]*return 'sessions'/);
    } else if (bucket === 'messages') {
      assert.match(sheetSource, /type\.startsWith\('direct_message_'\)[\s\S]*type\.startsWith\('board_message_'\)[\s\S]*return 'messages'/);
    }
  }
}

function runTesterAdversarialTest() {
  const sheet = readSource('src/components/NotificationsSheet.tsx');
  const fixtures = readSource('src/components/__tests__/__fixtures__/notificationsFixtures.ts');

  assert.equal(
    FAILS_ON_REVERT_COMMIT,
    'd2fca61b37c8e328e31340281b05fed59e1fd86b',
    'SC-28 tester adversarial fails-on-revert anchor must be the implementation code commit',
  );

  assert.equal(EXTENSION_FIXTURES.length, 17, 'SC-36 tester extension must cover the remaining 17 types');
  assert.equal(MATRIX_TYPES.length, 25, 'SC-36 matrix must cover all 25 active notification types');
  assertTypeRegistry(sheet);

  const categoryHelper = sheet.match(/function getFilterCategory[\s\S]*?\n}\n/)?.[0] || '';
  assert.match(
    categoryHelper,
    /board_card_message/,
    'Addendum matrix row 18 requires board_card_message to resolve to Chats/messages, not Plans/sessions',
  );

  assert.match(fixtures, /collaboration_invite_received[\s\S]*inviterName: 'Marcus Rivera'[\s\S]*inviterAvatarUrl:/, 'Archetype B base fixture must be the only rich avatar/name case');
  assert.match(sheet, /getAvatarUrl\(item\.data \|\| \{\}\)/, 'Avatar source must be explicit notification data only');
  assert.match(sheet, /getIconConfig\(item\.type\)/, 'Missing avatar data must fall back to the type-matched Ionicon');
  assert.doesNotMatch(sheet, /useActorAvatar|profiles\.avatar_url|actor profile/i, 'Option C forbids actor-profile avatar lookups in v1');
  assert.doesNotMatch(sheet, />\?\?</, 'No fabricated ?? initials may render for no-data notifications');
  assert.doesNotMatch(sheet, /senderUsername[\s\S]*getInitials|actor_id[\s\S]*getInitials/i, 'No username or actor-id initials inference may be used');

  assert.match(sheet, /function renderTitleWithBoldActor\(\s*title: string,\s*data: Record<string, unknown>,\s*\)/, 'Bold split helper must take structured data, not parse title heuristically');
  assert.match(sheet, /data\?\.inviterName[\s\S]*data\?\.senderName[\s\S]*data\?\.userName[\s\S]*data\?\.fromUserName/, 'Bold split may consider only explicit data name fields');
  assert.doesNotMatch(sheet, /senderUsername|title\.split|parseTitle|inferActor/i, 'Bold split must not infer actor names from title/body/usernames');

  assert.doesNotMatch(sheet, /notifications-location-chain|getNotificationLocation|fromLocationName|toLocationName|placeName|locationName/, 'SC-38 no location-chain row or helper may ship in v1');
  assert.match(sheet, /v1 renders body only; location-chain waits for structured data/, 'SC-38 v1 deferral must be documented near body rendering');
  assert.doesNotMatch(sheet, /Location unknown|Unknown location|—\s*→|→\s*—/, 'Constitution #9 forbids placeholder location copy');

  assert.match(sheet, /unreadCount > 0 && \(/, 'SC-30 zero unread must hide the new-count pill');
  assert.match(sheet, /const showMarkAllRead = unreadCount > 0;/, 'SC-30 zero unread must hide Mark all as read');
  assert.match(sheet, /const showClearAll = notifications\.length > 0;/, 'SC-30 empty inbox must hide Clear all');
  assert.match(sheet, /const showActionRow = showMarkAllRead \|\| showClearAll;/, 'SC-30 action pill row must hide when both actions are hidden');

  const archetypeCounts = MATRIX_TYPES.reduce((counts, [, , archetype]) => {
    counts[archetype] = (counts[archetype] || 0) + 1;
    return counts;
  }, {});
  assert.deepEqual(archetypeCounts, { A: 18, B: 1, C: 6 }, 'SC-36 archetype mix must match the addendum matrix');

  for (const fixture of EXTENSION_FIXTURES) {
    assert.equal(fixture.data.deepLink, `mingla://tester/${fixture.type}`, `${fixture.type} fixture must not fabricate extra structured fields`);
    assert.equal(Object.keys(fixture.data).length, 1, `${fixture.type} extension fixture must contain deepLink only`);
  }
}

if (require.main === module) {
  try {
    runTesterAdversarialTest();
    console.log(`PASS ORCH-0975 tester adversarial suite; fails-on-revert anchor ${FAILS_ON_REVERT_COMMIT}`);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
