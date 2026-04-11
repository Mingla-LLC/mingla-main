# Documentation Truth Sweep — Granular Plan

> ORCH-0390 | Priority: P0 (blocks all downstream work)
> Goal: Every document, comment, and artifact reflects the actual code as of 2026-04-11
> Prerequisite for: Product skill analytics strategy (Approach 3)

---

## Why This Must Happen First

The product skill will read artifacts, README, and code to make analytics strategy decisions. If those documents lie (and several do), the product skill will make wrong recommendations. We need ground truth before strategy.

---

## Scope of Damage (What's Wrong)

### Tier 1 — Actively Wrong (lying to readers)

| Item | What's Wrong | Impact |
|------|-------------|--------|
| README.md (root) | Claims "Mixpanel (analytics)" as part of stack — implies it works. It's dead. | Anyone reading thinks analytics work |
| README.md (root) | Says "71 edge functions" — count may be wrong | Inaccurate architecture overview |
| README.md (root) | No analytics architecture section | No guidance on how analytics services relate |
| README.md (root) | No .env setup instructions for Mixpanel | New developers can't enable analytics |
| app-mobile/README.md | Says "27 edge functions" — count may be wrong | Same |
| app-mobile/.env.example | Missing EXPO_PUBLIC_MIXPANEL_TOKEN | Developers don't know it's needed |
| MEMORY.md | References "AppsFlyer Event Map" in outputs/ — doesn't exist | Memory points to phantom document |

### Tier 2 — Stale (was true, now outdated)

| Item | How Stale | What Changed |
|------|-----------|-------------|
| PRIORITY_BOARD.md | 3 days | New ORCH-0387/0388/0389 not ranked. Recent closures not reflected. |
| INVARIANT_REGISTRY.md | 12 days | i18n work (ORCH-0386), legal links (ORCH-0350/0351), OTP channels (ORCH-0370), friend profile (ORCH-0373), map pins (ORCH-0374) all shipped since last update |
| ROOT_CAUSE_REGISTER.md | 12 days | Block/friend mutual exclusion root cause (ORCH-0367) not registered |
| DECISION_LOG.md | 5 days | i18n architecture decision, OTP multi-channel decision, analytics investigation decisions not logged |
| SPEC_QUEUE.md | 12 days, skeletal | Shows 0 items but specs were written (ORCH-0370, 0371, 0373, 0374, 0386) |
| IMPLEMENTATION_QUEUE.md | 12 days, skeletal | Shows 0 items but implementations happened |
| TEST_QUEUE.md | 12 days, skeletal | Shows 0 items but QA reports exist |
| RETEST_LEDGER.md | 12 days, skeletal | Shows 0 items |
| Currency fallback rates | 17 days | Last updated 2026-03-25 in currencyService.ts |

### Tier 3 — Missing (should exist, doesn't)

| Item | Why It Matters |
|------|---------------|
| Analytics Architecture Document | No single doc explains how Mixpanel/RC/AppsFlyer/OneSignal relate, what each owns, how identity works |
| AppsFlyer Event Map | 22 events in code, no canonical map document |
| Notification Type Registry | 15+ notification types across 11 edge functions, no single reference |
| Edge Function Inventory | No doc lists all edge functions with their purpose, trigger, and auth requirements |

### Tier 4 — Code Comments (minor but cleanup-worthy)

| Item | File | Issue |
|------|------|-------|
| NavigationContext.tsx:56,60,64 | 3 "will be implemented" stubs | Still stubs — either implement or document as intentional |
| MessageInterface.tsx:22 | Commented expo-av import | Stale if expo-av is now available |
| OnboardingFlow.tsx:23 | Commented WhatsAppLogo import | May be stale after ORCH-0370 (OTP channels) shipped |
| ShareModal.tsx:37 | Commented useState hook | Dead code |
| BoardDiscussion.tsx:22 | "dropdown-menu UI not yet created" | Still true? Or has it been built? |

---

## Execution Plan — 6 Dispatches

### Dispatch 1: Forensic Code Audit — Edge Function & Service Inventory
**Agent**: Investigator (forensics skill)
**Scope**: Read every edge function in supabase/functions/, every service in app-mobile/src/services/, and produce:
1. Complete edge function inventory (name, purpose, trigger type, auth, env vars needed)
2. Complete service file inventory (name, purpose, external dependencies)
3. Accurate count of edge functions (README claims 71 / 27)
4. Environment variable registry (.env vars actually used vs. documented)
5. Dead code identification (functions defined but never called, imports never used)

**Output**: `INVESTIGATION_CODE_INVENTORY.md`
**Why first**: This produces the ground truth that all other document updates depend on.

