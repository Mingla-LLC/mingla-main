# INVESTIGATION — ORCH-1329 [partner-invite email polish + "Get the Mingla app" download CTA]

**Phase:** INVESTIGATE (read-only forensic). No fix proposed, no product code written, no scope expansion.
**Worktree:** `~/Desktop/mingla-orchs/orch-1329-[partner-invite-email-polish]/` on branch `orch-1329-partner-invite-email-polish` (rebased on `origin/main` @ `dd61352e2`).
**Surface:** backend-only — one transactional email rendered server-side by the `invite-brand-member` edge function; viewed in the recipient's mail client. No app runtime in scope.
**Comms ledger:** read on entry. No `BLOCK`+`OPEN` entry targets `mingla-forensics`, `ORCH-1329`, or `ALL` requiring action. `COMMS-0052`/`COMMS-0063` (business-app OTA/native-build blocks) are irrelevant here — this ORCH deploys an edge function only, no app build or OTA.

---

## 1. Symptom summary (expected vs actual)

- **Actual:** The partner-invite email built by `invite-brand-member` has exactly ONE call-to-action — the "Accept invitation" / "Accept & set up {Brand}" button pointing at `business.usemingla.com/accept-brand-invitation?token=…`. There is **no app-download link anywhere** in the HTML body or the plain-text fallback (verified: `grep -niE "download|get the app|onelink" invite-brand-member/*.ts` → 0 matches).
- **Expected (ORCH-1329):** the email should also carry a device-appropriate "Get the Mingla app" download CTA so the invited brand owner lands on the right app, plus general polish.
- **The central engineering constraint:** email clients do not execute JavaScript, so the client-side `detectClientPlatform()` / UA-branch pattern used by ORCH-1324/1328 in the web app **cannot run inside an email**. Device-appropriateness must be delivered another way.

---

## 2. Investigation manifest (every file read, in trace order)

| # | File | Why |
|---|------|-----|
| 1 | `COMMS_LEDGER.md` | Mandatory entry read; scan for BLOCK/WARN targeting me/ORCH-1329/ALL |
| 2 | `supabase/functions/invite-brand-member/index.ts` | The sole email path — `buildInviteEmail`, `sendInviteEmail`, `handler`, both variants, env vars |
| 3 | `supabase/functions/_shared/email/shell.ts` | `renderShell` singleton; where a new CTA may legally live |
| 4 | `supabase/functions/_shared/email/ticketBody.ts` | The `renderDownloadAppCta()` referenced by the dispatch — what it actually does |
| 5 | `supabase/functions/_shared/email/tripConfirmationEmail.ts` | Second `renderDownloadAppCta()` — same question |
| 6 | `supabase/functions/_shared/email/copy.ts`, `escape.ts` | Copy SSOT + the canonical `escapeHtml` the 0785-C gate keys on |
| 7 | `mingla-marketing/lib/store-links.ts` | Store-URL SSOT — consumer vs business App Store IDs, business web URL |
| 8 | `mingla-marketing/app/business/download/page.tsx` | The business smart-redirect route (ORCH-1326) — UA branch + 307 |
| 9 | `mingla-marketing/app/download/page.tsx` | The consumer smart-redirect route (ORCH-1319) |
| 10 | `mingla-marketing/lib/device-platform.ts` | `resolvePlatformFromUa` — proves the redirect is UA-string-only, server-side |
| 11 | `mingla-business/app/accept-brand-invitation.tsx` | Where the accept link lands → which app manages a brand |
| 12 | `supabase/functions/send-collaboration-invite/index.ts`, `send-phone-invite/index.ts` | Confirm they are NOT partner-email paths |
| 13 | `.github/scripts/strict-grep/orch-0785-buyer-string-escape.mjs`, `orch-0785-shell-singleton.mjs` | The two CI gates the implementor must satisfy |
| 14 | `.github/workflows/strict-grep-mingla-business.yml` | Confirm the gates are paths-gated on `supabase/functions/**` (they run for this change) |
| 15 | `supabase/functions/invite-brand-member/__tests__/orch-1050-invite-happy.test.ts` | The regression-test harness (CLOSE Step-0.5) |
| 16 | AppsFlyer MCP `get_onelink_templates` / `get_onelink_template_links` | OneLink live-state (ORCH-1313 P2) |

---

## 3. Q-scorecard

