# SPEC — ORCH-1382 [links-src-tracking-getapp-stack]

**Mode:** SPEC (build contract). No product code in this document.
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1382-[links-src-tracking-getapp-stack]` on branch `ORCH-1382-links-src-tracking-getapp-stack` (rebased onto `origin/main` @ `ebe07fa54`).
**Author:** mingla-forensics+claude · 2026-07-15
**Upstream:** ORCH-1381 [business-getapp-android-choice] + its ADDENDUM (shipped hours ago; this ORCH edits the same 4 surfaces).
**COMMS acked:** COMMS-0101 (WARN, `to: ALL`) — factored, **and materially corrected by execution** (see §0.1). New entry **COMMS-0103** filed.

---

## 0. Ground truth established at SPEC time (read before anything else)

Everything in this section was **re-verified by execution today**, not inherited. Three items in the
dispatch/ledger framing are **WRONG** and are corrected here. The dispatch instructed me to challenge
its own facts with contrary evidence; these are the results.

### 0.1 CORRECTION 1 — the business OneLink is **ALIVE on Android**. COMMS-0101 is STALE.

COMMS-0101 (2026-07-15) states: *"BUSINESS ONELINK STILL DEAD ON ANDROID … `minglabiz.onelink.me/ZSCW`
under Android UA → HTTP 200 'app unavailable' … `com.sethogieva.minglabusiness` (android) = 🟡 Pending."*
That is **no longer true.** Proven by two independent methods:

**Probe A — branded business OneLink, Android UA, 5 consecutive attempts (retried per the ~1-in-8 flake rule):**
```
curl -s -o /dev/null -w "%{http_code} -> %{redirect_url}\n" \
  -A 'Mozilla/5.0 (Linux; Android 13; Pixel 7) … Chrome/120.0.0.0 Mobile Safari/537.36' \
  https://biz.usemingla.com/ZSCW
```
```
301 -> market://details/?id=com.sethogieva.minglabusiness&referrer=af_tranid%3DMTgxMDIxNjIwNzcwMjM2NzgwODg%3D
301 -> market://details/?id=com.sethogieva.minglabusiness&referrer=af_tranid%3DMTU5ODE2NzY1NTM1OTk4ODgyNDk%3D
301 -> market://details/?id=com.sethogieva.minglabusiness&referrer=af_tranid%3DMjUxMjQwOTExMDY2MjA3MzI3OQ%3D%3D
301 -> market://details/?id=com.sethogieva.minglabusiness&referrer=af_tranid%3DMTg0MDYwMzAxMTkzNTUwMTk2MDE%3D
301 -> market://details/?id=com.sethogieva.minglabusiness&referrer=af_tranid%3DODcwODQ4NTg4MDIxMTQ5NTc5NA%3D%3D
```
**5/5 → 301 → `market://`.** Not a flake.

**Probe B — AppsFlyer MCP `get_apps` (authoritative account state):**
```
1. Mingla                        com.mingla.app.v2                 android  🟢 Active
2. Mingla: Host, Sell & Grow     com.sethogieva.minglabusiness     android  🟢 Active   ← was 🟡 Pending
3. Mingla –Date Plans & City Gems id6760440898                     ios      🟢 Active
4. Mingla: Host, Sell & Grow     id6768737367                      ios      🟢 Active
```
**All 4 apps Active.** The operator "Refresh Status" click COMMS-0101 asked for has happened.

**Consequence — this is the unlock for the whole ORCH.** The `orch-1381-business-getapp-android-choice.mjs`
gate docblock states its own lifting condition verbatim:

> *"BANS … minglabiz.onelink.me (DEAD on Android — AppsFlyer status Pending, COMMS-0101; **lifting this
> ban is a FUTURE ORCH gated on an operator dashboard Refresh Status + an Android curl returning the
> 301**)"*

**ORCH-1382 is that future ORCH, and its stated precondition is now MET and re-proven above.** The raw
`minglabiz.onelink.me` ban nevertheless **STAYS** (§10.4) — not because the link is dead, but because
Seth's routing policy says business traffic uses the branded `biz.usemingla.com` domain. Same ban, new
and now-correct rationale.

> Raw-domain aside (flake evidence): `minglabiz.onelink.me/ZSCW` under Android UA returned `200` on
> attempt 1 then `301 → market://` on attempts 2 and 3. This is the documented ~1-in-8 false failure.
> **It is entirely possible COMMS-0101's single "200 app unavailable" reading was itself a flake and
> the OneLink was never dead.** Unresolvable retroactively; recorded so nobody re-derives a "it was
> broken and got fixed" narrative that may never have happened. Either way, current state is proven.

### 0.2 CORRECTION 2 — the anchor change is **NOT** what fixes Seth's complaint. The OneLink is.

The dispatch says: *"Today every CTA calls `openExternal()` → `window.open(dest,'_blank')` with `dest` =
a PLAIN store URL. Android therefore loads the Play **website** first… Fix direction: make them plain
`<a href>` anchors pointing at the OneLink."*

The diagnosis of the symptom is exactly right. The attribution of the cause to `window.open` is **wrong**,
and it matters because it would let an implementor "fix" this by converting to anchors while keeping the
plain store URL — shipping a change that looks like the fix and does nothing.

- **The cause is the DESTINATION, not the opener.** `https://play.google.com/store/apps/details?id=…`
  returns `HTTP 200 text/html`. Chrome renders that page. This is true whether it is reached via
  `window.open()`, an `<a href>`, or a typed URL — the opener is irrelevant to what the server returns.
- **The OneLink returns `301 → market://…`** (proven, §0.1). Chrome hands `market://` straight to the
  Play app with no web page in between. That, and only that, is what removes the intermediate page.
- **Therefore: swapping the destination to the OneLink is load-bearing. Converting to anchors is not —
  for this symptom.**

**Anchors are still specified (§5.1), on independent and stronger grounds.** See the anchor decision.

### 0.3 CORRECTION 3 — the business copy is **NOT** literal-pinned in CI.

The dispatch says: *"The copy is CI-PINNED (`BUSINESS_APP_CHOICE_COPY` + the orch-1381 gate)… Changing it
means updating the pinned constant AND the gate, not hand-editing a button."*

The first half is right in spirit; **the second half is false**. Every live assertion is a *structural*
pin — it requires each surface to **render from the constant** — and **no live assertion pins the string
value**:

| Site | Assertion | Pins the literal? |
|---|---|---|
| `orch-1381-business-getapp-android-choice.mjs:164` | `if (!/BUSINESS_APP_CHOICE_COPY/.test(src))` | **No** — identifier only |
| `app/business/download/__tests__/business-download-route.tester.test.ts:121-125` | `/BUSINESS_APP_CHOICE_COPY/.test(src)` | **No** — identifier only |
| `orch-1381-business-getapp-android-choice.mjs:195` | `…= { download: 'Download the app', … }` | **No** — this is a **`--self-test` fixture string**, never compared to the real file |
| `lib/__tests__/business-app-target.tester.test.ts:70` | `"Download the app" and "Use on web" both resolve to…` | **No** — this is an **assertion failure *message***, not an assertion |

**This pin is well designed and should not be changed.** It forbids hand-writing a claim at a surface
(the real risk: a code-verified claim silently becoming an invented one) while permitting a deliberate,
single-point rewording at the source. **Ask (C)'s label change is therefore a ONE-LINE constant edit with
ZERO gate amendments.** Spelled out in §5.3.

### 0.4 CORRECTION 4 (new, discovered at SPEC time) — a **FOURTH decorative guard**.

The dispatch warns this codebase has produced THREE decorative guards. **There is a fourth, live on `main`
right now.** `orch-1328-links-cta-opens-store-clientside.mjs:125`:

```js
if (!/<button/.test(src)) {
  failures.push(`${TARGET}: the CTA must be a real <button> … not a <Link>/<a>.`);
}
```

`links-experience.tsx` renders the **tablist** with `<button role="tab">` (line 327). That token satisfies
this check **unconditionally**, forever, regardless of what the CTA is. Proven by execution:

```
-- orch-1328 check 3 (/<button/) against a CTA-as-anchor file that still has TAB buttons:
PASSES (decorative — matched the TAB button, not the CTA)
```

The check cannot fail while a tablist exists. It has never tested the CTA. **It is repaired in §10.1 —
not deleted** (the underlying "the CTA is a real, keyboard-activatable control" property is real and
worth keeping; it is simply re-expressed so it binds to the CTA).

### 0.5 Verified-and-CONFIRMED (dispatch was right)

| Claim | Status | Evidence |
|---|---|---|
| `src` → `pid` rides into the Play referrer | **CONFIRMED** | `…?pid=bio_youtube&c=business_bio` → `referrer=af_tranid%3D…%26pid%3Dbio_youtube%26c%3Dbusiness_bio` (3/3, both OneLinks) |
| Explorer OneLink `go.usemingla.com/w36m` live | **CONFIRMED** | Android → `301 market://details/?id=com.mingla.app.v2&referrer=pid%3D…`; iOS/desktop → `301 apps.apple.com/US/app/id6760440898?mt=8` |
| Business OneLink `biz.usemingla.com/ZSCW` live | **CONFIRMED** | §0.1; iOS → `301 apps.apple.com/US/app/id6768737367?mt=8` |
| Domain↔template mapping is correct, not crossed | **CONFIRMED** | MCP `get_onelink_templates`: `w36m`=`redirection_profile`→`id6760440898`/`com.mingla.app.v2` (consumer); `ZSCW`=`business_profile`→`id6768737367`/`com.sethogieva.minglabusiness` (business). Curls resolve to exactly those app IDs. |
| `lib/device-platform.ts` needs no change | **CONFIRMED** | `resolvePlatform` Android branch (`/android/i.test(ua)`) correct; **DO-NOT-TOUCH** (§7.2) |
| The 4 CTA surfaces are the right 4 | **CONFIRMED** | grep for `openExternal(` + `resolveBusinessAppTarget(` returns exactly those 4 + the helper |
| `orch-1326:63` `\bPLAY_STORE_URL\b` is word-anchored | **CONFIRMED** | ORCH-1381 already fixed it; **no re-amendment needed** |
| `orch-1342-store-links-ssot` is safe unamended | **CONFIRMED** | `SCAN_ROOTS = ["mingla-business/src", "mingla-business/app"]` — does **not** scan `mingla-marketing/`. Adding OneLink consts to the marketing SSOT cannot trip it; its byte-compare parses `APP_STORE_URL`/`PLAY_STORE_URL` by name and ignores new exports. |
| `rel="noopener"` on an anchor is safe vs the ORCH-1381 ban | **CONFIRMED** | ban regex is `/\.open\([^)\n]*\bno(?:opener\|referrer)\b[^)\n]*\)/` — scoped to `.open(`. Probe: anchor `rel="noopener"` → **passes**; `w.open(d,'_blank','noreferrer')` → **FIRES**. |

### 0.6 The `bio_` HARD RULE — **UPHELD**, reasoning corrected

The dispatch: *"Bare platform names (`facebook`, `tiktok`) are AppsFlyer **reserved SRN names** — using
them pours organic traffic into paid-ads reporting."*

**The rule is correct and is adopted verbatim as a hard contract (§4.2). Its stated mechanism is not
quite right**, and the spec should not carry a justification that a future reader can falsify and then
use to discard the rule.

