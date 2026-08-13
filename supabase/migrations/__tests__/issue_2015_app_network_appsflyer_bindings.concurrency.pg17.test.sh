#!/usr/bin/env bash
set -euo pipefail

db_host="${PGHOST:-localhost}"
db_user="${PGUSER:-postgres}"
db_name="${PGDATABASE:-postgres}"
actor_id="20152015-2015-4015-8015-201520152017"
idem_key="20150000-0000-4000-8000-000000000020"
payload="jsonb_build_object('app_key','explorer','os','android','provider','tiktok','provider_contract_kind','mobile_asset','provider_app_id','7659053200868786183','provider_measurement_id','7659053200868769799','actor','${actor_id}','reason','Converge two concurrent exact requests.','expected_current_version',1,'idempotency_key','${idem_key}')"

psql -h "$db_host" -U "$db_user" -d "$db_name" -v ON_ERROR_STOP=1 <<SQL >/dev/null
INSERT INTO auth.users(id,email) VALUES('${actor_id}','issue-2015-concurrency@example.com');
INSERT INTO public.admin_users(email,role,status) VALUES('issue-2015-concurrency@example.com','admin','active');
SQL

out_one="$(mktemp)"
out_two="$(mktemp)"
trap 'rm -f "$out_one" "$out_two"' EXIT

psql -h "$db_host" -U "$db_user" -d "$db_name" -v ON_ERROR_STOP=1 -Atc \
  "SELECT public.set_ad_app_safe_binding(${payload})->>'idempotent_replay';" >"$out_one" &
pid_one=$!
psql -h "$db_host" -U "$db_user" -d "$db_name" -v ON_ERROR_STOP=1 -Atc \
  "SELECT public.set_ad_app_safe_binding(${payload})->>'idempotent_replay';" >"$out_two" &
pid_two=$!
wait "$pid_one"
wait "$pid_two"

combined="$(tr '\n' ' ' <"$out_one") $(tr '\n' ' ' <"$out_two")"
[[ "$(grep -o 'false' <<<"$combined" | wc -l | tr -d ' ')" == "1" ]]
[[ "$(grep -o 'true' <<<"$combined" | wc -l | tr -d ' ')" == "1" ]]

state="$(psql -h "$db_host" -U "$db_user" -d "$db_name" -Atc \
  "SELECT binding_version || ':' || (SELECT count(*) FROM public.ad_app_binding_audit WHERE idempotency_key='${idem_key}') FROM public.ad_app_provider_bindings WHERE app_key='explorer' AND os='android' AND provider='tiktok';")"
[[ "$state" == "2:1" ]]
echo "#2015 concurrent identical requests converged: $state"