### Q1 — What does the invite email do today, and where exactly is the single CTA?
**Verdict (proven):** `invite-brand-member/index.ts::buildInviteEmail()` produces two variants from one function, each with one CTA button linking to the accept URL. Body assembled at `index.ts:287-292` (`greeting + attributionChip + bodyParagraph + personalNoteBlock + cta + finePrint`) and wrapped by `renderShell` at `index.ts:294-301`. The CTA button is `index.ts:259-268` → `href="${sharedEscapeHtml(input.acceptUrl)}"`. Accept URL built at `index.ts:517-523` = `${MINGLA_BUSINESS_WEB_URL || https://business.usemingla.com}/accept-brand-invitation?token=…`. No download link exists.

### Q2 — Can the ORCH-1324/1328 client-side UA branch run in an email?
**Verdict (proven):** No. `detectClientPlatform()` (`device-platform.ts:43-50`) reads `navigator`; mail clients strip/never run `<script>`. Device-appropriateness must be delivered by a **server-side** mechanism the email links to, or by giving the user an explicit choice.

### Q3 — Is there a server smart-redirect that 307s by User-Agent on a direct GET?
**Verdict (proven):** Yes — two of them, both shipped Next.js server components with `export const dynamic = 'force-dynamic'`:
- `app/business/download/page.tsx` (ORCH-1326): reads request UA (`headers().get('user-agent')`), `resolvePlatformFromUa(ua)`, then `if (platform === 'ios') redirect(BUSINESS_APP_STORE_URL); redirect(BUSINESS_WEB_URL)`. `redirect()` emits a **307**. iPhone → business App Store; **everyone else** (Android — Play still in review — + desktop/bot) → the business web app. No landing/QR page.
- `app/download/page.tsx` (ORCH-1319): consumer equivalent; iOS→App Store, Android→Play, desktop→QR+badges landing.

These work in email because when the recipient **taps** the button, the mail client opens the URL in the actual browser/webview, which sends a real device UA to the server, which 307s server-side. No JS required.

### Q4 — Which app should the download CTA point to?
**Verdict (proven): the BUSINESS app (`mingla-business`).** Evidence:
- The accept link lands at `business.usemingla.com/accept-brand-invitation` (`index.ts:517-523`), whose page is `mingla-business/app/accept-brand-invitation.tsx` (header comment line 5 confirms the URL; it is the business Expo-Router app / business web).
- The invitee becomes `brand_owner` and is told to "connect your bank so customers can buy tickets and you can get paid" (`index.ts:232-234`) — brand + event authoring is the BUSINESS app's job.
- `BUSINESS_APP_STORE_URL = https://apps.apple.com/app/id6768737367` (`store-links.ts:15`) is the LIVE business iOS listing; `/business/download` already routes iPhone→that listing, everyone else→`business.usemingla.com`.
- The consumer app (`id6760440898` / `com.mingla.app.v2`) is for attendees, not brand owners.

### Q5 — Is AppsFlyer OneLink live, and does it fit a business CTA?
**Verdict (proven): OneLink IS live but is configured for the CONSUMER app only → NOT usable for a business CTA without new config.** AppsFlyer MCP returned one template: `redirection_profile` (ID `w36m`), domain `mingla.onelink.me`, created **2026-07-06**, platforms **iOS `app|id6760440898`, Android `app|com.mingla.app.v2`** — both the CONSUMER app. One link: `https://mingla.onelink.me/w36m/r1g66ldx`. There is **no business-app (`id6768737367`) OneLink**. `store-links.ts:1-4` and `download/page.tsx:13-14` both document the OneLink swap as a FUTURE ORCH-1313 P2 seam, not yet wired into any store route.

### Q6 — What does the reusable `renderDownloadAppCta()` actually do — is it reusable here?
**Verdict (proven): NOT reusable as a store-download CTA.** Both copies render an "Open in Mingla" button linking to an **order-scoped consumer deep link**, not an app-store download:
- `ticketBody.ts:157-168`: `href="https://usemingla.com/orders/${escapeHtml(orderId)}/chat"`, label "Open in Mingla", card copy "Join your event chat in the Mingla app".
- `tripConfirmationEmail.ts:116-128`: identical pattern, `/orders/{orderId}/chat`, "Join your {trip} chat in the Mingla app".
Neither has any UA branch, store URL, or business context. The only reuse value is the **visual pattern** (soft-orange padded card + orange button) which the designer/implementor may mirror stylistically; the URL and semantics are wrong for a brand-owner "Get the app" CTA.