AppsFlyer's SRN list (KB *Self-reporting networks (SRNs)*) is: Amazon Ads, Apple Ads, Google Ads, DV360,
**Meta ads**, Roku, **Snapchat—Advanced SRN**, Tencent Social Ads, **TikTok for Business—Advanced SRN**,
X Ads, Yahoo. Their `pid` values are `Facebook Ads`, `snapchat_int`, `bytedanceglobal_int`,
`googleadwords_int`, `twitter_int` — **not** the bare strings `facebook` / `tiktok`. So a bare `facebook`
pid would most likely *not* collide with a reserved name; it would mint a **new custom media source
named `facebook`** sitting one row away from `Facebook Ads` in every dashboard.

**That is still a reporting catastrophe, and the `bio_` rule still prevents it — for three sound reasons:**
1. **Namespace hygiene (the real one).** `facebook` adjacent to `Facebook Ads` in a media-source column is
   indistinguishable to a human reading a report. Organic bio traffic gets read as paid social. This is
   the corruption the dispatch describes; the mechanism is human ambiguity, not an API collision.
2. **Future-proofing.** AppsFlyer adds SRNs over time. `bio_*` is guaranteed collision-free against every
   present and future reserved name.
3. **Self-documenting.** `bio_youtube` states its own provenance; `youtube` does not.

**Net: keep the HARD rule exactly as written. Do not weaken it on the grounds that the reserved-name
claim is imprecise.** The rule is right; only the "why" needed repair.

---

## 1. Executive summary

Five changes to the public marketing site, all in `mingla-marketing/`:

- **(A)** Every store CTA becomes a **real `<a href>` anchor pointing at the AppsFlyer OneLink** instead
  of a JS `window.open()` of a plain store URL. The OneLink `301`s straight to `market://` (Android) /
  `apps.apple.com` (iOS), so the store app opens with **no intermediate web page**. `openExternal()`
  **survives, narrowed to exactly one genuine non-store destination** (the desktop QR page).
- **(B) THE HEADLINE.** `/links` becomes **source-aware and tracked**. `usemingla.com/links?src=youtube`
  carries `src` into the OneLink as `pid=bio_youtube` + `c=explorer_bio|business_bio`, so an install from
  Seth's YouTube bio is attributable **whichever app the visitor picks**. Today every bio install is
  anonymous. `src` is sanitised as untrusted input and fails safe to `bio_direct`.
- **(C)** Business tab: label `"Download the app"` → `"Get the app"`, and the two actions **stack
  vertically** instead of sitting side-by-side. This **structurally retires** the ORCH-1381 ADDENDUM D-A
  `px-4` overflow patch.
- **(D)** Snapchat joins the Explorer socials (`https://www.snapchat.com/add/usemingla`). **Explorer-only —
  there is no business Snapchat account.**
- **(E)** The socials taxonomy gains an **explicit, type-enforced `scope`** discriminator, replacing
  today's accidental modelling-by-omission (a missing `businessHref`).

**(D) and (E) are coupled and cannot be done independently — this is the single most important structural
finding in the spec.** Under today's model, adding Snapchat with no `businessHref` makes it render on
**both** tabs with the consumer handle — identical in the data to YouTube/LinkedIn. But YouTube/LinkedIn are
*deliberately* neutral (Seth: *"they're neutral used for investor and education"*) while Snapchat is
*explorer-only*. **Two opposite intents, one indistinguishable representation.** That is exactly the
implicit-modelling defect (E) names, and (D) is the change that makes it bite. §5.5 resolves both with a
three-kind discriminated union that makes the distinction a **compile-time** fact.

---

## 2. Scope & non-goals

### 2.1 In scope
1. OneLink destinations + anchor conversion on the 4 CTA surfaces (A).
2. `src`→`pid` capture, sanitisation, propagation on `/links` (B).
3. Business label + stacked layout (C).
4. Snapchat social (D).
5. Socials `scope` taxonomy (E).
6. All CI gate amendments the above force (§10), each proven fails-on-revert.

### 2.2 Explicit non-goals
| Not doing | Why |
|---|---|
| Changing `/download` or `/business/download` **route semantics** | `/download`'s 307-to-store behaviour is the QR target (ORCH-1319) and out of scope. `/business/download` keeps its Server-Component + plain-`<a>` shape; **only its `href` value changes**. |
| `GUEST_FUNNEL_ONELINK_URL` flip | See §2.3 — assessed, **does not supersede**. |
| Touching `mingla-business/` | Hard guard §7.2. The `orch-1342` byte-compare stays green because `APP_STORE_URL`/`PLAY_STORE_URL` are **not modified**, only added alongside. |
| Native builds / OTA | Web-only PR. The app a visitor installs is whatever is live in the store (1.1.2). Per COMMS-0100, **an attributed web download CTA needs no native build.** |
| Repo-wide `if (!win)` sweep | COMMS-0101 flags `mingla-admin/` + RN webviews as unswept. Real, but a separate ORCH. |
| Fixing #905 (cookie banner covers CTA) | Pre-existing, carried by QA_ORCH-1381 P2-3/R-D4. **But §6 SC-8 forbids this ORCH from making it worse**, which is live because (C) grows the panel. |
| Fixing #904 (`NOOPENER` case-sensitivity) | Pre-existing gate hole. §10.6 notes it; not fixed here. |

### 2.3 `GUEST_FUNNEL_ONELINK_URL` — assessed, **does NOT supersede**

`mingla-business/src/constants/storeLinks.ts:47` — `export const GUEST_FUNNEL_ONELINK_URL: string | null = null` (DARK).

**Verdict: unrelated. Leave dark. Do not touch.**
- **Different app, different surface.** It is the **consumer** OneLink (`go.usemingla.com/w36m`) for the
  **business web checkout guest funnel** (`/checkout/{eventId}` → "see who's going"). ORCH-1382 touches
  `mingla-marketing/` only.
- **Different attribution grammar.** Its consumers are `af_sub*` deep-link payloads carrying an event slug
  (`guestFunnelLink.ts:133`), not a bio `pid`.
- **Hard guard.** `mingla-business/**` is DO-NOT-TOUCH (§7.2). Flipping it would also require amending
  `orch_1342_download_cta_ssot.test.ts:76` (`expect(GUEST_FUNNEL_ONELINK_URL).toBeNull()`).

Its go-live is still owned by whoever revives ORCH-1342 §4.1. **Registered as a discovery, not scope.**

---

## 3. Cross-Surface Impact Declaration (MANDATORY)

| # | Surface | Covered | User-visible behaviour demanded | Files touched here | Parity |
|---|---|---|---|---|---|
| 1 | **Consumer iOS** (`app-mobile/` iOS) | **NO** | — | none | Not a code surface for this ORCH. The **installed app is affected**: it receives `pid=bio_*` install attribution from the live 1.1.2 build's AppsFlyer SDK. **No build needed** (COMMS-0100). |
| 2 | **Consumer Android** (`app-mobile/` Android) | **NO** | — | none | As #1. Receives `pid` via the Play `referrer` (proven §0.5). |
| 3 | **Buyer/anonymous Web** (`mingla-business/` `/checkout/*`, `/e/*`, `/b/*`, `/t/*`) | **NO** | — | none | DO-NOT-TOUCH (§7.2). `GUEST_FUNNEL_ONELINK_URL` stays dark (§2.3). |
| 4 | **Business iOS** | **NO** | — | none | As #1, business app. |
| 5 | **Business Android** | **NO** | — | none | As #2, business app. |
| 6 | **Admin Web** (`mingla-admin/`, adjacent) | **NO** | — | none | DO-NOT-TOUCH. Carries the unswept `if (!win)` class (COMMS-0101) — separate ORCH. |
| 7 | **Business Web preview** (adjacent) | **NO** | — | none | Untouched. |
| — | **Marketing Web** (`mingla-marketing/`) — **the only covered surface** | **YES** | A–E in full | §7.1 allowlist | **MANUAL parity across 4 CTA surfaces** — they do **not** share a component, only `lib/`. §6 splits success criteria per surface for exactly this reason. |

**Why the primary-5 table is all NO:** ORCH-1382 is a **web-only** change to the public marketing site.
The apps are consumers of its output (attribution), not participants in its diff. **`[deploy]` tag on the
CLOSE commit is MANDATORY** (touches `mingla-marketing/`).

---

## 4. The `src` → `pid` contract (ask B — the headline)

### 4.1 Grammar

```
usemingla.com/links?src=<src>
        │
        ├─ Explorer tab tapped → https://go.usemingla.com/w36m?pid=bio_<src>&c=explorer_bio
        └─ Business tab tapped → https://biz.usemingla.com/ZSCW?pid=bio_<src>&c=business_bio
```

`/links?src=youtube` + Business tab → `https://biz.usemingla.com/ZSCW?pid=bio_youtube&c=business_bio`
— exactly the dispatch's proposal. **Validated by execution** (§0.5): both OneLinks carry `pid` + `c`
through to the Play `referrer` intact.

| Param | Value | Rule |
|---|---|---|
| `pid` | `bio_<src>` | **HARD:** always `bio_`-prefixed (§0.6). Never bare. Never empty. |
| `c` | `explorer_bio` \| `business_bio` | From the **tab tapped**, not from `src`. |

### 4.2 HARD RULES (non-negotiable)

- **H-1.** `pid` is **always** `bio_`-prefixed. `pid=facebook` / `pid=tiktok` / `pid=` / `pid=bio_` must be
  **unreachable by construction**, not merely unlikely. Enforced by construction (§5.2), by unit test
  (T-3/T-4), and by gate (§10.5).
- **H-2. Never crossed.** Business → `biz.usemingla.com`. Explorer → `go.usemingla.com`. A crossed link
  silently installs the wrong app and poisons both apps' attribution. Enforced by §10.5 + T-7.
- **H-3.** The raw `minglabiz.onelink.me` / `mingla.onelink.me` domains never appear in a CTA. Branded
  domains only (ORCH-1346: 1 domain = 1 template).
- **H-4.** `src` is **untrusted input reaching an external URL**. Sanitise before use. Never interpolate raw.

### 4.3 Sanitisation + fail-safe

**Charset filter, NOT an allowlist.** Deliberate, and the call must be understood:
- An allowlist (`['youtube','linkedin','seth']`) would require a **code deploy per new channel** — which
  destroys the entire point of a source-aware link. Seth must be able to put `?src=podcast` in a new bio
  today and have it work.
- **Accepted residual risk:** a third party can mint `?src=whatever` and add junk rows to AppsFlyer
  reporting. Blast radius is bounded to *junk custom media sources under the `bio_` namespace* — they can
  never collide with a reserved SRN (H-1), never reach paid reporting, and never affect a destination.
  **Accepted.**

```
LINKS_SRC_PATTERN = /^[a-z0-9_]{1,32}$/      (applied AFTER lowercasing + trimming)
LINKS_SRC_FALLBACK = 'direct'                 → pid = 'bio_direct'
```

