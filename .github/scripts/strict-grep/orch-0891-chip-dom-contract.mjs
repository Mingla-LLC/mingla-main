#!/usr/bin/env node

/**
 * I-CHIP-DOM-CONTRACT (ORCH-0891 invariant).
 *
 * Web composer chip Tiptap nodes (in `tiptapNodes/`) MUST emit DOM
 * matching the canonical class names defined in `composerChipHtml.ts`:
 *   - `mingla-event-chip` for event chips
 *   - `mingla-personalization-chip` for personalization chips
 *   - `mingla-chip-glyph` for the ▣ glyph inside event chips
 *
 * If a Tiptap node renders with a different class name, the existing
 * `composerChipHtml.ts` `COMPOSER_CHIP_CSS` (injected into the editor
 * via `richEditor.tsx`) won't apply — chips render as unstyled inline
 * spans, breaking pixel parity with native pell.
 *
 * Scope: mingla-business/src/components/marketing/ComposerV2/tiptapNodes/**\/*.ts
 *
 * Verification: every file in scope must contain BOTH the literal
 * `class: "mingla-event-chip"` OR `class: "mingla-personalization-chip"`
 * (whichever matches the file name) AND `contenteditable: "false"`.
 *
 * Cross-references:
 *   - SPEC_ORCH-0891 §5 (new invariants)
 *   - composerChipHtml.ts (canonical CSS contract)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

const TARGET_ROOT =
  "mingla-business/src/components/marketing/ComposerV2/tiptapNodes";

// File-name → required class-name token map. Each Tiptap node file must
// include the matching canonical class string in its source.
const NODE_FILE_CONTRACTS = [
  {
    pattern: /^EventChip\.web\.ts$/,
    requiredClass: "mingla-event-chip",
    requiredGlyph: "mingla-chip-glyph",
  },
  {
    pattern: /^EventChipResizable\.web\.tsx$/,
    requiredClass: "mingla-event-chip",
    requiredGlyph: "mingla-chip-glyph",
  },
  {
    pattern: /^PersonalizationChip\.web\.ts$/,
    requiredClass: "mingla-personalization-chip",
    requiredGlyph: null, // personalization chips don't need a glyph
  },
];

const violations = [];
let filesScanned = 0;

const targetAbs = path.join(repoRoot, TARGET_ROOT);

function checkFile(file) {
  const name = path.basename(file);
  const contract = NODE_FILE_CONTRACTS.find((c) => c.pattern.test(name));
  if (contract === undefined) return; // not a contract-bound file
  filesScanned++;
  const source = fs.readFileSync(file, "utf8");
  if (!source.includes(contract.requiredClass)) {
    violations.push({
      file: path.relative(repoRoot, file),
      reason: `missing required class name "${contract.requiredClass}"`,
    });
  }
  // Every chip must mark the rendered DOM as `contenteditable="false"` so the
  // editor treats it as atomic. Accept three source forms:
  //   - HTML attr:        `contenteditable="false"` (Tiptap renderHTML attrs)
  //   - Object literal:   `contenteditable: "false"` (Tiptap mergeAttributes)
  //   - React JSX prop:   `contentEditable={false}` OR `contentEditable="false"`
  //                       (React NodeView wrappers — ORCH-0891 M2)
  // React's camelCase form gets compiled to the lowercase HTML attribute at
  // render time, so all forms produce the same DOM output the backspace
  // handler relies on.
  const hasContentEditableFalse =
    source.includes(`contenteditable: "false"`) ||
    source.includes(`contenteditable="false"`) ||
    source.includes(`contentEditable={false}`) ||
    source.includes(`contentEditable="false"`);
  if (!hasContentEditableFalse) {
    violations.push({
      file: path.relative(repoRoot, file),
      reason: `missing contenteditable="false" (chips must be atomic — required for backspace handler)`,
    });
  }
  if (contract.requiredGlyph !== null && !source.includes(contract.requiredGlyph)) {
    violations.push({
      file: path.relative(repoRoot, file),
      reason: `missing required glyph class name "${contract.requiredGlyph}" (▣ marker is part of the visual contract)`,
    });
  }
}

try {
  const entries = fs.readdirSync(targetAbs, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile()) {
      checkFile(path.join(targetAbs, entry.name));
    }
  }
} catch (err) {
  // If the directory doesn't exist yet (e.g., before M1 ships), gate passes
  // with zero files scanned — that's fine because there's no Tiptap node
  // file to violate the contract.
  if (err.code !== "ENOENT") throw err;
}

if (violations.length > 0) {
  console.error("I-CHIP-DOM-CONTRACT violation (ORCH-0891):");
  console.error(
    "  Tiptap chip node file does NOT emit the canonical class names.",
  );
  console.error(
    "  Without the canonical class, composerChipHtml.ts CSS does not apply",
  );
  console.error("  and chip pixel parity with native pell breaks.");
  console.error("");
  for (const v of violations) {
    console.error(`  ${v.file}  →  ${v.reason}`);
  }
  console.error("");
  console.error(
    `Scanned ${filesScanned} contract-bound file(s); found ${violations.length} violation(s).`,
  );
  process.exit(1);
}

console.log(
  `ORCH-0891 I-CHIP-DOM-CONTRACT OK: scanned ${filesScanned} contract-bound file(s); chip class names + glyph + contenteditable contract satisfied.`,
);
process.exit(0);
