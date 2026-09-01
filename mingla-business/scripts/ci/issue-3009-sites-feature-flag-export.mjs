#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const buildRoot = path.resolve(
  process.cwd(),
  process.env.ISSUE3009_DIST ?? "dist/_expo/static/js/web",
);

function javascriptFiles(root) {
  if (!fs.existsSync(root)) {
    throw new Error(`#3009 bundle directory is missing: ${root}`);
  }
  const files = [];
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(target);
      if (entry.isFile() && entry.name.endsWith(".js")) files.push(target);
    }
  }
  return files;
}

export function verifyExport(root = buildRoot) {
  const files = javascriptFiles(root);
  if (files.length < 100) {
    throw new Error(
      `#3009 export is partial: found ${files.length} JavaScript chunks; expected at least 100`,
    );
  }
  const sources = files.map((file) => fs.readFileSync(file, "utf8"));
  if (sources.some((source) => source.includes("EXPO_PUBLIC_FF_SITES_ENABLED"))) {
    throw new Error(
      "#3009 Sites flag survived as a dynamic environment lookup in the exported bundle",
    );
  }
  if (
    !sources.some((source) =>
      /sites:[A-Za-z_$][A-Za-z0-9_$]*\("true",!1\)/.test(source),
    )
  ) {
    throw new Error(
      "#3009 enabled Sites flag is missing from the exported production-like bundle",
    );
  }
  return files.length;
}

const chunkCount = verifyExport();
console.log(
  `#3009 Sites feature-flag export PASS (${chunkCount} chunks, static enabled value present, dynamic lookup absent)`,
);
