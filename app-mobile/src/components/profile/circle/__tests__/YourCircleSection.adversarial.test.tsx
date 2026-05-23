// @ts-nocheck
/* eslint-disable @typescript-eslint/no-require-imports */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const repoRoot = path.resolve(__dirname, '../../../../../..');

function read(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
}

function loadCircleServiceWithSupabase(supabase) {
  const servicePath = path.join(repoRoot, 'app-mobile/src/services/circleService.ts');
  const serviceSource = fs.readFileSync(servicePath, 'utf8');
  const compiled = ts.transpileModule(serviceSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: servicePath,
  }).outputText;

  const module = { exports: {} };
  const sandboxRequire = (request) => {
    if (request === './supabase') return { supabase };
    return require(request);
  };

  vm.runInNewContext(compiled, {
    require: sandboxRequire,
    module,
    exports: module.exports,
    console,
    Error,
    Map,
    Number,
  }, { filename: servicePath });

  return module.exports;
}

function makeRow(overrides) {
  const labels = {
    close: { source: 'paired', label: 'Close friend' },
    friend: { source: 'friend', label: 'Friend' },
    extended: { source: 'co_attendee', label: 'Also going to Supper Club' },
  };
  const relationship = labels[overrides.tier] ?? labels.extended;
  return {
    user_id: overrides.user_id,
    tier: overrides.tier,
    display_name: overrides.display_name ?? null,
    username: overrides.username ?? null,
    avatar_url: overrides.avatar_url ?? null,
    has_business_app: overrides.has_business_app ?? false,
    relationship_source: Object.prototype.hasOwnProperty.call(overrides, 'relationship_source')
      ? overrides.relationship_source
      : relationship.source,
    relationship_label: Object.prototype.hasOwnProperty.call(overrides, 'relationship_label')
      ? overrides.relationship_label
      : relationship.label,
    relationship_context_type: Object.prototype.hasOwnProperty.call(overrides, 'relationship_context_type')
      ? overrides.relationship_context_type
      : null,
    relationship_context_id: Object.prototype.hasOwnProperty.call(overrides, 'relationship_context_id')
      ? overrides.relationship_context_id
      : null,
    relationship_context_title: Object.prototype.hasOwnProperty.call(overrides, 'relationship_context_title')
      ? overrides.relationship_context_title
      : null,
    relationship_source_count: Object.prototype.hasOwnProperty.call(overrides, 'relationship_source_count')
      ? overrides.relationship_source_count
      : 1,
    sort_score: overrides.sort_score ?? 0,
  };
}

async function testTierDeterministicWithSameUserInBothTiers() {
  const fromCalls = [];
  const rpcCalls = [];
  const supabase = {
    rpc: async (name, args) => {
      rpcCalls.push({ name, args });
      return {
        data: [
          makeRow({
            user_id: 'same-user',
            tier: 'friend',
            display_name: 'Same User',
            sort_score: 2,
          }),
          makeRow({
            user_id: 'same-user',
            tier: 'close',
            display_name: 'Same User',
            sort_score: 1,
          }),
        ],
        error: null,
      };
    },
    from: (table) => {
      fromCalls.push(table);
      throw new Error(`Unexpected supabase.from(${table})`);
    },
  };

  const { fetchUserCircle } = loadCircleServiceWithSupabase(supabase);
  const people = await fetchUserCircle('viewer-user');

  assert.equal(people.length, 1);
  assert.equal(people[0].userId, 'same-user');
  assert.equal(people[0].tier, 'close');
  assert.deepEqual(fromCalls, []);
  assert.deepEqual(JSON.parse(JSON.stringify(rpcCalls)), [{
    name: 'get_user_circle',
    args: {
      p_viewer_user_id: 'viewer-user',
      p_limit: 60,
      p_offset: 0,
    },
  }]);
}

