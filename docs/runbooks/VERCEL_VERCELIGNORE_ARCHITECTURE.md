# Vercel `.vercelignore` Architecture

**Status:** Active reference (post-ORCH-0857 [Vercel `.vercelignore` project-aware split] CLOSE 2026-05-17).
**Owner:** Sethogieva.
**Why it exists:** Pre-2026-05-17, a single repo-root `.vercelignore` was shared across three Vercel projects (`mingla-admin`, `mingla-business`, `mingla-marketing`). The file was tuned for `mingla-business`'s upload-size limit and listed `mingla-marketing/` as ignored. When Vercel deployed the `mingla-marketing` project WITHOUT cache (which it does on any cold or invalidated build), it stripped the `mingla-marketing/` source before `next build` and the build died with `No Next.js version detected`. This bit PR #122 on 2026-05-17. Cached builds masked the bug; cacheless builds exposed it.

---

## The architecture (2026-05-17 onward)

Each Vercel project has its OWN `.vercelignore` inside its Root Directory:

| Project          | Vercel Root Directory | `.vercelignore` path                |
|------------------|-----------------------|--------------------------------------|
| mingla-admin     | `mingla-admin`        | `mingla-admin/.vercelignore`         |
| mingla-business  | `mingla-business`     | `mingla-business/.vercelignore`      |
| mingla-marketing | `mingla-marketing`    | `mingla-marketing/.vercelignore`     |

Plus a repo-root `/.vercelignore` for paths NO Vercel project ever needs.

## Division of responsibility

### Repo-root `/.vercelignore` — universal-only

Contains ONLY paths NO Vercel project deploys. Read by every project's build regardless of Root Directory setting.

Allowed entries (root-anchored so a same-named folder inside a Vercel project is not stripped):
- `node_modules/`
- Non-Vercel codebases: `/app-mobile/`, `/backend/`, `/oauth-redirect/`, `/scripts/`, `/supabase/`, `/tests/`
- Repo-level documentation/archives: `/Mingla_Artifacts/`, `/Mingla_Roadmap/`

**FORBIDDEN entries:** any path under `mingla-admin/`, `mingla-business/`, or `mingla-marketing/`. Listing a Vercel project's own folder (or any subfolder of it) here will strip its own source on cacheless deploys.

### Per-project `*/.vercelignore` — internal cruft only

Contains ONLY paths INSIDE that project's directory that shouldn't deploy:
- `node_modules/`
- `.env`, `.env.local`
- Build artifacts: `dist/`, `.next/`, `.expo/`, `out/`, `.vite/`, `android/`, `ios/`

These files do NOT need to list sibling projects — Vercel's Root Directory setting already scopes the upload to the project's own folder.

---

## Why this design

1. **No silent cross-project strip.** A per-project file can't accidentally remove a sibling project's source — it only sees its own folder.
2. **Cacheless builds work.** Even on a cold Vercel cache (which strips all ignored paths fresh), each project's source survives because it's not listed in any read `.vercelignore`.
3. **Upload size stays small.** Each project uploads only its own Root Directory contents, minus its own build cruft.
4. **One file owns one project.** No cross-cutting concerns inside any `.vercelignore`. Engineers editing the business app's ignores don't need to think about marketing.

---

## Day-to-day rules

| When you... | Edit |
|-------------|------|
| Add a new build artifact in `mingla-business/dist-foo/` | `mingla-business/.vercelignore` |
| Add a new `.env.staging` to `mingla-marketing/` | `mingla-marketing/.vercelignore` |
| Add a new repo-root folder `experiments/` that no Vercel project deploys | `/.vercelignore` |
| Add a NEW Vercel project (e.g., `mingla-creator-tools`) | Create `mingla-creator-tools/.vercelignore`; set Root Directory in Vercel dashboard; do NOT add the project's folder to `/.vercelignore` |

---

## Verification

After changing any `.vercelignore`:

1. **Local probe:** run `cd <project-dir> && npx vercel build --prod=false` to confirm the build still finds all required source files.
2. **Cacheless PR test:** push a small commit (or trigger a redeploy with cache disabled in the Vercel dashboard) for each affected project. A pass on a cacheless build is the canonical regression-prevention proof.
3. **Live probe:** after merge to `main`, watch the next post-merge deploy on each affected project at https://vercel.com/seth-ogievas-projects/{mingla-admin,mingla-business,mingla-marketing}.

---

## Symptom-to-cause cheat-sheet

| Symptom in Vercel build log | Likely cause |
|---|---|
| `No Next.js version detected. Make sure your package.json has "next"...` | The project's Next.js source was stripped by a cross-project entry in `/.vercelignore`. Check the file does NOT list this project's folder. |
| `Removed N ignored files defined in .vercelignore` where N > expected | A `.vercelignore` (root or per-project) is over-aggressive. Diff against the previous PASS deployment to see what changed. |
| Production deploy on `main` passes, PR previews fail | Cache asymmetry. Cached prod builds hide the strip; cacheless PR builds expose it. The fix is in the ignore architecture, not in retry. |

---

## History

- **2026-05-17:** ORCH-0857 closed. Created this runbook. Migrated the single repo-root `.vercelignore` into a slim root file + three per-project files. Removed `mingla-marketing/` from the root file (the immediate cause of PR #122's failure).
- **Pre-2026-05-17:** Single repo-root `.vercelignore` tuned for `mingla-business`. Marketing builds passed only when Vercel build cache was warm.
