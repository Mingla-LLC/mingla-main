#!/usr/bin/env node
import fs from "node:fs";

const target = "supabase/functions/notify-message/index.ts";
const source = fs.readFileSync(target, "utf8");

const fnStart = source.indexOf("async function handleUnifiedMention");
if (fnStart === -1) {
  console.error(`VIOLATION: ${target}: handleUnifiedMention not found. ORCH-0908 mention mute gate cannot verify the invariant.`);
  process.exit(1);
}

const nextFn = source.indexOf("\nserve(async", fnStart);
const body = source.slice(fnStart, nextFn === -1 ? source.length : nextFn);

if (!body.includes("notifications_muted")) {
  console.error(
    `VIOLATION: ${target}: handleUnifiedMention must query conversation_participants.notifications_muted before dispatching mention pushes. Cross-reference I-PROPOSED-CHAT-MENTION-MUTE-RESPECTED.`,
  );
  process.exit(1);
}

if (!body.includes("skipPush") && !body.includes("suppressPush")) {
  console.error(
    `VIOLATION: ${target}: muted mentioned users must preserve the in-app notification row while suppressing push via skipPush/suppressPush.`,
  );
  process.exit(1);
}

console.log("PASS: ORCH-0908 handleUnifiedMention respects notifications_muted and preserves in-app notification dispatch.");
