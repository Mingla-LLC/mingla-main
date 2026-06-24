# IMPLEMENTATION — ORCH-1227 [business-name-and-legal-links]

**Branch:** `1227-business-name-and-legal-links`
**Commit:** `da0d5f87a67fb3e5d07914fb876352d7eb8aa2d4`
**Scope:** two App-Store-blocking BUSINESS-app fixes + CI regression guard. Surgical, no scope widening.

---

## FIX 1 — App display name (fixes Apple ITMS-90129)

The app's `CFBundleDisplayName`/`CFBundleName` resolved to the generic "Business", rejected by Apple
("bundle name/display name already taken"). Renamed the Expo top-level `name` to "Mingla Business".

### Diff — `mingla-business/app.json`
```diff
   "expo": {
-    "name": "Business",
+    "name": "Mingla Business",
     "slug": "mingla-business",
```
(`slug`, `bundleIdentifier`, `version`, package, and everything else untouched.)

### Diff — `mingla-business/app.config.ts`
```diff
     ...config,
-    name: config.name ?? "Business",
+    name: config.name ?? "Mingla Business",
     slug: config.slug ?? "mingla-business",
```

### `expo config` resolved-name verification
```
$ node_modules/.bin/expo config --json | (parse .name / .slug)
resolved name = "Mingla Business"
slug = "mingla-business"
```
Resolved top-level app name is now **"Mingla Business"**; slug unchanged.

---

## FIX 2 — Login footer legal links (dead domain → live pages)

`mingla-business/src/components/auth/BusinessWelcomeScreen.tsx` pointed the Terms/Privacy links at the
DEAD `mingla.app` domain (HTTP 000). Repointed to the live `usemingla.com` pages (both HTTP 200).
`openTerms`/`openPrivacy` already consume these constants — no other change in the file.

### Diff — `BusinessWelcomeScreen.tsx`
```diff
-const TERMS_URL = "https://mingla.app/terms";
-const PRIVACY_URL = "https://mingla.app/privacy";
+const TERMS_URL = "https://usemingla.com/terms-of-service";
+const PRIVACY_URL = "https://usemingla.com/privacy-policy";
```

---

## FIX 3 — Regression guard (CLOSE HARD MUST)

Business jest is not a blocking CI job, so protection is a strict-grep gate that runs in CI.

**Gate:** `.github/scripts/strict-grep/orch-1227-business-name-and-legal-links.mjs`
**Invariant:** `I-PROPOSED-1227-BUSINESS-NAME-AND-LEGAL-LINKS` (DRAFT until CLOSE)
**Wired into:** `.github/workflows/strict-grep-mingla-business.yml` (new top job
`orch-1227-business-name-and-legal-links`, runs `--self-test` then the live gate; registry comment added).

### Asserts
1. `mingla-business/app.json` Expo top-level `name` is exactly `"Mingla Business"` AND is NOT the bare
   `"Business"` (ITMS-90129 regression guard). Parsed as JSON, not substring.
2. `BusinessWelcomeScreen.tsx` `TERMS_URL = https://usemingla.com/terms-of-service` and
   `PRIVACY_URL = https://usemingla.com/privacy-policy`, AND the dead `mingla.app/terms` /
   `mingla.app/privacy` strings are GONE.

### Proof — PASS on fix
```
$ node .github/scripts/strict-grep/orch-1227-business-name-and-legal-links.mjs --self-test
ORCH-1227 business-name-and-legal-links self-test PASS (5/5 cases).   exit=0

$ node .github/scripts/strict-grep/orch-1227-business-name-and-legal-links.mjs
ORCH-1227 I-PROPOSED-1227-... PASS — app name is "Mingla Business" and login legal links
point at the live usemingla.com pages.   exit=0
```

### Proof — FAIL on revert (run against the real working-tree files, then restored)
Commit under test: **`da0d5f87a67fb3e5d07914fb876352d7eb8aa2d4`**

| Revert | Gate result |
|--------|-------------|
| A — `app.json` name → `"Business"` | FAIL, exit=1 (`expo.name must be "Mingla Business"` + `bare generic "Business" (ITMS-90129 regression)`) |
| B — `TERMS_URL` → `https://mingla.app/terms` | FAIL, exit=1 (`TERMS_URL must equal ...` + `dead link "https://mingla.app/terms" must be removed`) |
| C — `PRIVACY_URL` → `https://mingla.app/privacy` | FAIL, exit=1 (`PRIVACY_URL must equal ...` + `dead link "https://mingla.app/privacy" must be removed`) |
| Restored | PASS, exit=0 |

---

## Files changed (commit `da0d5f87a67fb3e5d07914fb876352d7eb8aa2d4`)
- `mingla-business/app.json` — name → "Mingla Business"
- `mingla-business/app.config.ts` — fallback name → "Mingla Business"
- `mingla-business/src/components/auth/BusinessWelcomeScreen.tsx` — TERMS_URL/PRIVACY_URL → usemingla.com pages
- `.github/scripts/strict-grep/orch-1227-business-name-and-legal-links.mjs` — new gate (+155)
- `.github/workflows/strict-grep-mingla-business.yml` — job + registry comment (+14)

## Hard guards honored
- Worktree only; no build/deploy/submit/merge/push (orchestrator owns those).
- Surgical edits only — bundleIdentifier/slug/version/package untouched.
- All work committed on `1227-business-name-and-legal-links`; working tree clean.
