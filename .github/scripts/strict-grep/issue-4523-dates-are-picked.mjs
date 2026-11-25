#!/usr/bin/env node
// MINGLA-INVARIANT: I-4523-DATES-ARE-PICKED | issue #4523 | Every date in Mingla is picked from the shared Mingla calendar (@mingla/calendar or @mingla/calendar-web); no surface renders a typed date, a browser date or datetime-local input, an OS date spinner or dialog, or a showPicker() bridge, and changing month never closes the calendar.
/**
 * issue #4523 — one Mingla calendar: the "dates are picked" gate.
 * Invariant: I-4523-DATES-ARE-PICKED.
 *
 * RULES (a hit is one match of one rule in one file, comments stripped):
 *   1. an `<input>` / `createElement("input")` whose type is date, datetime-local,
 *      month or week (question-type metadata like `{ type: "date", label }` is
 *      NOT an input and is not a hit).
 *   2. `@react-native-community/datetimepicker` imported in a file whose
 *      `<DateTimePicker>` is not provably `mode="time"` (date, datetime, a
 *      dynamic mode, or no mode at all, which defaults to a date).
 *   3. `showPicker(` anywhere.
 *   4. a `placeholder` that teaches a typed date: YYYY, DD/MM, MM/DD.
 *   5. an import of `ui/WebDateTimeInput` (the old browser date/time input).
 *      (`ui/DateField` is the Mingla calendar wrapper since slice 3 and is allowed.)
 *   6. structural: the calendar surface's month-navigation handler must not
 *      mention onChange, onDone, onCancel or onClose (a behavioural jest suite
 *      owns the truth; this pins the wiring).
 *
 * ALLOWLIST: a counted ratchet `{ "<path>": <hits> }` seeded with every hit that
 * exists today. It can only shrink: the gate fails when a listed file has MORE
 * hits than listed, when an unlisted file has a hit, or when a listed file has
 * FEWER hits than listed (so the migration PR must lower the number in the same
 * change). The last slice leaves it `{}`.
 *
 * Time-only fields (`type="time"`, `<DateTimePicker mode="time">`) are allowed.
 * A file that reaches the old browser input ONLY for its time mode is listed by
 * name in TIME_ONLY_EXEMPTIONS with its reason (no directory or pattern
 * exemptions); it is exempt from rule 5 only while every `<WebDateTimeInput>`
 * in it is `type="time"`, and every other rule still applies to it.
 * mingla-site-cms (Payload's own calendar) is out of scope. `--self-test` drives
 * the pure checkers with fixtures.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** Directories scanned, relative to the repo root. `packages/*` is expanded below. */
export const SCAN_ROOTS = [
  "mingla-business/src",
  "mingla-business/app",
  "app-mobile/src",
  "mingla-admin/src",
  "mingla-sites/src",
];

/** Counted ratchet. Only ever lowered. */
export const ALLOWLIST = {
  // #4490 removed the venue menu sheet's browser time input, so its row is gone (ratchet lowered to empty).
};

/**
 * Time-only fields (spec OD-4: times stay their own control). Each entry is one
 * file and why it is time-only. Exempt from rule 5 only while every
 * `<WebDateTimeInput>` in the file is `type="time"`.
 */
export const TIME_ONLY_EXEMPTIONS = {
  "mingla-business/src/components/event/CreatorStep2When.tsx":
    "Event start and end TIMES (single, recurring and each multi-date row); the dates in this step are picked from the Mingla calendar (ui/DateField).",
  "mingla-business/src/components/event/MultiDateOverrideSheet.tsx":
    "Per-date start and end TIME overrides; the date of each occurrence is not edited in this sheet.",
  "mingla-business/src/components/programs/TimeField.tsx":
    "The program time of day field: a time only, with no date part.",
};

