import { readFileSync } from 'node:fs';

const TARGETS = [
  '.claude/skills/mingla-orchestrator/SKILL.md',
  '.claude/skills/mingla-forensics/SKILL.md',
  '.claude/skills/mingla-implementor/SKILL.md',
  '.claude/skills/mingla-tester/SKILL.md',
  '.claude/skills/mingla-product/SKILL.md',
  '.claude/skills/mingla-designer/SKILL.md',
  '.claude/skills/ui-ux-pro-max/SKILL.md',
  '.claude/skills/mingla-price-tiers/SKILL.md',
  '.claude/skills/mingla-categorizer/SKILL.md',
  'AGENTS.md',
];

const REQUIRED_LEDGER_HEADING = '## Read the Comms Ledger on entry (MANDATORY)';
const REQUIRED_2SECTION_HEADING = '## Standardized 2-Section Output (MANDATORY, every response, every turn)';

const failures = [];

for (const target of TARGETS) {
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

console.log(`META-ORCH-0954 stanza enforcement PASSED for ${TARGETS.length} files.`);
