-- #3872 T14 contract path. The implementation suite includes the grant matrix
-- plus the rollout kill-switch assertions added during hardening.
\set ON_ERROR_STOP on
\ir issue_3872_r1_grants_killswitch.tester.adversarial.pg17.test.sql
