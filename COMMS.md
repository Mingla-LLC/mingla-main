# Mingla Comms

**Canonical path:** `/Users/sethogieva/Desktop/mingla-main/COMMS.md` (anchor `main`), reachable from every worktree via absolute path.

Cross-session coordination for concurrent Claude/Codex sessions. Read the Active table on session entry; write on discovering anything that affects another in-flight work item. Everything else about the work itself belongs in the work item's GitHub issue on the [Mingla Avengers board](https://github.com/orgs/Mingla-LLC/projects/4).

The pre-2026-07-19 ledger (COMMS-0001 → COMMS-0117, in `COMMS_LEDGER.md`) is preserved at git tag `pre-avengers-archive`.

## How to read

On session entry, scan the Active table. For each row where `to` matches your skill/role, your current issue #, or is literally `ALL`:

- `severity: BLOCK` + `status: OPEN` → STOP. Do the body now. Append yourself to `acked_by`; set status to `ACKNOWLEDGED` (or `RESOLVED` if your action fully closes it).
- `severity: WARN` + `status: OPEN` → read, factor into your turn, append yourself to `acked_by`.
- `severity: FYI` → read and continue.

## How to write

When you discover something that affects another in-flight session or issue:

1. Allocate the next `COMMS-NNNN` (max existing ID + 1, zero-padded to 4; numbering continues from the old ledger — next is COMMS-0118).
2. Append a row to the Active table. Bodies are inline (`<br>` for line breaks); no separate detail files.
3. Commit it as a one-file direct-to-`main` commit on the anchor and push immediately — acks committed but never pushed get silently dropped by a later `pull --rebase`. Note: the anchor pre-commit hook blocks direct main commits by default; `MINGLA_ALLOW_MAIN_COMMIT=1` is the sanctioned override for COMMS/CLOSE docs commits (#1014 tester D-9):
   ```bash
   cd /Users/sethogieva/Desktop/mingla-main
   git checkout main && git pull
   git add COMMS.md
   MINGLA_ALLOW_MAIN_COMMIT=1 git commit -m "COMMS-NNNN: <one-line subject>"
   git push origin main
   ```

## Stale cleanup

Sweep on any status/triage run: `OPEN` rows past `expires` → `STALE`; `RESOLVED`/`STALE` rows → move to Archive. Default `expires`: 14 days for `WARN`/`FYI`; `none` for `BLOCK` (BLOCK never auto-stales).

---

## Active entries

| id | date | from | to | severity | status | expires | acked_by | subject / body |
|---|---|---|---|---|---|---|---|---|
| COMMS-0118 | 2026-07-19 | orchestrator | ALL | WARN | OPEN | none | mingla-implementor+claude (#976), mingla-product+claude, mingla-tester+claude (#976 test), mingla-tester+claude (#882 test), mingla-forensics+claude (#1014 spec), mingla-implementor+claude (#1014), mingla-tester+claude (#1014 test), mingla-forensics+claude (#1022 spec) | Operating model migrated (issue #974): work is tracked as GitHub issues on the Mingla Avengers board; `Mingla_Artifacts/`, `Mingla_Roadmap/`, and the old `COMMS_LEDGER.md` are retired (history at tag `pre-avengers-archive`). Write comms here, work docs to the issue. In-flight sessions started before 2026-07-19: finish on your current branch, but file your close as an issue comment, not an artifact .md. |

---

## Archive (resolved / stale)

*(empty — pre-migration archive lives in `COMMS_LEDGER.md` at tag `pre-avengers-archive`)*
