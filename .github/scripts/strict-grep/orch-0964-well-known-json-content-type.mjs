#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const failures = [];
const hosts = ["mingla-business", "mingla-marketing"];
const wellKnownSources = [
  "/.well-known/apple-app-site-association",
  "/.well-known/assetlinks.json",
];

const hasJsonHeader = (config, source) =>
  Array.isArray(config.headers) &&
  config.headers.some(
    (entry) =>
      entry?.source === source &&
      Array.isArray(entry.headers) &&
      entry.headers.some(
        (header) =>
          String(header?.key).toLowerCase() === "content-type" &&
          String(header?.value).toLowerCase() === "application/json",
      ),
  );

for (const host of hosts) {
  const vercelPath = join(root, host, "vercel.json");
  const publicRoot = join(root, host, "public/.well-known");
  const hasWellKnown =
    existsSync(join(publicRoot, "apple-app-site-association")) ||
    existsSync(join(publicRoot, "assetlinks.json"));
  if (!hasWellKnown) continue;
  if (!existsSync(vercelPath)) {
    failures.push(`${host}: .well-known files exist but vercel.json is missing`);
    continue;
  }
  const raw = readFileSync(vercelPath, "utf8");
  if (/text\/plain/i.test(raw)) {
    failures.push(`${host}/vercel.json: .well-known must not be text/plain`);
  }
  const config = JSON.parse(raw);
  for (const source of wellKnownSources) {
    if (!hasJsonHeader(config, source)) {
      failures.push(`${host}/vercel.json: missing application/json header for ${source}`);
    }
  }
}

if (failures.length > 0) {
  console.error("ORCH-0964 well-known JSON content-type gate failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("ORCH-0964 well-known JSON content-type gate passed.");