| Input `?src=` | Sanitised | Emitted `pid` | Rationale |
|---|---|---|---|
| `youtube` | `youtube` | `bio_youtube` | happy path |
| `YouTube` / `  YouTube  ` | `youtube` | `bio_youtube` | case/space tolerant — bios are typed by humans |
| `linkedin`, `seth` | as-is | `bio_linkedin`, `bio_seth` | the three named channels |
| **absent** | `direct` | `bio_direct` | **FAIL-SAFE** |
| `""` (empty) | `direct` | `bio_direct` | **FAIL-SAFE — never `pid=bio_`** |
| `<script>alert(1)</script>` | `direct` | `bio_direct` | rejected by charset |
| `a&b=c` / `../x` / `%2e%2e` | `direct` | `bio_direct` | injection rejected |
| 33+ chars | `direct` | `bio_direct` | length bound |
| `?src=a&src=b` (array) | `direct` | `bio_direct` | ambiguous → fail safe. **Next gives `string[]` here — an implementor treating `searchParams.src` as `string` ships `"a,b"`.** |
| `facebook` | `facebook` | `bio_facebook` | **SAFE** — `bio_` prefix is what makes a platform name safe (§0.6) |

**Rules:**
- **Fail-safe is `bio_direct`, never omission.** Omitting `pid` would let the install fall to the template
  default and become indistinguishable from organic — re-creating the exact anonymity this ORCH exists to
  kill. `bio_direct` is a real, queryable answer ("someone opened /links with no src").
- **Invalid and absent both → `bio_direct`.** One path, one fallback, nothing to get wrong.
- **Never throw.** A malformed `src` must never break the page.

### 4.4 Persistence across tab switches — **required**

