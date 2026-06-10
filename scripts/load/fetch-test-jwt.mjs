#!/usr/bin/env node
/**
 * #426 — Obtain LOAD_TEST_USER_JWT for k6 agent-chat scripts.
 *
 * Requires: SUPABASE_URL (or derivable from LOAD_BASE_URL), SUPABASE_ANON_KEY,
 *           LOAD_TEST_EMAIL, LOAD_TEST_PASSWORD
 */

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing env: ${name}`);
    process.exit(1);
  }
  return v;
}

function supabaseUrlFromEnv() {
  if (process.env.SUPABASE_URL) {
    return process.env.SUPABASE_URL.replace(/\/$/, "");
  }
  const base = process.env.LOAD_BASE_URL;
  if (base && base.includes("/functions/v1")) {
    return base.replace(/\/functions\/v1\/?$/, "");
  }
  console.error("Set SUPABASE_URL or LOAD_BASE_URL (…/functions/v1)");
  process.exit(1);
}

async function main() {
  const url = supabaseUrlFromEnv();
  const anonKey = requireEnv("SUPABASE_ANON_KEY");
  const email = requireEnv("LOAD_TEST_EMAIL");
  const password = requireEnv("LOAD_TEST_PASSWORD");

  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    console.error("Auth failed:", body.error_description || body.msg || res.status);
    process.exit(1);
  }

  console.log(`export LOAD_TEST_USER_JWT='${body.access_token}'`);
  if (body.expires_in) {
    console.error(`# Token expires in ${body.expires_in}s`);
  }
}

main();