### Q7 — Is `invite-brand-member` the ONLY email path for "partner invites a user"?
**Verdict (proven): Yes.**
- `send-collaboration-invite/index.ts:1` — "This function does NOT send email despite its name." Push notifications only.
- `send-phone-invite/index.ts` — sends **SMS via Twilio** (`index.ts:237-250`), a CONSUMER friend invite: `"${inviterName} invited you to Mingla! Plan experiences together. Download now: https://mingla.app/invite"`. Not partner/brand.
- `marketing-send` — campaign/broadcast; `grep -niE "partner|brand_owner|brand_invitation"` → 0 matches.
- `notify-dispatch` — generic notifications; same grep → 0 matches.
- `accept-brand-invitation` (edge fn) — processes the token on the accept side; sends no invite email.
So the entire partner-invite email surface = `invite-brand-member/index.ts`, function `buildInviteEmail()`.

### Q8 — Do both email variants exist from one builder, and how do they differ?
**Verdict (proven):** One `buildInviteEmail()` (`index.ts:172-321`) branches on `partnerSetup`:
- **Partner-setup** (`partner_setup=true`, effective at `index.ts:549-550`): subject "{Brand} — your Mingla brand is ready to claim" (`:205-206`); attribution chip "Set up for you by {Inviter}" (`:220-226`); rich body about becoming owner + connecting bank (`:228-235`); CTA "Accept & set up {Brand}" (`:216-218`).
- **Standard team invite** (default): subject "{Brand} invited you to join their team on Mingla" (`:207`); no chip; one-line body "{Inviter} invited you to join {Brand} on Mingla as {Role}" (`:236-240`); CTA "Accept invitation". This variant is visibly **barer**.

### Q9 — What are the hard build constraints, and which are CI-enforced?
**Verdict (proven):** Four gates/invariants + text-parity + SSOT — see §7. All strict-grep gates are paths-gated on `supabase/functions/**` (`strict-grep-mingla-business.yml:6-17`), so they WILL run for a change to `invite-brand-member/index.ts`.

---

## 4. Findings (six-field evidence)

### F-1 — The invite email has zero download CTA; the single CTA is the accept token link.
1. **Symptom:** No "Get the app" link in HTML or text. 2. **Layer:** code. 3. **Probe:** `grep -niE "download|get the app|business/download|onelink" supabase/functions/invite-brand-member/*.ts`. 4. **Evidence:** 0 matches; body assembly `index.ts:287-292` contains only `greeting, attributionChip, bodyParagraph, personalNoteBlock, cta, finePrint`; `text` (`index.ts:304-312`) ends "Accept: {url} … expires in 7 days." 5. **Mechanism:** the feature simply was never added. 6. **Severity:** CONFIRMED (the gap ORCH-1329 exists to fill).

### F-2 — A shipped, email-compatible business smart-redirect already exists.
1. **Symptom:** need a device-appropriate destination without JS. 2. **Layer:** code (marketing web). 3. **Probe:** read `app/business/download/page.tsx` + `device-platform.ts`. 4. **Evidence:** `const ua = (await headers()).get('user-agent') ?? ''; const platform = resolvePlatformFromUa(ua); if (platform === 'ios') redirect(BUSINESS_APP_STORE_URL); redirect(BUSINESS_WEB_URL)` (`:27-32`); `resolvePlatformFromUa` is UA-string-only (`device-platform.ts:62-66`); `dynamic = 'force-dynamic'` (`:18`). 5. **Mechanism:** a single `<a href="https://usemingla.com/business/download">` in the email → mail client opens it in browser on tap → server reads real UA → 307 to the right destination. Zero email JS. 6. **Severity:** CONFIRMED ROOT of the recommended mechanism.

### F-3 — The two existing `renderDownloadAppCta()` helpers are order-chat deep links, not store downloads.
1. **Symptom:** dispatch suggested reuse. 2. **Layer:** code. 3. **Probe:** read both functions. 4. **Evidence:** `ticketBody.ts:163` + `tripConfirmationEmail.ts:123` both `href=".../orders/${orderId}/chat"` label "Open in Mingla". 5. **Mechanism:** they open a specific order's chat in the consumer app; no store logic. 6. **Severity:** CONFIRMED — option (4) is not directly reusable (visual pattern only).

