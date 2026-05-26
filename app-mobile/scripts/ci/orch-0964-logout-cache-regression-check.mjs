#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-0964 [public page theme customization] logout/cache regression.
 *
 * Consumer brand/profile theme data is cached under query keys that do not
 * carry a user id (`consumerBrand` by slug and `brandTheme` by event id).
 * The targeted auth-change predicate cannot remove those keys, so logout
 * privacy depends on `performPrivateAuthCleanup({ currentUserId: null })`
 * reaching the signed-out `queryClient.clear()` path.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

const read = (relativePath) =>
  fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

const checks = [];
const check = (name, pass, detail) => checks.push({ name, pass, detail });

const authCleanup = read("app-mobile/src/utils/authCleanup.ts");
const queryPersistence = read("app-mobile/src/utils/queryPersistence.ts");
const brandHook = read("app-mobile/src/hooks/useBrandBySlug.ts");
const eventThemeHook = read("app-mobile/src/hooks/useEventTheme.ts");

check(
  "L-01 consumer brand cache key is the ORCH-0964 public brand profile key",
  /consumerBrandKeys\s*=\s*\{[\s\S]*?all:\s*\[\s*["']consumerBrand["']\s*\]\s*as const[\s\S]*?bySlug:\s*\(slug:\s*string\)\s*=>\s*\[\s*\.\.\.consumerBrandKeys\.all,\s*slug\s*\]\s*as const/s.test(
    brandHook,
  ),
  "useBrandBySlug must keep the cache under ['consumerBrand', slug] so this regression guards the actual SC-21 key.",
);

check(
  "L-02 event theme cache key is the ORCH-0964 public event theme key",
  /eventThemeKeys\s*=\s*\{[\s\S]*?all:\s*\[\s*["']brandTheme["']\s*\]\s*as const[\s\S]*?byEventId:\s*\(eventId:\s*string\)\s*=>\s*\[\s*\.\.\.eventThemeKeys\.all,\s*eventId\s*\]\s*as const/s.test(
    eventThemeHook,
  ),
  "useEventTheme must keep the cache under ['brandTheme', eventId] so this regression guards the actual SC-21 key.",
);

check(
  "L-03 auth-change predicate remains user-id scoped only",
  /export function shouldRemoveForAuthChange\([\s\S]*?const keyUserId = getUserIdFromQueryKey\(queryKey\);[\s\S]*?if \(!keyUserId\) return false;[\s\S]*?return !currentUserId \|\| keyUserId !== currentUserId;/s.test(
    queryPersistence,
  ),
  "The targeted predicate intentionally cannot remove slug/event-id-only keys; signed-out cleanup must therefore clear the whole query client.",
);

check(
  "L-04 signed-out private auth cleanup clears the full React Query client",
  /export async function performPrivateAuthCleanup[\s\S]*?queryClient\.removeQueries\(\{[\s\S]*?predicate:\s*\(query\)\s*=>\s*shouldRemoveForAuthChange\(query\.queryKey,\s*currentUserId\),[\s\S]*?\}\);[\s\S]*?if \(!currentUserId\)\s*\{\s*queryClient\.clear\(\);\s*\}/s.test(
    authCleanup,
  ),
  "Logout must call queryClient.clear() when currentUserId is absent; otherwise ['consumerBrand', slug] and ['brandTheme', eventId] survive because they have no embedded user id.",
);

check(
  "L-05 logout still removes the persisted React Query snapshot from AsyncStorage",
  /const REACT_QUERY_PERSIST_KEY = ["']REACT_QUERY_OFFLINE_CACHE["'];[\s\S]*?if \(key === REACT_QUERY_PERSIST_KEY\) return true;/s.test(
    authCleanup,
  ),
  "Clearing memory cache is not enough; the offline React Query snapshot must also be classified as private storage and removed on logout.",
);

const failures = checks.filter((item) => !item.pass);
for (const item of checks) {
  console.log(`${item.pass ? "PASS" : "FAIL"} ${item.name}`);
  if (!item.pass) console.log(`  ${item.detail}`);
}

if (failures.length > 0) {
  console.error(`ORCH-0964 logout/cache regression failed: ${failures.length}/${checks.length}`);
  process.exit(1);
}

console.log("ORCH-0964 logout/cache regression passed.");