/** True when every `<WebDateTimeInput>` in the source is a literal type="time". */
function webDateTimeInputsAreTimeOnly(src) {
  let saw = false;
  for (const tag of jsxOpeningTags(src, "WebDateTimeInput")) {
    saw = true;
    if (!/\btype\s*=\s*(?:\{\s*)?["'`]time["'`]/.test(tag)) return false;
  }
  return saw;
}

const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs)$/;
const DATE_TYPES = "date|datetime-local|month|week";

/** Removes // and block comments, keeping strings intact enough for these regexes. */
export function stripComments(src) {
  let out = "";
  let i = 0;
  let quote = null;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (quote !== null) {
      out += c;
      if (c === "\\") {
        out += n ?? "";
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      out += c;
      i += 1;
      continue;
    }
    if (c === "/" && n === "/") {
      while (i < src.length && src[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && n === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/** Text of a JSX opening tag from `<Name` to its closing `>` (brace-aware). */
function* jsxOpeningTags(src, name) {
  const needle = new RegExp(`<${name}(?![\\w.])`, "g");
  let m;
  while ((m = needle.exec(src)) !== null) {
    let depth = 0;
    let quote = null;
    let j = m.index + m[0].length;
    for (; j < src.length; j += 1) {
      const c = src[j];
      if (quote !== null) {
        if (c === quote && src[j - 1] !== "\\") quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "{") depth += 1;
      else if (c === "}") depth -= 1;
      else if (c === ">" && depth === 0 && src[j - 1] !== "=") break;
    }
    yield src.slice(m.index, j + 1);
  }
}

/** Rule hits for one file. Returns an array of { rule, detail }. */
export function checkSource(relPath, rawSource) {
  const hits = [];
  const src = stripComments(rawSource);

  // 1 — date-typed inputs
  const typedAsDate = new RegExp(`\\btype\\s*=\\s*(?:\\{\\s*)?["'\`](?:${DATE_TYPES})["'\`]`);
  for (const tag of jsxOpeningTags(src, "input")) {
    if (typedAsDate.test(tag)) hits.push({ rule: 1, detail: "<input type=date-like>" });
  }
  const created = new RegExp(
    `createElement\\(\\s*["']input["']\\s*,\\s*\\{[^}]{0,400}?\\btype\\s*:\\s*["'](?:${DATE_TYPES})["']`,
    "g",
  );
  for (const _ of src.matchAll(created)) hits.push({ rule: 1, detail: 'createElement("input", { type: date-like })' });
  // Sites' generic form-field helper: field(label, "date")
  if (/mingla-sites\//.test(relPath)) {
    for (const _ of src.matchAll(/\bfield\([^()]*,\s*["']date["']\s*\)/g)) hits.push({ rule: 1, detail: 'field(..., "date")' });
  }

  // 2 — OS date picker
  if (/from\s*["']@react-native-community\/datetimepicker["']/.test(src)) {
    let sawElement = false;
    for (const tag of jsxOpeningTags(src, "DateTimePicker")) {
      sawElement = true;
      const mode = /\bmode\s*=\s*(\{[^}]*\}|["'][^"']*["'])/.exec(tag);
      const isTime = mode !== null && /^(?:\{\s*)?["'`]time["'`](?:\s*\})?$/.test(mode[1]);
      if (!isTime) hits.push({ rule: 2, detail: `DateTimePicker mode=${mode === null ? "(default date)" : mode[1]}` });
    }
    // Imported but rendered through a wrapper (e.g. React.createElement): still a date picker unless time-only.
    if (!sawElement && /\bmode\s*[:=]\s*["'`](?:date|datetime)["'`]/.test(src)) {
      hits.push({ rule: 2, detail: "datetimepicker imported with a date mode" });
    }
  }

  // 3 — showPicker bridge
  for (const _ of src.matchAll(/\bshowPicker\s*\(/g)) hits.push({ rule: 3, detail: "showPicker(" });

  // 4 — typed-date placeholder
  for (const _ of src.matchAll(/placeholder\s*[=:]\s*\{?\s*["'`][^"'`\n]*(?:YYYY|DD\s*\/\s*MM|MM\s*\/\s*DD)/g)) {
    hits.push({ rule: 4, detail: "typed-date placeholder" });
  }

  // 5 — the old controls (a listed time-only file is exempt while it stays time-only)
  const timeOnlyExempt =
    Object.prototype.hasOwnProperty.call(TIME_ONLY_EXEMPTIONS, relPath) && webDateTimeInputsAreTimeOnly(src);
  const inUiDir = /(^|\/)components\/ui\/[^/]+$/.test(relPath);
  // A type-only import is erased and brings in no control.
  for (const m of src.replace(/import\s+type\s[^;]*;/g, "").matchAll(/(?:from|import|require\()\s*\(?\s*["']([^"']+)["']/g)) {
    const spec = m[1];
    const isOld = /(^|\/)WebDateTimeInput$/.test(spec);
    if (!isOld) continue;
    if (timeOnlyExempt) continue;
    if (/(^|\/)ui\/WebDateTimeInput$/.test(spec) || (inUiDir && /^\.\/WebDateTimeInput$/.test(spec))) {
      hits.push({ rule: 5, detail: `import ${spec}` });
    }
  }

  return hits;
}

/** Rule 6: the surface's month-navigation handler never closes or commits. */
export function checkSurfaceNavigation(surfaceSource) {
  if (surfaceSource === null) return ["packages/calendar/CalendarSurface.tsx is missing (rule 6)"];
  const src = stripComments(surfaceSource);
  const start = src.indexOf("const onNavigateMonth");
  const end = start === -1 ? -1 : src.indexOf("const onNavigateYears", start);
  if (start === -1 || end === -1) return ["CalendarSurface.tsx: onNavigateMonth / onNavigateYears markers not found (rule 6)"];
  const slice = src.slice(start, end);
  return /\b(onChange|onDone|onCancel|onClose)\b/.test(slice)
    ? ["CalendarSurface.tsx: onNavigateMonth mentions onChange/onDone/onCancel/onClose; month navigation must never commit or close (rule 6)"]
    : [];
}

/** Compares per-file hit counts with the ratchet. Pure. */
export function compareWithAllowlist(counts, allowlist) {
  const problems = [];
  for (const [file, count] of Object.entries(counts)) {
    const allowed = allowlist[file];
    if (allowed === undefined) problems.push(`${file}: ${count} date-picking violation(s) and not on the allowlist`);
    else if (count > allowed) problems.push(`${file}: ${count} violation(s), allowlist permits ${allowed}`);
    else if (count < allowed) problems.push(`${file}: now ${count} violation(s) but the allowlist still says ${allowed}; lower it in this change`);
  }
  for (const [file, allowed] of Object.entries(allowlist)) {
    if (counts[file] === undefined && allowed > 0) {
      problems.push(`${file}: allowlisted for ${allowed} but now has 0 hits (or is gone); remove the entry`);
    }
  }
  return problems;
}

function listSources(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return [];
  const out = [];
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "__tests__") continue;
    const child = path.posix.join(rel, entry.name);
    if (entry.isDirectory()) out.push(...listSources(child));
    else if (SOURCE_EXT.test(entry.name) && !/\.test\.[a-z]+$/.test(entry.name)) out.push(child);
  }
  return out;
}

function packageRoots() {
  const abs = path.join(ROOT, "packages");
  return fs
    .readdirSync(abs, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !/^calendar(-|$)/.test(e.name))
    .map((e) => `packages/${e.name}`);
}

export function scanRepo(read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8")) {
  const files = [...SCAN_ROOTS, ...packageRoots()].flatMap(listSources);
  const counts = {};
  for (const rel of files) {
    const hits = checkSource(rel, read(rel));
    if (hits.length > 0) counts[rel] = hits.length;
  }
  return counts;
}

function main() {
if (process.argv.includes("--self-test")) {
  const fail = [];
  const expectHits = (name, file, text, want) => {
    const got = checkSource(file, text).length;
    if ((got > 0 ? 1 : 0) !== want) fail.push(`${name} (got ${got})`);
  };
  expectHits("typed placeholder fails", "mingla-business/src/a.tsx", '<TextInput placeholder="YYYY-MM-DD" />', 1);
  expectHits("DD/MM placeholder fails", "app-mobile/src/a.tsx", "const p = { placeholder: 'DD/MM/YYYY' };", 1);
  expectHits('<input type="date"> fails', "mingla-admin/src/a.jsx", '<input type="date" value={v} />', 1);
  expectHits("datetime-local fails", "mingla-admin/src/a.jsx", "<input\n  className={x}\n  type='datetime-local'\n  onChange={(e) => set(e.target.value)}\n/>", 1);
  expectHits("createElement input date fails", "mingla-business/src/a.tsx", 'React.createElement("input", { type: "date", value })', 1);
  expectHits("showPicker( fails", "mingla-business/src/a.tsx", "el.showPicker();", 1);
  expectHits("date-mode DateTimePicker fails", "mingla-business/src/a.tsx", 'import DateTimePicker from "@react-native-community/datetimepicker";\nconst x = <DateTimePicker mode="date" value={d} onChange={() => 1} />;', 1);
  expectHits("modeless DateTimePicker fails", "mingla-business/src/a.tsx", 'import DateTimePicker from "@react-native-community/datetimepicker";\nconst x = <DateTimePicker value={d} />;', 1);
  expectHits("dynamic-mode DateTimePicker fails", "mingla-business/src/a.tsx", 'import DateTimePicker from "@react-native-community/datetimepicker";\nconst x = <DateTimePicker mode={m} value={d} />;', 1);
  expectHits("import of ui/DateField (the calendar wrapper) passes", "mingla-business/src/a.tsx", 'import { DateField } from "../ui/DateField";', 0);
  expectHits("import of ui/WebDateTimeInput fails", "mingla-business/src/a.tsx", 'import { WebDateTimeInput } from "../../components/ui/WebDateTimeInput";', 1);
  expectHits("a type-only import of ui/DateField passes", "mingla-business/src/a.tsx", 'import type { DateFieldProps } from "../ui/DateField";', 0);
  expectHits('type="time" passes', "mingla-business/src/a.tsx", '<input type="time" value={v} />', 0);
  expectHits("time-only DateTimePicker passes", "mingla-business/src/a.tsx", 'import DateTimePicker from "@react-native-community/datetimepicker";\nconst x = <DateTimePicker mode="time" value={d} onChange={() => 1} />;', 0);
  expectHits("question-type metadata passes", "mingla-business/src/a.tsx", '{ type: "date", label: "Date" }', 0);
  expectHits("a comment mentioning type=date passes", "mingla-business/src/a.tsx", '// <input type="date" />\n/* showPicker( */\nconst a = 1;', 0);
  expectHits("ProgramPickers DateField is not the old control", "app-mobile/src/a.tsx", 'import { DateField } from "../programs/ProgramPickers";', 0);
  expectHits("Sites field(.., date) fails", "mingla-sites/src/a.tsx", 'field("Date", "date")', 1);
  expectHits("Sites field(.., text) passes", "mingla-sites/src/a.tsx", 'field("Name", "text")', 0);

  const allow = { "a.tsx": 2 };
  const cmp = (name, counts, wantProblems) => {
    if ((compareWithAllowlist(counts, allow).length > 0 ? 1 : 0) !== wantProblems) fail.push(name);
  };
  cmp("allowlist count equal passes", { "a.tsx": 2 }, 0);
  cmp("allowlist count up fails", { "a.tsx": 3 }, 1);
  cmp("allowlist count down fails", { "a.tsx": 1 }, 1);
  cmp("unlisted file fails", { "a.tsx": 2, "b.tsx": 1 }, 1);
  cmp("listed file with zero hits fails", {}, 1);

  // #4523 checkpoint 17: custom-form date questions (form-rendering, the Host
  // primitives, the Explorer RSVP / brand-form input) are on the calendar. None
  // of them may be allowlisted again, and each must stay at zero hits.
  const formDateLeaves = [
    "packages/form-rendering/QuestionRenderers.tsx",
    "mingla-business/src/components/checkout/intake/businessFormPrimitives.tsx",
    "app-mobile/src/components/forms/RsvpFormWebDateInput.tsx",
  ];
  for (const leaf of formDateLeaves) {
    if (ALLOWLIST[leaf] !== undefined) fail.push(`${leaf} is allowlisted again`);
    if (fs.existsSync(path.join(ROOT, leaf)) && checkSource(leaf, fs.readFileSync(path.join(ROOT, leaf), "utf8")).length !== 0) {
      fail.push(`${leaf} has a date-picking violation`);
    }
  }
  const rsvpDate = "app-mobile/src/components/forms/RsvpFormWebDateInput.tsx";
  expectHits("a browser date box back in the Explorer form date input fails", rsvpDate, '<input type="date" value={value} onChange={onChange} />', 1);
  if (compareWithAllowlist({ [rsvpDate]: 1 }, ALLOWLIST).length === 0) fail.push("a date box in the Explorer form date input fails the shipped allowlist");
  expectHits(
    "an OS date picker back in the form renderer fails",
    "packages/form-rendering/QuestionRenderers.tsx",
    'import DateTimePicker from "@react-native-community/datetimepicker";\nconst x = <DateTimePicker mode="date" value={d} />;',
    1,
  );

  // #4523 checkpoint 20: time-only exemptions are named files with reasons, never patterns.
  const exempt = "mingla-business/src/components/programs/TimeField.tsx";
  const timeOnlySrc = 'import { WebDateTimeInput } from "../ui/WebDateTimeInput";\nconst a = <WebDateTimeInput type="time" value={v} onChangeValue={set} ariaLabel="Time" />;';
  expectHits("a listed time-only file with only time inputs passes", exempt, timeOnlySrc, 0);
  expectHits(
    "a listed time-only file that gains a date-typed WebDateTimeInput fails",
    exempt,
    timeOnlySrc + '\nconst b = <WebDateTimeInput type="date" value={d} onChangeValue={set} ariaLabel="Day" />;',
    1,
  );
  expectHits(
    "a listed time-only file with a dynamic WebDateTimeInput type fails",
    exempt,
    'import { WebDateTimeInput } from "../ui/WebDateTimeInput";\nconst a = <WebDateTimeInput type={kind} value={v} />;',
    1,
  );
  expectHits("a listed time-only file that gains a browser date box fails", exempt, timeOnlySrc + '\nconst c = <input type="date" />;', 1);
  expectHits(
    "a listed time-only file that gains an OS date picker fails",
    exempt,
    timeOnlySrc + '\nimport DateTimePicker from "@react-native-community/datetimepicker";\nconst d = <DateTimePicker mode="date" value={x} />;',
    1,
  );
  expectHits("the same time-only source in an UNLISTED file still fails (no blanket exemption)", "mingla-business/src/components/other/Clock.tsx", timeOnlySrc, 1);
  for (const [file, reason] of Object.entries(TIME_ONLY_EXEMPTIONS)) {
    if (typeof reason !== "string" || reason.trim().length < 20) fail.push(`${file}: time-only exemption needs a stated reason`);
    if (/[*?[\]]/.test(file) || file.endsWith("/")) fail.push(`${file}: exemptions name one file, never a pattern or directory`);
    if (!fs.existsSync(path.join(ROOT, file))) fail.push(`${file}: exempted file is missing; remove the exemption`);
    else if (!webDateTimeInputsAreTimeOnly(stripComments(fs.readFileSync(path.join(ROOT, file), "utf8")))) {
      fail.push(`${file}: exempted as time-only but has a non-time WebDateTimeInput (or none); remove the exemption`);
    }
    if (ALLOWLIST[file] !== undefined) fail.push(`${file}: both exempted and allowlisted`);
  }

  const goodNav = "const onNavigateMonth = useCallback((delta) => { setVisible(delta); }, []);\n  const onNavigateYears = 1;";
  const badNav = "const onNavigateMonth = useCallback((delta) => { props.onDone(); }, []);\n  const onNavigateYears = 1;";
  if (checkSurfaceNavigation(goodNav).length !== 0) fail.push("clean nav handler passes");
  if (checkSurfaceNavigation(badNav).length === 0) fail.push("nav handler that closes fails");
  if (checkSurfaceNavigation(null).length === 0) fail.push("missing surface fails");

  if (fail.length) {
    console.error(`#4523 dates-are-picked self-test FAIL: ${fail.join("; ")}`);
    process.exit(1);
  }
  console.log("#4523 dates-are-picked self-test PASS");
  process.exit(0);
}

if (process.argv.includes("--print-seed")) {
  console.log(JSON.stringify(scanRepo(), null, 2));
  process.exit(0);
}

const counts = scanRepo();
const problems = compareWithAllowlist(counts, ALLOWLIST);
const surface = path.join(ROOT, "packages/calendar/CalendarSurface.tsx");
problems.push(...checkSurfaceNavigation(fs.existsSync(surface) ? fs.readFileSync(surface, "utf8") : null));
if (problems.length > 0) {
  console.error(`FAIL [I-4523-DATES-ARE-PICKED]: ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  x ${p}`);
  process.exit(1);
}
const total = Object.values(counts).reduce((a, b) => a + b, 0);
console.log(`OK [I-4523-DATES-ARE-PICKED]: ${total} allowlisted hit(s) in ${Object.keys(counts).length} file(s), none new; month navigation never closes.`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
