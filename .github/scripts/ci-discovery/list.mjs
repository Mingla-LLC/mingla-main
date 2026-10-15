#!/usr/bin/env node

import { listLane } from "./load-plan.mjs";

function args(argv) {
  const laneIndex = argv.indexOf("--lane");
  if (laneIndex < 0 || !argv[laneIndex + 1]) throw new Error("ci-discovery:list:missing_lane");
  return { lane: argv[laneIndex + 1], json: argv.includes("--json") };
}
const options = args(process.argv.slice(2));
const entries = listLane(options.lane);
if (options.json) {
  console.log(JSON.stringify({ lane: options.lane, count: entries.length, entries }, null, 2));
} else {
  console.log(`Resolved ${options.lane} plan (${entries.length})`);
  for (const entry of entries) console.log(`${entry.orderKey}\t${entry.profile}\t${entry.path}`);
}