async function testBadgeOnlyOnDualAppFlag() {
  const supabase = {
    rpc: async () => ({
      data: [
        makeRow({ user_id: 'consumer-only-1', tier: 'close', has_business_app: false }),
        makeRow({ user_id: 'consumer-only-2', tier: 'friend', has_business_app: null }),
        makeRow({ user_id: 'consumer-only-3', tier: 'extended', has_business_app: false }),
        makeRow({ user_id: 'dual-app', tier: 'extended', has_business_app: true }),
      ],
      error: null,
    }),
    from: () => {
      throw new Error('supabase.from must not be called');
    },
  };

  const { fetchUserCircle } = loadCircleServiceWithSupabase(supabase);
  const people = await fetchUserCircle('viewer-user');

  assert.equal(people.filter((person) => person.hasBusinessApp).length, 1);
  assert.equal(people.find((person) => person.hasBusinessApp).userId, 'dual-app');

  const avatarSource = read('app-mobile/src/components/profile/circle/CircleAvatarTile.tsx');
  assert.match(
    avatarSource,
    /person\.hasBusinessApp \? <BusinessBadge hasBusinessApp=\{person\.hasBusinessApp\} \/> : null/,
  );
  const unguardedBriefcaseLines = avatarSource
    .split('\n')
    .filter((line) => line.includes('briefcase') && !line.includes('hasBusinessApp'));
  assert.deepEqual(unguardedBriefcaseLines, []);
}

