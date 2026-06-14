# TEST — ORCH-1137 · Business-web lucide icon systemic fix

**Skill:** mingla-tester (production gatekeeper)
**Date:** 2026-06-14
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1137-[ari-emptystate-plus-glyph]/` on branch `ORCH-1137-ari-emptystate-plus-glyph` (tip `32480594d` at entry)
**SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-1137_BIZ_WEB_LUCIDE_ICON_SYSTEMIC.md` (`c4d34763e`)
**Implementation report:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1137_BIZ_WEB_LUCIDE.md` (`32480594d`)
**Investigation:** `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1137_ARI_EMPTYSTATE_PLUS_GLYPH.md` (`f15acfaef`)

---

## 1. Verdict

### **PASS** — P0: 0 · P1: 0 · P2: 0 · P3: 0 · P4: 1

Every success criterion is independently verified with live-fire/build evidence I produced myself (not the implementor's claims). The fix is a bundler-shim + dependency change; per Phase-0.A exemptions the authoritative live-fire proof is a real `expo export -p web` web bundle (not a simulator), which the SPEC itself demands — I ran it and grepped the resulting artifact. Native is structurally proven untouched. Both regression catchers (implementor happy-path + my adversarial) are on-branch, in-diff, and fail-on-revert.

**Comms ledger:** Read on entry. COMMS-0034 (WARN, `ORCH-1136,ALL`, OPEN) is the ORCH-1137 scope boundary — ORCH-1137 owns the systemic biz-web lucide fix, must never return `undefined`, must not regress ORCH-1085. Factored into this test: I verified the never-undefined invariant directly (SC-3/SC-4) and the ORCH-1085 non-regression (SC-5). No `BLOCK`+`OPEN` entry targets `mingla-tester` or ORCH-1137. COMMS-0030 is RESOLVED (no native build performed here).

---

## 2. SC-by-SC matrix

| SC | Criterion | Verdict | Independent evidence (mine) |
|----|-----------|---------|------------------------------|
| **SC-1-Web** | Ari empty-state "+" chip renders a real lucide Plus glyph | **PASS** | Ran `expo export -p web` myself (exit 0). The Plus SVG path signatures `M5 12h14` (horizontal) AND `M12 5v14` (vertical) are BOTH present in the exported bundle `__common-66fa9b…js`. These are ABSENT under the `() => null` null-stub (which renders nothing). `tester_render_proof.txt`. |
| **SC-2-Web** | Other in-app glyphs (`ArrowUp`, `Menu`, `Settings`, `X`) render real | **PASS** | Shim unit test T-2 renders all 11 live names → each yields a real `<svg>`. The full `lucide-react` namespace is bundled (`createLucideIcon` factory + `lucide-react` module string present in `__common`). |
| **SC-3-Web** | Ari conversation cards don't crash: `AlertTriangle, Check, CheckSquare, Pencil, Play, Square` resolve to real components, never `undefined` | **PASS** | My own node runtime probe (`tester_fallback_probe.txt`): all 6 resolve `undefined=false renderable=true svg=true`, none throw. AlertTriangle (`triangle-alert` class + `m21.73 18` path) and Check (`M20 6 9 17`) glyph data present in the exported bundle. |
| **SC-4-Web** | Unknown/future icon name → real fallback, never `undefined`, never throws | **PASS** | My probe: `TotallyMadeUpIcon99999` → `undefined=false renderable=true`, renders a 371-char `<svg>` (HelpCircle fallback), no throw. `then` guard correctly `undefined`. My adversarial A-5 fuzzes 6 arbitrary names — all non-undefined, no throw. |
| **SC-5-Web** | `expo export -p web` exit 0 — ORCH-1085 not regressed | **PASS** | I ran the real export → **exit 0**, full bundle produced at `/tmp/orch1137-test-web-build`. No `import.meta`/Flow/react-native-svg parse error. `lucide-react` has zero RN deps. `tester_web_export_*.log`. |
| **SC-6-Native** (verify-unchanged) | iOS/Android still load real `lucide-react-native`, byte-identical | **PASS (structural)** | `git diff origin/main...HEAD --name-only` contains ZERO `.tsx`/`.ts` source under `components/ari` or `screens/ari`. The lucide alias (metro.config.js:200) sits inside the single `if (platform === "web")` block (line 153); native falls through to the real lib. The only metro change is comment-only (control flow byte-identical). |
| **SC-7** | `orch_1057_*` + `orch_1101_*` stay green, unmodified | **PASS** | I ran all 5 history suites: `orch_1057_ari_composer_icons_emptystate` + 4× `orch_1101_*` → 110/110 green. None appear in the closing diff (untouched). |

---

## 3. Findings

### P4-1 (NOTE / praise) — Total Proxy resolver is the structurally-correct choice
The implementor chose a total `Proxy`-backed resolver over a (longer) enumerated list, which structurally eliminates BOTH failure classes (blank glyph + `undefined`-crash) for all current AND future icon names with zero maintenance. The `has` trap, `then`-guard, `__esModule`/`default` interop, and a hard `forwardRef` fallback (if `HelpCircle` ever vanishes) are all handled. This is the right call and worth replicating for the other web shims if they ever face the same enumeration drift. No fix required.

**No P0/P1/P2/P3 findings.**

---

## 4. Step 0.5 — Independent re-run of the implementor's fails-on-revert proof

Re-ran the implementor's happy-path proof myself (the implementor cited `fails-on-revert verified at 0a9d1ba85`). Procedure: true line-deletion — overwrote the shim with the original `const IconStub = () => null` 12-entry null-stub, ran the suites, then restored from backup.

- **Null-stub (reverted):** `orch_1137_lucide_web_shim.test.ts` → **12 of 19 FAILED** (exactly matches the implementor's "12 of 19 FAILED" claim). Strict-grep gate `i-proposed-1137-biz-web-lucide-real.mjs` → **exit 1** (`INV-1` violation: `found lucide-react=false, Proxy=false, foundNullStub=true`).
- **Restored:** shim test **19/19 PASS**; gate **exit 0** (`INV-1` + `INV-2` OK); shim file byte-identical to committed HEAD (`git diff --stat` empty); working tree clean.

The implementor's fails-on-revert proof reproduces exactly. Commit hashes I checked out/ran against: `0a9d1ba85` (shim rewrite) and the committed HEAD `32480594d`.

---

## 5. Adversarial test added (tester-owned, different angle)

**Path:** `mingla-business/src/shims/__tests__/orch_1137_lucide_web_shim_adversarial.test.ts` (NEW, append-only)
**Cases:** 24, all PASS against the real shim.

**Angles attacked (deliberately DIFFERENT from the implementor's happy-path T-1..T-5):**
- **A-1 — enumeration-is-dead:** icons in NEITHER the old-12 list NOR the 11 live app names (`Trash2, Calendar, Bell, Search, MapPin, Clock`) must render a real `<svg>`. Proves the resolver is a TOTAL Proxy, not a renamed/longer enumeration.
- **A-2 — dead-12-no-regression:** the 7 dead social icons the OLD stub enumerated (`AtSign, Facebook, Globe2, Instagram, Linkedin, Music2, Youtube`) — which used to render blank as `() => null` — now render a real `<svg>`.
- **A-3 — Proxy `has`-trap:** `'Plus' in shim` and `'SomeArbitraryIconName1137' in shim` are `true` (a plain null-stub object has no `has` trap → false), while `'then' in shim` is `false` (thenable guard).
- **A-4 — web↔native roster parity / no-divergence guard:** reads the REAL native `lucide-react-native@0.577.0` roster from its on-disk CJS icon directory (1700+ kebab files → PascalCase), samples ≈46 names across the full roster, and asserts EVERY one resolves to a real, non-undefined, non-throwing renderable component on the web shim — the exact mechanism by which a web roster drifting below native would re-introduce blank glyphs.
- **A-5 — never-undefined fuzz:** 6 arbitrary capitalized names the implementor did NOT use — none undefined, none throw on render.

**fails-on-revert verified at `0a9d1ba85`:** reverting the shim to the null-stub flips **23 cases RED** across all 5 angles (A-1 Trash2/Calendar/… blank; A-2 social icons blank; A-3 `'…1137' in shim` false; A-4 native-roster names undefined; A-5 fuzz undefined). Restoring the real shim flips them **24/24 GREEN**; shim file byte-clean vs HEAD afterward.

**Both tests in the closing diff:** the implementor happy-path `orch_1137_lucide_web_shim.test.ts` and this adversarial `orch_1137_lucide_web_shim_adversarial.test.ts` both appear in `git diff origin/main...HEAD --name-only` after this commit. Neither is absorbed via a side-branch merge.

---

## 6. Constitution 14-rule matrix

| # | Rule | Verdict | Evidence |
|---|------|---------|----------|
| 1 | No dead taps | N/A | No interactive control added; the fix makes a previously-blank glyph render. |
| 2 | One owner per truth | PASS | The web shim is the single owner of web lucide resolution; native owns native. No competing owner. |
| 3 | No silent failures | **PASS (improved)** | The fix REMOVES a silent failure — unknown names no longer silently return `undefined` (crash) and known names no longer silently render blank. |
| 4 | One query key per entity | N/A | No data layer. |
| 5 | Server state stays server-side | N/A | No state. |
| 6 | Logout clears everything | N/A | No auth/state. |
| 7 | Label `[TRANSITIONAL]` | N/A | No transitional code (confirmed in impl report §9). |
| 8 | Subtract before adding | PASS | The null-stub was REPLACED (not added alongside); the 7 dead social-icon enumerations are gone. |
| 9 | No fabricated data | PASS | Renders real Lucide glyphs; the fallback (HelpCircle) is an honest "unknown" affordance, not a fake of a specific icon. |
| 10 | Currency-aware | N/A | — |
| 11 | One auth instance | N/A | Shim does not touch auth (anon-web-safe — no `useAuth`). |
| 12 | Validate at right time | N/A | — |
| 13 | Exclusion consistency | N/A | — |
| 14 | Persisted-state startup | N/A | — |

No violation. Rule 3 is materially improved.

---

## 7. Device / parity matrix

| # | Surface | Verdict | Evidence |
|---|---------|---------|----------|
| 1 | Consumer iOS | N/A | Different app (`app-mobile`); out of scope. |
| 2 | Consumer Android | N/A | Different app. |
| 3 | Buyer/anon Web (biz public routes) | PASS (incidental) | Same shared web alias; any lucide glyph on a public route now renders real. No `useAuth` in the shim — anon-web-safe. |
| 4 | Business iOS | PASS (unchanged) | Native loads real `lucide-react-native`; zero `.tsx` touched; web-only metro guard. Byte-identical. |
| 5 | Business Android | PASS (unchanged) | Same as iOS. |
| 6 | Admin Web | N/A | Separate app; already uses `lucide-react` directly. |
| 7 | **Business Web preview** (target) | **PASS** | Real `expo export -p web` (exit 0) + bundle grep (Plus paths present) + node runtime probe (all icons + unknown resolve real). |

**Physical-iPhone HITL:** not required — native path is structurally unchanged (no `.tsx`, web-only guard) and the symptom is web-only by construction. No native re-build performed, so COMMS-0027 OTA hygiene N/A (web ships via Vercel export).

**Live browser render of the Ari "+" chip:** NOT performed as a literal browser screenshot. The web symptom is fully determined by the platform-gated shim — I proved the real glyph ships three independent ways (export-bundle grep of both Plus paths, node `renderToStaticMarkup` producing the `<svg>` with the Plus paths + props passing through, and the gate render-proof). This is `proven`-level for a build-config fix. A literal browser screenshot would add nothing the bundle artifact + render output don't already prove.

---

## 8. Discoveries for Orchestrator

- None. Scope held exactly to the SPEC §11 allowlist. The 3 pre-existing closing-diff artifact files (spec/investigation/evidence) are the forensics baseline.
- At CLOSE: flip `I-PROPOSED-1137-BIZ-WEB-LUCIDE-REAL` DRAFT → ACTIVE; resolve COMMS-0034 (the systemic fix it references is verified shipped).

---

## 9. Test artifacts

- `Mingla_Artifacts/evidence/ORCH-1137/tester_web_export_build.log` + `tester_web_export_tail.txt` — my `expo export -p web` (exit 0).
- `Mingla_Artifacts/evidence/ORCH-1137/tester_render_proof.txt` — Plus paths + SC-3 glyph data in the exported bundle.
- `Mingla_Artifacts/evidence/ORCH-1137/tester_fallback_probe.txt` — F-3 crash-kill runtime probe.
- `mingla-business/src/shims/__tests__/orch_1137_lucide_web_shim_adversarial.test.ts` — my adversarial test.
