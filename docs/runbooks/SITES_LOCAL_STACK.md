# Mingla Sites local stack

Runs the whole Sites system (Core Supabase, the separate Sites CMS Supabase,
Studio and the public runtime) on one Mac with no production dependency.
Owner: initiative #2829. Scripts: `scripts/sites/local/`.

## What runs where

| Piece | Where | Ports |
|---|---|---|
| Core Supabase (repo migrations + edge functions) | Docker, project id `mingla-sites-core-local`, workdir generated at `~/.mingla-sites-local/<checkout>-<hash>/core` (outside the repo) | API 55321, DB 55322, shadow 55320, inspector 55383 |
| Sites CMS Supabase (database, storage, auth only) | Docker, project id `mingla-sites-cms-local`, `mingla-site-cms/local-supabase` | API 55421, DB 55422, shadow 55420 |
| Studio (`mingla-site-cms`) | `next dev` | http://localhost:3101 |
| Public runtime (`mingla-sites`) | `next dev` | http://&lt;label&gt;.sites.localhost:3100 |

The ports and project ids are deliberately different from the repository
defaults (5432x, `gqnoajqerqhnvulmnyvv`), so another chat's local stack can run
at the same time. Override the Core ports with `SITES_LOCAL_CORE_API_PORT`,
`SITES_LOCAL_CORE_DB_PORT`, `SITES_LOCAL_CORE_SHADOW_PORT` if one is taken.

Browsers resolve every `*.localhost` name to 127.0.0.1, so no hosts-file edit
is needed. For command-line checks use `curl` (it does the same) or pass
`--resolve <host>:3100:127.0.0.1`.

## Docker endpoint

The scripts reach Docker only through `DOCKER_HOST`, which every `docker`
and `supabase` command inherits. They never run `docker context use`: the
current Docker context is global on this Mac and other chats depend on it.

- #2829 work uses its own colima VM, profile `mingla-2829`. When
  `DOCKER_HOST` is unset and `~/.colima/mingla-2829/docker.sock` exists, the
  scripts use that socket; otherwise export it yourself:
  `export DOCKER_HOST=unix://$HOME/.colima/mingla-2829/docker.sock`.
- Any manual `docker` or `supabase` command for this stack needs the same
  `DOCKER_HOST`, or it will talk to a different Docker.
- With no `DOCKER_HOST` and no such socket the scripts stop with a message
  rather than guess.

## Bring-up

Prerequisites: Docker running and able to pull images, the Supabase CLI
(`/Users/sethogieva/bin/supabase` or on PATH), Node 22, `psql`, and real
`node_modules` in `mingla-sites/` and `mingla-site-cms/` (`npm ci` in each;
in a worktree, delete a `node_modules` symlink first).

```bash
scripts/sites/local/start-local-sites.sh            # bring up, seed, run the apps
scripts/sites/local/start-local-sites.sh --no-run   # bring up and seed only
scripts/sites/local/start-local-sites.sh --reset    # also reset the Core database
scripts/sites/local/run-local-sites.sh [--prod]     # run the apps again later
```

`start-local-sites.sh`:

1. writes the Core stack workdir (a copy of the function policy config with
   the ports above; migrations and functions are symlinks to the repo);
2. starts both stacks (the first start applies every Core migration);
3. applies pending Core migrations (`supabase migration up`; `db reset` only
   with `--reset`);
4. generates key material once (`generate-local-keys.mjs`) and writes the
   gitignored `mingla-sites/.env.local`, `mingla-site-cms/.env.local`,
   `supabase/functions/.env.local` and `scripts/sites/local/.state/cms-ops.env`
   (pass `--rotate` to the key script to regenerate everything);
5. seeds Core (`seed-local.mjs`): the service config row with
   `environment='local'`, seven role users, the brands "gogi fixture",
   "Young & Stamped" (name and slug only) and "Local Test Trips", team
   memberships, the gogi fixture's site row and one upcoming trip;
6. bootstraps the Sites CMS database and buckets and applies the Payload
   migrations (`scripts/sites/apply-sites-cms-migrations.mjs` in local mode);
7. creates the runtime storage reader and binds the reader policy to it;
8. starts the edge functions, Studio and the runtime (`run-local-sites.sh`).

Seed user emails and passwords are in
`scripts/sites/local/.seed-credentials.local.json` (gitignored). No script
prints a key, password or token.

## Safety rails (do not weaken)

