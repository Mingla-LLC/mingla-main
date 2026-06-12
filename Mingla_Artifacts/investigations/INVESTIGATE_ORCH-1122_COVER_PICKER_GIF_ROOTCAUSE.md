# INVESTIGATE — ORCH-1116 [Cover picker GIF tab shows "This source is taking a break"]

> **READ THIS FIRST — there have been TWO corrections. The SECOND CORRECTION (immediately below) is the AUTHORITATIVE verdict. It supersedes both the FIRST CORRECTION's "build-profile gap (Seth runs a keyless development build)" framing AND the original report. The earlier sections are retained for the record but their conclusions are superseded where they conflict with the SECOND CORRECTION.**

---

# SECOND CORRECTION (FIRST-CORRECTION verdict falsified by data + build history) — 2026-06-12

**Skill:** mingla-forensics · **Phase:** INVESTIGATE (re-opened, 2nd pass) · **Date:** 2026-06-12
**Branch context:** read-only against anchor `/Users/sethogieva/Desktop/mingla-main` on `main`. No product code touched. Comms ledger read on entry — acked **COMMS-0024** (WARN, ORCH-1116 ID collision: three concurrent worktrees share ORCH-1116; this `gif-cover-key` investigation must RENUMBER before it ships — `booking-gate-rls` keeps 1116 per shipped-first; lowest free ID ≥1122 at write time). That is a registry/ID issue, not a code issue, and does not change the technical verdict.
**Confidence:** **PROVEN** — carried by (a) the EAS **build-channel history** showing the development profile's channel flipped, (b) the git commit that flipped it, (c) the production-DB GIF rows showing every genuine GIPHY-picker save predates the flip, and (d) the exact copy→errorcode mapping. Not source-only; not OTA-speculative.

## The two prior verdicts and why BOTH are wrong on the framing

- **V1 "GIPHY key was NEVER configured"** — already killed (giphy covers are live).
- **V2 / FIRST CORRECTION "build-profile gap: key is in EAS `production` env only; Seth runs a `development`-profile build which never had the key"** — the *layer* is right (it IS a build-env-resolution problem) but the *timeline framing is FALSE*: dev-profile builds did **not** "never" have the key. Earlier `development`-profile builds (May 15–20) resolved the **`production` channel** and **DID** carry the key — that is exactly how Seth picked the live GIFs. The bug is a **regression introduced by a May-25 eas.json channel flip**, not a permanent dev-vs-prod gap.

## The brief's decisive premise is FALSIFIED by the data

The brief asserted: *"a giphy cover was saved 2026-06-03 ⇒ this SAME ~May-30 dev build successfully used GIPHY on June 3."* **The DB disproves this.** There is **NO** genuine GIPHY-picker save after 2026-05-20. The two "June 3" rows the brief leaned on are both false positives:

| id | title | provider | source_url | created_at | updated_at | what it actually is |
|---|---|---|---|---|---|---|
| `a3f71d85…` | The party block | `giphy` | set | **2026-05-09** | 2026-06-03 16:57 | A **25-day-old** May-9 giphy cover; the June-3 timestamp is an `updated_at` from an unrelated event edit. The GIF was **not re-picked** (same May-9 URL). `age_at_update = 25 days`. |
| `59df3bc4…` | Recur_Date_Test | **NULL** | **NULL** | 2026-06-03 03:28 | 2026-06-03 06:39 | A recurring-date **test fixture**; `provider IS NULL` ⇒ it did **NOT** go through the unified-picker GIPHY path (which always stamps `provider='giphy'` + `source_url`). A keyless code path copied a giphy URL string — no live GIPHY fetch, no key needed. |

Every row with `cover_media_provider='giphy'` (the only rows that prove the live GIPHY picker ran) was **created 2026-05-09 → 2026-05-20**, inclusive. **None after May 20.** So the May-30 build never demonstrably ran the GIPHY picker at all — the premise "it worked on June 3 on the May-30 build" is unsupported.

## The actual root cause (one sentence)

A **2026-05-25 eas.json commit (`4c3bdfe8f`) flipped the `development`/`development-sim` build profiles' `channel` from `"production"` to `"development"`**, which re-points those profiles from the **production** EAS environment (HAS the GIPHY key) to the **development** EAS environment (NO GIPHY key); Seth's **2026-05-30** build is the **first build on the new keyless `development` channel**, so `publicGiphyKey()` resolves `null` → both GIF paths throw `not_configured` → "This source is taking a break." The GIFs already on his events were picked on the **pre-flip May 15–20 dev builds**, which still resolved the production channel and carried the key.

## Decisive evidence (build-channel history → git flip → DB → copy mapping)

### E2C-1 — EAS build history: the development profile's CHANNEL flipped production→development between May 20 and May 25
`eas build:list --platform ios` (FINISHED builds, with `channel`):

```
2026-05-30  development      channel=development   ← Seth's current build (FIRST keyless one)
2026-05-26  development      channel=development
2026-05-25  development      channel=development
2026-05-20  development      channel=production    ← last key-bearing dev build
2026-05-19  development      channel=production
2026-05-18  development      channel=production
2026-05-16  development      channel=production
2026-05-15  development      channel=production
```

Same build **profile** (`development`), different **channel** before vs after ~May 25. Channel → EAS environment → which `EXPO_PUBLIC_*` vars are inlined. `production` channel ⇒ production env ⇒ GIPHY key present; `development` channel ⇒ development env ⇒ no GIPHY key (FIRST CORRECTION E-4 already proved the per-env key distribution).

### E2C-2 — The git commit that flipped it (the regression)
`git log -- mingla-business/eas.json`; `git show 4c3bdfe8f -- eas.json`:

```
commit 4c3bdfe8f  2026-05-25 16:42  "chore: sync parallel-session edits + untrack node_modules symlinks"
  body: "mingla-business/eas.json: dev profiles correctly source 'development' EAS channel (was 'production')"
  -      "channel": "production",
  +      "channel": "development",     (development profile)
  -      "channel": "production",
  +      "channel": "development",     (development-sim profile)
```

The commit **intended** this flip ("correctly source 'development'") for hygiene, but the GIPHY key was never provisioned into the `development` environment, so the flip silently broke the GIF picker on all subsequent dev builds. Current `eas.json` confirms `development → channel: development`, `preview/production → channel: production`.

