import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const migration = read('supabase/migrations/20280221004216_issue_4216_creator_rights.sql');
const explorerAgreement = read('app-mobile/app/creator/setup/agreement.tsx');
const explorerRates = read('app-mobile/app/creator/setup/rates.tsx');
const hostHire = read('mingla-business/src/components/gigs/HireSheet.tsx');
const media = read('supabase/functions/creator-media-status/index.ts');

assert.match(migration, /I-4216-AGREEMENT-SERVER-AUTHORITY/);
assert.match(migration, /I-4216-RIGHTS-AFTER-FULL-RELEASE/);
assert.match(migration, /I-4216-LICENSE-NOT-NEGOTIABLE/);
assert.match(migration, /'creator-v1'/);
assert.match(migration, /5f3a9bf9a3dd9a938b25730f7c2fa5c046ea8151dba5f3c63602c7aaacf23a96/);
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.creator_agreement_sign\(p_date_of_birth date\)/);
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.gig_rights_status\(p_contract_id uuid\)/);
assert.match(migration, /rights_activated_at=coalesce\(c\.rights_activated_at,now\(\)\)/);
assert.match(migration, /v_active:=v\.rights_activated_at IS NOT NULL/);
assert.match(migration, /p_terms->>'rights_accepted'/);
assert.match(migration, /s\.gross_minor=t\.fee_minor AND s\.reversed_minor=0/);
assert.match(migration, /NEW\.changes \? 'usage_days'/);

assert.doesNotMatch(explorerAgreement, /EXPO_PUBLIC_CREATOR_AGREEMENT/);
assert.match(explorerAgreement, /creatorProgramService\.currentAgreement\(\)/);
assert.match(explorerAgreement, /signAgreement\(birthDate\)/);
assert.doesNotMatch(explorerRates, /USAGE_OPTIONS|Hosts may reuse it for/);
assert.match(explorerRates, /perpetual organic and paid-marketing rights/);

assert.match(hostHire, /rights_accepted: true/);
assert.match(hostHire, /Read the full Creator agreement/);
assert.match(media, /await deps\.hasActiveRights\(data\.contract_id\)/);
assert.match(media, /const download = activeRights/);

console.log('PASS #4216 Creator rights happy-path contract');