### F-4 — OneLink is live but consumer-only.
1. **Symptom:** is OneLink an option? 2. **Layer:** runtime (AppsFlyer). 3. **Probe:** MCP `get_onelink_templates`, `get_onelink_template_links(w36m)`. 4. **Evidence:** template `w36m`, platforms iOS `id6760440898` + Android `com.mingla.app.v2` (both CONSUMER); link `https://mingla.onelink.me/w36m/r1g66ldx`; created 2026-07-06 by seth@usemingla.com. 5. **Mechanism:** routing a business owner through it would install the CONSUMER app. 6. **Severity:** CONFIRMED — option (2) infeasible for business without a new business-app OneLink.

### F-5 — No hosted store-badge images exist in-repo; business Play listing does not exist.
1. **Symptom:** could we show dual badges? 2. **Layer:** data/assets. 3. **Probe:** `find . -iname '*app-store*.png' -o -iname '*google-play*.png' …`. 4. **Evidence:** 0 matches; `store-links.ts:11-13` comment: "Google Play still in review — no Play listing yet"; the business Android destination is the WEB app, not Play. 5. **Mechanism:** an email `<img>` store badge needs a hosted PNG (none) and a live listing (business Play = none). 6. **Severity:** CONFIRMED — option (3) is higher-cost and would ship a dead/absent Android target.

### F-6 — `tripConfirmationEmail.ts` bypasses `renderShell` and emits its own `<!DOCTYPE html>` — legal, but a pattern inconsistency.
1. **Symptom:** two email shells in the codebase. 2. **Layer:** code. 3. **Probe:** read file + the 0785-D gate. 4. **Evidence:** `tripConfirmationEmail.ts:205` emits `<!DOCTYPE html>`; `orch-0785-shell-singleton.mjs:42` skips everything under `_shared/email/`, so this is **allowed by the gate** (the file lives in that dir). 5. **Mechanism:** the singleton invariant is scoped to "outside `_shared/email/`", so trip-confirmation is grandfathered. 6. **Severity:** SUSPECTED CONTRIBUTOR (out-of-scope discovery; not a blocker for ORCH-1329).

---

## 5. Central-question analysis — the four mechanisms, ranked

| Rank | Mechanism | Feasibility | Needs | Trade-off |
|------|-----------|-------------|-------|-----------|
| **1 (RECOMMEND)** | **Single button → `https://usemingla.com/business/download`** (server 307 UA-branch) | **HIGH — route already shipped (ORCH-1326)** | Nothing new (static absolute URL; optional env for the origin). Points at BUSINESS app: iPhone→business App Store, else→business web app. | On desktop "Get the app" lands on the business web app (not a store) — correct for a brand owner. No install attribution (raw store URLs), but the route is the documented OneLink seam. |
| 2 | AppsFlyer OneLink | LOW | A NEW OneLink template for the business app (`id6768737367`) + a live business Play listing | Gains attribution but current OneLink is CONSUMER-only → wrong app; business Android not live. Defer to ORCH-1313 P2. |
| 3 | Dual App Store + Play badges | LOW–MED | 2 hosted badge PNGs (none exist) + a live business Play listing (none) | More visual, but dead Android link, higher build cost, and a manual choice instead of the smart redirect. |
| 4 | Reuse `renderDownloadAppCta()` | N/A for a store CTA | — | It links to `/orders/{id}/chat` (consumer order chat), not a store. Reuse the visual pattern only. |

**Recommendation: Option 1** — a single subordinate button linking to `https://usemingla.com/business/download`, targeting the **BUSINESS** app. It is the only option that is (a) already live and email-safe, (b) device-appropriate server-side with no JS, (c) pointed at the correct (business) app, and (d) forward-compatible with the OneLink swap (ORCH-1313 P2) because the redirect is centralised in the route, not the email.

---

## 6. Both-variants recommendation

**Include the download CTA in BOTH variants** (partner-setup AND standard team invite), as a **secondary** element subordinate to the primary Accept button.

Reasoning: every recipient of this email — a `brand_owner` OR any team role (`event_manager`, `finance_manager`, `marketing_manager`, `scanner`, `brand_admin`) — is being added to a brand to do brand work, which happens in the BUSINESS app. Scanners in particular need the app to scan at the door. The standard variant is the barest today (F-1/Q8) and benefits most from a clear next step. The primary CTA in both stays the token action ("Accept invitation" / "Accept & set up {Brand}"); the download CTA is placed below it (ideally below the fine print, or as a distinct card) and visually differentiated so two orange buttons don't compete.

