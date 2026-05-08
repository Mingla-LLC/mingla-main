#!/usr/bin/env node
/* eslint-disable no-console */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const checks = [];
const check = (name, pass, detail) => {
  checks.push({ name, pass, detail });
};

const queryPersistence = read('src/utils/queryPersistence.ts');
check(
  'T1/T2 pending and non-idle queries are not dehydrated',
  queryPersistence.includes('query.state.status === "pending"') &&
    queryPersistence.includes('query.state.fetchStatus') &&
    queryPersistence.includes('query.state.fetchStatus !== "idle"'),
  'src/utils/queryPersistence.ts must reject pending and non-idle query states',
);
check(
  'T3/T4 auth-scoped query keys are matched to current user',
  queryPersistence.includes('getUserIdFromQueryKey') &&
    queryPersistence.includes('shouldRemoveForAuthChange') &&
    queryPersistence.includes('keyUserId !== currentUserId'),
  'src/utils/queryPersistence.ts must expose user-key matching/removal helpers',
);
check(
  'T7 cancellation errors are classified as non-errors',
  queryPersistence.includes('isQueryCancellationError') &&
    queryPersistence.includes('AuthStateCancelledError') &&
    queryPersistence.includes('AbortError'),
  'src/utils/queryPersistence.ts must classify cancellation/auth-state errors',
);

const index = read('app/index.tsx');
check(
  'T1-T4 app persistence uses shared Mingla predicate',
  index.includes('shouldDehydrateMinglaQuery(query, useAppStore.getState().user?.id ?? null)'),
  'app/index.tsx must call shouldDehydrateMinglaQuery with the current auth user',
);

const queryClient = read('src/config/queryClient.ts');
check(
  'T7 QueryCache does not error-log cancellation',
  queryClient.includes('isQueryCancellationError(error)') &&
    queryClient.includes('cancelled ${key}') &&
    queryClient.includes('return;'),
  'src/config/queryClient.ts must skip error breadcrumbs for cancellation errors',
);

const authCleanup = read('src/utils/authCleanup.ts');
check(
  'T5/T6 auth cleanup removes persisted private query cache',
  authCleanup.includes('REACT_QUERY_OFFLINE_CACHE') &&
    authCleanup.includes('queryClient.removeQueries') &&
    authCleanup.includes('queryClient.clear()') &&
    authCleanup.includes('AsyncStorage.multiRemove'),
  'src/utils/authCleanup.ts must clear React Query memory and persisted private cache',
);

const useAuthSimple = read('src/hooks/useAuthSimple.ts');
check(
  'T5/T6 auth listener routes null/user-switch through cleanup',
  useAuthSimple.includes("reason: 'initial-no-session'") &&
    useAuthSimple.includes("reason: 'auth-state-signed-out'") &&
    useAuthSimple.includes("reason: 'auth-user-switch'"),
  'useAuthSimple must cleanup on initial no-session, SIGNED_OUT, and user switch',
);
check(
  'T19 Apple cancel is not logged as app error',
  useAuthSimple.indexOf('code === "ERR_REQUEST_CANCELED"') <
    useAuthSimple.indexOf("logger.error('Apple sign-in failed'"),
  'Apple ERR_REQUEST_CANCELED must return before logger.error',
);

const directSignOutFiles = [
  'src/components/OnboardingFlow.tsx',
  'src/components/profile/AccountSettings.tsx',
  'src/hooks/useAuthSimple.ts',
];
const directSignOutViolations = directSignOutFiles.flatMap((file) => {
  const source = read(file);
  if (file === 'src/hooks/useAuthSimple.ts') {
    return source.includes('supabase.auth.signOut(') ? [file] : [];
  }
  return source.includes('supabase.auth.signOut(') ? [file] : [];
});
check(
  'T18 direct sign-out bypasses are removed',
  directSignOutViolations.length === 0,
  `Direct supabase.auth.signOut found in: ${directSignOutViolations.join(', ') || '(none)'}`,
);

const friendsHook = read('src/hooks/useFriendsQuery.ts');
const friendsService = read('src/services/friendsService.ts');
const blockService = read('src/services/blockService.ts');
check(
  'T8/T9 blocked users verify expected user and do not return false empty data',
  friendsHook.includes('fetchBlockedUsers(userId!)') &&
    friendsService.includes('AuthStateCancelledError') &&
    friendsService.includes('throw new AuthStateCancelledError') &&
    blockService.includes('expectedUserId') &&
    !friendsService.includes('console.error("Error fetching blocked users:"'),
  'blocked-users path must pass expected user and throw auth-state cancellation',
);

const profileInterests = read('src/hooks/useProfileInterests.ts');
check(
  'T10/T11 profile interests tolerate missing preferences row and upsert updates',
  profileInterests.includes('.maybeSingle()') &&
    profileInterests.includes('PreferencesService.updateUserPreferences'),
  'useProfileInterests must use maybeSingle and canonical upsert update',
);

const appsFlyer = read('src/services/appsFlyerService.ts');
check(
  'T12/T13 AppsFlyer stale callback no-ops',
  appsFlyer.includes('currentUserId !== userId') &&
    appsFlyer.includes('Device registration skipped') &&
    appsFlyer.includes('registeredDeviceKeys'),
  'AppsFlyer registration must verify current auth user before upsert',
);
check(
  'AppsFlyer listener flags do not warn without listeners',
  appsFlyer.includes('onInstallConversionDataListener: false') &&
    appsFlyer.includes('onDeepLinkListener: false'),
  'AppsFlyer listener flags must be disabled unless handlers are registered',
);

const engagement = read('src/services/cardEngagementService.ts');
check(
  'T14/T15 recordEngagement checks session before RPC',
  engagement.indexOf('supabase.auth.getSession()') <
    engagement.indexOf("supabase.rpc('record_engagement'") &&
    engagement.includes('skipped - not authenticated'),
  'recordEngagement must check session before RPC',
);

const appStateManager = read('src/components/AppStateManager.tsx');
check(
  'T17 AppStateManager does not subscribe to whole Zustand store',
  !appStateManager.includes('} = useAppStore();') &&
    appStateManager.includes('useAppStore((s) => s._hasHydrated)'),
  'AppStateManager must use selectors, not useAppStore() whole-store subscription',
);

const appStore = read('src/store/appStore.ts');
check(
  'T16 tabScroll has no-op guard',
  appStore.includes('Math.round(y)') &&
    appStore.includes('Math.abs((state.tabScroll[key] ?? 0) - nextY) < 2') &&
    appStore.includes('return state;'),
  'setTabScroll must avoid rewriting equivalent scroll positions',
);

const icon = read('src/components/ui/Icon.tsx');
check(
  'T20 icon warnings are mapped',
  icon.includes("'list-outline':") &&
    icon.includes("'sunny':") &&
    icon.includes("'partly-sunny':"),
  'Icon map must include list-outline, sunny, and partly-sunny aliases',
);

const failed = checks.filter((c) => !c.pass);
for (const result of checks) {
  console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name}`);
  if (!result.pass) console.log(`  ${result.detail}`);
}

if (failed.length > 0) {
  console.error(`\nORCH-0749 regression gate failed: ${failed.length} check(s) failed.`);
  process.exit(1);
}

console.log('\nORCH-0749 regression gate: PASS');
