import { useState, useEffect, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import { Brain } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { AlertCard, SectionCard } from "../ui/Card";
import { Button } from "../ui/Button";
import { RulesHealthRow } from "./RulesHealthRow";
import { RuleSetGrid } from "./RuleSetGrid";

const SEARCH_DEBOUNCE_MS = 300;

export function RulesFilterTab({ selectedCityId, invoke, toast, flagEnabled }) {
  const [overview, setOverview] = useState(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState(null);
  const [driftLoading, setDriftLoading] = useState(false);

  const [rules, setRules] = useState([]);
  const [rulesLoading, setRulesLoading] = useState(true);
  const [rulesError, setRulesError] = useState(null);
  const [selectedRuleId, setSelectedRuleId] = useState(null);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const [groupBy, setGroupBy] = useState("category");
  const [neverFiredOnly, setNeverFiredOnly] = useState(false);

  // Debounce search → debouncedSearch (drives the RPC)
  const debounceRef = useRef(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => debounceRef.current && clearTimeout(debounceRef.current);
  }, [search]);

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
        p_show_only_never_fired: false, // kept client-side for instant toggle
      });
      if (rpcErr) throw rpcErr;
      setRules(Array.isArray(data) ? data : []);
    } catch (err) {
      setRulesError(err.message || "Couldn't load rules list.");
    } finally {
      setRulesLoading(false);
    }
  }, [debouncedSearch, kindFilter]);

  useEffect(() => {
    if (flagEnabled) {
      loadOverview();
      loadRulesList();
    }
  }, [flagEnabled, loadOverview, loadRulesList]);

  // Reload list when search/kind change (but not on every keystroke — debouncedSearch handles that)
  useEffect(() => {
    if (flagEnabled) loadRulesList();
  }, [flagEnabled, debouncedSearch, kindFilter, loadRulesList]);

  const handleDriftClick = useCallback(async () => {
    if (driftLoading) return;
    setDriftLoading(true);
    try {
      const result = await invoke({ action: "run_drift_check" });
      const status = result?.status || "unknown";
      const diffCount = Array.isArray(result?.diffs) ? result.diffs.length : 0;
      toast({
        variant: status === "in_sync" ? "success" : status === "drift" ? "warning" : "error",
        title:
          status === "in_sync"
            ? "Sources in sync"
            : status === "drift"
            ? `Drift found in ${diffCount} place(s)`
            : status === "contradiction"
            ? `Contradiction in ${diffCount} place(s)`
            : "Drift check complete",
        description:
          status === "in_sync"
            ? "Filter, on-demand, and display all agree."
            : "Drift detail panel ships in M3.4.",
      });
      await loadOverview();
    } catch (err) {
      toast({
        variant: "error",
        title: "Drift check failed",
        description: err.message || "Couldn't run drift check. Try again.",
      });
    } finally {
      setDriftLoading(false);
    }
  }, [driftLoading, invoke, toast, loadOverview]);

  const handleRuleClick = useCallback((ruleId) => {
    setSelectedRuleId(ruleId);
    // M3.3 will open the side panel here. For M3.2: surface what was clicked.
    const rule = rules.find((r) => r.id === ruleId);
    if (rule) {
      toast({
        variant: "info",
        title: rule.name,
        description: `Side panel editor lands in M3.3. (kind: ${rule.kind} · ${rule.entry_count || 0} entries)`,
      });
    }
  }, [rules, toast]);

  const handleRunRuleClick = useCallback((rule) => {
    // M3.4 will dispatch a per-rule run on the selected city.
    toast({
      variant: "info",
      title: `Run ${rule.name} on city`,
      description: "Per-rule run dispatch ships in M3.4.",
    });
  }, [toast]);

  if (!flagEnabled) {
    return (
      <div className="space-y-6">
        <AlertCard variant="info" title="Coming soon">
          The Rules Filter tab is being prepared. Check back shortly.
        </AlertCard>
      </div>
    );
  }

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
        onRunClick={handleRunRuleClick}
        loading={rulesLoading}
        cityIsSelected={!!selectedCityId}
        search={search}
        onSearchChange={setSearch}
        kindFilter={kindFilter}
        onKindFilterChange={setKindFilter}
        groupBy={groupBy}
        onGroupByChange={setGroupBy}
        neverFiredOnly={neverFiredOnly}
        onNeverFiredToggle={setNeverFiredOnly}
      />

      <SectionCard
        title="Run History"
        subtitle="Coming in M3.4"
      >
        <p className="text-[13px] text-[var(--color-text-tertiary)]">
          Per-city run history and the [+ Run Rules Filter] button land in M3.4.
          Use the Pipeline tab today to trigger rules-only runs.
        </p>
      </SectionCard>
    </motion.div>
  );
}
