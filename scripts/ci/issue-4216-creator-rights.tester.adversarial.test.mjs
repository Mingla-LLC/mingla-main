import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const migration = read('supabase/migrations/20280221004216_issue_4216_creator_rights.sql');
const program = read('app-mobile/src/services/creatorProgramService.ts');
const creatorContract = read('app-mobile/app/creator/contract/[contractId].tsx');
const hostContract = read('mingla-business/src/components/creators/screens/HostGigContractScreen.tsx');

assert.match(migration, /creator_agreement_acceptance_immutable/);
assert.match(migration, /creator_agreement_version_immutable/);
assert.match(migration, /agreement_version_not_current/);
assert.match(migration, /REVOKE ALL ON FUNCTION public\.issue_4216_creator_has_current_agreement\(uuid\)\s+FROM PUBLIC,anon,authenticated/);
assert.match(migration, /ENABLE ALWAYS TRIGGER issue_4216_gig_rights_guard/);
assert.match(migration, /ENABLE ALWAYS TRIGGER issue_4216_contract_rights_guard/);
assert.match(migration, /ENABLE ALWAYS TRIGGER issue_4216_terms_rights_guard/);
assert.match(migration, /current_setting\('issue4216\.host_rights_accepted',true\)<>'on'/);
assert.match(migration, /creator_agreement_acceptance_id IS NOT NULL/);
assert.match(migration, /creator_rights_accepted_at IS NOT NULL/);
assert.match(migration, /h\.status='released'/);
assert.match(migration, /contract_rights_activation_immutable/);
assert.match(migration, /creator_rights_activation_failed/);
assert.match(migration, /v_active:=v\.rights_activated_at IS NOT NULL/);
assert.match(migration, /creator_rights_not_negotiable/);
assert.match(migration, /gig_rights_status\(j\.contract_id\)->>'status'='active'/);

assert.doesNotMatch(program, /signAgreement:\s*\(version:/);
assert.match(program, /p_includes_usage_days: 90/);
assert.match(creatorContract, /full Creator fee was released/);
assert.match(creatorContract, /not granted for this gig/);
assert.match(hostContract, /Download unlocks only after the full Creator fee is released/);
assert.match(hostContract, /perpetualRightsActive\s*\?\s*\(\s*<Button/);

console.log('PASS #4216 adversarial rights gates');