async function testRpcSoleOwnerSpyOnFrom() {
  const fromCalls = [];
  const rpcCalls = [];
  const supabase = {
    rpc: async (name, args) => {
      rpcCalls.push({ name, args });
      return { data: [], error: null };
    },
    from: (table) => {
      fromCalls.push(table);
      return {};
    },
  };

  const { fetchUserCircle } = loadCircleServiceWithSupabase(supabase);
  await fetchUserCircle('viewer-user', 30, 60);

  assert.deepEqual(fromCalls, []);
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].name, 'get_user_circle');
  assert.deepEqual(JSON.parse(JSON.stringify(rpcCalls[0].args)), {
    p_viewer_user_id: 'viewer-user',
    p_limit: 30,
    p_offset: 60,
  });

  const serviceSource = read('app-mobile/src/services/circleService.ts');
  assert.doesNotMatch(serviceSource, /\.from\(['"](friends|pairings|orders)['"]\)/);
  assert.match(serviceSource, /supabase\.rpc\('get_user_circle'/);
}

async function testEmptyStateWhenRpcReturnsEmptyArray() {
  const supabase = {
    rpc: async () => ({ data: [], error: null }),
    from: () => {
      throw new Error('supabase.from must not be called');
    },
  };

  const { fetchUserCircle } = loadCircleServiceWithSupabase(supabase);
  const people = await fetchUserCircle('viewer-user');

  assert.equal(people.length, 0);

  const emptySource = read('app-mobile/src/components/profile/circle/CircleEmptyState.tsx');
  const sectionSource = read('app-mobile/src/components/profile/circle/YourCircleSection.tsx');
  assert.match(emptySource, /Your circle will grow as you meet people through Mingla/);
  assert.match(sectionSource, /people\.length === 0/);
  assert.match(sectionSource, /<CircleEmptyState \/>/);
}

function testRpcImpersonation42501() {
  const migrationSource = read('supabase/migrations/20260724000005_profile_circle_relationship_source.sql');
  assert.match(migrationSource, /v_caller uuid := auth\.uid\(\)/);
  assert.match(migrationSource, /v_caller IS NULL OR v_caller <> p_viewer_user_id/);
  assert.match(migrationSource, /USING ERRCODE = '42501'/);
}

function testBlockedUserExclusion() {
  const migrationSource = read('supabase/migrations/20260724000005_profile_circle_relationship_source.sql');
  assert.match(migrationSource, /NOT EXISTS \(\s*SELECT 1\s*FROM public\.friends fb/s);
  assert.match(migrationSource, /fb\.user_id = p_viewer_user_id/);
  assert.match(migrationSource, /fb\.friend_user_id = c\.other_id/);
  assert.match(migrationSource, /fb\.status = 'blocked'/);
  assert.match(migrationSource, /fb\.deleted_at IS NULL/);
  assert.match(migrationSource, /FROM public\.friends rb/s);
  assert.match(migrationSource, /rb\.user_id = c\.other_id/);
  assert.match(migrationSource, /rb\.friend_user_id = p_viewer_user_id/);
}

function testConsumerAppOnlyFilterAndBusinessOnlyExclusion() {
  const migrationSource = read('supabase/migrations/20260724000005_profile_circle_relationship_source.sql');
  assert.match(migrationSource, /consumer_users AS \(\s*SELECT DISTINCT ad\.user_id\s*FROM public\.appsflyer_devices ad\s*WHERE ad\.app = 'consumer'\s*\)/s);
  assert.match(migrationSource, /dual_app_users AS \(\s*SELECT DISTINCT ad\.user_id\s*FROM public\.appsflyer_devices ad\s*WHERE ad\.app = 'business'\s*\)/s);
  assert.match(migrationSource, /WHERE c\.other_id IN \(SELECT \w+\.user_id FROM consumer_users \w+\)/);
  assert.match(migrationSource, /\(c\.other_id IN \(SELECT \w+\.user_id FROM dual_app_users \w+\)\) AS has_business_app/);
  assert.doesNotMatch(
    migrationSource,
    /\bIN \(SELECT user_id FROM (consumer_users|dual_app_users)\)/,
    'PL/pgSQL RETURNS TABLE output column user_id makes unqualified SELECT user_id ambiguous',
  );
}

async function testRelationshipSourceMappingAndGenericLabelRemoval() {
  const supabase = {
    rpc: async () => ({
      data: [
        makeRow({
          user_id: 'event-user',
          tier: 'extended',
          display_name: 'Event User',
          relationship_source: 'co_attendee',
          relationship_label: 'Also going to Supper Club',
          relationship_context_type: 'event',
          relationship_context_id: 'event-1',
          relationship_context_title: 'Supper Club',
          relationship_source_count: 2,
          sort_score: 3,
        }),
        makeRow({
          user_id: 'friend-of-friend',
          tier: 'extended',
          display_name: 'FoF User',
          relationship_source: 'friend_of_friend',
          relationship_label: 'Friend of Maya',
          relationship_context_type: 'user',
          relationship_context_id: 'maya',
          relationship_context_title: 'Maya',
          sort_score: 2,
        }),
        makeRow({
          user_id: 'legacy-extended-source',
          tier: 'extended',
          display_name: 'Legacy User',
          relationship_source: null,
          relationship_label: null,
          sort_score: 1,
        }),
      ],
      error: null,
    }),
    from: () => {
      throw new Error('supabase.from must not be called');
    },
  };

  const { fetchUserCircle } = loadCircleServiceWithSupabase(supabase);
  const people = await fetchUserCircle('viewer-user');

  assert.equal(people.length, 3);
  assert.equal(people[0].relationshipSource, 'co_attendee');
  assert.equal(people[0].relationshipLabel, 'Also going to Supper Club');
  assert.equal(people[0].relationshipContextType, 'event');
  assert.equal(people[0].relationshipContextId, 'event-1');
  assert.equal(people[0].relationshipContextTitle, 'Supper Club');
  assert.equal(people[0].relationshipSourceCount, 2);
  assert.equal(people[1].relationshipSource, 'friend_of_friend');
  assert.equal(people[1].relationshipLabel, 'Friend of Maya');
  assert.equal(people[2].userId, 'legacy-extended-source');
  assert.equal(people[2].relationshipSource, 'mixed');
  assert.equal(people[2].relationshipLabel, 'Connected through Mingla');

  const avatarSource = read('app-mobile/src/components/profile/circle/CircleAvatarTile.tsx');
  assert.match(avatarSource, /person\.relationshipLabel/);
  assert.doesNotMatch(avatarSource, /Mingla connection/);
}

function testRelationshipSourceRpcContract() {
  const migrationSource = read('supabase/migrations/20260724000005_profile_circle_relationship_source.sql');

  assert.match(migrationSource, /relationship_source\s+text/);
  assert.match(migrationSource, /relationship_label\s+text/);
  assert.match(migrationSource, /relationship_context_type\s+text/);
  assert.match(migrationSource, /relationship_context_id\s+uuid/);
  assert.match(migrationSource, /relationship_context_title\s+text/);
  assert.match(migrationSource, /relationship_source_count\s+int/);
  assert.match(migrationSource, /tier_coattendee_event_matches AS/);
  assert.match(migrationSource, /o2\.payment_status = 'paid'/);
  assert.match(migrationSource, /o2\.buyer_user_id IS NOT NULL/);
  assert.match(migrationSource, /'Also going to ' \|\| e\.title/);
  assert.match(migrationSource, /'Also attended ' \|\| e\.title/);
  assert.match(migrationSource, /'Friend of ' \|\| tf\.mutual_friend_name/);
  assert.match(migrationSource, /CASE WHEN ter\.source_type_count > 1 THEN 'mixed'/);
  assert.doesNotMatch(migrationSource, /^\s*(order_id|ticket_id|buyer_email|buyer_name|buyer_phone|stripe_payment_intent_id)\s+/m);
}

function testRelationshipSourceMigrationUsesPostRemoteHeadVersion() {
  const migrationsDir = path.join(repoRoot, 'supabase/migrations');
  const migrations = fs.readdirSync(migrationsDir);

  assert.ok(
    migrations.includes('20260724000005_profile_circle_relationship_source.sql'),
    'profile circle relationship-source migration must use a version after linked remote head 20260724000004',
  );
  assert.ok(
    !migrations.includes('20260724000004_profile_circle_relationship_source.sql'),
    'colliding 20260724000004 profile circle migration must not remain in the local chain',
  );
}

function testPurchaseInvalidatesCircle() {
  const sheetSource = read('app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx');
  const hookSource = read('app-mobile/src/hooks/useCalendarEntries.ts');

  assert.match(sheetSource, /import \{ circleKeys \} from "\.\.\/\.\.\/hooks\/queryKeys"/);
  assert.match(sheetSource, /queryClient\.invalidateQueries\(\{ queryKey: circleKeys\.all \}\)/);
  assert.match(hookSource, /import \{ circleKeys \} from "\.\/queryKeys"/);
  assert.match(
    hookSource,
    /useOrdersRealtimeSubscription[\s\S]*?queryClient\.invalidateQueries\(\{ queryKey: circleKeys\.all \}\)/,
  );
}

function testAvatarTapUsesCanonicalAppProfileOwner() {
  const sectionSource = read('app-mobile/src/components/profile/circle/YourCircleSection.tsx');
  const profilePageSource = read('app-mobile/src/components/ProfilePage.tsx');
  const appIndexSource = read('app-mobile/app/index.tsx');

  assert.doesNotMatch(sectionSource, /ViewFriendProfileScreen/);
  assert.doesNotMatch(sectionSource, /<Modal\b/);
  assert.doesNotMatch(sectionSource, /selectedUserId/);
  assert.match(sectionSource, /onViewProfile\?\.\(person\.userId\)/);
  assert.match(profilePageSource, /onViewFriendProfile\?: \(userId: string\) => void/);
  assert.match(profilePageSource, /<YourCircleSection onViewProfile=\{onViewFriendProfile\} \/>/);
  assert.match(appIndexSource, /onViewFriendProfile=\{handleViewFriendProfile\}/);
  assert.match(appIndexSource, /onMessage=\{\(userId\) => \{\s*setViewingFriendProfileId\(null\);\s*setPendingOpenDmUserId\(userId\);\s*setCurrentPage\("connections"\);/s);
}

function testYourCircleHeaderHasNoSubtitle() {
  const sectionSource = read('app-mobile/src/components/profile/circle/YourCircleSection.tsx');

  assert.match(sectionSource, />Your Circle</);
  assert.doesNotMatch(sectionSource, /Close friends, friends, and people you meet at Mingla/);
}

async function runYourCircleSectionAdversarialTest() {
  await testTierDeterministicWithSameUserInBothTiers();
  await testBadgeOnlyOnDualAppFlag();
  await testRpcSoleOwnerSpyOnFrom();
  await testEmptyStateWhenRpcReturnsEmptyArray();
  await testRelationshipSourceMappingAndGenericLabelRemoval();
  testRpcImpersonation42501();
  testBlockedUserExclusion();
  testConsumerAppOnlyFilterAndBusinessOnlyExclusion();
  testRelationshipSourceRpcContract();
  testRelationshipSourceMigrationUsesPostRemoteHeadVersion();
  testPurchaseInvalidatesCircle();
  testAvatarTapUsesCanonicalAppProfileOwner();
  testYourCircleHeaderHasNoSubtitle();
}

if (require.main === module) {
  runYourCircleSectionAdversarialTest()
    .then(() => {
      console.log('PASS ORCH-0933 YourCircleSection adversarial regression');
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = { runYourCircleSectionAdversarialTest };
