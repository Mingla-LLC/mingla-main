#!/usr/bin/env node
// #2829 W0 — print WHERE the local Sites stack lives. Names, ports and file
// paths only; never a key, password or token.
import { existsSync, readFileSync } from "node:fs";

import { PORTS, REPO_ROOT, SEED_CREDENTIALS_PATH, SECRETS_PATH } from "./lib/local-state.mjs";

const secrets = existsSync(SECRETS_PATH) ? JSON.parse(readFileSync(SECRETS_PATH, "utf8")) : null;
const lines = [
  "Local Mingla Sites stack (#2829)",
  `  Core API (Supabase):        http://127.0.0.1:${PORTS.coreApi}   db 127.0.0.1:${PORTS.coreDb}`,
  `  Sites CMS API (Supabase):   http://127.0.0.1:${PORTS.cmsApi}   db 127.0.0.1:${PORTS.cmsDb}`,
  `  Studio:                     http://localhost:${PORTS.studio}/admin  (enter through the Business app handoff)`,
  `  Public runtime:             http://<label>.sites.localhost:${PORTS.runtime}/`,
  "  Env files (gitignored):     mingla-sites/.env.local, mingla-site-cms/.env.local, supabase/functions/.env.local",
  `  Seed users + passwords:     ${SEED_CREDENTIALS_PATH.replace(`${REPO_ROOT}/`, "")} (gitignored)`,
];
if (secrets) {
  lines.push(`  gogi fixture site id:       ${secrets.fixtures.gogi_site_id}`);
}
process.stdout.write(`${lines.join("\n")}\n`);
