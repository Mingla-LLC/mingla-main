import { existsSync, readFileSync } from 'node:fs';

// META-ORCH-0954: every operator-facing agent/skill definition that ENTERS the
// pipeline must carry the chat-coordination stanza + the 2-section output template.
// (Originally the comms-ledger-read stanza; re-pinned by #3476, see below. The
// filename and MANIFEST.json job key keep their historical name.)
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
//   files are enforced via developer discipline + skill-author review, not CI
//   (since #3476 they must carry the same coordination protocol as AGENTS.md).
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

// Issue #974 (2026-07-19): the first comms ledger was replaced by a COMMS table and
// the long-form 2-section template compressed into "## Response style".
// Issue #3476 (2026-09-17): the COMMS table itself is retired. Chats now message
// each other directly (start / blocked / done), with the GitHub issue as the
// Claude<->Codex channel, and binding rules live in "## Standing holds". The
// contract keeps its substance: every agent must follow the coordination protocol
// on entry and answer in the two-section format; the required heading moved.
const REQUIRED_COORDINATION_HEADING = '## Coordinate with other chats (MANDATORY)';
const REQUIRED_STANDING_HOLDS_HEADING = '## Standing holds';
const REQUIRED_2SECTION_HEADING = '## Response style';

const failures = [];
let checked = 0;

for (const target of TARGETS) {
  if (!existsSync(target)) {
    console.warn(`META-ORCH-0954: SKIP missing target ${target} (not in repo).`);
    continue;
  }
  checked += 1;
  const text = readFileSync(target, 'utf8');
  if (!text.includes(REQUIRED_COORDINATION_HEADING)) {
    failures.push(`${target}: missing coordination stanza \`${REQUIRED_COORDINATION_HEADING}\``);
  }
  if (!text.includes(REQUIRED_STANDING_HOLDS_HEADING)) {
    failures.push(`${target}: missing \`${REQUIRED_STANDING_HOLDS_HEADING}\` section`);
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