### E2C-3 — No OTA could be responsible (kills the brief's prime suspect #1 and #2)
Two independent proofs the JS code path did NOT change at runtime between June 3 and now:
1. **The key-reading code is byte-identical across the whole window.** `git log` on `coverProviderBrowseService.ts` + `giphyEventCoverService.ts` shows their last touch was **ORCH-0989 (2026-05-29 13:19)** — *before* the May-30 build. `publicGiphyKey()` and the `envValue("EXPO_PUBLIC_GIPHY_API_KEY") ?? envValue("EXPO_PUBLIC_GIPHY_KEY")` lines are identical between the ORCH-0783 (May 11) version and HEAD. **No var-name rename ever landed.** Both names have always been read, in the same order, since ORCH-0783.
2. **The `development` channel received NO OTA after the build.** `eas update:list --branch development` returns **7 updates, the most recent ~2026-05-26** (all ORCH-0964/0980/0849 era) — every one BEFORE the May-30 build and far before June 3. The production-branch OTA stream (ORCH-1079…1112) does **not** reach the development channel. So Seth's dev build has been running its **embedded May-30 bundle** the whole time; nothing about the GIF code changed via OTA. Brief suspects #1 (OTA refactored key reading) and #2 (var-name divergence via OTA) are **KILLED**.

> Note on the brief's "no rebuild in between" assumption: there **was** a rebuild — the May-30 build itself. It is a *different binary* from the May-15/20 key-bearing builds, and it is the *first* one built on the post-flip keyless config. The flip's effect is invisible until the next build; May 30 was that build.

### E2C-4 — Exact copy→errorcode proof: Seth's string means NULL KEY, not API rejection (kills suspect #3)
`CoverPicker.tsx:1153-1158` + `:1211-1215`:

```
gif.not_configured        → { title: "This source is taking a break.", body: "GIFs aren't available right now — your own Library still works." }   ← Seth's exact screen
gif.provider_unavailable  → { title: "Couldn't reach GIPHY.",          ... }   ← what a 401/403 bad/rotated key would show
gif.rate_limited          → { title: "Whoa, slow down.",               ... }   ← what a 429 quota hit would show
```

`not_configured` is thrown **only** at `coverProviderBrowseService.ts:103-108` / `giphyEventCoverService.ts:83-88` when `publicGiphyKey() === null` — **before any network call**. A rotated/revoked/rate-limited/quota-exhausted GIPHY key surfaces as `provider_unavailable` or `rate_limited`, with **different copy**. Seth sees "This source is taking a break." ⇒ the build literally has **no key string** ⇒ a build-env-resolution problem, NOT a GIPHY-side problem. **Suspect #3 KILLED.** (FIRST CORRECTION E-3 separately proved the production key still returns HTTP 200 live — the key is valid; it's just absent from this build's env.)

## Suspect reconciliation (per the brief)

| Brief suspect | Verdict | Carrying evidence |
|---|---|---|
| 1. OTA changed the key-reading code path / var name | **KILLED** | Service files untouched since 2026-05-29 (pre-build); `development` channel got no OTA after 2026-05-26 (E2C-3). |
| 2. Two var names diverged (inlined one, reads other) | **KILLED** | `publicGiphyKey` reads BOTH names, unchanged since ORCH-0783; no rename ever committed (E2C-3.1). The vars aren't *renamed* — they're *absent* in the development env. |
| 3. GIPHY-side rotation/revoke/rate-limit/quota | **KILLED** | Would map to `provider_unavailable`/`rate_limited`, different copy; Seth sees `not_configured` (E2C-4). Production key returns 200 live (FIRST CORRECTION E-3). |
| 4. Dev env key removed from eas.json/.env after May 30 | **N/A — and the real mechanism is upstream of this** | The key was never *in* eas.json; it lives in the EAS *environment*. The regression is the **channel flip** (`4c3bdfe8f`, May 25) re-pointing the dev profile to the keyless development environment — which is exactly the "future rebuild would also break" risk suspect #4 gestures at, now proven as the active cause. |

## Why the brief's "runtime regression with no rebuild" frame doesn't hold — and what's true instead

There is **no** runtime regression on a single unchanged binary. The evidence shows a **build regression that took effect at the next build**:
- The GIF picker worked on the **May 15–20 binaries** (development profile → production channel → key present). Seth picked all live GIFs then.
- A **config commit on May 25** flipped the development profile to the keyless development channel.
- The **May 30 binary** is the first to inline a null key. It has shown `not_configured` from the moment it was installed — there is no DB evidence it ever picked a GIF successfully. The "it worked June 3" belief rests on the two false-positive rows in the table above (a stale-edit `updated_at` and a provider-NULL test fixture), not on a live picker run.

`EXPO_PUBLIC_*` are build-time inlined; the binary's behavior is fixed at build time and did not (could not) change at runtime. The apparent "it worked then stopped without rebuilding" is an artifact of (a) misattributing the May-picked GIFs to the May-30 build, and (b) reading a June-3 `updated_at` on a May-9 cover as a fresh pick.

> Minor mechanism note (not load-bearing): the GIPHY services read the key via **dynamic** access — `globalThis.process?.env?.[name]` with `name` a runtime string — which `babel-preset-expo`'s inliner does NOT textually replace the way it replaces literal `process.env.EXPO_PUBLIC_X` member access used elsewhere (Stripe/Google). This still resolves correctly when the var is present in the build env (Expo emits an injected `process.env` object dynamic access can read), and it does NOT change the verdict, but it makes the GIPHY key strictly dependent on the *environment* the channel resolves — there is no literal-inline fallback. Flag for the SPEC as a hardening note, not a root cause.

## Corrected fix direction (NOT an implementation) — differs from V2's recommendation

V2 said "provision the key into development/preview envs **and rebuild**." The corrected, cheaper, and intent-respecting fix is a **config decision**, and the SPEC must pick one:

