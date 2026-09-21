# AGENTS.md

## How Mingla work is tracked

All work — bugs, features, ideas, discoveries — lives as GitHub issues on the **Mingla Avengers board** (https://github.com/orgs/Mingla-LLC/projects/4). The board README is the operating manual. If it's not an issue, it doesn't exist.

- **Issue titles are plain English**; the **issue # is the work ID**. Branches are `<issue#>-short-slug`; PRs say `Fixes #<issue#>`.
- **Status lifecycle:** `Todo` (queued) → `In Progress` (investigating / building) → `In Review` (PR open, testing) → `Done` (merged + verified; auto-closes the issue).
- **Documentation goes to the issue**, not the repo: investigation findings, spec decisions, implementation notes, and test evidence are issue comments (attach screenshots). Do NOT create per-work-item .md files — CI (`scripts/docs/check_artifact_placement.py`) rejects them.
- When something ships, its pull request adds one line to `REPORTS.md` (format documented in that file) — see § No docs-only follow-up pull requests.
- Set board fields when creating issues (Work Type, Product, Theme, Priority, Estimate; Horizon/Quarter for roadmap items) — board views filter on them.
- Setting Status = Done auto-closes the issue (a project workflow); don't mark Done anything that should stay open.

## Canonical docs (the only durable .md surface)

| Doc | Owns |
|---|---|
| `PRODUCT_AND_STRATEGY.md` | Product, positioning, roadmap, strategy |
| `MARKETING.md` | Channels, attribution, marketing motions |
| `REPORTS.md` | Shipped-work log |
| `docs/` | Engineering references: invariant registry, handbook, worktree strategy, runbooks, contracts |

Everything pre-2026-07-19 (Mingla_Artifacts/, Mingla_Roadmap/, per-ORCH docs, the first comms ledger) is preserved at git tag `pre-avengers-archive`. The later `COMMS.md` coordination table was retired by #3476; chats now follow § Coordinate with other chats, and the table's history is in git.

## No docs-only follow-up pull requests

- The `REPORTS.md` ship-log line and any `docs/INVARIANT_REGISTRY.md` status change are written in the same pull request as the change they describe, before it merges.
- Exception: if an invariant's proof only exists after merge (it needs a green `main` or a live check), leave it DRAFT, record the post-merge check on the issue, and flip it to ACTIVE in your next pull request.
- Post-merge release records (OTA ids, deploy and live verification) go on the issue as a comment, not into a repo file.
- A docs-only pull request is only for work whose deliverable is the docs themselves.

## Coordinate with other chats (MANDATORY)

Claude and Codex chats coordinate by messaging each other directly. The old `COMMS.md` table is retired (#3476); its history is in git.

**Find the live chats.** Claude: `ListAgents`, then `SendMessage` (Claude chats on this Mac). Codex: `list_threads`, then `send_message_to_thread` (Codex threads). Claude and Codex cannot message each other, so the GitHub issue is the shared channel between them: anything a chat on the other side must see goes on the issue as a comment.

**1. Before you start** work on an issue:
- Message the live chats whose work could collide with yours: the issue #, what you are about to change, and any shared thing you will touch (production deploys, migrations, OTA publishes, the shared anchor checkout, simulators, Metro ports, CI gates, a shared file such as `REPORTS.md` or `docs/INVARIANT_REGISTRY.md`).
- Post the same note as a comment on your issue, including your chat's address (Claude: the name `ListAgents` gives this session; Codex: the thread title) so any chat can find the owner.

**2. When you are blocked** by something another chat owns:
- If the owner is a live chat on your side, message it directly with what you need and why.
- If the owner is not live, or is on the other side (Claude/Codex), comment on the owner's issue and tell Seth.
- Do not work around another chat's in-flight change.

**3. When you are done** (merged, deployed, published, or stopping):
- Message the chats affected by what you changed: rebase needed, deploy or OTA published, a shared file or gate changed, a new trap found.
- Put the same note on your issue.

**Replying.** When a message names something you own, answer it at your next step: act, say when you will, or say it is not yours. Reply to the sender (Claude: the message's `from`; Codex: the sending thread).

**Keep it signal.** Send only what changes what the other chat does; no status chatter. Never ask another chat to do something your own permissions refused.

**What must outlast a chat does not go in a message:**
- Work records (findings, specs, test verdicts, release records such as OTA ids) go on the issue.
- A lasting lesson or trap goes into the relevant doc or runbook under `docs/`, in the same pull request as the work that found it.
- A hold that binds every chat goes into § Standing holds below, in its own small pull request, and is announced to live chats.

## Standing holds

Rules every chat must follow until the linked issue lifts them. Remove a hold in the pull request that lifts it.

- **No public app release without Seth's explicit approval.** Do not create, upload, submit, promote or roll out any App Store or Google Play build (TestFlight and Play internal included), and do not publish any production OTA, unless Seth has approved that specific release in chat; an approval covers only the release it names. Still allowed without asking: EAS development or simulator builds that never reach a store, web releases through the reviewed Vercel `[deploy]` path, and reviewed migrations and edge function deploys under their own gates. Lifted by Seth only: no issue lifts it (it began on #2049 and #2054, both closed, and every release since has kept it in force).
- **A web change only ships if the squash subject contains `[deploy]`.** Every Vercel project on the team (`mingla-admin`, `mingla-business`, `mingla-marketing`, `mingla-site-cms`, `mingla-sites`) is behind an Ignored Build Step that reads the commit message, so a merged pull request whose title lacks the literal string `[deploy]` deploys NOTHING and the dashboard shows `CANCELED`. Nothing in CI or the merge reports this — the only signal is the product still being broken. Put `[deploy]` in the PR title before merging anything under a web project, and after merging confirm the production deployment reached `READY` rather than assuming. A redeploy through the Vercel API does NOT bypass the gate: it re-reads the same commit message and is cancelled again; the fix is a new commit whose subject carries the marker.
- **Do not deploy Mingla Sites edge functions by hand.** Never hand-deploy a `brand-site-*` function, and never deploy `brand-site-control` with `--no-verify-jwt`; comment on #3381 and tell Seth before deploying any Sites function. A green "Deploy Supabase Edge Functions" run that prints `NOTICE select: governed_bundle_lane_required` did NOT deploy your function. Lifted by #3381.
- **The Supabase spend cap is armed.** Do not build anything on Supabase Image Transformations (`/render/image/...`); use the existing `<placeId>/<n>_thumb.jpg` thumbnails in `place-photos`. Check storage headroom before any large photo, collage or supply-expansion ingest: going over a quota can put the whole org's database into read-only mode. Lifted by #1643.

## Engineering discipline (unchanged)

- **Never commit on the anchor `main`** (`~/Desktop/mingla-main`). Work in a per-issue worktree: `~/Desktop/mingla-orchs/<issue#>-<slug>/` on branch `<issue#>-<slug>`, branched from fresh `origin/main`. Full rules: `docs/WORKTREE_STRATEGY.md`.
- **One PR per issue; merge only when all required checks are GREEN** and the PR is mergeable. Never merge red, never disable a check.
- The 14-rule Architecture Constitution in `README.md` binds every change; invariants in `docs/INVARIANT_REGISTRY.md` are enforced by strict-grep CI gates.
- Fixes ship with regression tests; the tests suite is append-only (CI-gated).
- Both apps ship the SAME version — bump together (CI parity gate).
- Public trip/offering changes must hit ALL surfaces (consumer iOS/Android, business iOS/Android, buyer web, admin where applicable).

## Response style

Every chat response uses exactly two top-level sections: **A — What just happened** (1–4 plain-English sentences, outcome first, layman first) and **B — Handoff** (next steps for Seth, a handoff paragraph for the next agent, or "none; awaiting your direction"). Detail beyond summary-grade goes to the issue, not chat.
