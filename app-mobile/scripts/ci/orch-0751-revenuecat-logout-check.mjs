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

const revenueCatService = read('src/services/revenueCatService.ts');
const authCleanup = read('src/utils/authCleanup.ts');
const appIndex = read('app/index.tsx');
const useRevenueCat = read('src/hooks/useRevenueCat.ts');
const packageJson = JSON.parse(read('package.json'));

const helperIndex = revenueCatService.indexOf('export async function logoutRevenueCatIfIdentified');
const logOutIndexAfterHelper =
  helperIndex === -1 ? -1 : revenueCatService.indexOf('Purchases.logOut()', helperIndex);
const isAnonymousIndexAfterHelper =
  helperIndex === -1 ? -1 : revenueCatService.indexOf('Purchases.isAnonymous()', helperIndex);

check(
  'T1 service exports guarded logout helper',
  helperIndex !== -1,
  'src/services/revenueCatService.ts must export logoutRevenueCatIfIdentified',
);
check(
  'T2 service exports anonymous logout classifier',
  revenueCatService.includes('export function isRevenueCatAnonymousLogoutError'),
  'src/services/revenueCatService.ts must export isRevenueCatAnonymousLogoutError',
);
check(
  'T3 guarded helper checks anonymous state before strict logout',
  helperIndex !== -1 &&
    isAnonymousIndexAfterHelper !== -1 &&
    logOutIndexAfterHelper !== -1 &&
    isAnonymousIndexAfterHelper < logOutIndexAfterHelper,
  'logoutRevenueCatIfIdentified must call Purchases.isAnonymous() before Purchases.logOut()',
);
check(
  'T4 classifier recognizes RevenueCat anonymous logout code',
  revenueCatService.includes('PURCHASES_ERROR_CODE.LOG_OUT_ANONYMOUS_USER_ERROR') &&
    revenueCatService.includes('LOG_OUT_ANONYMOUS_USER_ERROR'),
  'classifier must recognize LOG_OUT_ANONYMOUS_USER_ERROR / code 22',
);
check(
  'T5 unknown RevenueCat logout errors still surface',
  revenueCatService.includes('if (isRevenueCatAnonymousLogoutError(error)) return null') &&
    revenueCatService.includes('throw error') &&
    authCleanup.includes('RevenueCat logout failed') &&
    appIndex.includes('logoutRevenueCatIfIdentified failed') &&
    useRevenueCat.includes("console.error('[RevenueCat] Logout failed:'"),
  'anonymous logout may no-op, but unexpected RevenueCat logout failures must still warn/error',
);
check(
  'T6 auth cleanup uses guarded logout, not strict logout',
  authCleanup.includes('logoutRevenueCatIfIdentified') &&
    !authCleanup.includes('logoutRevenueCat().catch'),
  'auth cleanup integration cleanup must call logoutRevenueCatIfIdentified',
);
check(
  'T7 root null-user branch avoids strict logout swallow',
  appIndex.includes('logoutRevenueCatIfIdentified().catch') &&
    !appIndex.includes('logoutRevenueCat().catch(() => {})'),
  'app/index.tsx null-user branch must not call logoutRevenueCat().catch(() => {})',
);
check(
  'T8 RevenueCat login merge path is preserved',
  revenueCatService.includes('const { customerInfo } = await Purchases.logIn(userId)') &&
    appIndex.includes('loginRevenueCat(user.id)'),
  'loginRevenueCat(userId) and root authenticated branch must remain intact',
);
check(
  'T9 useRevenueCatLogout uses guarded logout and clears CustomerInfo cache',
  useRevenueCat.includes('logoutRevenueCatIfIdentified') &&
    useRevenueCat.includes('UseMutationResult<CustomerInfo | null, Error, void>') &&
    useRevenueCat.includes('queryClient.removeQueries({ queryKey: revenueCatKeys.customerInfo() })') &&
    !useRevenueCat.includes('mutationFn: () => logoutRevenueCat()'),
  'useRevenueCatLogout must use guarded logout and remove CustomerInfo cache on success',
);
check(
  'T10 package script is registered',
  packageJson.scripts?.['test:orch-0751'] === 'node ./scripts/ci/orch-0751-revenuecat-logout-check.mjs',
  'package.json must expose test:orch-0751',
);
check(
  'T11 guarded logout serializes concurrent cleanup callers',
  revenueCatService.includes('let guardedLogoutInFlight: Promise<CustomerInfo | null> | null = null') &&
    revenueCatService.includes('if (guardedLogoutInFlight) return guardedLogoutInFlight') &&
    revenueCatService.includes('guardedLogoutInFlight = logoutPromise') &&
    revenueCatService.includes('if (guardedLogoutInFlight === logoutPromise)') &&
    revenueCatService.includes('guardedLogoutInFlight = null'),
  'logoutRevenueCatIfIdentified must share one in-flight logout so duplicate sign-out cleanup cannot call RevenueCat twice',
);

const failed = checks.filter((c) => !c.pass);
for (const result of checks) {
  console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name}`);
  if (!result.pass) console.log(`  ${result.detail}`);
}

if (failed.length > 0) {
  console.error(`\nORCH-0751 RevenueCat logout gate failed: ${failed.length} check(s) failed.`);
  process.exit(1);
}

console.log('\nORCH-0751 RevenueCat logout gate: PASS');
