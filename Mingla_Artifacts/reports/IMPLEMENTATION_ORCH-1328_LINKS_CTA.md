# IMPLEMENTATION — ORCH-1328 [links-cta-soft-nav-blank-page]

**Phase:** IMPLEMENT (executed the APPROVED binding contract)
**Contract:** `specs/SPEC_ORCH-1328_LINKS_CTA_FIX.md` (root cause: `investigations/INVESTIGATION_ORCH-1328_LINKS_CTA_SOFT_NAV.md`)
**Layman outcome:** On `usemingla.com/links`, tapping either tab's button now opens the App Store / right store / web app directly and **leaves `/links` on screen** — no more blank page (Explorer) or footer-only page (Business).

---

## 1. What changed (exactly per spec — ONE product file + the regression triad)

### Product file — `mingla-marketing/components/marketing/links-experience.tsx`
- **Imports:** removed `import Link from 'next/link'` (the CTA no longer soft-navigates); added `detectClientPlatform` (`@/lib/device-platform`) + the four store consts `APP_STORE_URL, PLAY_STORE_URL, BUSINESS_APP_STORE_URL, BUSINESS_WEB_URL` (`@/lib/store-links`).
- **`openExternal(dest)` helper:** `const win = window.open(dest, '_blank', 'noopener,noreferrer'); if (!win) window.location.assign(dest)` — popup-blocked → same-tab navigation fallback (no silent failure).
- **`onCtaClick(tab)` rewritten device-aware** (mirrors `glass-nav.tsx`): Business tab → iOS `BUSINESS_APP_STORE_URL`, else `BUSINESS_WEB_URL`; Explorer iOS → `APP_STORE_URL`, Android → `PLAY_STORE_URL`, desktop/other → `openExternal(tab.cta.href)` (= `/download`, UNCHANGED route, new tab for the QR). `links_page_cta_clicked` kept, enriched with `{ platform, store }`.
- **CTA element:** `<Link href=…>` → `<button type="button" onClick={() => onCtaClick(activeTab)}>` carrying the SAME `cn(CTA_BASE, CTA_INTENT[activeTab.cta.intent])` recipe (a real focusable, keyboard-activatable control).
- **Two stale comments updated** (CTA_BASE header + §4 CTA comment) to describe the new client device-aware action. No behavior change from the comments.
- **Preserved verbatim:** the ORCH-1327 persistent-pill switcher, the WAI-ARIA roving-tabindex tablist, reduced-motion, the one-viewport SNAPSHOT, the socials row. `lib/links-config.ts` / `lib/store-links.ts` / `lib/device-platform.ts` / `app/download/page.tsx` / `app/business/download/page.tsx` / both layouts — UNTOUCHED.

### Regression triad
- **GUARD:** `.github/scripts/strict-grep/orch-1328-links-cta-opens-store-clientside.mjs` (modeled on `orch-1319-getapp-cta-direct-store.mjs`; comment-stripped over the component). REQUIRES `detectClientPlatform` + all four store consts (word-boundary anchored so `\bAPP_STORE_URL\b` ≠ `BUSINESS_APP_STORE_URL`) + `<button` + `onClick={() => onCtaClick(` + `window.open(` + `window.location.assign(` + `links_page_cta_clicked` + `platform ===`. BANS a `next/link` import + the `<Link` element + `<a href="/download"`/`<a href="/business/download"` + hardcoded `apps.apple.com`/`play.google.com`. `--self-test` 10/10.
- **CI job:** `orch-1328-links-cta-opens-store-clientside` wired into `.github/workflows/strict-grep-mingla-business.yml` immediately above the ORCH-1327 job, plus a registry comment line in the "Currently registered gates" block.
- **Invariant:** `I-PROPOSED-1328-LINKS-CTA-OPENS-STORE-CLIENT-SIDE` registered **DRAFT** in `Mingla_Artifacts/INVARIANT_REGISTRY.md` (flips ACTIVE at CLOSE).
- **Tests (append-only):** `components/marketing/__tests__/links-cta-device-aware.test.ts` (happy-path, presence, 7/7) + `.tester.test.ts` (adversarial, comment-stripped: no `next/link`/`<Link>`, no hardcoded literal, no store-branch reversal, desktop reaches the QR, fallback present, keyboard-activatable button, 7/7) — repo tsc+node pattern.

---

## 2. Gate results (all green)

| Gate | Command | Result |
|---|---|---|
| Package typecheck | `npm ci && npm run typecheck` | PASS (exit 0, clean) |
| Package build | `npm run build` | PASS (exit 0; `/links` static 5.24 kB) |
| New guard self-test | `node …/orch-1328-links-cta-opens-store-clientside.mjs --self-test` | PASS 10/10 |
| New guard live | `node …/orch-1328-links-cta-opens-store-clientside.mjs` | PASS |
| Happy-path test | tsc+node `links-cta-device-aware.test.js` | PASS 7/7 |
| Tester adversarial | tsc+node `links-cta-device-aware.tester.test.js` | PASS 7/7 |
| ORCH-1319 G-1..G-4 self-test | 4 guards | PASS (8/8, 6/6, 5/5, 4/4) |
| ORCH-1324 self-test | guard | PASS 11/11 |
| ORCH-1325 self-test | guard | PASS 10/10 |
| ORCH-1326 self-test + live | guard | PASS 11/11 + live green |
| ORCH-1327 self-test + live | guard | PASS 8/8 + live green |
| ORCH-1319 getapp live | guard | PASS (device-driven to live stores) |
| `links-config.tester.test.ts` | tsc+node | PASS 10/10 |
| `links-tab-switcher.test.ts` / `.tester.test.ts` | tsc+node | PASS 6/6 + 4/4 |
| `device-platform.test.ts` | tsc+node | PASS 7/7 |
| No dangling soft-nav | `grep -nE "next/link\|<Link[ >/]" links-experience.tsx` | NONE |

> Note on the spec's literal `grep -rn "next/link\|<Link"`: the raw substring `<Link` still matches `<Linkedin` (the lucide icon) and `<LinksTab…>` (generic type params) — both pre-existing and unrelated to the soft-nav. The meaningful checks (no `next/link` import, no `<Link>` JSX element) pass; the word-boundary grep `<Link[ >/]` returns NONE.

---

## 3. Fails-on-revert (proven)

Reverting the CTA to the original `<Link href={activeTab.cta.href}>` soft-nav (restoring the pre-ORCH-1328 component) makes the fix's evidence collapse:
- Happy-path `links-cta-device-aware.test.ts` → FAILS (loses `<button type="button">`, `window.open(`, `window.location.assign(`, the `tab.id === 'business'` branch).
- Strict-grep guard → FIRES (`next/link` import + `<Link` element banned; `<button`/`window.open(`/`window.location.assign(`/`platform ===`/all-four-consts required).

**fails-on-revert verified at `<HASH>`** (see final chat payload for the concrete hash).

---

## 4. Constitution compliance
- **No dead taps:** the button opens the store/web on the gesture; `/links` stays mounted (driven-proven in the investigation §3.3).
- **No silent failures:** `window.open` → `window.location.assign` popup-block fallback.
- **SSOT:** store URLs only from `lib/store-links.ts`; the guard bans hardcoded literals.
- **A11y:** the CTA is a real, focusable, keyboard-activatable `<button>` with the shared focus-ring; the ORCH-1327 roving-tabindex tablist is untouched.

## 5. Scope discipline
- Stayed in the spec allowlist (ONE product file + guard + workflow job + registry + two tests + this report).
- No push / PR / deploy / merge / CLOSE. No new npm dependency. DRAFT invariant (flips ACTIVE at CLOSE).