`src` is a **page-level** value, resolved once on the server and passed as a prop. It is **not** tab state.
Switching Explorer↔Business **cannot** lose it — not by discipline, by structure. (Seth: *"whether `src`
should persist across tab switches (it should)"* — satisfied by construction; pinned by T-9.)

### 4.5 Where `src` is read — **server, not `useSearchParams()`**

Read in `app/links/page.tsx` (already a Server Component) via the `searchParams` prop; sanitise; pass the
resolved `src` down. **Do not use `useSearchParams()`.**

| | Server `searchParams` (**chosen**) | `useSearchParams()` (rejected) |
|---|---|---|
| Suspense boundary | not needed | **required**, or the build errors |
| Hydration | value present in first paint | client-only → flicker/mismatch risk |
| Testability | pure function, plain tsc+node | needs a router mock |
| Canonical SEO | `alternates.canonical: '/links'` already set (`page.tsx:19`) → `?src=` variants **do not fragment SEO** | same |

> Next 15 note: `searchParams` is a **Promise** and the page is already `async`-compatible. Reading it opts
> the route into dynamic rendering — correct and intended. `/links` has no `force-static`.

---

## 5. Layered specification

**No DB / edge-function / RLS / service / realtime layer is touched.** Marketing web only.

### 5.1 THE ANCHOR DECISION (ask A) — **anchors YES, for a different reason than stated**

**Decision: convert the store/web CTAs to real `<a href>` anchors with `target="_blank" rel="noopener"`.
Keep `openExternal()` for exactly one genuine non-store destination.**

**Why — the dispatch's reason does not hold, but three stronger ones do.**

The dispatch's reason (anchors stop Android loading the Play website first) is **false** (§0.2) — the
destination does that. Adopting anchors on a false premise would be a decorative decision. They are
adopted on these grounds instead:

1. **In-app browsers — the decisive one.** `/links` is a **link-in-bio page**. Its traffic is
   overwhelmingly Instagram / TikTok / LinkedIn / Snapchat **in-app webviews**. `window.open()` is
   routinely **blocked, ignored, or silently no-op'd** in those webviews; a plain anchor is the one
   navigation primitive that always works. **The current implementation's most important audience is the
   one most likely to have it fail.** An anchor removes that entire failure class.
2. **Correct semantics + free platform behaviour.** A CTA whose whole job is *navigate to a destination*
   is an `<a>`. This restores long-press → "Open in new tab", middle-click, "Copy link address",
   right-click, and screen-reader link semantics — all of which a `<button>` destroys. It also removes the
   popup-blocker dependency entirely.
3. **It matches the file's own proven precedent.** `links-experience.tsx:451-458` **already** renders the
   socials row as `<a href target="_blank" rel="noopener noreferrer">`. Anchors are not a new pattern here;
   the CTA is the odd one out.

**Why `target="_blank"` (and not same-tab):**
- Preserves ORCH-1328's `/links` **stays mounted** invariant **literally** — no amendment to that invariant
  is needed, only to the mechanism its gate checks.
- **Analytics survive.** `captureMarketing` on a same-tab anchor races the unload and can be lost.
  `_blank` leaves the page alive and the capture flushes. This is a real, silent data-loss trap.
- Matches the socials row (#3 above).

**Why `rel="noopener"` and NOT `rel="noreferrer"`:** per Seth's ORCH-1381 OQ-2 ruling (Referer to our own
store listings accepted, and it is useful attribution signal). For a OneLink the Referer is *actively
useful* to AppsFlyer.

> **TRAP — READ THIS BEFORE TOUCHING `rel`.** `open-external.ts`'s docblock and the ORCH-1381 gate say
> **"NEVER `noopener`/`noreferrer`"** in the loudest possible terms. That ban is scoped to
> **`window.open()` feature strings ONLY**, where either token makes `open()` return `null` even on
> success. **On an `<a>` element, `rel="noopener"` has no such pathology and is a required security
> property.** An implementor pattern-matching the ban onto anchors would ship a real reverse-tabnabbing
> regression while believing they were complying with ORCH-1381.
> **Proven by execution** — the ban regex is scoped to `.open(`:
> ```
> passes | anchor rel="noopener" (proposed ORCH-1382)
> passes | anchor rel="noopener noreferrer" (existing socials row)
> FIRES  | window.open noopener (the real bug)
> FIRES  | window.open noreferrer-only (half-fix trap)
> ```
> No gate conflict. §10.1 adds an explicit self-test case pinning this so nobody "helpfully" re-bans it.

#### Does `openExternal()` survive? — **YES, narrowed to exactly ONE call site.**

Direct answer to *"Spec whether `openExternal` survives at all, or only for genuine non-store destinations."*

**It survives, for genuine non-store destinations only. After ORCH-1382 it has exactly one call site:**
`links-experience.tsx` → **Explorer, desktop/other → `/download`** (the QR page).

Call-site ledger:

| Surface | Action | Before | After |
|---|---|---|---|
| `links-experience` | Explorer ios/android | `openExternal(APP_STORE_URL\|PLAY_STORE_URL)` | **`<a>` → Explorer OneLink** |
| `links-experience` | Explorer **desktop** | `openExternal('/download')` | **`openExternal('/download')` — UNCHANGED. The only survivor.** |
| `links-experience` | Business download | `openExternal(installHref)` | **`<a>` → Business OneLink** |
| `links-experience` | Business use-web | `openExternal(webHref)` | **`<a>` → `BUSINESS_WEB_URL`** |
| `glass-nav` | Explorer ios/android | `openExternal(store)` | **`<a>` → Explorer OneLink** |
| `glass-nav` | Explorer **desktop** | `setQrOpen(true)` | **unchanged** (opens a panel → correctly a `<button>`) |
| `glass-nav` | Business download / use-web | `openExternal(...)` | **`<a>` × 2** |
| `hero` | Business download / use-web | `openExternal(...)` | **`<a>` × 2** |
| `/business/download` | both | already plain `<a>` | **`<a>` — href value only** |

**Why keep the module for one call site** (rather than the tempting `<a href="/download">` and delete):
1. **The `/download` QR page is not a store button.** Ask A is about store CTAs. Desktop has no store app
   to hand off to; opening the QR page in a new tab while `/links` stays mounted is correct, shipped, and
   proven. It is genuinely a *different action*.
2. **Deleting it would decommission `I-PROPOSED-1381-OPEN-EXTERNAL-SINGLE-OWNER` days after it was
   established**, and would delete an 8/8 self-tested, browser-verified guard against a bug that shipped to
   production **this week**. COMMS-0101 explicitly records the `if (!win)` idiom as **unswept in
   `mingla-admin/` + the RN webviews**. The module and its gate are the living documentation for the next
   author who meets that idiom. **Deleting a guard because its last caller moved is how the bug comes back.**
3. **`orch-1381-open-external-no-double-nav.mjs` needs ZERO amendment** if the module survives — it targets
   `open-external.ts` **only** (`TARGET = "mingla-marketing/lib/open-external.ts"`, line 51) and hard-fails
   `target not found` (line 205) if deleted.

> **Direct answer to *"say what happens to the ORCH-1381 gates that REQUIRE `window.location.assign(`; a
> gate must never mandate a worse implementation":*** the premise is **inverted** for this gate. It requires
> `.location.assign(` **inside `open-external.ts` itself**, not at any surface. Because the module survives
> unchanged, **`orch-1381-open-external-no-double-nav.mjs` is NOT amended, NOT weakened, and does not
> conflict.** The gates that *do* conflict are `orch-1328` and `orch-1319` — and they conflict over
> **store-const references and the `onCtaClick` binding**, not over `assign(`. Full list §10.

#### Which element renders where

| Destination class | Element | Reason |
|---|---|---|
| Store (OneLink) | `<a href target="_blank" rel="noopener">` | real link; survives in-app webviews |
| Business web app | `<a href target="_blank" rel="noopener">` | real link |
| `/download` QR page (Explorer desktop, `/links`) | `<button>` + `openExternal` | new tab, page stays; proven |
| QR **panel** (Explorer desktop, nav) | `<button>` + `setQrOpen(true)` | opens a panel, navigates nowhere |

**`components/ui/button.tsx` is `<button>`-only (no `asChild`/`as`).** Do **not** add polymorphism — that
is a shared component with site-wide blast radius. Instead **export the class recipe** and let anchors
consume it (§5.4), which also retires `links-experience`'s duplicated `CTA_BASE`.

### 5.2 New/changed `lib/` modules

#### 5.2.1 `lib/store-links.ts` — **ADD 2 consts** (do not modify existing)

```
+ export const EXPLORER_ONELINK_URL = 'https://go.usemingla.com/w36m'
+ export const BUSINESS_ONELINK_URL = 'https://biz.usemingla.com/ZSCW'
```
- Belongs here: the file's own docblock (lines 3-4) already anticipates it — *"Later this may indirect
  through the AppsFlyer OneLink (ORCH-1313 P2)."*
- **`APP_STORE_URL` / `PLAY_STORE_URL` / `BUSINESS_*` MUST NOT be modified or removed** — `/download`
  (`app/download/page.tsx:22,38-39`) still uses them, and `orch-1342` byte-compares the two consumer consts
  against `mingla-business/src/constants/storeLinks.ts:26-28`. **Adding exports is safe** (verified §0.5).
- Carry a comment recording the §0.1 evidence + the ORCH-1346 one-domain-one-template rule.

#### 5.2.2 `lib/links-src.ts` — **NEW** (pure, React-free)

```
export const LINKS_SRC_PATTERN: RegExp            // /^[a-z0-9_]{1,32}$/
export const LINKS_SRC_FALLBACK = 'direct'
export const LINKS_PID_PREFIX  = 'bio_'
export type LinksCampaign = 'explorer_bio' | 'business_bio'

export function sanitizeLinksSrc(raw: string | string[] | undefined | null): string
export function toBioPid(src: string): string                       // `bio_${src}`
export function buildOneLinkHref(base, { pid, campaign }): string    // URLSearchParams
```
- React-free → testable with the repo's plain tsc+node pattern.
- `buildOneLinkHref` **must** use `URLSearchParams` (defence-in-depth; values are already sanitised).
- `sanitizeLinksSrc` must handle `string[]` (Next's repeated-param shape) → fallback.
- **`toBioPid` is the ONLY place `bio_` is written.** H-1 is structural.

#### 5.2.3 `lib/explorer-app-target.ts` — **NEW** (mirrors `business-app-target.ts`)

Kills the *explorer* decision triplication (`glass-nav.tsx:69` and `links-experience.tsx:214` both carry
`platform === 'ios' ? APP_STORE_URL : PLAY_STORE_URL`) — the same class ORCH-1381 killed for business.

```
export interface ExplorerAppTarget {
  installHref: string | null   // the Explorer OneLink (device-independent); null on desktop
  installStore: 'app_store' | 'play' | null   // ANALYTICS LABEL ONLY
  canInstall: boolean
}
export function resolveExplorerAppTarget(platform, attribution: OneLinkAttribution): ExplorerAppTarget
```
- `installStore` stays **platform-derived** even though the href is shared — it is an analytics label
  (mirrors `business-app-target.ts:35-36`). **This keeps `platform ===` branching genuinely load-bearing**,
  so `orch-1319`/`orch-1328`'s device-driven checks stay meaningful rather than becoming decorative.
- Desktop → `installHref: null`, `canInstall: false` (caller routes to `/download`).

#### 5.2.4 `lib/business-app-target.ts` — **CHANGED**

- **`resolveBusinessAppTarget(platform)` → `resolveBusinessAppTarget(platform, attribution)`** —
  `attribution` is a **REQUIRED** param.
- `installHref` for **both** ios and android → `buildOneLinkHref(BUSINESS_ONELINK_URL, attribution)`.
- `installStore` stays platform-derived (analytics label).
- `webHref`, `canInstall`, desktop branch: **unchanged**.

> **Why a REQUIRED param and not an optional one / a decorator the surfaces call.**
> An optional param, or a separate `withAttribution(href, …)` the 4 surfaces must remember to call, makes
> "forgot attribution" **silent** — the CTA still works, the install still lands, and the attribution is
> just gone. That is invisible in QA, invisible in CI, and only discovered months later as a hole in
> reporting. A **required parameter makes it a compile error**. That is a stronger guard than any regex
> gate in this repo, and it costs one signature change.
> **Cost, stated honestly:** it breaks `lib/__tests__/business-app-target.test.ts` (T-1) and
> `business-app-target.tester.test.ts` at every call. Those updates are **mandated and pre-approved** in
> §7.3 under `[TEST-MOD-APPROVED ORCH-1382]`.

#### 5.2.5 `lib/links-config.ts` — **CHANGED** (D + E) — see §5.5

### 5.3 Ask (C) — label + stack

#### 5.3.1 The label — the pinned-copy update path

**Exactly one line changes. No gate amendment** (§0.3).

`lib/business-app-target.ts:98`
```
-  download: 'Download the app',
+  download: 'Get the app',
```
- Matches the nav's existing wording and its `get_the_app_clicked` event name.
- All 4 surfaces render `BUSINESS_APP_CHOICE_COPY.download` → **all 4 update automatically**. That is the
  pin working exactly as designed.
- `moreNote` / `desktopNote` / `useWeb`: **UNCHANGED**. They are code-verified *claims* (`business-app-target.ts:82-96`);
  this ORCH proves nothing new about scanning or push, so it must not touch them.
- **Do not hand-write `"Get the app"` at any surface.** That is precisely what the structural pin forbids.

**Correction to the dispatch, restated:** *"Changing it means updating the pinned constant AND the gate"* —
**there is no gate to update.** The gates assert the *identifier*, never the string (§0.3 table). Adding a
literal-string assertion would be a **regression**: it would make Seth's own reword require a CI edit, for
no safety gain (the surfaces already cannot hand-write copy).

#### 5.3.2 The stack — and **YES, the `px-4` patch becomes redundant**

Direct answer to *"Bonus: stacking structurally kills the 360px overflow ORCH-1381 patched — say whether
that patch becomes redundant."* → **Yes. Remove it.**

ORCH-1381 ADDENDUM D-A added `px-4` at `links-experience.tsx:402,410` with this recorded reason (lines 387-396):

> *"Two `w-full` pills share this row, so flex shrinks each to ~130px at 360px; `px-7` left 'Use on web' a
> 59px content box → 3-line wrap → 9px spill past the fixed `h-14`. `px-4` restores a 98px box."*

**The precondition — two pills sharing one row — is exactly what (C) deletes.** Stacked, each pill is
full-width (~335px at 375, ~320px at 360). `px-7` fits with room to spare.

- **Remove the `px-4` override** at both call sites → revert to `CTA_BASE`'s `px-7`, restoring visual
  parity with the Explorer CTA.
- **Remove the D-A comment block** (lines 387-396) — it documents a constraint that no longer exists.
  Leaving it would send a future author hunting a row that isn't there.
- **T-10 (§9) pins this**: `px-4` must not reappear on the business pills.

#### 5.3.3 The vertical budget — **the real risk in (C)**

**This is the most likely way ORCH-1382 breaks something.** Stacking **adds ~64px** (second pill 56 +
`gap-2` 8) to the business panel. QA_ORCH-1381 measured the `/links` no-scroll headroom at 375×667 as
**~20px** (`maxBottom=647 ≤ 667`). **Naïve stacking overruns by ~44px.**

> **The failure mode is CLIPPING, not scrolling — and it will pass a naïve gate.**
> The root is `h-[100dvh] overflow-hidden` (`links-experience.tsx:256-261`). When content overflows, the
> page **does not scroll — it silently cuts content off**. A tester asserting
> `scrollHeight === clientHeight` (exactly what QA_ORCH-1381 asserted for SC-6) would report **PASS on a
> visibly broken page**. **This is a decorative-check trap being born.** SC-6/SC-7 (§6) therefore mandate
> measuring **element visibility within the viewport**, never `scrollHeight`.

**Reclamation levers (business tab), in preference order. The implementor must MEASURE, not estimate:**

| Lever | File:line | ~Saves |
|---|---|---|
| Panel padding `p-6` → `p-5` | `links-experience.tsx:361` | 8px |
| CTA container `mt-5` → `mt-4` | `links-experience.tsx:384` | 4px |
| Note `mt-3` → `mt-2` | `links-experience.tsx:415` | 4px |
| Socials row `mt-5` → `mt-4` | `links-experience.tsx:448` | 4px |
| Tablist `mt-6` → `mt-5` | `links-experience.tsx:298` | 4px |
| Business pills `h-14` → `h-12` (**48px — still ≥44px WCAG**) | business branch only | 16px |

**Forbidden levers:**
- **Changing `BUSINESS_APP_CHOICE_COPY`** to buy space. The copy is a claim, not padding. (QA_ORCH-1381
  P2-1 explicitly ruled: *"prefer the layout fix over changing the constant."*)
- **Touching `CTA_BASE`** — the Explorer CTA shares it and renders correctly today (ORCH-1381 D-A rationale).
  Business-tab overrides only.
- **Dropping the note**, or making the pills smaller than 44px.

If SC-6 cannot be met without a forbidden lever → **STOP, raise OQ-2 (§11), do not ship a clipped page.**

### 5.4 The class recipe (supports §5.1)

`components/ui/button.tsx` — **ADD** an exported class-recipe helper; `Button` itself consumes it so the two
can never drift:
```
export function buttonClasses({ variant, size, className }): string
```
- **Purely additive.** `Button`'s props, DOM, and behaviour **must not change** — it is used site-wide.
- Anchors then render `className={buttonClasses({ variant: 'primary', size: 'lg' })}` and look identical to
  a `Button` by construction.
- **Retires `links-experience.tsx`'s duplicated `CTA_BASE`/`CTA_INTENT`** (lines 57-64), which exists only
  because there was no way to get the recipe without the element (comment, lines 52-56).
- **If this proves harder than it looks, it is DEFERRABLE**: anchors may keep using the local `CTA_BASE`
  recipe. It is a cleanliness win, not a correctness one — **do not let it block A–E.**

### 5.5 Asks (D) + (E) — Snapchat + the socials taxonomy

#### 5.5.1 The problem (E), stated precisely

`links-config.ts:88-100` models the taxonomy as an **optional field**:
```ts
export interface LinksSocial {
  label: string
  href: string
  businessHref?: string   // ← absence carries ALL the meaning
}
```
Absence of `businessHref` currently means *"universal — same URL on both tabs"* (YouTube, LinkedIn:
lines 117-119). Seth's ruling: *"Youtube and linkedin are not explorers nor business, they're neutral used
for investor and education."* — the data **accidentally** models this correctly, by omission.

**(D) is what breaks it.** Snapchat is **Explorer-only** (no business account). Added under today's model
(no `businessHref`), it renders on **both** tabs — because *"neutral"* and *"explorer-only"* are the **same
absence**. Two opposite intents, one representation. The bug ships silently and looks like data entry.

**Answer to *"whether the data model should carry an explicit neutral/shared kind rather than leaving it
implicit as a missing field"*: YES — and it needs THREE kinds, not two.**

#### 5.5.2 The fix — a discriminated union (compile-time enforced)

```ts
export type LinksSocialScope = 'per_surface' | 'neutral' | 'explorer_only'

export type LinksSocial =
  | { scope: 'per_surface';   label: string; href: string; businessHref: string }  // businessHref REQUIRED
  | { scope: 'neutral';       label: string; href: string }                        // both tabs, one URL
  | { scope: 'explorer_only'; label: string; href: string }                        // Explorer tab ONLY
```

| Scope | Members | Renders on | Meaning |
|---|---|---|---|
| `per_surface` | Instagram, X, TikTok, Facebook, Threads | both (URL swaps) | dedicated @minglabusiness account exists |
| `neutral` | **YouTube, LinkedIn** | both (same URL) | **Seth's ruling — investor & education, neither explorer nor business** |
| `explorer_only` | **Snapchat** | **Explorer only** | no business account exists |

**Why a union and not `scope` + optional `businessHref`:** the union makes a `per_surface` social **without**
a `businessHref` a **compile error**, and makes reading `businessHref` off a `neutral` one a compile error.
The invariant stops depending on anyone remembering it. This is the same reasoning as §5.2.4.

Resolver (`links-config.ts:135-137`):
```ts
export function socialHref(social, tab) {
  return tab === 'business' && social.scope === 'per_surface' ? social.businessHref : social.href
}
export function socialsForTab(tab: LinksTabId): readonly LinksSocial[]   // NEW
  // business tab → filters out scope === 'explorer_only'
```
`links-experience.tsx:450` changes `LINKS_SOCIALS.map(...)` → `socialsForTab(activeId).map(...)`.

#### 5.5.3 Snapchat entry + icon

```
{ scope: 'explorer_only', label: 'Snapchat', href: 'https://www.snapchat.com/add/usemingla' }
```
- **Icon: an inline brand SVG**, following the established local convention. `links-experience.tsx:66-67`
  records it: *"lucide ships clean Instagram / LinkedIn / Facebook / YouTube marks. It has no X (Twitter
  rebrand), TikTok, or Threads glyph, so those use inline brand SVGs (§4)."* **lucide-react `^0.460.0`
  ships no Snapchat glyph** → add `case 'Snapchat':` to `SocialIcon` (line 68) returning an inline
  `<svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">`, matching
  TikTok/Threads/X exactly.
- **No new asset file, no new dependency, no icon-library change.**
- Self-verifying: a wrong lucide import is a hard build error.
- **Placement:** after Threads (end of the row) — keeps the existing order stable and puts the
  scope-filtered member last, so the business tab's row simply ends one icon earlier.

---

## 6. Success criteria

Per-surface where parity is manual (§3). **Every criterion is observable and tester-checkable.**

### Ask A — real links to the store app
- **SC-1-Links-Explorer.** On `/links` (Explorer, Android UA), the CTA is an `<a>` whose `href` starts
  `https://go.usemingla.com/w36m?` and carries `pid=` + `c=explorer_bio`. Tapping it opens the **Play app**
  with **no intermediate Play web page**.
- **SC-1-Links-Business.** Same, Business tab, `href` starts `https://biz.usemingla.com/ZSCW?`, `c=business_bio`.
- **SC-1-Nav-Explorer / SC-1-Nav-Business / SC-1-Hero.** Each renders an `<a href>` to the correct OneLink
  (never a `<button onClick>`) on ios/android.
- **SC-1-BizDownload.** `curl -A '<Android UA>' https://usemingla.com/business/download` → `200` HTML whose
  install `<a href>` is the **Business OneLink**, not `play.google.com`. (Route stays a Server Component:
  no `window`, no `navigator`, no `<form>`.)
- **SC-1-iOS.** Same 4 surfaces under iOS UA → OneLink → App Store app.
- **SC-1-Desktop.** `canInstall === false`: `/links` Explorer desktop still opens `/download` **in a new tab
  via `openExternal`** and `/links` stays mounted. Nav desktop still opens the **QR panel**. **No dead or
  hidden install button.**
- **SC-1-Rel.** Every new store/web anchor has `target="_blank"` **and** `rel="noopener"`. **`rel` must not
  be empty** (the §5.1 trap).
- **SC-1-NoOrphanState.** After tapping a store anchor on a real Android device, `/links` is **still mounted
  and interactive** on return (ORCH-1328's invariant, re-proven under the new mechanism).

### Ask B — source tracking
- **SC-2-Ride.** `/links?src=youtube` → Business tab anchor `href` contains **exactly**
  `pid=bio_youtube` and `c=business_bio`. Explorer tab → `pid=bio_youtube`, `c=explorer_bio`.
- **SC-3-Persist.** With `?src=youtube`, switching Explorer→Business→Explorer: **every** resolved `href`
  still carries `pid=bio_youtube`. Only `c` changes.
- **SC-4-FailSafe.** For `src` ∈ {absent, `""`, `<script>alert(1)</script>`, `a&b=c`, 33×`a`, `?src=a&src=b`}:
  `href` carries **`pid=bio_direct`**. **Never** `pid=`, **never** `pid=bio_`, **never** a raw reflected value,
  **never** an unencoded `&`/`<`, and the page **never throws**.
- **SC-5-Prefix (HARD).** Across **every** input in SC-4 plus `youtube|linkedin|seth|facebook|tiktok`, the
  emitted `pid` **always** matches `/^bio_[a-z0-9_]{1,32}$/`.
- **SC-5-NeverCrossed (HARD).** No Explorer surface ever emits a `biz.usemingla.com` href; no Business
  surface ever emits a `go.usemingla.com` href. No surface emits `*.onelink.me`.

### Ask C — label + stack
- **SC-6-Label.** All 4 business surfaces render **"Get the app"**. Zero occurrences of "Download the app"
  in rendered output. `moreNote`/`desktopNote`/`useWeb` byte-unchanged.
- **SC-6-Stack.** On `/links` Business (phone widths), "Get the app" renders **directly above** "Use on web"
  (`getAppRect.bottom <= useWebRect.top`), **not** side-by-side (they must **not** share a `top`).
- **SC-6-NoScroll (measured, CLIPPING-aware — supersedes the ORCH-1381 SC-6 method).** At **375×667** and
  **360×640**, Business tab, with `?src=youtube`, **consent already accepted**:
  1. `document.documentElement.scrollHeight === clientHeight` (no scroll), **AND**
  2. **every** one of: wordmark, tablist, heading, both CTAs, the note, **and every social icon** has
     `rect.bottom <= innerHeight && rect.top >= 0` — i.e. **nothing is clipped**.
  **Criterion (2) is mandatory.** `overflow-hidden` makes (1) alone pass on a visibly broken page (§5.3.3).
- **SC-6-Tap.** Both business pills ≥ **44px** tall.
- **SC-7-PxRedundant.** The `px-4` override is **gone** from both business pills; they render `CTA_BASE`'s
  `px-7`; **no** label overflow (`scrollHeight === clientHeight` **per pill**) at 320/360/375/390/412.
- **SC-8-NoBannerRegression.** At 375×667 **pre-consent**, the consent banner's overlap with the primary
  business CTA is **no worse** than ORCH-1381's measured baseline (banner `y=439–655`, CTAs `y=394–450`,
  11px overlap). **Carried bug #905 — this ORCH must not deepen it.**

### Asks D + E — socials
- **SC-9-Snap-Explorer.** Explorer tab renders a Snapchat icon linking **exactly**
  `https://www.snapchat.com/add/usemingla`, `target="_blank"`.
- **SC-9-Snap-NotBusiness.** Business tab renders **NO** Snapchat icon. **There is no business Snapchat
  account; a link to the consumer one from the business tab is the defect.**
- **SC-9-Counts.** Explorer = **8** socials; Business = **7**. Both rows fully visible at 375×667 and
  360×640 (SC-6-NoScroll criterion 2 covers this).
- **SC-10-Neutral.** YouTube + LinkedIn render on **both** tabs with the **same** `href` on each.
- **SC-10-PerSurface.** Instagram/X/TikTok/Facebook/Threads swap to their `@minglabusiness` handle on the
  Business tab (unchanged behaviour).
- **SC-10-TypeSafety.** A `per_surface` entry missing `businessHref` **fails `tsc`**. (Compile-time; proven
  by a deliberate negative check in T-8.)

---

## 7. Allowlist / DO-NOT-TOUCH

### 7.1 Allowlist — the implementor may change ONLY these

**Product code**
1. `mingla-marketing/lib/store-links.ts` — **ADD 2 consts only** (§5.2.1)
2. `mingla-marketing/lib/links-src.ts` — **NEW**
3. `mingla-marketing/lib/explorer-app-target.ts` — **NEW**
4. `mingla-marketing/lib/business-app-target.ts` — signature + `installHref` + label (§5.2.4, §5.3.1)
5. `mingla-marketing/lib/links-config.ts` — D + E (§5.5)
6. `mingla-marketing/app/links/page.tsx` — read/sanitise `searchParams.src` (§4.5)
7. `mingla-marketing/components/marketing/links-experience.tsx` — anchors, stack, `px-4` removal, Snapchat icon, `socialsForTab`
8. `mingla-marketing/components/marketing/glass-nav.tsx` — anchors + OneLink
9. `mingla-marketing/components/sections/organiser-home/hero.tsx` — anchors + OneLink
10. `mingla-marketing/app/business/download/page.tsx` — **`href` value + attribution only**
11. `mingla-marketing/components/ui/button.tsx` — **additive `buttonClasses` export only** (§5.4; deferrable)

**Tests / gates** — §9 + §10.

### 7.2 DO-NOT-TOUCH (stop-and-amend before any edit)

| Path | Why |
|---|---|
| `mingla-marketing/lib/device-platform.ts` | Dispatch hard guard; orchestrator-verified correct (§0.5) |
| `app-mobile/**` | Hard guard. Web-only ORCH. |
| `mingla-business/**` | Hard guard. Incl. `GUEST_FUNNEL_ONELINK_URL` (§2.3) + the `orch-1342` byte-compare peer |
| `mingla-admin/**` | Hard guard |
| `supabase/functions/invite-brand-member/index.ts` | Owns the invite-email href — **byte-frozen** |
| `mingla-marketing/app/download/page.tsx` | `/download` route semantics out of scope; still uses `APP_STORE_URL`/`PLAY_STORE_URL` |
| `BUSINESS_APP_CHOICE_COPY.moreNote` / `.desktopNote` / `.useWeb` | Code-verified claims; only `.download` changes |
| `CTA_BASE` / `CTA_INTENT` **shared** recipe | Explorer CTA shares it (ORCH-1381 D-A) — business-tab overrides only |
| `lib/open-external.ts` | **Survives UNCHANGED** (§5.1). Editing it breaks an 8/8-self-tested guard for zero gain. |
| `.github/scripts/strict-grep/orch-1342-store-links-ssot.mjs` | Verified safe unamended (§0.5) |
| `.github/scripts/strict-grep/orch-1381-open-external-no-double-nav.mjs` | Verified safe unamended (§5.1) |
| `.github/scripts/strict-grep/orch-1326-*.mjs` `\bPLAY_STORE_URL\b` | Already word-anchored by ORCH-1381 |

**INVITE-EMAIL — BYTE-FROZEN (HARD).** `orch-1329-invite-email.tester.test.ts:191-224` pins the href to
**exactly** `https://usemingla.com/business/download` with **no query string**.
**Therefore: `/business/download` MUST NOT require a `src`/`pid` query param to function.** It resolves its
own attribution server-side (`pid=mingla_web`, `c=business_download`). **Never append a query param to the
invite-email href to carry attribution.** This is the single easiest way to fail this ORCH's CI.

### 7.3 `[TEST-MOD-APPROVED ORCH-1382]` — pre-approved test modifications

These files assert tokens the spec deliberately removes. Modifying them is **mandated, bounded, and
pre-approved** (precedent: `65ee89d85`). Each modification **must preserve the original defect-catching
angle** — retarget the assertion, never delete it.

| File | Why | Permitted change |
|---|---|---|
| `lib/__tests__/business-app-target.test.ts` (T-1) | pins `resolveBusinessAppTarget('android').installHref === BUSINESS_PLAY_STORE_URL`; signature + destination change | Retarget to the Business OneLink; **keep** the "android ≠ web" angle |
| `lib/__tests__/business-app-target.tester.test.ts` | A-1..A-5 call the 1-arg signature | Add `attribution`; **extend A-4** to also assert `installHref` never contains `go.usemingla.com` (**new cross-app contamination vector**) |
| `lib/links-config.tester.test.ts` | imports `APP_STORE_URL`/`PLAY_STORE_URL`; asserts the old socials shape | Update to the `scope` union; **keep** the no-hardcoded-store-URL angle |
| `components/marketing/__tests__/links-cta-device-aware.test.ts` + `.tester.test.ts` | assert `<button>`/`openExternal` tokens for the CTA | Retarget to the anchor contract; **keep** device-aware + desktop-reaches-QR angles |
| `app/business/download/__tests__/business-download-route.tester.test.ts` | asserts the install href shape | Retarget to the OneLink; **keep** the `BUSINESS_APP_CHOICE_COPY` structural pin (§0.3) |

**Not covered by this approval:** `orch-1329-invite-email.tester.test.ts` (byte-frozen), any `mingla-business/`
test, `orch_1342_*`. Touching those → **stop and amend**.

---

## 8. Implementation order

1. **`lib/store-links.ts`** — add the 2 OneLink consts. *(Nothing depends on it yet; commit-safe.)*
2. **`lib/links-src.ts`** (NEW) + **T-3/T-4/T-5** — sanitisation + builder, tests green **before** any caller.
   **The security boundary lands first and proven.**
3. **`lib/explorer-app-target.ts`** (NEW) + **T-6**.
4. **`lib/business-app-target.ts`** — signature + OneLink + `'Get the app'`; update T-1 + tester test
   (§7.3). **`tsc` now fails at all 4 surfaces — this is the required-param guard working.**
5. **`lib/links-config.ts`** — `scope` union + Snapchat + `socialsForTab`; update `links-config.tester.test.ts`.
6. **`components/ui/button.tsx`** — additive `buttonClasses` (§5.4; **skip if it fights back**).
7. **`app/links/page.tsx`** — read + sanitise `searchParams.src`, pass down.
8. **`links-experience.tsx`** — anchors, `src` prop, stack, remove `px-4` + D-A comment, Snapchat icon,
   `socialsForTab`. **Then MEASURE SC-6-NoScroll and apply §5.3.3 levers until green.**
9. **`glass-nav.tsx`** → anchors + OneLink (explorer + business). Desktop QR panel untouched.
10. **`hero.tsx`** → anchors + OneLink.
11. **`app/business/download/page.tsx`** → OneLink href + server-side attribution. **No query param.**
12. **Gate amendments** (§10) — each with self-test cases, each proven fails-on-revert.
13. **Regression tests** (§9) — each proven fails-on-revert.
14. Full local gate sweep (§10.7) + `npm run build` in `mingla-marketing/`.

---

## 9. Regression prevention — the fails-on-revert contract

**Every test below MUST FAIL when its defect is reintroduced and PASS when the fix is restored. A test that
cannot demonstrate both directions does not ship.** The implementor must record the **actual observed
failure output** for each (not "verified" — the paste).

Run pattern (the marketing package has no jest — plain tsc+node; note the emit-root gotcha recorded in
COMMS-0101: `tsc` roots the emit at `lib/` → `/tmp/o/__tests__/…`):
```
cd mingla-marketing
npx tsc lib/__tests__/<f>.ts --outDir /tmp/o --module commonjs --target es2020 --moduleResolution node \
  && node /tmp/o/__tests__/<f>.js
```

| ID | File | Angle | The revert it must catch |
|---|---|---|---|
| **T-1** *(mod)* | `lib/__tests__/business-app-target.test.ts` | business install href = Business OneLink; `installHref !== webHref` | android → web, or → plain Play URL |
| **T-2** *(mod)* | `lib/__tests__/business-app-target.tester.test.ts` | A-1..A-5 + **A-6 (NEW)**: `installHref` never contains `go.usemingla.com` | **cross-app OneLink contamination** (business owners installing the consumer app) |
| **T-3** | `lib/__tests__/links-src.test.ts` (NEW) | `sanitizeLinksSrc` happy path + case/trim | dropping lowercase/trim |
| **T-4** ⭐ | `lib/__tests__/links-src.tester.test.ts` (NEW) | **ADVERSARIAL.** Table-drives **every** SC-4 input **+** `<script>`, `a&b=c`, `../`, `%2e%2e`, `\n`, unicode, 33 chars, `''`, `undefined`, `null`, `['a','b']`. Asserts `/^bio_[a-z0-9_]{1,32}$/` **always** | any sanitisation hole; **`pid=bio_`**; `pid=`; reflected raw input; a thrown error |
| **T-5** | `lib/__tests__/links-src.test.ts` | `buildOneLinkHref` encodes via `URLSearchParams`; base+query well-formed | manual string concat |
| **T-6** | `lib/__tests__/explorer-app-target.test.ts` (NEW) | explorer ios/android → Explorer OneLink; desktop → `null` | desktop growing a dead install button |
| **T-7** ⭐ | `lib/__tests__/onelink-never-crossed.tester.test.ts` (NEW) | **BY IDENTITY, not substring.** business target never `go.*`; explorer target never `biz.*`; neither ever `*.onelink.me`; both bases distinct | **H-2** — the highest-damage available bug |
| **T-8** | `lib/links-config.tester.test.ts` *(mod)* | `socialsForTab('business')` excludes `explorer_only`; `'explorer'` includes it; neutral same URL both tabs; **8/7 counts**; Snapchat href exact; **+ a commented negative `@ts-expect-error` proving a `per_surface` entry without `businessHref` fails tsc** | **Snapchat leaking onto the business tab** (the D+E coupling bug); a neutral social growing a business variant |
| **T-9** | `components/marketing/__tests__/links-cta-device-aware.tester.test.ts` *(mod)* | anchors carry `href`+`target="_blank"`+`rel` containing `noopener`; **`pid` survives a tab switch**; desktop still reaches `/download` via `openExternal` | reverting to `<button onClick>`; **dropping `rel`** (§5.1 trap); losing `src` on tab switch |
| **T-10** | same as T-9 | `px-4` absent from the business pills; stacked (not one row) | the D-A patch creeping back; a revert to side-by-side |
| **T-11** | `app/business/download/__tests__/business-download-route.tester.test.ts` *(mod)* | install href = Business OneLink **with** `pid`+`c`; **route needs NO query param**; still Server-Component-safe (no `window`/`navigator`/`<form>`) | plain Play URL returning; **attribution moved onto the invite-email href** (byte-frozen breach) |

⭐ = the three that catch the highest-damage defects. **If the budget for proving fails-on-revert is
constrained, prove T-4, T-7, and T-8 first.**

---

## 10. CI gate amendments

**Which existing gates conflict — decided by execution, not reading.**

| Gate | Conflicts? | Action |
|---|---|---|
| `orch-1328-links-cta-opens-store-clientside.mjs` | **YES — 3 checks** | **AMEND** (§10.1) |
| `orch-1319-getapp-cta-direct-store.mjs` | **YES — 1 check** | **AMEND** (§10.2) |
| `orch-1324-business-getapp-device-aware.mjs` | **YES — 1 check** | **AMEND** (§10.3) |
| `orch-1381-business-getapp-android-choice.mjs` | **PARTIAL** | **AMEND** — lift the OneLink ban per its own stated condition (§10.4) |
| `orch-1326-links-business-download-route.mjs` | **NO** | unamended — `\bPLAY_STORE_URL\b` already anchored; new consts don't trip it |
| `orch-1342-store-links-ssot.mjs` | **NO** | unamended — doesn't scan `mingla-marketing/` (§0.5) |
| `orch-1381-open-external-no-double-nav.mjs` | **NO** | unamended — module survives (§5.1) |
| `orch-1327-links-tab-switcher-persistent-pill.mjs` | **NO** | tablist untouched |
| `orch-1319-no-testflight-anywhere.mjs` | **NO** | no testflight tokens added |
| `orch-1329-invite-email.tester.test.ts` | **NO** | href byte-frozen (§7.2) |
| **NEW** `orch-1382-links-src-onelink-attribution.mjs` | — | **CREATE** (§10.5) |

**Every amended/new check needs a `--self-test` case that FAILS on the defect and PASSES on the fix.**
A check without a failing case is decorative — this repo has now produced **four** (§0.4).

### 10.1 `orch-1328-links-cta-opens-store-clientside.mjs` — AMEND (3 checks)

**Conflict 1 — `REQUIRED_CONSTS` (lines 74-77).** Requires `\bAPP_STORE_URL\b` + `\bPLAY_STORE_URL\b` in
`links-experience.tsx`. The Explorer CTA now resolves the OneLink via `resolveExplorerAppTarget` and
**stops referencing them → the gate FAILS the correct implementation.** *(This is precisely Seth's "a gate
must never mandate a worse implementation".)*
```js
const REQUIRED_CONSTS = [ "\\bresolveExplorerAppTarget\\b", "\\bresolveBusinessAppTarget\\b" ];
```
Rationale comment must record: consts moved behind the two decision helpers (the ORCH-1381 pattern,
extended to explorer); requiring them here would re-create the triplication both ORCHs removed.

**Conflict 2 — check 3, `/<button/` (line 125). DECORATIVE — REPAIR, don't delete (§0.4).** It matches the
tablist. Replace with a check that binds to the **CTA**:
```js
// The CTA must be a real, keyboard-activatable NAVIGATION control: an <a href> with target+rel.
const CTA_ANCHOR = /<a\s+[^>]*href=\{[^}]*(?:installHref|oneLinkHref|webHref)[^}]*\}/;
if (!CTA_ANCHOR.test(src)) failures.push(`${TARGET}: the store/web CTA must be a real <a href={…}> anchor …`);
if (!/target="_blank"/.test(src)) failures.push(`${TARGET}: the CTA anchor must carry target="_blank" (…/links stays mounted, analytics flush).`);
// SECURITY — rel="noopener" on an ANCHOR is REQUIRED and is NOT the ORCH-1381 window.open pathology.
if (!/rel="noopener/.test(src)) failures.push(`${TARGET}: the CTA anchor must carry rel="noopener" — reverse-tabnabbing. NOTE: the ORCH-1381 noopener BAN is scoped to window.open FEATURE STRINGS only; on an <a> rel="noopener" is mandatory.`);
```
> **The old `/<button/` check must NOT simply be deleted** — its intent (a real, keyboard-activatable
> control) is real. It is re-expressed above so it binds to the CTA and can actually fail.

**Conflict 3 — check 3b, `onClick={() => onCtaClick(` (line 128).** Proven to fire against the anchor
implementation:
```
-- orch-1328 check 3b: FIRES (real conflict — must amend)
```
The store path no longer routes through `onCtaClick`; the analytics call does.
```js
if (!/onClick=\{\(\) => onCtaTrack\(/.test(src)) failures.push(`${TARGET}: the CTA must fire onCtaTrack(…) on click (analytics must not be silently dropped when the anchor navigates).`);
```

**Retained unchanged:** `detectClientPlatform`, `resolveBusinessAppTarget(`, `openExternal(` *(still true —
the desktop `/download` path)*, `links_page_cta_clicked`, `platform ===`, and **all** BANs (`next/link`,
`<Link`, `<a href="/download"`, `<a href="/business/download"`, `apps.apple.com`, `play.google.com`,
`window.open(`, the noopener/noreferrer `.open(` trap).

> **The `apps.apple.com` / `play.google.com` bans stay and are now MORE meaningful**: after ORCH-1382 a
> store literal on `/links` means someone bypassed the OneLink and killed attribution.

**New self-test cases (all must fire):** CTA reverted to `<button onClick={() => onCtaClick(`; anchor with
`target` but **no `rel`**; anchor with `rel="noopener"` **wrongly flagged** (must **pass** — pins §5.1);
`APP_STORE_URL` re-introduced; `resolveExplorerAppTarget` removed; a `<button role="tab">`-only file
(**must FAIL** — proves §0.4's decorative check is genuinely repaired).

### 10.2 `orch-1319-getapp-cta-direct-store.mjs` — AMEND (1 check)

**Conflict — check (a), lines 51-58.** Requires **both** `APP_STORE_URL` and `PLAY_STORE_URL` in
`glass-nav.tsx`. The explorer nav CTA moves to the OneLink → **FAILS the correct implementation.**
```js
if (!/resolveExplorerAppTarget\(/.test(src)) failures.push(`${NAV}: the explorer "Get the app" CTA must resolve via resolveExplorerAppTarget( …`);
if (!/EXPLORER_ONELINK_URL|oneLinkHref|installHref/.test(src)) failures.push(`${NAV}: the CTA must target the Explorer OneLink …`);
```
**Retained:** `detectClientPlatform(`, `platform ===` *(still load-bearing — desktop→QR panel, and
`installStore` is platform-derived)*, `get_the_app_clicked`, and **all** BANs (`GetTheAppModal`,
`get-the-app-modal`, `explorer-app-submit`, `submitExplorerAppLead`, `explorer-interest`,
`get_the_app_submitted`, `testflight`, `type="email"`).
**New self-test cases:** OneLink target removed → fire; `resolveExplorerAppTarget` removed → fire;
`platform ===` removed → fire (desktop QR branch); compliant nav → pass.

### 10.3 `orch-1324-business-getapp-device-aware.mjs` — AMEND (1 check)

**Conflict — check (e).** Requires every external open to delegate to `openExternal(`. `glass-nav` + `hero`
now use anchors for all business destinations → **`openExternal` legitimately disappears from both files.**
```js
// ORCH-1382: business destinations are ANCHORS. openExternal is no longer required HERE
// (it survives ONLY for the /links desktop QR path). What must not come back is an INLINE window.open.
if (!/<a\s+[^>]*href=\{/.test(src)) failures.push(`${label}: business destinations must render as real <a href={…}> anchors …`);
if (!/rel="noopener/.test(src)) failures.push(`${label}: business anchors must carry rel="noopener" …`);
```
**Retained (critical):** `resolveBusinessAppTarget(`, `BUSINESS_APP_CHOICE_COPY`, `detectClientPlatform(`,
`get_the_app_clicked` + `surface: 'organiser'` + **both** `action: 'download'` and `action: 'use_web'`, and
**all** BANs — **especially the inline `window.open(` ban and the noopener/noreferrer `.open(` trap.**
> The `.open(` trap ban **must be retained verbatim**. §5.1 introduces `rel="noopener"` on anchors, which
> makes the tokens `noopener`/`noreferrer` **legitimately present in these files for the first time**.
> The ban regex is scoped to `.open(` and does **not** fire on `rel=` (proven §0.5). **A future author who
> "simplifies" the regex to a bare `/noopener/` will re-open the D-B double-nav bug class.** A self-test
> case must pin this: a file with `rel="noopener"` **and** a bare `w.open(d,'_blank')` → **pass**.

### 10.4 `orch-1381-business-getapp-android-choice.mjs` — AMEND (lift its own stated condition)

The gate BANS `minglabiz.onelink.me` **and** `go.usemingla.com` over the helper + all 4 surfaces, with the
lifting condition written into its own docblock (quoted §0.1). **That condition is now met and re-proven.**

| Ban | Action | Why |
|---|---|---|
| `go.usemingla.com` **on BUSINESS surfaces + the business helper** | **KEEP** | ORCH-1346: consumer-owned. **Now enforcing H-2 (never crossed)** rather than "the link is dead". Update the rationale comment. |
| `minglabiz.onelink.me` | **KEEP** | **Rationale REPLACED**: not "dead on Android" (**it is alive — §0.1**) but **routing policy** — business traffic uses the branded `biz.usemingla.com`. **The comment MUST be corrected**; leaving "DEAD on Android, AppsFlyer Pending" is a false statement that will mislead the next author into believing business OneLinks are unusable. |
| `mingla.onelink.me` | **ADD** | Symmetry — the raw consumer domain is equally banned (H-3). |
| **`biz.usemingla.com` literal on a surface** | **ADD** | SSOT: the const lives in `store-links.ts`; a surface literal is drift. |

**Structural note (why this is nearly free):** because the OneLink bases live in `lib/store-links.ts` and the
surfaces reference **identifiers** (`BUSINESS_ONELINK_URL`), **no surface ever contains a branded-domain
literal**. The literal bans therefore stay satisfied *without weakening*, and simultaneously enforce the
SSOT. The gate does **not** scan `store-links.ts`, so the const is free to live there.

Also **AMEND** the required-checks block: `resolveBusinessAppTarget(` now takes 2 args — add a check that
the **attribution argument is actually passed** (a 1-arg call is a `tsc` error, but the gate should state
the contract):
```js
if (!/resolveBusinessAppTarget\(\s*[^),]+,\s*[^)]+\)/.test(src)) failures.push(`${label}: resolveBusinessAppTarget( must be called WITH an attribution argument — a bare 1-arg call ships an unattributed OneLink (ORCH-1382 §5.2.4).`);
```
**New self-test cases:** `biz.usemingla.com` literal at a surface → fire; `go.usemingla.com` at a business
surface → fire; `mingla.onelink.me` → fire; 1-arg `resolveBusinessAppTarget(platform)` → fire; compliant
(identifier + 2-arg) → pass.

### 10.5 **NEW** `orch-1382-links-src-onelink-attribution.mjs`

Invariant **`I-PROPOSED-1382-LINKS-SRC-BIO-PID-NEVER-CROSSED`** (DRAFT until CLOSE).

Over `lib/store-links.ts` + `lib/links-src.ts` + the 4 surfaces (comment-stripped):

| # | Check | Catches |
|---|---|---|
| R1 | `EXPLORER_ONELINK_URL` value contains `go.usemingla.com` **and** `w36m`; **not** `biz.` / `minglabiz` / `ZSCW` | consumer base crossed |
| R2 | `BUSINESS_ONELINK_URL` value contains `biz.usemingla.com` **and** `ZSCW`; **not** `go.usemingla.com` / `w36m` / `minglabiz.onelink.me` | **business base crossed / raw domain** |
| R3 | `links-src.ts` defines `LINKS_PID_PREFIX = 'bio_'` **and** `toBioPid` is the only writer of the prefix | H-1 bypass |
| R4 | `links-src.ts` sanitisation regex is **anchored** — `^…$` present | **`/[a-z0-9_]{1,32}/` unanchored → `<script>x</script>` yields a partial match** (a real, easy, silent hole) |
| R5 | **STRUCTURAL** — `toBioPid` returns a template/concat rooted at `LINKS_PID_PREFIX`, never a bare interpolation of `src` | `pid=${src}` |
| R6 | no surface contains a `go.usemingla.com` / `biz.usemingla.com` / `*.onelink.me` **literal** | SSOT drift |
| R7 | `app/links/page.tsx` calls `sanitizeLinksSrc(` and does **not** pass `searchParams` raw into any href | **raw untrusted input reaching an external URL** |

**R4 and R5 are the non-decorative teeth** — R4 because an unanchored regex is the single most likely
sanitisation bug and a token-presence check would never see it; R5 because a `pid` built by bare
interpolation passes every presence check while violating H-1.

**Self-test cases (each must fire):** bases swapped (R1/R2); `minglabiz.onelink.me` as the business base;
`LINKS_PID_PREFIX` changed to `''`; **unanchored** regex (R4); `toBioPid` returning `` `${src}` `` (R5); a
surface with a hardcoded `go.usemingla.com` (R6); `page.tsx` passing `searchParams.src` straight through
(R7); **compliant → pass**; banned token **inside a comment → must pass** (comment-strip proof).

### 10.6 Known gate hole (NOT fixed here) — issue #904

Every gate regex above is **case-sensitive**; browsers are not. `rel="NOOPENER"` /
`w.open(d,'_blank','NOOPENER')` slips through **every** check in this repo. **Pre-existing, out of scope,
explicitly not fixed by ORCH-1382.** New §10 regexes **must not make it worse**; adding `/i` where it costs
nothing is encouraged but not mandated. **Flagged so the tester does not report it as an ORCH-1382 defect.**

### 10.7 Local sweep before PR

```
node .github/scripts/strict-grep/orch-1328-links-cta-opens-store-clientside.mjs --self-test && node …/orch-1328-….mjs
node .github/scripts/strict-grep/orch-1319-getapp-cta-direct-store.mjs --self-test && node …
node .github/scripts/strict-grep/orch-1324-business-getapp-device-aware.mjs --self-test && node …
node .github/scripts/strict-grep/orch-1326-links-business-download-route.mjs --self-test && node …
node .github/scripts/strict-grep/orch-1381-business-getapp-android-choice.mjs --self-test && node …
node .github/scripts/strict-grep/orch-1381-open-external-no-double-nav.mjs --self-test && node …   # must stay green UNTOUCHED
node .github/scripts/strict-grep/orch-1342-store-links-ssot.mjs --self-test && node …              # must stay green UNTOUCHED
node .github/scripts/strict-grep/orch-1382-links-src-onelink-attribution.mjs --self-test && node … # NEW
cd mingla-marketing && npm run build
```
**Register the new gate as a job in `.github/workflows/strict-grep-mingla-business.yml`** (where the sibling
`orch-13xx` jobs live) **and** add its invariant stanza to the header comment block — the repo convention.

---

## 11. Open questions

**OQ-1 — Snapchat on the Business tab: hidden, or shown with the consumer handle? (RECOMMEND: hidden.)**
Seth: *"Add Snapchat to the Explorer socials… **Explorer only** — there is NO business Snapchat account."*
Read literally → `explorer_only` → **hidden** on the Business tab (Business shows 7, Explorer 8). The
alternative (treat it as `neutral`, showing the consumer handle on both) is what today's model would do by
accident and is what §5.5 exists to prevent. **Spec'd as hidden.** Ship as spec'd unless Seth says otherwise.

**OQ-2 — `/links` vertical budget (§5.3.3). ESCALATE ONLY IF the levers fall short.**
Stacking costs ~64px against ~20px measured headroom. If the implementor cannot reach SC-6-NoScroll with the
allowed levers, Seth must rule between: (a) business pills `h-12` (48px, still ≥44px); (b) shortening
`BUSINESS_APP_CHOICE_COPY.moreNote` (**currently forbidden — it is a verified claim**); (c) accept the
Business tab scrolling at 375×667 (**breaks the ORCH-1317 §1 contract**). **Recommendation: (a).**
**Do not silently pick (b) or (c).**

**OQ-3 — third-party dependency on the OneLink for the install path. (RECOMMEND: accept + monitor.)**
**A genuine new risk introduced by ask A, and it must be stated.** Today a dead OneLink template breaks
nothing — every CTA points at a plain store URL that cannot go Pending. After ORCH-1382, **every install
CTA on the marketing site depends on AppsFlyer serving a 301.** COMMS-0101 recorded exactly that failure
mode **this week** (business app Pending → OneLink serving `200 "app unavailable"` instead of `301`). The
blast radius **widens from "Android business only" to "every install CTA, both apps, all platforms."**
- **Recommend: accept** (attribution is the entire point of B; all 4 apps are now Active — §0.1)
  **+ mitigate** with a scheduled synthetic probe (cron/CI) curling both OneLinks under an Android UA and
  alerting on anything that is not a `301 → market://` (**with a retry** — the ~1-in-8 flake, §0.1, would
  otherwise page constantly). **The probe is a follow-on ORCH, not this one.**
- **Seth's call.** If he rejects the risk, the fallback is: OneLink on `/links` (attribution matters most)
  and plain store URLs on nav/hero — **but that leaves ask A's "no intermediate page" complaint unfixed on
  nav/hero**, since the plain URL is the actual cause (§0.2).

**OQ-4 — pid for non-`/links` surfaces. (RECOMMEND: `pid=mingla_web`.)**
Ask B specifies `bio_*` for `/links` only. But once nav/hero/`/business/download` use a OneLink (forced by
ask A), they **need** a pid or they attribute to the template default and become indistinguishable from
organic. Recommend `pid=mingla_web` with `c` ∈ {`explorer_nav`, `business_nav`, `business_hero`,
`business_download`}. `mingla_web` is not a reserved SRN and is not `bio_*` (correctly — these are not bio
traffic). **Spec'd as recommended; flag if Seth wants a different taxonomy.**

---

## 12. The tester's attack list

Hand to `mingla-tester`. **Source-only reasoning caps at "suspected" — SC-1/SC-6/SC-8 require a real device
or a real viewport.** Rapid-fire curl loops give ~1-in-8 false failures: **always retry ≥3× before calling a
link broken** (§0.1 shows the flake live).

### A. Attribution (highest value)
1. **`?src=` fuzz.** `<script>alert(1)</script>`, `a&b=c`, `../../etc/passwd`, `%2e%2e%2f`, `a%00b`,
   `'; DROP`, 1000×`a`, `""`, `?src` (bare), `?src=a&src=b`, `?SRC=youtube` (**wrong case KEY** — Next is
   case-sensitive → expect fallback), unicode `?src=ユーチューブ`, `?src=bio_youtube` (**double-prefix →
   expect `bio_bio_youtube`, which is ugly but SAFE — confirm it is not `bio_youtube`**).
   **Every one must yield `pid=bio_direct` or a `/^bio_[a-z0-9_]{1,32}$/` value. Nothing reflected. No throw.**
2. **Crossed links (H-2).** Grep every rendered href on `/links`, `/business`, `/business/download`.
   **Business must NEVER emit `go.usemingla.com`; Explorer must NEVER emit `biz.usemingla.com`.** Then
   **curl the emitted business href under an Android UA and assert the resolved package is
   `com.sethogieva.minglabusiness`, not `com.mingla.app.v2`.** *(Identity, not substring — the T-2/T-7 angle.)*
3. **Tab-switch persistence.** `?src=seth` → Explorer→Business→Explorer→Business. `pid=bio_seth` on **every**
   resolved href; only `c` flips.
4. **Referrer ride-through (live).** `curl -A '<Android UA>' '<emitted href>'` → assert `301` → `market://`
   **and** the `referrer` param decodes to contain `pid=bio_<src>`. Both apps. **Retry ≥3×.**
5. **Reserved-SRN safety.** `?src=facebook`, `?src=tiktok`, `?src=snapchat`, `?src=google` → **must** emit
   `bio_facebook` etc., **never** bare. *(This is the H-1 defect that corrupts paid reporting.)*

### B. The anchor contract
6. **Real link.** DOM-assert `<a href>` (not `<button>`) on all 4 surfaces, ios + android UA. Long-press on
   a real device → the OS "Open in new tab / Copy link" sheet **must** appear.
7. **`rel` not dropped.** Every store/web anchor: `target="_blank"` **and** `rel` contains `noopener`.
   **This is the §5.1 trap** — an implementor "complying" with ORCH-1381 may have stripped it.
8. ⭐ **In-app browser (the reason anchors were chosen — §5.1).** Open `usemingla.com/links` **from the
   Instagram in-app browser** and **from TikTok's**, on a real Android phone and a real iPhone. Tap both
   CTAs. **The store must open.** *(This is the case `window.open` fails and the one the whole decision
   rests on. It cannot be proven in a desktop browser.)*
9. **No intermediate page (ask A's actual symptom).** Real Android device, tap "Get the app". **The Play
   app must open directly — no Play *website* flash.** *(This is the acceptance test for §0.2. If a web page
   flashes, the OneLink is not being used.)*
10. **`/links` stays mounted.** After the store opens, return to the browser. `/links` must still be there,
    interactive, on the same tab.
11. **Desktop unchanged.** `/links` Explorer desktop → new tab to `/download` (QR), `/links` stays. Nav
    desktop → QR **panel**. **No dead install button anywhere** (`canInstall === false`).
12. **Popup-block.** Block popups → the desktop `/download` path must still navigate (the surviving
    `openExternal` fallback), **exactly once** — not twice. *(The D-B double-nav regression.)*

### C. Layout (real viewports — clipping, not scrollHeight)
13. ⭐ **Clipping, not scrolling (§5.3.3).** 375×667 **and** 360×640, Business tab, `?src=youtube`, consent
    **accepted**. Assert **every** element (wordmark, tablist, heading, both CTAs, note, **every social
    icon**) has `rect.bottom <= innerHeight && rect.top >= 0`. **Do NOT report PASS on
    `scrollHeight === clientHeight` alone — `overflow-hidden` makes that pass on a clipped page.**
    *(This is the trap that would let this ORCH ship broken.)*
14. **Stacked, not side-by-side.** `getApp.bottom <= useWeb.top`; the two must **not** share a `top`.
15. **`px-4` gone.** Both business pills at 320/360/375/390/412: `scrollHeight === clientHeight` **per pill**;
    computed padding = `px-7`. **No 3-line wrap.** *(SC-7 — the ORCH-1381 P2-1 regression.)*
16. **44px.** Both pills ≥ 44px tall. Landscape 667×375 + 915×412.
17. **#905 not deepened (SC-8).** 375×667 **pre-consent**: measure banner↔CTA overlap; compare to the
    ORCH-1381 baseline (banner `y=439–655`, CTAs `y=394–450`). **Carried bug — must not get worse.**

### D. Socials
18. **Snapchat present on Explorer** → exactly `https://www.snapchat.com/add/usemingla`; **ABSENT on
    Business** (OQ-1). *(The D+E coupling bug: if it appears on Business, the taxonomy was not implemented.)*
19. **Counts:** Explorer 8, Business 7. Both rows fully visible at 375×667 **and** 360×640 (feeds #13).
20. **Neutral:** YouTube + LinkedIn → identical href on both tabs.
21. **Per-surface:** Instagram/X/TikTok/Facebook/Threads → `@minglabusiness` on Business (unchanged).
22. **Icon renders.** Snapchat `<svg>` actually paints — **do not accept layout box alone**; a broken glyph
    lays out identically. *(The QA_ORCH-1381 `naturalWidth` lesson.)*

### E. Copy + regression
23. **"Get the app"** on all 4 business surfaces; **zero** "Download the app" in rendered output.
24. **`moreNote` / `desktopNote` / `useWeb` byte-unchanged.**
25. **Invite email byte-frozen.** `orch-1329-invite-email.tester.test.ts` green; the href is **exactly**
    `https://usemingla.com/business/download` with **no** query string. **Then confirm
    `/business/download` still attributes correctly WITHOUT one.** *(§7.2 — the easiest way to fail this ORCH.)*
26. **`/business/download` still a Server Component.** `curl` returns `200` HTML with the right href per UA;
    grep the source for `window` / `navigator` / `<form>` → **zero**.
27. **Gate honesty (fails-on-revert).** For **each** §10 amendment, revert the fix in a scratch copy and
    confirm the gate **FAILS**; restore and confirm **PASS**. **Specifically re-prove §0.4:** a
    `links-experience.tsx` whose CTA is a plain `<div>` but which still has `<button role="tab">` **must now
    FAIL** `orch-1328` (it passes on `main` today).
28. **`orch-1381-open-external-no-double-nav.mjs` + `orch-1342-store-links-ssot.mjs` still green,
    UNTOUCHED.** *(If either was edited, the implementor breached §7.2.)*

---

## 13. Invariants

### Preserved (with the test that proves it)
| ID | How preserved | Test |
|---|---|---|
| `I-PROPOSED-1328-LINKS-CTA-OPENS-STORE-CLIENT-SIDE` | The CTA still opens the destination on the tap and `/links` stays mounted — the **mechanism** changes (anchor + `_blank`), the **property** does not | T-9, attack #10 |
| `I-PROPOSED-1381-OPEN-EXTERNAL-SINGLE-OWNER` | `open-external.ts` **unchanged**; still the one owner of the surviving non-store open | gate unamended, attack #28 |
| `I-PROPOSED-1381-BUSINESS-GETAPP-ANDROID-CHOICE` | Two real actions, never collapsed; android never → web | T-1, T-2 |
| `I-PROPOSED-1342-STORE-LINKS-SSOT` | `mingla-business/` untouched; the two byte-compared consts unmodified | gate unamended, attack #28 |
| `I-PROPOSED-1324-BUSINESS-GETAPP-DEVICE-AWARE` | Both actions + both `action:` captures survive | §10.3, attack #23 |
| `I-PROPOSED-1326-LINKS-BUSINESS-DOWNLOAD-DEVICE-AWARE` | Route stays a Server Component rendering plain `<a>` | T-11, attack #26 |
| `I-1319-GETAPP-CTA-LINKS-LIVE-STORES-NOT-TESTFLIGHT` | OneLink → the **live** listings; no testflight token | §10.2 |
| ORCH-1317 §1 `/links` single-viewport no-scroll | SC-6-NoScroll (**clipping-aware**) | attack #13 |
| ORCH-1346 one-domain-one-template | `go.*` consumer / `biz.*` business, never crossed | **T-7**, §10.5 R1/R2 |
| ORCH-1329 invite-email href byte-frozen | No query param added; `/business/download` self-attributes | attack #25 |

### NEW (propose as DRAFT — orchestrator flips ACTIVE at CLOSE)
- **`I-PROPOSED-1382-LINKS-SRC-BIO-PID-NEVER-CROSSED`** (DRAFT) — *Every OneLink emitted by
  `mingla-marketing/` carries a `pid` matching `/^bio_[a-z0-9_]{1,32}$/` (bio surfaces) or a non-reserved
  owned-media pid (site surfaces); `src` is sanitised against an **anchored** charset and fails safe to
  `bio_direct`, never empty and never reflected; and the Explorer (`go.usemingla.com/w36m`) and Business
  (`biz.usemingla.com/ZSCW`) bases are **never crossed** and never raw `*.onelink.me`.*
  **Enforcement:** `orch-1382-links-src-onelink-attribution.mjs` (§10.5) + T-4 + T-7. Fails-on-revert both
  directions.

---

## 14. Downstream routing

**Next → `mingla-implementor`.** Then `mingla-tester` (§12). Then `mingla-orchestrator` CLOSE.

- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1382-[links-src-tracking-getapp-stack]` on branch
  `ORCH-1382-links-src-tracking-getapp-stack`.
- **CLOSE commit MUST carry `[deploy]`** (touches `mingla-marketing/`).
- **One PR**, `gh pr merge --squash --admin`, **all checks green** first.
- **Orchestrator at CLOSE:** flip `I-PROPOSED-1382-…` DRAFT → ACTIVE; register the new gate's invariant
  stanza in the workflow header; **resolve/supersede COMMS-0101's "business OneLink DEAD on Android" claim
  (§0.1) — COMMS-0103 files the correction**; register the §11 OQ-3 synthetic-probe follow-on and the §2.2
  repo-wide `if (!win)` sweep as new ORCHs.
- **Blocking on Seth:** OQ-3 (accept the third-party install-path dependency) — **answer before IMPLEMENT**,
  it can change scope. OQ-1 + OQ-4 have recommended defaults and are **non-blocking**. OQ-2 escalates only
  if the §5.3.3 levers fall short.