Local mode is a security control (#2829 AD-12). Each rail has a test.

- The runtime and Studio turn local mode on only when every signal agrees:
  `SITES_LOCAL_MODE=1`, no `VERCEL`/`VERCEL_ENV`, loopback backends. Any
  partial signal throws (`mingla-sites/src/lib/localMode.issue2829.test.ts`,
  `mingla-site-cms/src/lib/localMode.issue2829.test.ts`).
- `next build` fails when a Vercel marker and a local-mode variable are both
  set (same tests spawn the build).
- Core refuses loopback origins and the `sites.localhost` suffix unless the
  config row says `environment='local'`; the environment never changes after
  insert; no migration writes a local row
  (`supabase/migrations/__tests__/issue_2829_sites_multi_brand.test.sql`,
  `scripts/sites/__tests__/issue_2829_local_stack_scripts.test.mjs`).
- `brand-site-control` refuses a local row unless its own `SUPABASE_URL` is
  the local stack (`supabase/functions/_shared/__tests__/issue_2829_sites_environment_guard.test.ts`).
- The CMS bootstrap and Payload-migration scripts accept a loopback target
  only in local mode, and refuse local mode under Vercel or GitHub Actions
  (`scripts/sites/__tests__/issue_2829_local_mode_ops.test.mjs`).

Never copy a value from a local `.env.local` into Vercel or any hosted
project, and never point the local scripts at a hosted database.

## Site forms and history import (#2829 W5)

- Contact forms and newsletter boxes send to Mingla's public enquiry and
  subscribe functions (#4111), which the Core stack serves locally like every
  other function; the runtime forwards server-side (no Origin header). The
  enquiry lands in the brand's Messages → Customer enquiries ("Website"); the
  newsletter sends a confirmation email (the local stack sends none, so check
  `brand_subscribe_pending` in the local Core database).
- A brand's pre-Mingla trips become ended Mingla trips through
  `scripts/sites/import-historical-trips.mjs` (Core, service role) and its
  reviews become site Testimonials through
  `mingla-site-cms/src/scripts/import-testimonials.ts` (`npx payload run`).
  Both dry-run unless told to apply. Locally use only the invented example
  `scripts/sites/local/fixtures/historical-import.neutral.json` (with the
  local brand id); a brand's real records stay private and are imported in
  production only as a Seth-approved step after merge
  (`--target production --apply --confirm-production-import <brand_id>`).

## The travel pilot site and its parity run (#2829 W7b)

- `node scripts/sites/local/seed-young-and-stamped.mjs` builds the pilot
  brand's site on the local stack from the brand's own source, read at run
  time from `YS_SOURCE_DIR` (read-only) and never committed. It records the
  brand's existing Payload seed without running Payload
  (`lib/payload-seed-recorder/`), creates her trip documents as Mingla trips,
  her archive and reviews through the history and review imports, the site
  through Studio's REST API, then validates and publishes. Intermediates go to
  `YS_PRIVATE_DIR` (default `~/.mingla-private/2829`). Needs functions, Studio
  and the runtime running; re-runs reuse uploads (`--reupload-media` forces
  fresh ones, `--skip-core` leaves Core alone).
- `mingla-sites/e2e/ys-parity/run.sh` captures the 12 parity pages against the
  private baselines (outputs to `~/.mingla-private/2829/parity-runs/`, never
  the repository). Run it against a production build of the runtime.
- The public CI goldens: `npm run goldens:render` in `mingla-sites`, then run
  `e2e/goldens/goldens.mjs` inside `mcr.microsoft.com/playwright:v1.64.0-noble`
  (see the header of that file); `--update` rewrites them for review.

## A brand's own domain (#2829 W8)

Locally the domain flow uses the local domain provider, the local DNS resolver
and a probe of the local runtime, all driven by `public.brand_site_local_domain_states`
(created only by the local seed and `scripts/sites/local/domain-state.mjs`,
both of which refuse any database whose Sites service row is not `local`; no
migration creates it). Never edit `/etc/hosts` or Mac network settings.

```bash
# The runtime must answer for the test domain (local mode serves only listed extra hosts).
SITES_LOCAL_EXTRA_HOSTS=youngandstamped.test scripts/sites/local/run-local-sites.sh --prod
# supabase/functions/.env.local carries SITES_LOCAL_PROBE_ORIGIN (generate-local-keys.mjs).

# Simulate the owner's DNS: verified + configured, a registrar's nameservers, email records.
node scripts/sites/local/domain-state.mjs --host youngandstamped.test --verified --configured \
  --ns dns1.registrar-servers.com,dns2.registrar-servers.com --mx mx1.mail.test
# Drift: --misconfigured (two checks in a row flag it); --age-misconfigured-days 8 then a
# check makes the Mingla address the main one again. Email records gone: --no-mx.
```

Attach, check, make primary and disconnect from the Business app (Website, then
Your addresses) or `brand-site-domains` directly; open the domain in a browser
with `--host-resolver-rules="MAP youngandstamped.test 127.0.0.1"` (Playwright /
Chromium) and port 3100.

## Business web against the local stack

```bash
scripts/sites/local/run-business-web.sh --port 8190   # Expo web on http://localhost:8190
# Sign in: Continue with Email, type a seeded email, Send code, then:
node scripts/sites/local/business-web.mjs code brand_owner   # prints a 6-digit code
```

The script writes `scripts/sites/local/.state/business-web.env` (loopback Core
URL and anon key, the Sites flag on, Studio at `http://localhost:3101`, a
placeholder `pk_test_` key, PostHog and Sentry off), exports it over
`mingla-business/.env` and starts Expo. Keep that file out of `mingla-business/`:
Metro bundles a `.env.*` file it finds there and the web bundle fails.
`app.config.js` fails any EAS or Vercel build that carries the Studio override or
a loopback Supabase URL. The local stack sends no email, so codes come from the
helper (only for `@local.invalid` seed users). The first Website screen load can
take 30 s or more while edge workers boot. Studio's "Return to Mingla" and the
preview's close/publish links go to `SITES_LOCAL_BUSINESS_ORIGIN` (written into
`mingla-site-cms/.env.local` by `generate-local-keys.mjs`, default
`http://localhost:8190`, loopback only); a different Business web port needs
`SITES_LOCAL_BUSINESS_WEB_PORT` set when the keys are generated.

## Tear-down

```bash
# Ctrl-C in the run-local-sites.sh terminal stops functions, Studio and runtime
scripts/sites/local/stop-local-sites.sh          # stop both stacks, keep data
scripts/sites/local/stop-local-sites.sh --wipe   # also drop volumes, keys, env files, seed users
```

The stop script only stops the two project ids above. Never run
`docker system prune` or stop containers you did not start: other chats run
their own stacks and databases on this Mac.

## Traps

- A preview someone else is looking at must run with `--frozen`
  (`scripts/sites/local/run-local-sites.sh --prod --frozen`). Without it,
  `supabase functions serve` serves the live `supabase/functions` tree and
  restarts the edge runtime on ANY change there, so ordinary code edits in the
  checkout take the preview down. 2026-10-26: edits during W8 restarted the
  runtime under Seth's Young & Stamped preview; cold workers timed out, the
  runtime got "not found" from Core and showed "Website not available" with
  photos and videos missing until it recovered by itself (~15 min).
  `--frozen` serves `git archive HEAD supabase/functions packages` from
  `~/.mingla-sites-local/<checkout>-<hash>/frozen-<sha>/`; uncommitted edits
  are not served, and a new commit needs a restart of the run script to be
  served. Generated workdirs never live inside the checkout: a snapshot copies
  every test and `*.ci-suite.json`, and in-tree copies broke CI discovery and
  the ci-discovery jest suites (#2829 W11). `SITES_LOCAL_STACKS_DIR` overrides
  the location and is refused if it points inside the repository.
- `next dev` (Next 16) writes an untracked `AGENTS.md` and rewrites
  `next-env.d.ts` in each app. `run-local-sites.sh` removes the one and
  restores the other on exit, along with `mingla-site-cms/src/payload-types.ts`
  (Payload's dev server regenerates it); if a run is killed hard, restore them with
  `git checkout -- mingla-sites/next-env.d.ts mingla-site-cms/next-env.d.ts mingla-site-cms/src/payload-types.ts`
  and delete `mingla-sites/AGENTS.md` / `mingla-site-cms/AGENTS.md`.
- Core migrations are applied by `psql` replay, not by the Supabase CLI: the
  repository has files sharing a version prefix, which the CLI's ledger
  rejects. Applied files are recorded in `sites_local.applied_migrations` on
  the local database; `--reset` starts again from an empty database.
- If Docker cannot pull images (`lookup public.ecr.aws ... i/o timeout`), the
  Docker VM behind `DOCKER_HOST` has lost DNS. Use (or restart) the dedicated
  colima profile; do not change the Mac's own network settings.
- Edge functions run inside Docker, where `localhost` is the container itself.
  The local service row therefore points Core at Studio through the Docker
  host gateway, `http://host.docker.internal:3101`. Only a local row may hold
  that origin; the database and `brand-site-control` refuse it on a
  production row.
- After a colima VM restart the name `host.docker.internal` may not resolve
  inside the edge-runtime container (its `/etc/hosts` has no entry and the
  VM's resolver does not know it), and every Core → Studio call ends in
  `SERVICE_TEMPORARILY_UNAVAILABLE` after about 8 s, with no request in
  Studio's log. Check with `docker exec supabase_edge_runtime_mingla-sites-core-local getent hosts host.docker.internal`;
  if it prints nothing, add the VM's host address (`host.lima.internal`,
  usually `192.168.5.2`; `colima ssh -p mingla-2829 -- getent hosts host.lima.internal`)
  to that container's `/etc/hosts` as root. The entry lasts until the
  container is recreated.
  `supabase functions serve` recreates the container when shared function
  code changes, so the entry has to be added again after such an edit.
  Since #2829 W9a `run-local-sites.sh` does this automatically: a watcher
  checks the edge container every 5 s and adds the entry (from
  `host.lima.internal` on the `SITES_LOCAL_COLIMA_PROFILE` profile, default
  `mingla-2829`, else `192.168.5.2`) and logs `added host.docker.internal`;
  the manual step is only needed when the stack was started another way.
- After a colima VM restart the VM's own resolver (`192.168.5.4`) can time
  out, so image pulls and the edge runtime's first imports fail with a DNS
  error (`supabase start` stops at the health check). Point the VM at public
  resolvers for the session:
  `colima ssh -p mingla-2829 -- sudo sh -c 'printf "nameserver 1.1.1.1\nnameserver 8.8.8.8\n" > /etc/resolv.conf'`
  (inside the VM only; colima rewrites the file on its next start).