**Open decision for Seth (see §10):** whether to suppress the download CTA for purely web-first roles. Recommendation: keep it in both, differentiated by hierarchy — do not gate by role.

---

## 7. Hard constraints the implementor must respect

1. **ORCH-0785-C buyer-string-escape gate** — `.github/scripts/strict-grep/orch-0785-buyer-string-escape.mjs`, run by `strict-grep-mingla-business.yml` (paths-gated on `supabase/functions/**` → runs for this change). Inside any HTML-context template literal (one containing `<`/`>`/`style=`/`href=`), every interpolation whose leading identifier matches `^(order|event|brand|recipient|attendee|cta|paragraph|line|ticket)` must be `escapeHtml(...)` at the call site. **Concrete traps:** (a) the download URL should be a **static string literal** (no interpolation → nothing to escape); (b) if the implementor builds an HTML fragment variable and names it `ctaDownload`/`brandDownload`, interpolating `${ctaDownload}` inside an HTML-context literal will FAIL the gate — the safe names are a `*Html`/`*HTML` suffix (allowlisted, `:58`) e.g. `downloadCtaHtml`, or a `render*` function (`:59`); (c) any brand/inviter string placed inside the new CTA must be `sharedEscapeHtml(...)`.

2. **EMAIL_BRAND_SHELL_SINGLETON (I-PROPOSED-AD / ORCH-0785-D)** — `.github/scripts/strict-grep/orch-0785-shell-singleton.mjs`. No file under `supabase/functions/**` (outside `_shared/email/**`) may emit `<!doctype html>` / `<!DOCTYPE html>` / `<html lang=`. **The new CTA MUST be added inside the `bodyHtml` string passed to `renderShell` in `buildInviteEmail()`** (`index.ts:287-301`) — OR inside `shell.ts` itself. It may NOT introduce any new doctype/html wrapper in `invite-brand-member/index.ts`. Recommended home: append a fragment to `bodyHtml`.

3. **Plain-text fallback parity** — the `text` output (`index.ts:304-312`) currently ends at the accept URL + expiry with NO download URL. The implementor must append the download URL to the plain-text body (both variants), e.g. `Get the Mingla Business app: https://usemingla.com/business/download`.

