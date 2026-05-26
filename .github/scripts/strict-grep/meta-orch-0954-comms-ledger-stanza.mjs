import { existsSync, readFileSync } from 'node:fs';

// META-ORCH-0954: every operator-facing agent/skill definition that ENTERS the
// pipeline must carry the comms-ledger-read stanza + the 2-section output template.
//
// IMPORTANT — gitignore reality (codified 2026-05-25 after `ffa816d37 chore: untrack
// .claude/skills/*/SKILL.md per .gitignore rule`):
//
//   .gitignore lines 49-50 exclude `.claude/` AND `.codex/` from the repo. Both
//   Claude SKILL.md and Codex SKILL.md files are operator-local agent definitions
//   that ship with developer machines, not the repo. CI checkouts on Ubuntu runners
//   do NOT see those files.
//
//   Therefore the only file this CI gate can verify is the tracked top-level
//   AGENTS.md (the canonical Codex agent contract that lives at repo root and
//   IS checked in). The 9 `.claude/skills/*/SKILL.md` + 6 `.codex/skills/*/SKILL.md`
//   files are enforced via developer discipline + the standing memory rule
//   `feedback_comms_ledger_required.md` + skill-author review, not CI.
//
//   The existsSync guard below is belt-and-braces for any future tracked file
//   that's later removed from the repo without a corresponding TARGETS update.
const TARGETS = [
  'AGENTS.md',
];

const SKIPPED_GITIGNORED = [
  '.claude/skills/*/SKILL.md (gitignored — Claude agent definitions are operator-local)',
  '.codex/skills/*/SKILL.md (gitignored — Codex agent definitions are operator-local)',
];

const REQUIRED_LEDGER_HEADING = '## Read the Comms Ledger on entry (MANDATORY)';
const REQUIRED_2SECTION_HEADING = '## Standardized 2-Section Output (MANDATORY, every response, every turn)';

const failures = [];
let checked = 0;

for (const target of TARGETS) {
  if (!existsSync(target)) {
    console.warn(`META-ORCH-0954: SKIP missing target ${target} (not in repo).`);
    continue;
  }
  checked += 1;
  const text = readFileSync(target, 'utf8');
  if (!text.includes(REQUIRED_LEDGER_HEADING)) {
    failures.push(`${target}: missing ledger stanza`);
  }
  if (!text.includes(REQUIRED_2SECTION_HEADING)) {
    failures.push(`${target}: missing 2-section template`);
  }
}

if (failures.length) {
  console.error('META-ORCH-0954 stanza enforcement FAILED:');
  failures.forEach((failure) => console.error(`  - ${failure}`));
  process.exit(1);
}

console.log(`META-ORCH-0954 stanza enforcement PASSED for ${checked} tracked file(s).`);
console.log(`Gitignored skill paths (intentionally NOT CI-enforced):`);
SKIPPED_GITIGNORED.forEach((p) => console.log(`  - ${p}`));
