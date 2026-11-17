#!/usr/bin/env node
// #4238 rework 3 — a 6-digit email sign-in code for THIS worktree's Host ads
// stack, so the native Host app (Apple, Google or email code only; no
// password) can sign in to the seeded brand locally. Local only: it refuses
// any API that is not this stack's loopback port.
//
//   node scripts/sites/local/host-ads-sign-in-code.mjs [--email you@local.invalid]
//       Mints a code with the stack's auth admin API (generate_link). No mail
//       is sent. Type it on the app's "Enter the 6-digit code" screen AFTER
//       asking for a code there (asking again replaces the code).
//   node scripts/sites/local/host-ads-sign-in-code.mjs --inbox [--email ...]
//       Reads the newest code the stack mailed (the app's own "Send code")
//       from the stack's mail catcher (HOST_ADS_STACK_MAIL_PORT, default 56524;
//       web UI http://127.0.0.1:56524).
//
// The email defaults to the seed owner (host-ads-owner@local.invalid).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { STATE_DIR, parseEnvFile } from "./lib/local-state.mjs";
import { HOST_ADS_IDENTITY_PATH, readHostAdsIdentity } from "./lib/host-ads-stack.mjs";

function fail(message) {
  process.stderr.write(`FAIL host-ads-sign-in-code: ${message}\n`);
  process.exit(1);
}

const args = process.argv.slice(2);
let email = "host-ads-owner@local.invalid";
let inbox = false;
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "--email" && args[i + 1]) email = args[++i];
  else if (args[i] === "--inbox") inbox = true;
  else fail(`unknown argument ${args[i]}`);
}

/** The 6-digit code in a mail body, or null. */
function codeFromMail(text) {
  const match = /\b(\d{6})\b/.exec(String(text ?? ""));
  return match ? match[1] : null;
}

let identity;
let status;
try {
  identity = readHostAdsIdentity(process.env.HOST_ADS_IDENTITY_PATH || HOST_ADS_IDENTITY_PATH);
  status = parseEnvFile(readFileSync(resolve(STATE_DIR, "host-ads.status.env"), "utf8"));
} catch (error) {
  fail(`${error.message} (start this worktree's stack with scripts/sites/local/start-host-ads-stack.sh)`);
}
const api = new URL(status.API_URL ?? "");
if (!["127.0.0.1", "localhost"].includes(api.hostname) || Number(api.port) !== Number(identity.api_port)) {
  fail("HOST_ADS_API_NOT_THIS_STACK");
}

if (inbox) {
  const port = Number(process.env.HOST_ADS_STACK_MAIL_PORT || 56524);
  const base = `http://127.0.0.1:${port}`;
  const list = await fetch(`${base}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}&limit=1`).catch(() => null);
  if (!list || !list.ok) fail(`the mail catcher at ${base} did not answer (is the stack running with its mail catcher?)`);
  const found = await list.json();
  const id = found?.messages?.[0]?.ID;
  if (!id) fail(`no mail for ${email} yet: tap "Send code" in the app first`);
  const message = await (await fetch(`${base}/api/v1/message/${id}`)).json();
  const code = codeFromMail(`${message?.Text ?? ""} ${message?.HTML ?? ""}`);
  if (!code) fail("the newest mail has no 6-digit code");
  process.stdout.write(`${code}\n`);
  process.exit(0);
}

const key = status.SERVICE_ROLE_KEY;
const response = await fetch(`${api.origin}/auth/v1/admin/generate_link`, {
  method: "POST",
  headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
  body: JSON.stringify({ type: "magiclink", email }),
});
if (!response.ok) fail(`generate_link answered ${response.status} (is ${email} a user on this stack? run seed-host-ads.mjs)`);
const body = await response.json();
const code = body?.email_otp ?? body?.properties?.email_otp;
if (typeof code !== "string" || !/^\d{6}$/.test(code)) fail("the stack returned no 6-digit code");
process.stdout.write(`${code}\n`);
