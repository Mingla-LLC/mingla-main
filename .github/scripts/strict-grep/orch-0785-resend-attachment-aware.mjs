#!/usr/bin/env node
// ORCH-0785-A — Resend POST attachment-aware gate.
//
// Every `fetch("https://api.resend.com/emails"` POST in supabase/functions/**
// must either include `attachments` in the JSON body OR have a
// `// no-attachment: <reason>` comment within 6 lines above the fetch call.
//
// Opt-out: add a `// no-attachment: <reason>` comment on the line immediately
// above the fetch call (or up to 6 lines above) explaining why the email
// carries no PDF/file attachment.

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const ROOT_FNS = path.join(ROOT, "supabase", "functions");
const TARGET = `fetch("https://api.resend.com/emails"`;

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && full.endsWith(".ts")) out.push(full);
  }
  return out;
}

const failures = [];
for (const file of walk(ROOT_FNS)) {
  const text = fs.readFileSync(file, "utf8");
  if (!text.includes(TARGET)) continue;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes(TARGET)) continue;
    // Look forward up to 40 lines for the JSON body — heuristic match on
    // `attachments` token inside the same fetch call block.
    const slice = lines.slice(i, Math.min(i + 40, lines.length)).join("\n");
    const hasAttachments = /attachments\s*:/.test(slice);
    if (hasAttachments) continue;
    // Look backward up to 6 lines for an opt-out comment.
    const before = lines.slice(Math.max(0, i - 6), i).join("\n");
    if (/\/\/\s*no-attachment\s*:/.test(before)) continue;
    failures.push(
      `${path.relative(ROOT, file)}:${
        i + 1
      }: Resend POST missing attachments and no // no-attachment: <reason> opt-out`,
    );
  }
}

if (failures.length > 0) {
  console.error("ORCH-0785-A Resend attachment-aware gate failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("ORCH-0785-A Resend attachment-aware gate passed.");