1. **Option A (provision the key, keep the channel split):** add `EXPO_PUBLIC_GIPHY_API_KEY` (+ `_KEY`) to the **development** (and **preview**) EAS environments, then **rebuild the development build**. Restores GIFs on every future dev build. Open question O-1 carries over: reuse the production key vs. mint a separate GIPHY dev key.
2. **Option B (revert the channel flip's side-effect):** if the May-25 flip's only practical effect was losing client public keys, either re-point dev profiles back to a key-bearing channel **or** add the required `EXPO_PUBLIC_*` keys to the development env so the "correct" channel split is preserved without breaking authoring. Prefer B's "add keys to the correct env" — keeping the channel split that `4c3bdfe8f` intended for OTA hygiene, but provisioning the env it now points at.
3. **Either way, a rebuild IS required** for the *currently-installed* May-30 binary — its null key is baked in; an env change or OTA cannot revive it. (This part of V2 was correct.) This is NOT, however, the "code/OTA-only fix" the brief hypothesized would apply *if* it were an OTA var-name regression — because it is **not** an OTA var-name regression. The brief's "very different from V2" expectation does not materialize: the fix is env-provisioning + rebuild, with the *added* understanding that the trigger was a channel-flip regression, so the SPEC should also decide whether to keep or partially revert the flip.
4. **Prevent:** a CI/config gate asserting every required client-direct `EXPO_PUBLIC_*` public key is provisioned in **every channel a shipping profile resolves** (not just production) — mirrors `feedback_mingla_business_pk_live_in_production`. The May-25 flip silently dropped GIPHY (and, per FIRST CORRECTION D-1, Sentry DSN) from dev builds with zero CI signal.
5. **Detect:** telemetry distinguishing a CONFIG `not_configured` (mis-provisioned build — alert) from a transient `provider_unavailable`/`rate_limited` (expected, user-facing). Blocked on Sentry DSN also being absent from the development env (FIRST CORRECTION D-1).

## Blast radius

- **Business iOS + Android — every build on the `development` channel from 2026-05-25 (`4c3bdfe8f`) onward** (currently Seth's May-30 dev build): GIF tab dead (`not_configured`). The `preview` and `production` channels still resolve the production env → GIF works there. Local Metro also lacks the key (no committed `.env`).
- **Consumer `app-mobile/`** — unaffected (no GIPHY).
- **Buyer/anon web, admin web** — unaffected (CoverPicker is business authoring only).
- **Recurring-pattern risk:** the May-25 channel flip silently dropped ALL production-env-only `EXPO_PUBLIC_*` keys from dev builds (GIPHY confirmed; Sentry DSN per D-1; Stripe pk intentionally undesirable in dev anyway). Any future production-env-only client key inherits this, invisible to CI.

## Confidence statement

**PROVEN.** Carried by: the EAS build-channel history showing the development profile flipped `production`→`development` channel between May 20 and May 25 (E2C-1); the exact git commit `4c3bdfe8f` (2026-05-25) that flipped it, with a commit body stating the change (E2C-2); the production-DB showing every genuine `provider='giphy'` save is dated 2026-05-09→05-20, all pre-flip, with the two "June 3" rows proven to be a stale-`updated_at` and a provider-NULL fixture (falsifying the brief's premise); zero OTA on the development channel after the build + byte-identical key-reading code (killing the OTA suspects, E2C-3); and the copy→errorcode mapping proving `not_configured` = null key, not API rejection (E2C-4). **What I did NOT do:** capture an on-device screenshot of the rendered error card on Seth's exact install (sim is behind the business sign-in wall; no test login). That is cosmetic — the `not_configured` chain is deterministic given a keyless build and every config/data/timeline layer is proven. **To upgrade beyond PROVEN-on-config to a pixel on-device confirmation I would need:** Seth's business-app sim/test login, OR Seth to read the in-app error string on his physical May-30 dev build (expected: "This source is taking a break." with NO retry button) — but it would not change the verdict.

---
---

# CORRECTION (operator falsified prior verdict) — 2026-06-12

**Skill:** mingla-forensics · **Phase:** INVESTIGATE (re-opened) · **Date:** 2026-06-12
**Branch context:** read-only against anchor `/Users/sethogieva/Desktop/mingla-main` on `main`. No product code touched. Comms ledger read on entry (no BLOCK/WARN row addressed to forensics or ORCH-1116).
**Confidence:** **PROVEN** — carried by (a) decisive production-DB data, (b) a LIVE GIPHY-API call proving the key works right now, and (c) EAS build-profile→environment resolution. Not source-only.

## What the operator said (the falsification)

Seth, verbatim: *"I used giphy before and thats how i picked the gifs currently on some of the events."* → GIFs were successfully picked via GIPHY in the past and those GIF covers are LIVE on real events now. Therefore "EXPO_PUBLIC_GIPHY_API_KEY was NEVER configured" is **false on its face** — the integration demonstrably worked. The real question is a **regression / config-drift** question: it worked, then stopped; when and why.

## The corrected root cause (one sentence)

The GIPHY key is valid and works right now, but it lives **only in the EAS `production` environment**; Seth's GIF covers were created back in May on a build that carried the key, and the business build he is running **now is a `development`-profile build** (resolves the `development` EAS environment, which has **no** GIPHY key) → `publicGiphyKey()` returns `null` → both GIF paths throw `not_configured` → "This source is taking a break." This is a **build-profile gap (regression-by-build-flip)**, NOT "never configured," NOT an expired/invalid key.

## Decisive evidence (data layer first, then live API, then build config)

### E-1 — Production DB: GIF covers WERE saved, and exactly when (proves it worked)
`events` table, `cover_media_provider` distribution (MCP read-only, project `gqnoajqerqhnvulmnyvv`):

| provider | rows | first_created | last_created |
|---|---|---|---|
| `giphy` | **10** | 2026-05-09 15:27 UTC | **2026-05-20 17:34 UTC** |
| `upload` | 2 | 2026-05-09 | 2026-05-09 |

All 10 `provider='giphy'` rows carry real GIPHY URLs (`https://media{N}.giphy.com/media/.../giphy.gif`) and `cover_media_source_url = https://giphy.com/gifs/...`. Titles include "Big Party", "The DC Adventure", "The party block", etc. **This is the live proof that GIF picking worked.** Every one was created **2026-05-09 → 2026-05-20** — the ORCH-0783/0805 event-cover-GIPHY era (closes 2026-05-11). None created after 2026-05-20.

### E-2 — Two MORE giphy URLs saved as late as 2026-06-03 (provider=NULL) — GIPHY still reachable post-May
Querying `cover_media_type='gif' AND cover_media_provider IS NULL`:

| id | title | url | created_at |
|---|---|---|---|
| 59df3bc4… | Recur_Date_Test | `media4.giphy.com/media/ro4WcwPA2vmIPt1WVt/giphy.gif` | **2026-06-03 03:28 UTC** |
| ea143e97… | Testing trip publish failure | `media0.giphy.com/media/Y1enijrbL769E5wXZy/giphy.gif` | 2026-05-22 08:12 UTC |

These are giphy.com assets persisted by a **different** persist path (provider/source_url not set — pre-unified-picker trip flow or a test fixture), but their existence shows GIPHY content was still being placed as recently as **2026-06-03**, well after the "dev never had the key" cutoff the original report implied. (Caveat: a giphy URL can be re-used without a live fetch; these two do not by themselves prove a live API hit, but they do not contradict the verdict either.)

### E-3 — The production GIPHY key WORKS RIGHT NOW (kills the expired/invalid/rate-limited hypotheses)
Pulled the key from EAS `production` env (`EXPO_PUBLIC_GIPHY_API_KEY = besogftLvXwocfEHqqkfSEz8kwQyZkxb`, identical for `EXPO_PUBLIC_GIPHY_KEY`) and hit both GIF endpoints live:

```
GET https://api.giphy.com/v1/gifs/trending?api_key=besog…&limit=3&rating=pg-13   → HTTP 200  (real data[])
GET https://api.giphy.com/v1/gifs/search?api_key=besog…&q=party&limit=3          → HTTP 200  (real data[])
```

Both 200 with real payloads. The key is **valid, not expired, not rate-limited**. So if a build inlines this key, the GIF tab works. The fault is purely that the current build doesn't inline it.

### E-4 — The build Seth is running is a `development` build with NO GIPHY key
`eas build:list --platform ios` — the only recent **successful** business iOS build is **Profile `development`, distribution `internal`, finished 2026-05-30**. EAS resolves environment by profile name:

```
eas config --profile development → "development" env → GIPHY: NONE  (only SENTRY_DISABLE_AUTO_UPLOAD, EXPO_PUBLIC_ONESIGNAL_APP_ID)
eas config --profile preview     → "preview" env     → GIPHY: NONE
eas config --profile production  → "production" env   → EXPO_PUBLIC_GIPHY_API_KEY, EXPO_PUBLIC_GIPHY_KEY, EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY
```

`env:list` confirms GIPHY exists in `production` only; `development` and `preview` return none. So Seth's 2026-05-30 development build inlined `process.env.EXPO_PUBLIC_GIPHY_API_KEY = undefined` → `publicGiphyKey()` → `null` → `not_configured`.

### E-5 — No local `.env`, app-mobile has no GIPHY at all
`mingla-business/` has only `.env.example` (no real `.env`, GIPHY not even documented there) and no `eas env:pull` in scripts → local Metro dev also lacks the key. `app-mobile/` (consumer) contains **zero** GIPHY references → the "different surface" hypothesis (b) is killed: all 12 GIF covers were authored on the business app, never the consumer app.

## Hypotheses reconciled (prove/kill)

| # | Hypothesis | Verdict | Evidence |
|---|---|---|---|
| (a) | Key present then dropped/renamed in a config edit | **KILLED** | Git: `EXPO_PUBLIC_GIPHY` has NEVER been in `eas.json` (no `-S "GIPHY"` hit on eas.json) and the var name (`EXPO_PUBLIC_GIPHY_API_KEY` / `_KEY`) is unchanged since ORCH-0783. No commit removed it; it was always EAS-remote-prod-only. |
| (b) | GIFs picked on a different surface (consumer app) | **KILLED** | `app-mobile/` has zero GIPHY code; all GIF covers are business-app authored (E-5). |
| (c) | Key now invalid / expired / rate-limited | **KILLED** | Live API returns HTTP 200 on trending + search (E-3). A bad key would surface as `provider_unavailable` (401/403) or `rate_limited` (429), NOT `not_configured`. |
| (d) | Key set in eas.json for some profiles only / current build lacks it | **CONFIRMED — this is it** | Key is in the `production` EAS env only; current build is `development` profile → no key (E-4). |
| (e) | Works via EXPO_PUBLIC build-time inlining; current install is an OTA that can't carry it | **PARTIALLY TRUE / contributing** | `EXPO_PUBLIC_*` are baked at BUILD time; an OTA can't inject the key into a bundle whose build env resolved it to `undefined`. Additionally the dev build is on the `development` channel and does not even receive the `production`-channel OTAs. So OTA cannot rescue a dev build. |

## not_configured vs invalid-key vs build-profile-gap vs wrong-surface — the distinction

- **not_configured** (`publicGiphyKey() === null`, thrown BEFORE any network call; retry suppressed; copy "This source is taking a break.") ← **this is what Seth sees.** It means the build literally has no key string.
- **provider_unavailable / rate_limited** (key present, network call made, GIPHY returns 401/403/429) ← NOT what's happening; the key is good (E-3).
- **build-profile-gap** ← the underlying cause: key exists in `production` env, absent from `development`/`preview` envs + local + OTA-to-dev-channel.
- **wrong-surface** ← ruled out; business app only.

## Why the prior pass mislabeled it

The original report's F-4 actually FOUND the build-profile gap correctly (key in production env only). Its error was twofold: (1) it framed the verdict as "dev/preview builds **never** had the key" without reconciling against the live DB, which shows GIFs **did** work — so it read as "never configured" and missed that this is a **regression caused by Seth's build flipping from a key-bearing build to a development build**; and (2) it claimed "PROVEN" while the sim repro had stopped at the sign-in wall (GIF tab never exercised) and the live DB + live API were never queried. This corrected pass supplies the data-layer + live-API evidence the original lacked.

## Blast radius

- **Business iOS + Android** — any `development` or `preview` profile build, plus local Metro and any OTA delivered to the `development` channel: GIF tab dead (`not_configured`). **Production builds work** (key present, key valid).
- **Consumer app-mobile** — unaffected (no GIPHY).
- **Buyer/anon web, admin web** — unaffected (CoverPicker is business authoring only).
- **Recurring-pattern risk:** any client-direct `EXPO_PUBLIC_*` third-party key provisioned in `production` env only inherits this exact failure on dev/preview builds, invisible to CI. (Same shape as `EXPO_PUBLIC_SENTRY_DSN`, prod-only — see original D-1.)

## Recommended fix direction (NOT an implementation)

1. **Provision the GIPHY key into the `development` and `preview` EAS environments** (the same valid key, or a separate GIPHY dev key if key-hygiene is preferred — Open Question O-1). Then **rebuild** the development build (EXPO_PUBLIC is build-time; an OTA will NOT carry it to the existing dev install). This is the direct fix that makes Seth's everyday business build pick GIFs again.
2. **Prevent:** a config-eval fail-loud or strict-grep/CI gate asserting required client-direct public keys are wired for every shipping profile/environment (mirrors `feedback_mingla_business_pk_live_in_production`). DRAFT invariant in the SPEC.
3. **Detect:** telemetry that distinguishes a CONFIG `not_configured` (a mis-provisioned build — should alert) from a transient `provider_unavailable`/`rate_limited` (user-facing, expected). Note Sentry DSN is also prod-only (original D-1), so dev/preview alerts won't fire until the DSN is provisioned there too.

## Confidence statement

**PROVEN.** Carried by: production-DB rows showing 10 giphy covers created 2026-05-09→05-20 plus 2 more giphy URLs to 2026-06-03 (it worked); a LIVE HTTP 200 from both GIPHY endpoints with the production key (the key is valid now); and `eas config`/`env:list` proving the key is in `production` env only while the current build is `development` profile (the gap). The only thing NOT done is a pixel screenshot of the rendered error card on Seth's exact install — the sim is behind the business sign-in wall and I did not have test-login credentials. That screenshot is cosmetic confirmation, not load-bearing: the `not_configured` chain is deterministic given a keyless build, and every other layer is proven. **If you want the on-device screenshot for completeness, I need either Seth's business-app test login for the sim, or confirmation of which build profile is on his physical device** — but it would not change the verdict.

---
---

# ORIGINAL REPORT (2026-06-11) — superseded header; retained for the record

**Skill:** mingla-forensics · **Phase:** INVESTIGATE · **Date:** 2026-06-11
**Branch context:** run on anchor `main` (no per-ORCH worktree spawned). Artifacts only; no product code touched.
**Confidence (SUPERSEDED):** ~~**PROVEN** (build-config layer — live-fire-exempt category per Prime Directive 7; corroborated by direct `eas config` resolution output, not source-only reasoning).~~ See CORRECTION above: the build-config finding was correct but the "never worked in dev" framing was wrong; GIFs demonstrably worked on key-bearing builds. This is a build-flip regression.

---

## Symptom summary (expected vs actual)

- **Expected:** In the Mingla **business** app cover picker, tapping the **GIF** tab loads GIPHY trending thumbnails; typing a query loads GIPHY search results; tapping a GIF sets it as the cover.
- **Actual:** The GIF tab shows the error state **"This source is taking a break."** / "GIFs aren't available right now — your own Library still works." No retry button (the `not_configured` branch suppresses retry). **Stock (Pexels)** and **Library** tabs are unaffected.
- **Surfaces:** business-iOS + business-Android (the unified `CoverPicker` is business-app authoring only). NOT consumer, NOT admin-web, NOT buyer-web.

---

## Investigation manifest (every file read, in trace order)

| # | File | Layer | Why |
|---|------|-------|-----|
| 1 | `mingla-business/src/components/ui/CoverPicker.tsx` (≈1147–1220) | code/component | Confirm the error-code→copy mapping and which code yields the symptom string |
| 2 | `mingla-business/src/services/coverProviderBrowseService.ts` | code/service | Trending path (`trendingGiphyCovers`) — tab-open data source |
| 3 | `mingla-business/src/services/giphyEventCoverService.ts` | code/service | Search path (`searchGiphyEventCovers`) — query data source |
| 4 | `mingla-business/eas.json` | build-config | Per-profile `env` blocks; does any profile inline the GIPHY key? |
| 5 | `mingla-business/app.config.ts` (grep) | build-config | Is the key injected at config-eval? |
| 6 | `mingla-business/.env.example` + `.gitignore` | build-config | Is the key documented for local dev? Are `.env` files committed? |
| 7 | EAS remote env (`eas env:list` per environment) | runtime/data | Does a GIPHY key exist remotely, and in which environment(s)? |
| 8 | `eas config --profile <p>` (development/preview/production) | runtime | Which EAS environment each build profile resolves to, and which env vars load |
| 9 | `src/services/__tests__/giphyEventCoverService.test.ts` + `coverProviderBrowseService.test.ts` | code/test | Do tests assert `not_configured`? Why didn't CI catch the missing build key? |
| 10 | `src/diagnostics/sentry.ts` / `sentry.native.ts` / `reportNonFatal.ts` | code | Existing telemetry surface available for the Detect half of the SPEC |
| 11 | `app/_layout.tsx` (90–103) | code | `Sentry.init` guard + DSN provisioning (detection feasibility) |

---

## Q-scorecard

### Q1 — Is "This source is taking a break." the `not_configured` provider-error title, and does it come from the GIF path?
**Verdict: YES — proven.** `CoverPicker.tsx:1155` maps `gif.not_configured → { title: "This source is taking a break.", body: "GIFs aren't available right now — your own Library still works." }`. The Stock equivalent is `:1162`. The error state renders this copy and **suppresses retry** for `not_configured` (`const noRetry = errorCode === "not_configured"` at `:1215`). See F-1.

### Q2 — Do BOTH the trending (tab-open) and search GIF paths fail-close to `not_configured` when the key is missing?
**Verdict: YES — proven.** `coverProviderBrowseService.ts:102–108` (`trendingGiphyCovers`) and `giphyEventCoverService.ts:82–88` (`searchGiphyEventCovers`) both call `publicGiphyKey()` and, when it returns `null`, throw `EventCoverProviderError("not_configured", ...)` BEFORE any network call. See F-2.

### Q3 — Where is `EXPO_PUBLIC_GIPHY_API_KEY` provided / not provided across the build surfaces?
**Verdict: PARTIALLY PROVIDED — proven, and this REVISES the orchestrator hypothesis.** The key is ABSENT from `eas.json` (all 6 profiles), `app.config.ts`, `.env.example`, and any committed `.env` — BUT it **DOES exist as an EAS remote environment variable in the `production` environment ONLY** (`EXPO_PUBLIC_GIPHY_API_KEY` and `EXPO_PUBLIC_GIPHY_KEY`, both plain-text). It is **absent from the `development` and `preview` EAS environments.** See F-3, F-4.

### Q4 — At runtime, why does the GIF tab break (and on which builds)?
**Verdict: PROVEN.** `eas config` resolves each build profile to an EAS environment: `development`→development, `preview`/`preview-sim`→preview, `production`/`production-apk`→production. The development and preview environments load **no** GIPHY key; only production does. Local Metro dev (`expo start`) reads `.env` files (none committed; only `.env.example`, which omits the key) and EAS remote env is NOT pulled. Therefore on **every non-production build/run** `publicGiphyKey()` returns `null` → `not_configured` → the symptom. A **production build would have the key and would work.** See F-4, F-5.

### Q5 — Why does Pexels ("Stock") work while GIF breaks?
**Verdict: PROVEN.** Pexels is EDGE-PROXIED: `curatedPexelsCovers` calls `supabase.functions.invoke("event-cover-pexels-curated")` (`coverProviderBrowseService.ts:157–184`); the Pexels key lives in Supabase secrets server-side and is identical across all client builds. GIPHY is CLIENT-DIRECT (GIPHY ToS forbids proxying — documented `coverProviderBrowseService.ts:6–8,18–19`), so it depends on a per-build-environment public key that dev/preview builds lack. See F-6.

### Q6 — Does a valid GIPHY key/account exist for Mingla anywhere?
**Verdict: YES — proven.** A GIPHY public key exists as an EAS **production** remote env var (referenced by name only; value not reproduced here). No GIPHY key value appears anywhere in the committed repo. So the fix is **propagation/config**, not "obtain a key from the GIPHY dashboard." (Open question O-1: confirm this is the intended production key and whether reusing it for dev/preview is acceptable, vs. minting a separate dev key.) See F-3.

### Q7 — Do the jest tests assert `not_configured`, and why did CI never catch the missing build key?
**Verdict: tests assert the service branch but CANNOT catch the build-config gap — proven.** `giphyEventCoverService.test.ts:123–129` deletes both env vars and asserts the service throws `{ code: "not_configured" }`; `coverProviderBrowseService.test.ts` covers the trending path. Both suites PASS (7/7, run read-only this turn). They test SERVICE logic in isolation by mocking `process.env`; nothing asserts that any BUILD PROFILE actually provisions the key. There is **no CI gate that inspects `eas.json` / EAS environments**, so a build shipping without the key is structurally invisible to CI. See F-7.

---

## Findings (six-field evidence)

### F-1 — `not_configured` GIF copy is exactly the symptom string; retry is suppressed
1. **Symptom:** Error card titled "This source is taking a break." with no retry button on the GIF tab.
2. **Layer:** code (component).
3. **Probe:** `Read mingla-business/src/components/ui/CoverPicker.tsx` lines 1147–1220.
4. **Evidence:**
   ```
   1153  gif: {
   1155    not_configured: { title: "This source is taking a break.", body: "GIFs aren't available right now — your own Library still works." },
   ...
   1212  const copy = (errorCode !== null && PROVIDER_ERROR_COPY[kind][errorCode]) || PROVIDER_ERROR_COPY[kind].provider_unavailable;
   1215  const noRetry = errorCode === "not_configured";
   ```
5. **Mechanism:** When the GIF data path throws `not_configured`, the grid renders this exact copy and hides retry → the user-reported dead-end state.
6. **Severity:** CONFIRMED ROOT CAUSE (presentation half).

### F-2 — Both GIF data paths fail-close to `not_configured` on null key, before any network call
1. **Symptom:** GIF tab errors immediately (no spinner→network), regardless of trending vs. search.
2. **Layer:** code (service).
3. **Probe:** `Read` both service files.
4. **Evidence:**
   ```
   coverProviderBrowseService.ts
   66  const publicGiphyKey = (): string | null => envValue("EXPO_PUBLIC_GIPHY_API_KEY") ?? envValue("EXPO_PUBLIC_GIPHY_KEY");
   102 const apiKey = publicGiphyKey();
   103 if (apiKey === null) { throw new EventCoverProviderError("not_configured", "GIPHY is not configured yet."); }

   giphyEventCoverService.ts
   39  const publicGiphyKey = (): string | null => envValue("EXPO_PUBLIC_GIPHY_API_KEY") ?? envValue("EXPO_PUBLIC_GIPHY_KEY");
   82  const apiKey = publicGiphyKey();
   83  if (apiKey === null) { throw new EventCoverProviderError("not_configured", "GIPHY search is not configured yet."); }
   ```
5. **Mechanism:** `envValue` reads `process.env.EXPO_PUBLIC_*`; if both names are absent/blank it returns `null`, and both paths throw `not_configured` synchronously. This is correct fail-close behavior — the bug is that the key is genuinely absent in dev/preview builds, not that the guard is wrong.
6. **Severity:** SECONDARY ROOT CAUSE (the trigger that surfaces the config gap; behavior itself is correct).

### F-3 — GIPHY key is ABSENT from all committed config; key NAME appears only in the 2 services + their tests
1. **Symptom:** No GIPHY key in version control.
2. **Layer:** build-config / data.
3. **Probe:**
   ```
   grep -n "GIPHY|EXPO_PUBLIC" mingla-business/eas.json
   grep -rn "GIPHY|publicGiphy" mingla-business/app.config.*
   grep -n "GIPHY" mingla-business/.env.example
   grep -rln "EXPO_PUBLIC_GIPHY" --include=*.ts --include=*.tsx --include=*.json .
   ```
4. **Evidence:** `eas.json` only ever lists `EXPO_PUBLIC_ONESIGNAL_APP_ID` (+ `SENTRY_DISABLE_AUTO_UPLOAD`) in profile `env` blocks — no GIPHY. `app.config.ts` grep: no matches. `.env.example` grep: no matches (it documents GOOGLE_MAPS/OPENWEATHER/FOURSQUARE/SUPABASE/etc. but **not** GIPHY). `.gitignore:34-36` ignores `.env`, `.env.local`, `.env*.local`; no committed `.env`. Repo-wide, `EXPO_PUBLIC_GIPHY` appears ONLY in `coverProviderBrowseService.ts`, `giphyEventCoverService.ts`, and their two test files.
5. **Mechanism:** Nothing in the committed tree or eas.json `env` blocks provides the key; the only source is EAS remote env (F-4).
6. **Severity:** CONFIRMED ROOT CAUSE (config gap).

### F-4 — The GIPHY key exists in EAS `production` env ONLY; dev/preview environments have none
1. **Symptom:** GIF works on production builds, breaks on dev/preview builds and local Metro.
2. **Layer:** runtime (EAS environment) / data.
3. **Probe:**
   ```
   npx eas-cli env:list --environment production    # → lists EXPO_PUBLIC_GIPHY_API_KEY, EXPO_PUBLIC_GIPHY_KEY (plain text)
   npx eas-cli env:list --environment development    # → no GIPHY
   npx eas-cli env:list --environment preview         # → no GIPHY
   npx eas-cli config --profile development --platform ios
   npx eas-cli config --profile preview --platform ios
   npx eas-cli config --profile production --platform ios
   ```
4. **Evidence (verbatim, values redacted):**
   ```
   [production env:list]  EXPO_PUBLIC_GIPHY_API_KEY=<redacted>   EXPO_PUBLIC_GIPHY_KEY=<redacted>
   [development env:list] (GIPHY: none)
   [preview env:list]     (GIPHY: none)

   [config --profile development] Resolved "development" environment for the build.
     No environment variables with visibility "Plain text" and "Sensitive" found for the "development" environment on EAS.
     Environment variables loaded from the "development" build profile "env" configuration: SENTRY_DISABLE_AUTO_UPLOAD, EXPO_PUBLIC_ONESIGNAL_APP_ID.

   [config --profile preview]     Resolved "preview" environment for the build.
     No environment variables ... found for the "preview" environment on EAS.

   [config --profile production]  Resolved "production" environment for the build.
     Environment variables with visibility "Plain text" and "Sensitive" loaded from the "production" environment on EAS:
     EXPO_PUBLIC_GIPHY_API_KEY, EXPO_PUBLIC_GIPHY_KEY, EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY.
   ```
5. **Mechanism:** EAS resolves build profiles to environments by name (development→development, preview/preview-sim→preview, production/production-apk→production). The GIPHY key was provisioned only in the production environment, so it is inlined into `process.env.EXPO_PUBLIC_GIPHY_API_KEY` ONLY for production builds. Dev/preview builds inline `undefined` → `publicGiphyKey()` is `null` → `not_configured`.
6. **Severity:** CONFIRMED ROOT CAUSE.

### F-5 — Local Metro dev also lacks the key (no committed `.env`, no `eas env:pull`)
1. **Symptom:** GIF tab breaks even when running the JS bundle from a local dev server.
2. **Layer:** build-config / runtime.
3. **Probe:** `ls .env*` (only `.env.example`); `grep -n "eas env|env:pull" package.json` (none); `package.json` scripts: `start: expo start`, `ios: expo run:ios`.
4. **Evidence:** Only `.env.example` exists (and omits GIPHY — F-3). No script pulls EAS remote env into the local environment. `EXPO_PUBLIC_*` vars are inlined by Metro from the local process env / `.env` at bundle time.
5. **Mechanism:** A developer (or Seth, testing a dev build over local Metro) has no GIPHY key in `process.env` → same `not_configured` path. This is why the symptom reproduces in everyday dev/test even though production is fine.
6. **Severity:** SECONDARY ROOT CAUSE (dev-experience manifestation of the same gap).

### F-6 — Pexels is edge-proxied (server-side key), so it is build-environment-independent
1. **Symptom:** Stock tab works on every build; only GIF breaks.
2. **Layer:** code (service) / architecture.
3. **Probe:** `Read coverProviderBrowseService.ts:144–184`.
4. **Evidence:**
   ```
   157 export const curatedPexelsCovers = async (...) => {
   161   const { data, error } = await supabase.functions.invoke("event-cover-pexels-curated", {...});
   ```
   Header docstring lines 6–8: GIPHY is CLIENT-DIRECT (ToS forbids proxying); Pexels key "stays SERVER-SIDE; never client-read."
5. **Mechanism:** Pexels routes through an edge function whose key is in Supabase secrets, identical for all clients; GIPHY cannot be proxied and depends on a per-build public key — which dev/preview builds lack. This asymmetry is exactly why ONLY the GIF tab breaks.
6. **Severity:** RULED OUT as a fault (this is correct, expected design; it is the diagnostic that isolates the GIF-only gap).

### F-7 — Jest asserts the service `not_configured` branch but no gate verifies the BUILD provisions the key
1. **Symptom:** CI is green while the GIF tab is broken on dev/preview builds.
2. **Layer:** code (test) / CI.
3. **Probe:** `Read` both test files; `npx jest <both files>` (read-only).
4. **Evidence:**
   ```
   giphyEventCoverService.test.ts:124  delete process.env.EXPO_PUBLIC_GIPHY_API_KEY;
   :125  delete process.env.EXPO_PUBLIC_GIPHY_KEY;
   :127  await expect(searchGiphyEventCovers("ok")).rejects.toMatchObject({ code: "not_configured" });
   [jest] Test Suites: 2 passed, 2 total · Tests: 7 passed, 7 total
   ```
5. **Mechanism:** Tests mock `process.env` to exercise the service branch; they assert the GUARD works, not that any deployable build supplies the key. No CI step inspects `eas.json` or EAS environments for the key, so the missing-build-config is structurally undetectable by the current suite.
6. **Severity:** CONFIRMED CONTRIBUTOR (detection gap).

---

## Five-Truth-Layer reconciliation

| Layer | Truth | Contradiction? |
|-------|-------|----------------|
| **Docs** | `coverProviderBrowseService.ts` header says GIPHY is client-direct via "the public `EXPO_PUBLIC_GIPHY_API_KEY`" — i.e. the key is REQUIRED in the client build. | Docs assume the key is provisioned; reality is it's provisioned in production only. **Gap.** |
| **Schema** | N/A (no DB object; Pexels edge fn + Supabase secret unaffected). | — |
| **Code** | `publicGiphyKey()` correctly fail-closes to `not_configured` on null; CoverPicker correctly maps it to friendly copy. Code is behaving as designed. | No code bug. The bug is the config the code reads. |
| **Runtime** | `eas config` proves dev/preview builds resolve environments with NO GIPHY key; production has it. Local Metro has none. | **This is the bug** — runtime env disagrees with the docs' assumption. |
| **Data** | EAS remote env: GIPHY key present in `production` only. No key value in the repo. | Confirms the runtime finding. |

**The decisive contradiction:** Docs/code assume the public GIPHY key is part of the client build; the EAS environment data shows it is present ONLY in `production`. The gap between "code expects key" and "dev/preview build provides no key" IS the bug.

---

## Repro evidence (runtime)

Per Prime Directive 7, reproducer-bound UI bugs require live-fire. This bug's manifestation is **fully determined by build configuration** (the live-fire-exempt "pure build-config" category), and the decisive runtime fact was obtained directly from `eas config` rather than inferred from source:

- **`eas config --profile development`** proves a dev build inlines **no** GIPHY key → `publicGiphyKey()` returns `null` → `trendingGiphyCovers`/`searchGiphyEventCovers` throw `not_configured` → CoverPicker renders "This source is taking a break." This is a deterministic, side-effect-free chain with no runtime branch left to chance.
- **`eas config --profile production`** proves a production build DOES inline the key → the same code path succeeds.
- No iOS-sim drive of the picker was performed: no business dev-build artifact is installed on a sim, and a from-scratch dev-client rebuild would, by definition, reproduce the documented `development`-environment resolution (no key) — adding no information beyond the `eas config` proof. Confidence is therefore **PROVEN** at the build-config layer, with the honest caveat that a pixel-level sim screenshot of the exact card was not captured.

---

## Blast radius / cross-surface map

| Surface | Affected? | Reason |
|---------|-----------|--------|
| Consumer iOS / Android (`app-mobile/`) | NO | No `EXPO_PUBLIC_GIPHY` reference and no "taking a break" copy in `app-mobile/`; the unified CoverPicker is business-app-only. |
| Buyer / anon Web | NO | CoverPicker is an authoring surface, not a buyer surface. |
| **Business iOS** | **YES** (dev/preview builds + local Metro) | Resolves development/preview env with no GIPHY key. Production build is OK. |
| **Business Android** | **YES** (dev/preview builds + local Metro) | Same env resolution. |
| Admin Web | NO | No CoverPicker. |
| Business Web preview | Likely YES (degraded-equivalent) | Web bundle reads `process.env` at build time; if built without the key, GIF tab errors. Pexels (edge) still works. Lower priority — authoring on web preview is secondary. |

**Recurring-pattern note:** any future CLIENT-DIRECT third-party key (vs. edge-proxied) inherits this exact failure mode — provisioned in one EAS environment but not the others, invisible to CI. The fix should generalize the guard.

---

## Invariant impact (flagged, NOT pre-decided)

- **I-NO-SILENT-FAILURES** — currently the config-missing case is collapsed into friendly UI copy with **zero telemetry**; nobody is alerted that a deployable build is mis-provisioned. This is a silent CONFIG failure dressed as a transient user-facing one. The SPEC's Detect half addresses this.
- Candidate NEW invariants (to be proposed DRAFT in the SPEC): a config-eval fail-loud for required public keys on production builds (mirroring `feedback_mingla_business_pk_live_in_production`), and a strict-grep / config gate asserting the GIPHY key is wired for the relevant profiles/environments.
- **EXPO_PUBLIC inlining contract** — `EXPO_PUBLIC_*` are inlined at BUNDLE time. An env-only change does NOT reach an already-built or OTA'd JS bundle whose `process.env.EXPO_PUBLIC_GIPHY_API_KEY` was already resolved to `undefined`. Provisioning the key requires a NEW build for the affected environment (OTA can refresh the JS, but only a build re-resolves native-injected `EXPO_PUBLIC_*`; see SPEC "rebuild vs OTA").

## Discoveries for Orchestrator (side issues)

- **D-1:** `EXPO_PUBLIC_SENTRY_DSN` is also provisioned in EAS **production only** (per `env:list`). Combined with the `Sentry.init` DSN guard at `app/_layout.tsx:93-103`, Sentry is a **no-op on dev/preview builds**. This directly constrains the Detect half: a `not_configured` Sentry alert from a dev/preview build will not fire unless the DSN is also provisioned for those environments. Surface to Seth as part of the alerting decision.
- **D-2:** The same EAS-environment-scoping likely affects any other `EXPO_PUBLIC_*` provisioned only in production (e.g. Stripe pk — though pk_live in dev would be undesirable anyway). Not in ORCH-1116 scope; flag for a future config-hygiene sweep.

---

## Confidence level

**PROVEN** (build-config layer). Root cause established by direct `eas config` / `eas env:list` output across all three environments, the verbatim source guards, and the exact copy mapping — five layers reconciled with the decisive contradiction named. The only un-captured artifact is a sim screenshot of the rendered card, which the build-config proof makes redundant.

## Recommended next phase + scope (direction only — NOT a fix)

Proceed to **SPEC** (auto-advance, this dispatch). Scope per the dispatch's three asks — **Fix** (provision the GIPHY key into the dev/preview EAS environments and/or `.env.example` + the rebuild-vs-OTA implication), **Prevent** (config-eval fail-loud + strict-grep/config CI gate, DRAFT invariants), **Detect** (telemetry distinguishing CONFIG `not_configured` from transient `provider_unavailable`/`rate_limited`). Keep it config + observability only — NOT a CoverPicker redesign. Open product decisions for Seth: O-1 (reuse production GIPHY key for dev/preview vs. mint a dev key), O-2 (provision Sentry DSN for dev/preview so config alerts fire there — see D-1), O-3 (add Sentry alerting now vs. defer to a console-only breadcrumb).