### Dispatch 2: Forensic Code Audit — Analytics & Notification System Map
**Agent**: Investigator (forensics skill)
**Scope**: Using findings from Dispatch 1 + the analytics identity audit already done, produce:
1. AppsFlyer Event Map — every event, where it fires, what properties it sends
2. Mixpanel Event Map — every tracking method, where it's called, what it tracks
3. OneSignal Notification Type Registry — every notification type, trigger, payload, preference category
4. Identity Lifecycle Map — exactly when each service identifies/clears users, with code line references
5. Cross-service integration map — what talks to what

**Output**: `ANALYTICS_AND_NOTIFICATION_ARCHITECTURE.md`
**Why**: This is the missing architecture document. Product skill needs this.

### Dispatch 3: Document Sync — Core Artifacts
**Agent**: Orchestrator (self — prompt-only, no code)
**Scope**: Using outputs from Dispatches 1-2, update:
1. **README.md (root)** — fix Mixpanel claim, update edge function count, add analytics architecture section, add .env setup instructions
2. **app-mobile/README.md** — fix edge function count, add analytics setup section
3. **app-mobile/.env.example** — add EXPO_PUBLIC_MIXPANEL_TOKEN with instructions
4. **PRIORITY_BOARD.md** — re-rank with ORCH-0387/0388/0389, remove closed items
5. **INVARIANT_REGISTRY.md** — add invariants from recent work, verify existing ones
6. **ROOT_CAUSE_REGISTER.md** — add ORCH-0367 root cause, any new patterns
7. **DECISION_LOG.md** — log i18n, OTP multi-channel, analytics audit decisions

**Output**: Updated documents in place
**Why**: Core artifacts must be accurate before product skill reads them.

### Dispatch 4: Document Sync — Queue Documents
**Agent**: Orchestrator (self)
**Scope**: Decide fate of skeletal queue documents:
- Option A: Populate them retroactively from AGENT_HANDOFFS history
- Option B: Mark them as deprecated (AGENT_HANDOFFS is the canonical pipeline tracker)
- Option C: Delete them

Recommendation: **Option B** — add a header noting they're superseded by AGENT_HANDOFFS.md, keep structure for future use if pipeline changes.

**Output**: Updated queue docs with honest status

### Dispatch 5: Code Comment Cleanup
**Agent**: Implementor
**Scope**: Surgical cleanup of identified stale comments:
1. Remove commented-out WhatsAppLogo import if ORCH-0370 made it unnecessary
2. Remove commented-out ShareModal useState if dead
3. Update or remove NavigationContext "will be implemented" comments (replace with "Placeholder — stack navigation not yet built")
4. Verify BoardDiscussion dropdown-menu stub status
5. Check expo-av comment relevance
6. Update currency fallback rates date if rates are still accurate

**Output**: Clean commits with specific changes
**Why**: Small scope, surgical, no behavior changes.

### Dispatch 6: WORLD_MAP & PRODUCT_SNAPSHOT Final Sync
**Agent**: Orchestrator (self)
**Scope**: After all previous dispatches complete:
1. Update WORLD_MAP surface grades for Analytics & Tracking (using Dispatch 2 findings)
2. Update COVERAGE_MAP with new coverage from analytics audit
3. Update PRODUCT_SNAPSHOT with accurate analytics state
4. Update MASTER_BUG_LIST with ORCH-0387/0388/0389
5. Verify MEMORY.md references (remove phantom AppsFlyer Event Map reference, update with new doc locations)

**Output**: All artifacts synchronized to code reality
**Why**: Final pass ensures everything agrees.

---

## After The Sweep

Once all 6 dispatches are complete, the product skill can run with confidence because:
- Every artifact reflects actual code state
- Analytics architecture is documented
- Event maps exist and are verified
- Identity lifecycle is mapped
- READMEs tell the truth
- Code comments don't mislead

**Then**: Product skill reads everything, answers "what analytics questions matter for launch?", and we scope the analytics implementation work from Approach 3.

---

## Estimated Effort

| Dispatch | Effort | Dependencies |
|----------|--------|-------------|
| 1. Code inventory | Large (forensic read of ~70+ edge functions + ~75 services) | None |
| 2. Analytics/notification map | Medium (focused on 4 services + 11 notification functions) | Dispatch 1 |
| 3. Core artifact sync | Medium (updating ~7 documents) | Dispatches 1-2 |
| 4. Queue doc decision | Small (5 minutes) | None |
| 5. Code comment cleanup | Small (surgical edits) | None |
| 6. Final sync | Medium (cross-referencing everything) | Dispatches 1-5 |

**Dispatches 1, 4, and 5 can run in parallel.**
**Dispatch 2 depends on 1.**
**Dispatch 3 depends on 1 and 2.**
**Dispatch 6 depends on all.**
