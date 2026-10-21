// Issue #3980 (R9) — the team for every people field: active and invited
// teammates with their display names, roles and open cards, me first. One
// shared answer per signed-in person, refreshed every five minutes.
import { useAuth } from "../context/AuthContext";
import * as ops from "../services/opsService";
import { normalizeTeam } from "../lib/peopleField";
import { useOpsPoll } from "./useOpsWork";

const CACHE = new Map();

export function usePeopleDirectory() {
  const { access } = useAuth();
  const read = useOpsPoll(async () => normalizeTeam((await ops.fetchPeopleDirectory())?.people), {
    key: `${access?.email || ""}|people`, intervalMs: 300_000, cache: CACHE,
  });
  const people = Array.isArray(read.data) ? read.data : [];
  return { people, me: people.find((p) => p.me)?.email || String(access?.email || "").toLowerCase(), loading: read.loading, error: read.error, refetch: read.refetch };
}
