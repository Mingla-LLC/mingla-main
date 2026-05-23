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
  return {
    user_id: overrides.user_id,
    tier: overrides.tier,
    display_name: overrides.display_name ?? null,
    username: overrides.username ?? null,
    avatar_url: overrides.avatar_url ?? null,
    has_business_app: overrides.has_business_app ?? false,
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
  const migrationSource = read('supabase/migrations/20260724000002_orch_0933_get_user_circle_rpc.sql');
  assert.match(migrationSource, /v_caller uuid := auth\.uid\(\)/);
  assert.match(migrationSource, /v_caller IS NULL OR v_caller <> p_viewer_user_id/);
  assert.match(migrationSource, /USING ERRCODE = '42501'/);
}

function testBlockedUserExclusion() {
  const migrationSource = read('supabase/migrations/20260724000002_orch_0933_get_user_circle_rpc.sql');
  assert.match(migrationSource, /NOT EXISTS \(\s*SELECT 1\s*FROM public\.friends fb/s);
  assert.match(migrationSource, /fb\.user_id = p_viewer_user_id/);
  assert.match(migrationSource, /fb\.friend_user_id = c\.other_id/);
  assert.match(migrationSource, /fb\.status = 'blocked'/);
  assert.match(migrationSource, /fb\.deleted_at IS NULL/);
}

function testConsumerAppOnlyFilterAndBusinessOnlyExclusion() {
  const migrationSource = [
    read('supabase/migrations/20260724000002_orch_0933_get_user_circle_rpc.sql'),
    read('supabase/migrations/20260724000003_orch_0933_get_user_circle_rpc_ambiguity_fix.sql'),
  ].join('\n');
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

async function runYourCircleSectionAdversarialTest() {
  await testTierDeterministicWithSameUserInBothTiers();
  await testBadgeOnlyOnDualAppFlag();
  await testRpcSoleOwnerSpyOnFrom();
  await testEmptyStateWhenRpcReturnsEmptyArray();
  testRpcImpersonation42501();
  testBlockedUserExclusion();
  testConsumerAppOnlyFilterAndBusinessOnlyExclusion();
  testAvatarTapUsesCanonicalAppProfileOwner();
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
