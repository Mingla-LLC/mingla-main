// #2829 W7b — run a brand's existing Payload seed against an in-memory
// recorder and write what it WOULD have created (documents, globals, files it
// would have uploaded) as JSON. Nothing is written anywhere but `--out`.
//
//   node --experimental-strip-types --no-warnings --import ./register.mjs \
//     extract.mjs --source <dir> --seed <module> --export <fn> \
//     [--module <module> ...] --out <file>
//
// `--module` modules are imported and their JSON-serialisable exports dumped
// too. Every path is relative to --source. The source is only read.

import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

function args(argv) {
  const out = { modules: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--module") out.modules.push(value);
    else if (["--source", "--seed", "--export", "--out"].includes(flag)) out[flag.slice(2)] = value;
    else throw new Error(`UNKNOWN_ARGUMENT:${flag}`);
    i += 1;
  }
  for (const key of ["source", "seed", "export", "out"]) if (!out[key]) throw new Error(`MISSING_ARGUMENT:${key}`);
  return out;
}

function makeRecorder() {
  let next = 1;
  const documents = [];
  const globals = {};
  const byCollection = new Map();
  const recorder = {
    documents,
    globals,
    async find({ collection }) {
      void collection;
      return { docs: [], totalDocs: 0, hasNextPage: false };
    },
    async create({ collection, data, filePath }) {
      const id = next;
      next += 1;
      const doc = { collection, id, data: data ?? {}, file: filePath ?? null };
      documents.push(doc);
      if (!byCollection.has(collection)) byCollection.set(collection, new Map());
      byCollection.get(collection).set(id, doc);
      return { id, ...(data ?? {}) };
    },
    async update({ collection, id, data }) {
      const doc = byCollection.get(collection)?.get(id);
      if (doc) Object.assign(doc.data, data ?? {});
      return { id, ...(data ?? {}) };
    },
    async delete() {
      return { docs: [] };
    },
    async updateGlobal({ slug, data }) {
      globals[slug] = { ...(globals[slug] ?? {}), ...(data ?? {}) };
      return globals[slug];
    },
    async findGlobal({ slug }) {
      return globals[slug] ?? {};
    },
  };
  return recorder;
}

function jsonSafe(value, seen = new WeakSet()) {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return value;
  if (value === undefined || typeof value === "function" || typeof value === "symbol") return undefined;
  if (typeof value !== "object") return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => jsonSafe(item, seen) ?? null);
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    const safe = jsonSafe(item, seen);
    if (safe !== undefined) out[key] = safe;
  }
  return out;
}

const options = args(process.argv.slice(2));
const source = resolve(options.source);
if (!existsSync(source)) throw new Error("SOURCE_MISSING");
const recorder = makeRecorder();
globalThis.__payloadSeedRecorder = recorder;
const silent = console.log;
console.log = () => {};
const modules = {};
try {
  for (const name of options.modules) {
    modules[name] = jsonSafe({ ...(await import(pathToFileURL(resolve(source, name)).href)) });
  }
  const seedModule = await import(pathToFileURL(resolve(source, options.seed)).href);
  const run = seedModule[options.export];
  if (typeof run !== "function") throw new Error("SEED_EXPORT_MISSING");
  await run({});
} finally {
  console.log = silent;
}
writeFileSync(
  options.out,
  `${JSON.stringify({ schema: 1, documents: recorder.documents, globals: recorder.globals, modules }, null, 1)}\n`,
  { mode: 0o600 },
);
process.stdout.write(`PAYLOAD_SEED_RECORDED documents=${recorder.documents.length} globals=${Object.keys(recorder.globals).length}\n`);
