# BATTLE-TESTED BLUEPRINT — Mingla Full Rooms Ad Engine

**Date:** 2026-07-15 · **Status:** validation complete, specs corrected, build plan active.
**This is the covering document.** The full contract = `PIPELINE_BLUEPRINT.md` (the end-to-end operator journey + validation matrices) **as corrected by** the eight evidence-backed spec amendments filed 2026-07-15 **and grounded in** `PROOF_LOG.md` (live probes with the engine's own credentials). Precedence on conflict: **PROOF_LOG > amendments > blueprint > gap register > original spec bodies.**

## 1. What is now PROVEN (nothing below is assumed)

| Claim | Evidence |
|---|---|
| Meta can create campaigns + creatives with our Page, on our billed ACTIVE account, via our system-user token | PROOF M-P1…M-P6 [VALIDATE-ONLY], incl. the newly-required `is_adset_budget_sharing_enabled` (M-13) and the app-Live precondition (B6, resolved) |
| Google can create the full SEARCH+RSA chain (budget→campaign→geo London 1006886→ad group→RSA→keyword) on the real billed account `3623860476` at BASIC tier, v24 | PROOF G-P1…G-P3 [VALIDATE-ONLY], incl. the newly-required `contains_eu_political_advertising` (G-14) |
| Reddit is fully provisioned: business, `a2_jcfwvnfcfqcs` (VALID), profile `t2_2ikkjswp3a`, funding servable, community search works | PROOF R-P1…R-P6 [ENGINE-LIVE] |
| Snapchat account/funding($15k/day)/pixel are live; token mints; envelope semantics confirmed | PROOF S-P1…S-P5 [ENGINE-LIVE] |
| TikTok token live (app approved); GB untargetable (both objectives); APP_PROMOTION viable | PROOF T-P1…T-P7 [ENGINE-LIVE] |
| The OneLink serves crawlers an app-install interstitial (cloaking pattern) → canonical-page destination policy is mandatory | PROOF D-P1 [ENGINE-LIVE] |
| Meta per-category floors: $1 imp / $1 video / **$5 clicks** / $40 low-freq (USD, live) | PROOF M-P8 |
| Both pixels (Meta, TikTok) have never fired → LINK_CLICKS / SWIPES are the only honest goals until #865 | PROOF M-P7, T-P4 |

**Remaining UNPROVEN (accepted residual risks, each with a named resolution point):**
1. Snap Public Profile `2cfbdc85-…` — unverifiable by API (403 on our token class); proven at first PAUSED creative create. (S-P4)
2. Reddit create chain — no validate-only exists; proven at first PAUSED create. (R-P5 note)
3. Reddit media constraints — [3P] numbers conflict; warn-only until read in a browser / partner-support email.
4. Snap Top-Snap max duration 180s vs 1800s — validate 3–180, confirm live.
5. TikTok fetcher reachability of Bunny URLs — pre-build check in WP4.

## 2. The corrected spec set (all local worktree commits, none pushed)

| Spec | Amendment | Commit | Highlights |
|---|---|---|---|
| #862 Meta + unified model | **A4** | `dc13202aa` (862 wt) | 13 Meta corrections (M-1…M-13), ChannelAdapter A4 widening, §D registry re-baseline, R-1…R-11, preflight re-based, destination policy v1, floors |
| **Reddit channel (NEW, issue TBD)** | v1 spec, 29 ACs | `dc13202aa` (862 wt) | job-runner create, PAUSED+strict-grep, pixel==account-id, Title-Case CTAs, no-age targeting, no invented floor |
| #863 TikTok | **A1** | `55a1a2130` | UTC+0, CBO bid_type, 100-char/no-emoji, live geo + GB fail-loud, CUSTOMIZED_USER hard-fail, Spark section, PAUSED fix |
| #864 Builder UI | **A4** | `738e842e9` | preflight step-0, per-channel copy caps + truncation preview, policy linter, honest goals/badges, city+radius |
| #865 Attribution | **A2** | `b37ef7c1a` | Reddit CAPI = token-first CONFIRMED (official doc), no 7d_view/28d_view, dedup contracts, Consent Mode v2, audience Phase B gates |
| #866 Creative library | **A1** | `4efa5aca5` | Snap upload rewrite, YouTube upload path (OD-2 closed), byte-probe validator, content-hash cache, ai_generated |
| #867 Snap+Google | **A1** | `495029028` | cents money fix (10,000×), 4 Snap create fixes, G-1…G-14, reference mutate body from G-P3, geo resolver, destination re-checker |

**Conductor rulings on flagged conflicts:** floor-unit seam = as-designed (platform constants in platform units, ours in cents, checks in micro post-conversion). Reddit carousel = trust the schema (1–6). All other flags resolved by sibling amendments (verified: A4.g stores all four Meta floors; pixel gate + billing_servable are in A4.e / preflight).

## 3. Channel readiness (proof-grade, 2026-07-15)

| Channel | Status | Gates left |
|---|---|---|
| **Meta** | GREEN | IG link (human, optional — Facebook-only until then) |
| **Google** | GREEN | — |
| **Reddit** | GREEN-provisioned | first-create proof; `REDDIT_ADS_CAPI_TOKEN` generation (for #865) |
| **Snapchat** | AMBER-GREEN | profile proven at first create |
| **TikTok** | AMBER | balance ≥$20 (human); GB escalation (external); US/NG viable |

## 4. Build plan — work packages and dispatch order

**Lane: consumer. Nothing goes live; everything created PAUSED; no campaign activates without Seth's explicit approval.**

| WP | Scope | Spec | Worktree | Depends on |
|---|---|---|---|---|
| **WP1** | Foundation + Meta channel: migrations (A3/A4 schema, cents `bigint`), `_shared/adChannel.ts` (A4 interface), `_shared/meta.ts` adapter, edge fns `admin-ad-connect` / `admin-ad-preflight` / `admin-ad-create-campaign` / `admin-ad-campaign-action` / `admin-ad-campaign-sync`, minimal admin surface, CI gates (strict-grep + unit tests incl. $5→5M micro) | #862 body+A1–A4 | issue-862 | — |
| **WP2** | Google adapter (`_shared/google.ts`): SEARCH+RSA only, single atomic mutate (G-P3 reference body), geo resolver, destination re-checker | #867 §Google + A1 | issue-867 | WP1 |
| **WP3** | Creative library + validator: byte-probe, per-channel matrices, per-ratio crops, Meta image/video upload, Google image/YouTube upload, Snap multipart | #866 + A1 | issue-866 | WP1 |
| **WP4** | Builder UI (wizard on the corrected spine, preflight screen, copy composer, previews, policy linter) | #864 + A4 | issue-864 | WP1 (+WP3 for creative step) |
| **WP5** | Snapchat adapter (4 create fixes, SWIPES, review polling) | #867 §Snap + A1 | issue-867 | WP1, WP3 |
| **WP6** | Reddit adapter (job runner, communities, PAUSED gates) | SPEC_ISSUE-REDDIT | issue TBD | WP1 |
| **WP7** | TikTok adapter (build now, launch when balance+market clear) | #863 + A1 | issue-863 | WP1 |
| **WP8** | Attribution (#865: pixels on web surfaces, CAPI ×5, dedup) — unlocks conversions/retargeting/lookalikes everywhere | #865 + A2 | issue-865 | parallel to WP2+ |
| **WP9** | The Brain (#884: floors, viability, reallocation) | #884 + A1 | issue-884 | WP1, WP8 (Phase A can run click-CPR after WP2) |

**Gates:** every WP → tester verdict (adversarial, runtime evidence) → REVIEW → merge only on green checks → first live-fire = one $5/day Meta LINK_CLICKS plumbing test, labeled as such, launched only by Seth.

**Human tasks open:** IG↔Page link · TikTok top-up ≥$20 · TikTok GB support ticket · `REDDIT_ADS_CAPI_TOKEN` (Events Manager) · (later) AppsFlyer crawler behavior review if we ever want the OneLink as a visible ad destination.
