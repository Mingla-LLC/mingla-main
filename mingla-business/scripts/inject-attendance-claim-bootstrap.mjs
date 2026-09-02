#!/usr/bin/env node

import {
  existsSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

const DEFAULT_HTML_PATH = "dist/index.html";
const MARKER = "mingla-attendance-claim-pre-router";
const HANDOFF_KEY = "__minglaAttendanceClaimFragment";
const BOOTSTRAP_SOURCE =
  `(()=>{const w=window,l=w.location,h=w.history;if(l.pathname!=="/attendance/claim"||l.hash==="")return;const f=l.hash.slice(1),u=l.pathname+l.search,s=h.state,v=Object.freeze({fragment:f,cleanUrl:u,historyState:s});Object.defineProperty(w,"${HANDOFF_KEY}",{value:v,writable:false,enumerable:false,configurable:true});h.replaceState(s,"",u);})();`;
const BOOTSTRAP_TAG = `<script id="${MARKER}">${BOOTSTRAP_SOURCE}</script>`;

const invariant = (condition, message) => {
  if (!condition) throw new Error(message);
};

const occurrences = (source, needle) =>
  source.split(needle).length - 1;

const inspectShell = (html) => {
  invariant(typeof html === "string" && html.length > 0, "HTML is empty");
  const htmlOpen = html.search(/<html(?:\s[^>]*)?>/i);
  const headMatch = /<head(?:\s[^>]*)?>/i.exec(html);
  const headOpen = headMatch?.index ?? -1;
  const headInsert = headMatch === null ? -1 : headOpen + headMatch[0].length;
  const headClose = html.search(/<\/head\s*>/i);
  const bodyOpen = html.search(/<body(?:\s[^>]*)?>/i);
  const bodyClose = html.search(/<\/body\s*>/i);
  const htmlClose = html.search(/<\/html\s*>/i);
  invariant(
    htmlOpen >= 0 && headOpen > htmlOpen && headInsert > headOpen &&
      headClose > headInsert && bodyOpen > headClose &&
      bodyClose > bodyOpen && htmlClose > bodyClose,
    "HTML shell is malformed or missing the head injection anchor",
  );
  const applicationScripts = [
    ...html.matchAll(/<script\b[^>]*\bsrc=(?:"[^"]+"|'[^']+')[^>]*>/gi),
  ];
  invariant(applicationScripts.length > 0, "HTML shell has no application script anchor");
  return {
    headInsert,
    firstApplicationScript: applicationScripts[0].index,
  };
};

const verifyInjectedShell = (html) => {
  const shell = inspectShell(html);
  invariant(occurrences(html, MARKER) === 1, "bootstrap marker must occur exactly once");
  const bootstrapIndex = html.indexOf(BOOTSTRAP_TAG);
  invariant(bootstrapIndex >= 0, "bootstrap marker is missing or conflicting");
  invariant(
    bootstrapIndex < shell.firstApplicationScript,
    "bootstrap must precede every application script",
  );
};

const inject = (html) => {
  const shell = inspectShell(html);
  const markerCount = occurrences(html, MARKER);
  if (markerCount !== 0) {
    invariant(markerCount === 1, "duplicate bootstrap marker");
    verifyInjectedShell(html);
    return html;
  }
  const injected =
    `${html.slice(0, shell.headInsert)}${BOOTSTRAP_TAG}${html.slice(shell.headInsert)}`;
  verifyInjectedShell(injected);
  return injected;
};

const htmlPath = resolve(process.argv[2] ?? DEFAULT_HTML_PATH);
const temporaryPath = `${htmlPath}.attendance-claim.tmp`;

try {
  invariant(existsSync(htmlPath), "exported dist/index.html is missing");
  const original = readFileSync(htmlPath, "utf8");
  const injected = inject(original);
  if (injected !== original) {
    writeFileSync(temporaryPath, injected, "utf8");
    renameSync(temporaryPath, htmlPath);
  }
  const written = readFileSync(htmlPath, "utf8");
  verifyInjectedShell(written);
  console.log("[attendance-claim-bootstrap] exported HTML verified");
} catch (error) {
  console.error(
    `[attendance-claim-bootstrap] failed closed: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exit(1);
}
