# IMPLEMENT — ORCH-1204 [web-auth-sync-gate]: CI-wired strict-grep gate

**Date:** 2026-06-22
**Worktree:** `~/Desktop/mingla-orchs/1204-[web-auth-sync-gate]/` on branch `1204-web-auth-sync-gate`
**Scope:** Append-only CI infra. NO product code changed. The gate READS `mingla-business/src/context/AuthContext.tsx`; it does not modify it.

---

## 1. Summary

ORCH-1204 fixed the business-web brand-load wedge by hydrating `session` / `user` / `loading`
SYNCHRONOUSLY at `AuthProvider` mount via lazy `useState` initializers derived from a single hoisted
`const initialStored = readStoredWebSession();`. The jest regression tests for that fix DO NOT run as
a blocking CI job (only `featureFlags.test.ts` runs in the business suite), so a revert of the three
initializers to `useState(null)/useState(null)/useState(true)` would ship undetected.

This change adds a strict-grep gate — which DOES run on every PR — that fails the build if the
synchronous hydration is reverted. It mirrors the ORCH-1205 gate pattern exactly (a `--self-test`
step + a real run, each a parallel job).

---

## 2. Gate script summary

**Path:** `.github/scripts/strict-grep/orch-1204-web-auth-sync-hydration.mjs` (298 lines)

Reads `mingla-business/src/context/AuthContext.tsx` and FAILS (non-zero exit + clear message) unless
ALL four conditions hold. The whole source is whitespace-collapsed (`/\s+/g → " "`) before matching,
so the detector is immune to line-wrapping / indentation / extra spaces.

1. **Hoisted read** — a single `const <name> = readStoredWebSession();` exists; the binding name is
   captured and reused so the per-state checks require derivation from THAT exact const.
2. **`session`** — lazy initializer `useState<...>(() => <name>)`; FAILS on `useState(null)`.
3. **`user`** — lazy initializer `useState<...>(() => <name>?.user ...)`; FAILS on `useState(null)`.
4. **`loading`** — lazy initializer `useState<...>(() => <name> === null)`; FAILS on bare `useState(true)`.

When a state is in the reverted form the message explicitly names the offending `useState(null)` /
`useState(true)` so the failure is self-explanatory. Missing target file → FAIL.

`--self-test` mode runs 2 positive fixtures (the real shape + a heavily-reformatted variant) and 5
negative fixtures (each of the three states reverted individually, the full three-way revert, and the
deleted hoisted read), and exits non-zero if the detector behaves wrong.

---

## 3. Workflow wiring

**File:** `.github/workflows/strict-grep-mingla-business.yml` (+13 lines, new job inserted directly
above the `orch-1205-edge-cors-x-client-info` job, mirroring its shape).

**Job name (id):** `orch-1204-web-auth-sync-hydration`
**Job display name:** `"ORCH-1204: business-web AuthProvider hydrates session/user/loading synchronously"`

Steps: checkout → setup-node@20 → `--self-test` step → real run step. Runs on every PR/push that
touches `mingla-business/**` (and the other registered paths), in parallel with all other gates; any
failure fails the PR. YAML validated (`ruby -ryaml`): both `orch-1204-…` and `orch-1205-…` jobs present.

---

## 4. PASS run (current, correct AuthContext.tsx)

```
=== LIVE PASS (current AuthContext.tsx) ===
ORCH-1204 gate PASS — business-web AuthProvider hydrates session/user/loading synchronously from readStoredWebSession() at mount.
exit=0
```

---

## 5. --self-test run

```
=== SELF-TEST ===
ORCH-1204 gate self-test PASS (2 positive + 5 negative fixtures behaved correctly).
exit=0
```

---

## 6. Fails-on-revert proof

The three initializers in `AuthContext.tsx` were temporarily reverted (true line edit) to:

```
189:  const [session, setSession] = useState<Session | null>(null);
190:  const [user, setUser] = useState<User | null>(null);
191:  const [loading, setLoading] = useState(true);
```

Gate run against the reverted file:

```
=== GATE AGAINST REVERTED FILE (must FAIL) ===
ORCH-1204 gate FAIL — the business-web AuthProvider no longer hydrates session/user/loading synchronously at mount:

mingla-business/src/context/AuthContext.tsx: `session` state is NOT a lazy initializer deriving from `initialStored`. Expected `useState<Session | null>(() => initialStored)`. Found the reverted `useState(null)` form — this re-introduces the ORCH-1204 wedge. DO NOT revert ORCH-1204.
mingla-business/src/context/AuthContext.tsx: `user` state is NOT a lazy initializer deriving from `initialStored?.user`. Expected `useState<User | null>(() => initialStored?.user ?? null)`. Found the reverted `useState(null)` form — this re-introduces the ORCH-1204 wedge. DO NOT revert ORCH-1204.
mingla-business/src/context/AuthContext.tsx: `loading` state is NOT a lazy initializer based on `initialStored === null`. Expected `useState<boolean>(() => initialStored === null)`. Found the reverted bare `useState(true)` form — this re-introduces the ORCH-1204 wedge. DO NOT revert ORCH-1204.
...
exit=1
```

The fix was then restored via `git checkout -- mingla-business/src/context/AuthContext.tsx`
(confirmed clean: `git status --porcelain` returned empty for that file) and the gate re-run:

```
=== RE-RUN GATE AFTER RESTORE (must PASS) ===
ORCH-1204 gate PASS — business-web AuthProvider hydrates session/user/loading synchronously from readStoredWebSession() at mount.
exit=0
```

**fails-on-revert verified** — gate exits 1 with all three states flagged when the fix is reverted,
exits 0 when restored. AuthContext.tsx is byte-identical to origin (no product code touched).

---

## 7. Files changed

| File | Change | Lines |
|------|--------|-------|
| `.github/scripts/strict-grep/orch-1204-web-auth-sync-hydration.mjs` | new gate script | +298 |
| `.github/workflows/strict-grep-mingla-business.yml` | new `orch-1204-web-auth-sync-hydration` job | +13 |

No other files staged. `mingla-business/src/context/AuthContext.tsx` is UNCHANGED.

---

## 8. Append-only / test-mod compliance

This is append-only CI infra: a new gate script + a new workflow job. No existing test or gate is
modified or deleted, so `tests-append-only.yml` is unaffected.

---

## 9. Commit

Committed on branch `1204-web-auth-sync-gate` (commit hash recorded in the chat summary). No deploy,
no merge, no OTA.

---

## 10. Comms

Acked **COMMS-0056** (WARN, `to: ALL`, re ORCH-1204/1205) — it explicitly flagged this caveat
("1204's regression protection is being upgraded from jest-only to a CI-wired strict-grep gate
`orch-1204-web-auth-sync-hydration.mjs`"). This change is that upgrade. Ack appended to the ledger.
