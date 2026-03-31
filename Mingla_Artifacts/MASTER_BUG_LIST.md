# Master Bug List

> Last updated: 2026-03-30
> Total: 265 | Open: 143 | Closed: 68 | Verified (B grade): 15 | Deferred: 1

## Summary by Status

| Status | Count | % |
|--------|-------|---|
| Open (F grade, unaudited) | 133 | 50% |
| Open (F grade, known bug) | 10 | 4% |
| Closed (A grade) | 68 | 26% |
| Verified (B grade) | 15 | 6% |
| Verified (C grade) | 1 | <1% |
| Deferred | 1 | <1% |

## Summary by Severity

| Severity | Open | Closed/Verified | Total |
|----------|------|-----------------|-------|
| S0 (Critical) | 8 | 5 | 13 |
| S1 (High) | 53 | 36 | 89 |
| S2 (Medium) | 66 | 31 | 97 |
| S3 (Low) | 16 | 12 | 28 |

## Active Issues (Open — Grade F)

### S0-Critical (Launch Blockers)

| ID | Title | Surface | Classification | Source |
|----|-------|---------|---------------|--------|
| ORCH-0001 | Phone OTP sign-in | Auth | unaudited | Tracker |
| ORCH-0004 | Sign-out cleanup | Auth | unaudited | Tracker |
| ORCH-0005 | Google Sign-In flow | Auth | unaudited | Tracker |
| ORCH-0006 | Apple Sign-In flow | Auth | unaudited | Tracker |
| ORCH-0102 | Account deletion | Profile | unaudited | Tracker |
| ORCH-0135 | Paywall screen | Payments | unaudited | Tracker |
| ORCH-0137 | RevenueCat integration | Payments | unaudited | Tracker |
| ORCH-0223 | RLS policy coverage | Security | unaudited | Tracker |
| ORCH-0224 | Admin auth (3-layer) | Security | unaudited | Tracker |
| ORCH-0225 | PII handling | Security | unaudited | Tracker |

### S1-High (Degrades Critical Flow)

| ID | Title | Surface | Classification | Source |
|----|-------|---------|---------------|--------|
| ORCH-0008 | State machine progression | Onboarding | unaudited | Tracker |
| ORCH-0009 | GPS requirement enforcement | Onboarding | unaudited | Tracker |
| ORCH-0011 | Resume after interruption | Onboarding | unaudited | Tracker |
| ORCH-0014 | Intent selection step | Onboarding | unaudited | Tracker |
| ORCH-0017 | Consent step | Onboarding | unaudited | Tracker |
| ORCH-0038 | Coordinates replacing text | Discovery | bug | Investigation |
| ORCH-0039 | Currency changes with GPS | Discovery | bug | Investigation |
| ORCH-0041 | Curated no Schedule button | Discovery | bug | Investigation |
| ORCH-0048 | Curated/category round-robin broken | Discovery | bug | User report |
| ORCH-0065 | Solo mode | Discovery | unaudited | Tracker |
| ORCH-0070 | Session creation | Collaboration | unaudited | Tracker |
| ORCH-0071 | Invite send/receive | Collaboration | unaudited | Tracker |
| ORCH-0072 | Real-time sync | Collaboration | unaudited | Tracker |
| ORCH-0073 | Voting mechanics | Collaboration | unaudited | Tracker |
| ORCH-0075 | Concurrent mutation safety | Collaboration | unaudited | Tracker |
| ORCH-0079 | Friend-based content visibility | Social | unaudited | Tracker |
| ORCH-0087 | In-app notifications | Notifications | unaudited | Tracker |
| ORCH-0094 | Save/unsave experience | Saved | unaudited | Tracker |
| ORCH-0095 | Board create/edit/delete | Saved | unaudited | Tracker |
| ORCH-0105 | Subscription management | Profile | unaudited | Tracker |
| ORCH-0111 | Map rendering (dual provider) | Map | unaudited | Tracker |
| ORCH-0112 | User location tracking | Map | unaudited | Tracker |
| ORCH-0114 | Nearby people display | Map | unaudited | Tracker |
| ORCH-0126 | Discover map integration | Map | unaudited | Tracker |
| ORCH-0127 | Send/receive messages | Chat | unaudited | Tracker |
| ORCH-0129 | Conversation list | Chat | unaudited | Tracker |
| ORCH-0132 | Messaging realtime | Chat | unaudited | Tracker |
| ORCH-0136 | Custom paywall screen | Payments | unaudited | Tracker |
| ORCH-0138 | Subscription service | Payments | unaudited | Tracker |
| ORCH-0140 | Feature gate enforcement | Payments | unaudited | Tracker |
| ORCH-0141 | Swipe limit (free users) | Payments | unaudited | Tracker |
| ORCH-0143 | Calendar tab display | Calendar | unaudited | Tracker |
| ORCH-0145 | Calendar service | Calendar | unaudited | Tracker |
| ORCH-0158 | Discover screen (people) | People | unaudited | Tracker |
| ORCH-0168 | Send pair request | Pairing | unaudited | Tracker |
| ORCH-0201 | Network failure at every layer | Network | unaudited | Tracker |
| ORCH-0218 | Error boundary coverage | Error | unaudited | Tracker |
| ORCH-0221 | Silent failure paths | Error | unaudited | Tracker |
| ORCH-0222 | Service error contract | Error | design-debt | Tracker |
| ORCH-0227 | Deep link service routing | DeepLink | unaudited | Tracker |
| ORCH-0233 | Error boundary (app-wide) | Lifecycle | unaudited | Tracker |
| ORCH-0236 | App state manager | Lifecycle | unaudited | Tracker |
| ORCH-0238 | Notification system provider | Lifecycle | unaudited | Tracker |
| ORCH-0242 | AppsFlyer integration | Analytics | unaudited | Tracker |

