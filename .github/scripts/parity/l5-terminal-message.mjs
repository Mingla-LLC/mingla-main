#!/usr/bin/env node
// #2591 L-5 — read a suite file's TERMINAL assertion message out of the file itself.
//
// The message is never hardcoded anywhere. L-5 asserts that a deliberately
// falsified database makes psql fail *with this exact text*, and that is what
// makes the leg self-checking: if a mutation trips an EARLIER assertion, psql
// stops with that assertion's message instead, the match fails, and the proof is
// refused rather than banked. A hardcoded expectation could not do that.
//
// Only ONE of the seventeen assertion-bearing files ends on a labelled
// RAISE EXCEPTION (`[CASE D]`, M-1173-02b); the other sixteen end on an
// unlabelled message. So the match is on the message TEXT, not on a label — the
// SPEC's "last labelled RAISE EXCEPTION" is not expressible against these files.
//
// What is printed is the literal's invariant PREFIX: everything before the first
// `%` placeholder, since the interpolated values vary per run. That prefix is
// what psql puts on stderr after `ERROR:  `.

import fs from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("usage: l5-terminal-message.mjs <suite-file.sql>");
  process.exit(2);
}
const text = fs.readFileSync(file, "utf8");

// Every RAISE EXCEPTION site, with its message literal. The literal may sit on
// the same line or on the next one, and may be split across concatenated lines.
const sites = [...text.matchAll(/RAISE\s+EXCEPTION\s*(?:\r?\n\s*)?'((?:[^']|'')*)'/g)];
if (sites.length === 0) {
  // race_a / race_b carry none at all. Their verdict is rendered by the assert
  // file that reads their outcome, and L-5 covers them that way instead.
  console.error(`${file}: no RAISE EXCEPTION site — not an L-5 subject`);
  process.exit(3);
}
const literal = sites[sites.length - 1][1].replace(/''/g, "'");
const prefix = literal.split("%")[0].trim();
if (prefix.length < 12) {
  console.error(`${file}: terminal message prefix "${prefix}" is too short to match on safely`);
  process.exit(4);
}
process.stdout.write(prefix);