4. **CLOSE Step-0.5 regression gate (fails-on-revert)** — commit a test FIRST that FAILS when the CTA is reverted and PASSES when restored. Harness precedent: `supabase/functions/invite-brand-member/__tests__/orch-1050-invite-happy.test.ts` — pure `deno test` over `buildInviteEmail()`. Add assertions that BOTH `payload.html` and `payload.text` include `usemingla.com/business/download`, for BOTH `partnerSetup:true` and `partnerSetup:false`. Respect the **tests-append-only** gate (`.github/workflows/tests-append-only.yml`): add a new test file or append; do not rewrite existing assertions. (The escape gate skips `__tests__`, so test HTML strings won't trip 0785-C.)

5. **Store-URL SSOT boundary** — `mingla-marketing/lib/store-links.ts` is the SSOT for the raw App Store IDs, but it is a Next.js module the Deno edge function **cannot import**. Keep the edge function OUT of the store-ID business: reference the **`/business/download` route URL** (which reads the SSOT server-side), NOT raw App Store IDs. Follow the existing env-with-default pattern used for `MINGLA_BUSINESS_WEB_URL` (`index.ts:519`) and the logo default (`index.ts:194-195`) — e.g. a new `MINGLA_MARKETING_URL` env (default `https://usemingla.com`) + `/business/download`, or a single documented constant. No edge fn currently references a marketing origin, so this is a fresh (small) addition.

---

## 8. Improvement opportunity list (for the designer — NOT a redesign performed here)

- **Standard-team-invite variant is bare:** no hero, no attribution chip, one-line body. It is the weakest surface and the place polish will show most.
- **Two-CTA hierarchy risk:** the primary Accept button is solid orange; a second solid-orange download button would compete. Differentiate (ghost/outline, or a distinct soft-orange card like the ticket pattern) so "Accept" clearly wins.
- **Dense partner-setup body:** "events, cover photos, description … connect your bank so customers can buy tickets and you can get paid" (`index.ts:228-235`) could become scannable steps/bullets.
- **Trust signal under-weighted:** "Your bank details go directly to Stripe — Mingla never sees them" (`index.ts:277-279`) is buried in grey fine print; it is a strong reassurance that could be elevated.
- **Fine-print wall:** expiry + raw URL + Stripe note is a block of muted text (`index.ts:270-279`); could be structured.
- **Role clarity (standard variant):** shows the role label but not what the role can do — a one-liner per role would help.
- **Preheader:** functional but could be more action-oriented (`index.ts:209-211`).
- **Sender warmth:** default `Mingla <noreply@usemingla.com>` (`index.ts:561-563`) reads cold on a personal partner-setup invite; consider a reply-enabled or brand-attributed from-name (flag only; sender change is arguably out of ORCH-1329 scope).
- **Mobile rendering:** the shell is single-column table-based already; the new CTA must keep a ≥44px tap target and not stack awkwardly beneath the fine print.
- **Transactional-compliance note:** this invite carries no List-Unsubscribe (likely fine as a 1:1 transactional invite, unlike `marketing-send`); confirm posture if copy/branding shifts it toward promotional.

---

## 9. Five-Truth-Layer reconciliation

| Layer | Finding | Contradiction? |
|-------|---------|----------------|
| **Docs** | Dispatch says a reusable `renderDownloadAppCta()` ships in ticket/trip emails | **Contradicted by code:** that helper is an order-chat deep link, not a store download (F-3). Code is truth. |
| **Schema** | `brand_invitations` + `partner_brand_links` written by the handler; role allow-set of 6 | Consistent; no email-relevant drift. |
| **Code** | One email path, two variants, one accept CTA, no download link | Truth for §1/§3. |
| **Runtime** | `/business/download` 307s by UA server-side; OneLink `w36m` is consumer-only | Confirms mechanism (F-2) and rules out OneLink for business (F-4). |
| **Data/Assets** | No hosted store-badge PNGs; business Play listing absent | Rules out clean dual-badge (F-5). |

---

## 10. Discoveries for the orchestrator + open questions for Seth

**Discoveries (out of scope for ORCH-1329):**
- D-1: `tripConfirmationEmail.ts` does not use `renderShell` and emits its own DOCTYPE — legal under the 0785-D gate (it lives in `_shared/email/`) but a shell inconsistency worth a future cleanup ORCH (F-6).
- D-2: The two `renderDownloadAppCta()` helpers link to consumer `/orders/{id}/chat` — if a business owner ever receives a ticket/trip email these send them to the CONSUMER app; not this ORCH's problem but a cross-app-attribution note.
- D-3: AppsFlyer OneLink `w36m` exists for the consumer app only; ORCH-1313 P2 still owes a business-app OneLink + the store-route swap.

**Open questions needing Seth's decision:**
1. **Both variants?** Recommend YES (both, differentiated by hierarchy). Confirm, or restrict to partner-setup only.
2. **Target app = BUSINESS** (evidence-backed recommendation). Confirm — a brand owner could in theory also want the consumer app, but management is the business app.
3. **Ship now with `/business/download`** (recommended, preserves the OneLink seam) vs. wait for a business-app OneLink (ORCH-1313 P2)? Recommend ship now.
4. **Sender from-name** on partner-setup invites — keep `noreply` or warm it up? (Flag only; likely a separate scope decision.)

---

## 11. Confidence + recommended next phase

**Confidence: proven** for all current-state facts (source read verbatim + live AppsFlyer MCP + CI-gate source). This is a backend/email/static-analysis investigation — no simulator repro applies (Prime Directive 7 exemption for pure backend/email work; the "runtime" evidence is the shipped route's documented 307 behavior + the live OneLink query).

**Recommended next phase: SPEC**, scoped to: add a single secondary "Get the Mingla Business app" CTA (→ `https://usemingla.com/business/download`) into `buildInviteEmail()`'s `bodyHtml` for BOTH variants + the plain-text fallback, plus the polish opportunities in §8 as a design contract (invoke `mingla-designer` for the CTA hierarchy + standard-variant polish). Scope stays inside `invite-brand-member/index.ts` + its `__tests__`; no marketing-web changes (route exists). Honor all §7 constraints; regression test per §7.4.

**Files the implementor will touch:**
- `supabase/functions/invite-brand-member/index.ts` — CTA fragment in `bodyHtml` (both variants) + download line in `text` + a marketing-origin env read (env-with-default pattern).
- `supabase/functions/invite-brand-member/__tests__/…` — new/appended regression test (both variants, html + text).
- No `mingla-marketing` change required (the `/business/download` route already exists). No `supabase/config.toml` change (`verify_jwt=true` already set).