(Full list of S2 and S3 items omitted for readability — see WORLD_MAP.md Issue Registry for complete data)

## Closed Issues (Grade A)

68 items closed with evidence. Key closures:

| Area | Count | Key Commits |
|------|-------|-------------|
| Discovery / Card Pipeline | 30 | 94143183, 77b92984, 6c7b2429, 7ca26b48, 28be9a63, 7fef7ed0, dba7b3f0 |
| Notifications | 6 | 376cd237, d4c6725e, ea655d36 |
| Collaboration UI | 3 | 15fe8742, 76cd2ca7, 3ee1bce9 |
| Profile & Settings | 4 | a268b19f, 302b74d5, cdd3cac0 |
| State & Cache | 2 | 846e7cce, 27e475ac |
| Chat Responsiveness | 4 | bef4ca3b, 2549dbe6 |
| Hardening Infrastructure | 3 | 06614e98 |
| UI Components | 3 | 0254bc4f, 2a96c8f6, 88f2d43f |
| Social / Friends | 1 | 76cd2ca7 |
| Pairing | 3 | 376cd237, 23f3a0dd |
| Card Rendering & Swipe | 2 | 5702067b, acf7e508 |
| Deck Pipeline | 7 | 79d0905b, 28be9a63 |

## Verified Issues (Grade B — Not Yet Fully Closed)

| ID | Title | Gap to A |
|----|-------|----------|
| ORCH-0002 | Session persistence | Full offline flow unaudited |
| ORCH-0007 | Zombie auth prevention | Heuristic-based (transitional) |
| ORCH-0035 | Triple duplicate API calls | One hidden flaw remains |
| ORCH-0042 | Paired view repeated experiences | Race on simultaneous fetches |
| ORCH-0050 | AI Card Quality Gate | Not yet run on production data |
| ORCH-0051 | Flowers category too broad | AI sole gate, not production-validated |
| ORCH-0063 | Empty pool state | Only discover-cards tested on device |
| ORCH-0076 | Friend request send/accept | Send flow unaudited |
| ORCH-0083 | Push delivery (OneSignal) | Sound uses OS defaults |
| ORCH-0088 | Deep link from notification | Invalid sessionId lingers |
| ORCH-0092 | Notification send observability | No retry queue |
| ORCH-0103 | Subscription tier freshness | "Take highest of 3" transitional model |
| ORCH-0156 | Holiday reminder notifications | custom_holidays.year NOT NULL, no recurring |
| ORCH-0204 | Offline queue observability | No user notification on discard |
| ORCH-0240 | Foreground refresh | Was dead code, now mounted |

## Deferred Issues

| ID | Title | Reason | Exit Condition | Date |
|----|-------|--------|----------------|------|
| ORCH-0222 | Service error contract | ~60+ call sites, high blast radius | Next hardening cycle | 2026-03-23 |

## Deck Hardening History (Passes 1-10)

44 bugs completed across 10 passes. All have commit evidence and test reports.
See Launch Readiness Tracker "Deck Hardening" section for full details.
