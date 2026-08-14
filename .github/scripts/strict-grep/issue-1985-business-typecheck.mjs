#!/usr/bin/env node
import { createRequire } from "node:module";
import path from "node:path";

const BUSINESS_ROOT = path.basename(process.cwd()) === "mingla-business"
  ? process.cwd()
  : path.resolve("mingla-business");
const requireFromBusiness = createRequire(
  path.join(BUSINESS_ROOT, "package.json"),
);
const ts = requireFromBusiness("typescript");
const configPath = path.join(BUSINESS_ROOT, "tsconfig.issue-1985.json");
const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
if (configFile.error) {
  console.error(ts.formatDiagnosticsWithColorAndContext([configFile.error], {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => BUSINESS_ROOT,
    getNewLine: () => ts.sys.newLine,
  }));
  process.exit(1);
}

const config = ts.parseJsonConfigFileContent(
  configFile.config,
  ts.sys,
  BUSINESS_ROOT,
  undefined,
  configPath,
);
if (config.errors.length > 0) {
  console.error(ts.formatDiagnosticsWithColorAndContext(config.errors, {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => BUSINESS_ROOT,
    getNewLine: () => ts.sys.newLine,
  }));
  process.exit(1);
}

const SCOPED_FILES = new Set(config.fileNames.map((fileName) => path.resolve(fileName)));
const program = ts.createProgram({
  rootNames: config.fileNames,
  options: config.options,
});
const allDiagnostics = ts.getPreEmitDiagnostics(program);
const blockingDiagnostics = allDiagnostics.filter((diagnostic) =>
  !diagnostic.file || SCOPED_FILES.has(path.resolve(diagnostic.file.fileName))
);

if (blockingDiagnostics.length > 0) {
  console.error(ts.formatDiagnosticsWithColorAndContext(blockingDiagnostics, {
    getCanonicalFileName: (fileName) => path.relative(BUSINESS_ROOT, fileName),
    getCurrentDirectory: () => BUSINESS_ROOT,
    getNewLine: () => ts.sys.newLine,
  }));
  process.exit(1);
}

console.log(
  `issue-1985 Business typecheck PASS: ${SCOPED_FILES.size} scoped files, ` +
    `${allDiagnostics.length} known transitive diagnostics excluded.`,
);
