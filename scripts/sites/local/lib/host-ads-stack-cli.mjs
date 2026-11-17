#!/usr/bin/env node
// #4238 rework 2 — the small checks start-host-ads-stack.sh runs (see host-ads-stack.mjs).
//   check-ports <port>...                         refuse a reserved or malformed port
//   write-identity <path> <project> <api> <db> <db_url> <token>
//   verify <path>                                 read the token back through the host port

import { HOST_ADS_RESERVED_PORTS, assertHostAdsTarget, readHostAdsIdentity, verifyHostAdsStack } from "./host-ads-stack.mjs";
import { writePrivate } from "./local-state.mjs";

function fail(message) {
  process.stderr.write(`FAIL host-ads-stack: ${message}\n`);
  process.exit(2);
}

const [command, ...rest] = process.argv.slice(2);
try {
  if (command === "check-ports") {
    if (rest.length === 0) fail("no ports given");
    const seen = new Set();
    for (const raw of rest) {
      const port = Number(raw);
      if (!Number.isInteger(port) || port < 1024 || port > 65535) fail(`port ${raw} is not a usable port`);
      if (HOST_ADS_RESERVED_PORTS.includes(port)) {
        fail(`port ${port} belongs to the shared Sites stack another chat uses (${HOST_ADS_RESERVED_PORTS.join("/")}); use the Host ads defaults or HOST_ADS_STACK_*_PORT`);
      }
      if (seen.has(port)) fail(`port ${port} is given twice`);
      seen.add(port);
    }
  } else if (command === "write-identity") {
    const [path, projectId, apiPort, dbPort, dbUrl, token] = rest;
    const identity = { project_id: projectId, api_port: Number(apiPort), db_port: Number(dbPort), db_url: dbUrl, token };
    assertHostAdsTarget(dbUrl, identity);
    writePrivate(path, `${JSON.stringify(identity, null, 2)}\n`);
    readHostAdsIdentity(path);
  } else if (command === "verify") {
    const identity = readHostAdsIdentity(rest[0]);
    verifyHostAdsStack(assertHostAdsTarget(identity.db_url, identity), identity);
  } else {
    fail(`unknown command ${command ?? ""}`);
  }
} catch (error) {
  fail(error.message);
}
