#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-1125 [cold deep-link "No QueryClient set" crash] — static regression.
 *
 * The React Query provider (PersistQueryClientProvider) used to live inside the
 * `/` (Home) route component App() in app/index.tsx, making it a SIBLING of the
 * public deep-link routes (/t/, /b/, /brand/). A cold deep-link opened in a
 * fresh process routed straight to one of those siblings before Home mounted,
 * so its first useQuery ran with no QueryClient in context and crashed with
 * "No QueryClient set, use QueryClientProvider to set one".
 *
 * The fix hoists the provider (+ its cacheReady cache-size gate, the persist
 * options, and the AnimatedSplashScreen overlay) into the expo-router root
 * layout app/_layout.tsx, wrapping <Stack/> inside StripeNativeProvider so
 * EVERY route — cold or warm — is a descendant of a QueryClient.
 *
 * This guard asserts the code SHAPE that prevents the regression:
 *   T-4  provider present in _layout.tsx, ABSENT (as code) from index.tsx
 *   T-6  exactly ONE QueryClient authority — no `new QueryClient(` anywhere in
 *        app/ (the singleton lives in src/config/queryClient.ts, imported)
 *   T-7  the provider is gated by `cacheReady` in _layout.tsx and the 1.5MB
 *        cache pre-clear effect runs there
 *   T-8  AnimatedSplashScreen mounted in _layout.tsx, gated by `!splashDone`
 *
 * Fails-on-revert: moving the provider back into index.tsx (and out of
 * _layout.tsx) flips T-4; removing the cacheReady gate flips T-7; removing the
 * splash flips T-8. Run: `npm run test:orch-1125`.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// scripts/ci -> app-mobile
const appRoot = path.resolve(__dirname, "../..");

const read = (rel) => fs.readFileSync(path.join(appRoot, rel), "utf8");

// Strip single-line `//` comments so explanatory ORCH-1125 comments that name
// these symbols do not satisfy/inflate the code-presence assertions.
const codeOnly = (src) =>
  src
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");

const layoutSrc = read("app/_layout.tsx");
const indexSrc = read("app/index.tsx");
const layoutCode = codeOnly(layoutSrc);
const indexCode = codeOnly(indexSrc);

const checks = [];
const check = (name, pass, detail) => checks.push({ name, pass, detail });

// ── T-4: provider present at root, absent (as code) from the / route ────────
check(
  "T-4a PersistQueryClientProvider mounted in app/_layout.tsx",
  /<PersistQueryClientProvider\b/.test(layoutCode),
  "The provider must wrap <Stack/> at the root layout so every cold deep-link is a descendant.",
);
check(
  "T-4b PersistQueryClientProvider absent (as code) from app/index.tsx",
  !/\bPersistQueryClientProvider\b/.test(indexCode) &&
    !/\bQueryClientProvider\b/.test(indexCode),
  "No QueryClient provider may be mounted on the / route — that is the original cold-route crash.",
);
check(
  "T-4c provider wraps <Stack/> in _layout.tsx",
  /<PersistQueryClientProvider[\s\S]*?<Stack\b[\s\S]*?<\/PersistQueryClientProvider>/.test(
    layoutCode,
  ),
  "<Stack/> must be a child of PersistQueryClientProvider so routes inherit the client.",
);

// ── T-6: exactly one QueryClient authority — no new client in app/ ──────────
const newClientInLayout = (layoutCode.match(/new\s+QueryClient\s*\(/g) || []).length;
const newClientInIndex = (indexCode.match(/new\s+QueryClient\s*\(/g) || []).length;
check(
  "T-6 no `new QueryClient(` instantiated in app/ (singleton imported from src/config/queryClient.ts)",
  newClientInLayout === 0 && newClientInIndex === 0,
  `Found ${newClientInLayout} in _layout.tsx + ${newClientInIndex} in index.tsx. The single client must be imported, never re-instantiated (Constitution #11 one-owner).`,
);
check(
  "T-6b _layout.tsx imports the queryClient singleton from src/config/queryClient",
  /import\s*\{[^}]*\bqueryClient\b[^}]*\}\s*from\s*["']\.\.\/src\/config\/queryClient["']/.test(
    layoutCode,
  ),
  "The provider must use the imported singleton instance, not a new client.",
);

// ── T-7: cacheReady gate + 1.5MB pre-clear effect at root ───────────────────
check(
  "T-7a provider mount is gated by `cacheReady` in _layout.tsx",
  /cacheReady\s*&&\s*\(?\s*[\s\S]{0,200}?<PersistQueryClientProvider\b/.test(layoutCode),
  "The Android 2MB-CursorWindow pre-clear must resolve (cacheReady) before the provider mounts.",
);
check(
  "T-7b the 1.5MB cache pre-clear effect lives in _layout.tsx and resolves cacheReady",
  /REACT_QUERY_OFFLINE_CACHE/.test(layoutCode) &&
    /1_500_000/.test(layoutCode) &&
    /setCacheReady\(true\)/.test(layoutCode),
  "The cache pre-clear (clear when length > 1.5MB) + setCacheReady(true) must run at root before the provider mounts.",
);
check(
  "T-7c the cache pre-clear effect was REMOVED from index.tsx (single owner)",
  !/REACT_QUERY_OFFLINE_CACHE/.test(indexCode),
  "The cacheReady pre-clear gate must live only at root after the move.",
);

// ── T-8: splash at root, gated by !splashDone ───────────────────────────────
check(
  "T-8a AnimatedSplashScreen mounted in _layout.tsx, gated by !splashDone",
  /!splashDone\s*&&\s*\(?\s*[\s\S]{0,80}?<AnimatedSplashScreen\b/.test(layoutCode),
  "The splash overlay must render at root while !splashDone so cold deep-links also show the splash.",
);
check(
  "T-8b AnimatedSplashScreen removed from index.tsx",
  !/<AnimatedSplashScreen\b/.test(indexCode),
  "The splash must live only at root after the move (single owner).",
);

// ── persist options preserved verbatim at root ──────────────────────────────
check(
  "P-1 persistOptions (shouldDehydrateMinglaQuery + 24h maxAge) preserved in _layout.tsx",
  /shouldDehydrateMinglaQuery\(query,\s*useAppStore\.getState\(\)\.user\?\.id\s*\?\?\s*null\)/.test(
    layoutCode,
  ) && /maxAge:\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/.test(layoutCode),
  "The dehydrate filter + 24h maxAge must move byte-identical so persistence behavior is unchanged.",
);

const failures = checks.filter((c) => !c.pass);
for (const c of checks) {
  console.log(`${c.pass ? "PASS" : "FAIL"} ${c.name}`);
  if (!c.pass) console.log(`  ${c.detail}`);
}

if (failures.length > 0) {
  console.error(
    `\nORCH-1125 static regression FAILED: ${failures.length}/${checks.length} checks failed.`,
  );
  process.exit(1);
}

console.log(`\nORCH-1125 static regression passed (${checks.length} checks).`);
