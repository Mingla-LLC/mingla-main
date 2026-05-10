# Implementation Report: Admin Vercel Package Upload Fix

> Date: 2026-05-09
> Mode: Diagnose and Fix
> Spec: User-directed deployment failure
> Status: implemented and verified

## 1. Layman Summary

The failed admin Vercel deploy was caused by the repo-level `.vercelignore` excluding the entire `mingla-admin/` folder. Vercel then tried to build from `/vercel/path0/mingla-admin`, but that directory did not contain `package.json` because the folder had not been uploaded. The fix keeps admin source files in the Vercel upload while still excluding admin-local generated/heavy files.

## 2. Request And Context

- **Request:** Fix failed admin Vercel deployment error: `ENOENT ... /vercel/path0/mingla-admin/package.json`.
- **Source:** User-provided Vercel log.
- **Affected surfaces:** Admin web deployment packaging.
- **Related issues/artifacts:** None.

## 3. Scope

- **In scope:** Repo-level Vercel ignore rules for admin deploy source availability.
- **Out of scope:** Vercel dashboard settings, env vars, app behavior, bundle optimization.
- **Assumptions:** Admin Vercel project uses root directory `mingla-admin`, matching the failed path in the deployment log.

## 4. Files Read

| File | Why | Relevant finding |
|---|---|---|
| `.vercelignore` | Deployment upload rules | Excluded `mingla-admin/`, which removes `mingla-admin/package.json` from Vercel uploads. |
| `mingla-admin/package.json` | Verify package exists and build script | Package exists locally and `build` runs `vite build`. |
| `mingla-admin/package-lock.json` | Verify lockfile/source upload relevance | Lockfile exists under admin and should be uploaded with source. |
| `mingla-admin/vite.config.js` | Verify output directory | Build output is `dist`. |
| `mingla-business/vercel.json` | Sibling deploy pattern | Business excludes heavy/generated files while preserving deploy source. |

## 5. Blast Radius

- **Direct changes:** `.vercelignore`.
- **Cascade changes:** Vercel admin uploads now include `mingla-admin` source files and lockfile.
- **Parity surfaces:** No mobile/business/runtime parity impact.
- **Cache impact:** None.
- **State boundaries:** None.
- **Auth/RLS/security:** No runtime security changes. Admin `.env`, `dist`, and `node_modules` remain excluded.
- **Deploy path:** Admin Vercel project can find `/vercel/path0/mingla-admin/package.json`.

## 6. Old To New Receipts

### `.vercelignore`

- **Before:** Excluded the entire `mingla-admin/` folder.
- **After:** Includes `mingla-admin/` source, while excluding `mingla-admin/.env`, `mingla-admin/dist/`, and `mingla-admin/node_modules/`.
- **Why:** Vercel needs the admin source root and `package.json` to install and run `npm run build`.
- **Approx lines changed:** 4.

## 7. Implementation Details

- **Architecture decisions:** Kept the monorepo-level ignore file and changed only the admin-specific exclusion.
- **Data flow:** Not applicable.
- **Mutation/query behavior:** Not applicable.
- **State handling:** Not applicable.
- **Error handling:** Not applicable.
- **Copy/accessibility:** Not applicable.
- **Analytics/notifications/realtime:** Not applicable.

## 8. Spec / Goal Traceability

| Criterion / goal | Implemented | Verification | Status |
|---|---|---|---|
| Admin deploy can access `mingla-admin/package.json` | Yes | `.vercelignore` no longer excludes `mingla-admin/`; source file exists locally | PASS |
| Admin app still builds | Yes | `npm run build` from `mingla-admin` | PASS |
| Heavy/generated admin files remain out of uploads | Yes | Explicit ignores for `.env`, `dist`, and `node_modules` | PASS |

## 9. Invariant Verification

| Invariant | Relevant | Preserved | Notes |
|---|---|---|---|
| Protect secrets | Yes | Yes | `mingla-admin/.env` remains ignored for Vercel uploads. |
| Do not change product behavior | Yes | Yes | No app code changed. |
| Keep deployment artifact lean | Yes | Yes | Admin `node_modules` and `dist` remain ignored. |

## 10. Parity Check

- **Mobile:** Not affected.
- **Business app:** Not affected by code, but repo-level upload size may increase slightly because admin source is no longer excluded.
- **Admin:** Deploy packaging fixed.
- **Public/web:** Not affected.
- **Solo/collab:** Not applicable.
- **Gaps:** Vercel dashboard root directory settings were not inspected directly.

## 11. Cache And Persisted State Safety

- **Query keys changed:** None.
- **Invalidations added:** None.
- **Data shape changes:** None.
- **AsyncStorage/Zustand impact:** None.
- **Cold start behavior:** Not affected.

## 12. Verification

| Check | Command / method | Result | Notes |
|---|---|---|---|
| Admin local production build | `npm run build` in `mingla-admin` | PASS | Vite built successfully. Existing bundle-size and mixed Leaflet CSS import warnings remain non-blocking. |
| Upload ignore sanity | Read `.vercelignore` diff | PASS | `mingla-admin/` exclusion removed; generated/heavy admin paths excluded. |

## 13. Regression Surface

1. Vercel CLI uploads from repo root may include admin source files where they were previously excluded.
2. Admin Vercel deploy now depends on existing dashboard/project settings still pointing at `mingla-admin`.

## 14. Risks, Limitations, Transition Items

| Item | Risk / temporary state | Exit condition | Location |
|---|---|---|---|
| Dashboard settings not verified | If the Vercel project root/build settings differ from the log path, another setting may still need correction | Redeploy admin and confirm Vercel installs from `mingla-admin/package.json` | Vercel project settings |

## 15. Discoveries For Orchestrator

- The repo has multiple Vercel project links (`.vercel/`, `mingla-admin/.vercel/`, `mingla-business/.vercel/`, `mingla-marketing/.vercel/`). Consider documenting a standard deploy command per web surface so future root-level `.vercelignore` changes do not break sibling apps.

## 16. Deploy Notes

- **Migrations:** None.
- **Edge functions:** None.
- **Mobile OTA/native:** None.
- **Business/admin web:** Redeploy the admin Vercel project. Expected fix: Vercel can read `/vercel/path0/mingla-admin/package.json` and proceed to `npm run build`.
- **Env vars/secrets:** No changes.

## Suggested Commit Message

```text
fix(admin): include admin source in Vercel uploads

Evidence: npm run build in mingla-admin
Deploy: redeploy admin Vercel project
```

## Ready-To-Test Checklist

1. Redeploy the admin Vercel project and confirm install/build starts from `mingla-admin/package.json`.
2. Confirm the deployed admin dashboard loads after build completes.
