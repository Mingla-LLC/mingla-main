import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Brain } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { AlertCard } from "../ui/Card";
import { Button } from "../ui/Button";
import { RulesHealthRow } from "./RulesHealthRow";
import { RuleSetGrid } from "./RuleSetGrid";
import { RuleSidePanel } from "./RuleSidePanel";
import { RunHistoryList } from "./RunHistoryList";
import { RunDetailPanel } from "./RunDetailPanel";
import { DriftDetailBanner } from "./DriftDetailBanner";

const SEARCH_DEBOUNCE_MS = 300;
const RUN_POLL_INTERVAL_MS = 1500;

export function RulesFilterTab({ selectedCityId, invoke, toast, flagEnabled, cityName }) {
  // ── Overview ──
  const [overview, setOverview] = useState(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState(null);

  // ── Rules list ──
  const [rules, setRules] = useState([]);
  const [rulesLoading, setRulesLoading] = useState(true);
  const [rulesError, setRulesError] = useState(null);
  const [selectedRuleId, setSelectedRuleId] = useState(null);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const [groupBy, setGroupBy] = useState("category");
  const [neverFiredOnly, setNeverFiredOnly] = useState(false);

  // ── Drift ──
  const [driftLoading, setDriftLoading] = useState(false);
  const [driftResult, setDriftResult] = useState(null);

  // ── Runs ──
  const [runs, setRuns] = useState([]);
  const [runsLoading, setRunsLoading] = useState(true);
  const [runsError, setRunsError] = useState(null);
  const [selectedRunId, setSelectedRunId] = useState(null);
  const [runInflight, setRunInflight] = useState(false);

  // ── Debounce search → debouncedSearch ──
  const debounceRef = useRef(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => debounceRef.current && clearTimeout(debounceRef.current);
  }, [search]);

  // ── Loaders ──
  const loadOverview = useCallback(async () => {
    setOverviewLoading(true);
    setOverviewError(null);
    try {
      const { data, error: rpcErr } = await supabase.rpc("admin_rules_overview");
      if (rpcErr) throw rpcErr;
      setOverview(data);
    } catch (err) {
      setOverviewError(err.message || "Couldn't load rules overview.");
    } finally {
      setOverviewLoading(false);
    }
  }, []);

  const loadRulesList = useCallback(async () => {
    setRulesLoading(true);
    setRulesError(null);
    try {
      const { data, error: rpcErr } = await supabase.rpc("admin_rules_list", {
        p_scope_filter: null,
        p_kind_filter: kindFilter || null,
        p_search: debouncedSearch || null,
        p_show_only_never_fired: false,
      });
      if (rpcErr) throw rpcErr;
      setRules(Array.isArray(data) ? data : []);
    } catch (err) {
      setRulesError(err.message || "Couldn't load rules list.");
    } finally {
      setRulesLoading(false);
    }
  }, [debouncedSearch, kindFilter]);

  const loadRuns = useCallback(async () => {
    setRunsLoading(true);
    setRunsError(null);
    try {
      const { data, error: rpcErr } = await supabase.rpc("admin_rules_runs", {
        p_city_id: selectedCityId || null,
        p_limit: 20,
        p_offset: 0,
      });
      if (rpcErr) throw rpcErr;
      setRuns(data?.runs || []);
    } catch (err) {
      setRunsError(err.message || "Couldn't load run history.");
    } finally {
      setRunsLoading(false);
    }
  }, [selectedCityId]);

  // ── Initial + reload effects ──
  useEffect(() => {
    if (flagEnabled) {
      loadOverview();
      loadRulesList();
      loadRuns();
    }
  }, [flagEnabled, loadOverview, loadRulesList, loadRuns]);

  useEffect(() => {
    if (flagEnabled) loadRulesList();
  }, [flagEnabled, debouncedSearch, kindFilter, loadRulesList]);

  useEffect(() => {
    if (flagEnabled) loadRuns();
  }, [flagEnabled, selectedCityId, loadRuns]);

  // ── Poll for active runs (every 1500ms while any run is 'running') ──
  const pollTimerRef = useRef(null);
  useEffect(() => {
    if (!flagEnabled) return;
    const hasActiveRun = runs.some((r) => r.status === "running");
    if (!hasActiveRun) {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      return;
    }
    pollTimerRef.current = setTimeout(() => {
      loadRuns();
      loadOverview();
    }, RUN_POLL_INTERVAL_MS);
    return () => pollTimerRef.current && clearTimeout(pollTimerRef.current);
  }, [flagEnabled, runs, loadRuns, loadOverview]);

  // ── Handlers ──
  const handleDriftClick = useCallback(async () => {
    if (driftLoading) return;
    setDriftLoading(true);
    setDriftResult(null);
    try {
      const result = await invoke({ action: "run_drift_check" });
      setDriftResult(result);
      await loadOverview();
    } catch (err) {
      setDriftResult({
        status: "error",
        error: err.message || "Couldn't run drift check. Try again.",
      });
      toast({
        variant: "error",
        title: "Drift check failed",
        description: err.message || "Couldn't run drift check. Try again.",
      });
    } finally {
      setDriftLoading(false);
    }
  }, [driftLoading, invoke, toast, loadOverview]);

  const handleRuleClick = useCallback((ruleId) => setSelectedRuleId(ruleId), []);
  const handlePanelClose = useCallback(() => setSelectedRuleId(null), []);
  const handleSaveSuccess = useCallback(() => {
    setSelectedRuleId(null);
    loadOverview();
    loadRulesList();
    loadRuns();
  }, [loadOverview, loadRulesList, loadRuns]);

  const handleRunRulesClick = useCallback(async () => {
    if (!selectedCityId || runInflight) return;
    setRunInflight(true);
    try {
      const result = await invoke({
        action: "run_rules_filter",
        city_id: selectedCityId,
        scope: "all",
      });
      if (result?.status === "already_running") {
        toast({
          variant: "warning",
          title: "Already running",
          description: "A rules-filter run is already active for this city.",
        });
      } else if (result?.status === "nothing_to_do") {
        toast({
          variant: "info",
          title: "Nothing to do",
          description: "No places matched the current scope.",
        });
      } else {
        toast({
          variant: "success",
          title: "Run started",
          description: `Processing ${result?.total_places || "places"} in ${cityName || "selected city"}…`,
        });
      }
      await loadRuns();
    } catch (err) {
      toast({
        variant: "error",
        title: "Couldn't start run",
        description: err.message || "Run failed to start. Try again.",
      });
    } finally {
      setRunInflight(false);
    }
  }, [selectedCityId, runInflight, invoke, toast, cityName, loadRuns]);

  const handleRunDetailClose = useCallback(() => setSelectedRunId(null), []);

  // ── Gate: flag-off ──
  if (!flagEnabled) {
    return (
      <div className="space-y-6">
        <AlertCard variant="info" title="Coming soon">
          The Rules Filter tab is being prepared. Check back shortly.
        </AlertCard>
      </div>
    );
  }

  const cityScopeLabel = selectedCityId ? (cityName || "Selected city") : "All cities";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="space-y-6"
    >
      {overviewError && (
        <AlertCard
          variant="error"
          title="Couldn't load rules overview"
          action={<Button size="sm" onClick={loadOverview}>Try Again</Button>}
        >
          {overviewError}
        </AlertCard>
      )}

      <RulesHealthRow
        overview={overview}
        loading={overviewLoading}
        onDriftClick={handleDriftClick}
        driftLoading={driftLoading}
      />

      {!overviewLoading && overview && (
        <div className="text-[12px] text-[var(--color-text-tertiary)] flex items-center gap-2">
          <Brain className="w-3.5 h-3.5" />
          <span>
            Manifest{" "}
            <code className="text-[var(--color-text-secondary)]">
              {overview.current_manifest_label || "—"}
            </code>{" "}
            · {overview.rules_active}/{overview.rules_total} rules active
          </span>
        </div>
      )}

      {driftResult && (
        <DriftDetailBanner
          result={driftResult}
          onDismiss={() => setDriftResult(null)}
        />
      )}

      {rulesError && (
        <AlertCard
          variant="error"
          title="Couldn't load rules list"
          action={<Button size="sm" onClick={loadRulesList}>Try Again</Button>}
        >
          {rulesError}
        </AlertCard>
      )}

      <RuleSetGrid
        rules={rules}
        selectedRuleId={selectedRuleId}
        onRuleClick={handleRuleClick}
        onRunClick={null /* ORCH-0538: per-rule runs need edge fn param — v2 */}
        loading={rulesLoading}
        cityIsSelected={false /* suppresses per-rule Run button; use global Run Rules Filter instead */}
        search={search}
        onSearchChange={setSearch}
        kindFilter={kindFilter}
        onKindFilterChange={setKindFilter}
        groupBy={groupBy}
        onGroupByChange={setGroupBy}
        neverFiredOnly={neverFiredOnly}
        onNeverFiredToggle={setNeverFiredOnly}
      />

      <RunHistoryList
        runs={runs}
        loading={runsLoading}
        error={runsError}
        selectedRunId={selectedRunId}
        onRunClick={setSelectedRunId}
        cityScopeLabel={cityScopeLabel}
        cityIsSelected={!!selectedCityId}
        onRunRulesClick={handleRunRulesClick}
        runInflight={runInflight}
      />

      <AnimatePresence>
        {selectedRuleId && (
          <RuleSidePanel
            key={`rule-${selectedRuleId}`}
            ruleSetId={selectedRuleId}
            onClose={handlePanelClose}
            onSaveSuccess={handleSaveSuccess}
            toast={toast}
            selectedCityId={selectedCityId}
          />
        )}
        {selectedRunId && (
          <RunDetailPanel
            key={`run-${selectedRunId}`}
            jobId={selectedRunId}
            onClose={handleRunDetailClose}
            allRunsOnCity={runs}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
