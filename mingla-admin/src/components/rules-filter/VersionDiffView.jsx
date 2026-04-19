import { useState, useEffect } from "react";
import { ArrowRight, Plus, Minus } from "lucide-react";
import { supabase } from "../../lib/supabase";

export function VersionDiffView({ versionAId, versionBId }) {
  const [diff, setDiff] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!versionAId || !versionBId) {
      setDiff(null);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    supabase
      .rpc("admin_rule_set_diff", { p_version_a: versionAId, p_version_b: versionBId })
      .then(({ data, error: rpcErr }) => {
        if (!alive) return;
        if (rpcErr) setError(rpcErr.message);
        else setDiff(data);
      })
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [versionAId, versionBId]);

  if (!versionAId || !versionBId) {
    return (
      <div className="text-center py-10">
        <p className="text-[13px] text-[var(--color-text-tertiary)]">
          Select two versions in the History tab to compare them.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-2">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-8 rounded bg-[var(--gray-100)] animate-pulse" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-[13px] text-[var(--color-error-700)] text-center py-6">
        Couldn't load diff: {error}
      </p>
    );
  }

  if (!diff) return null;

  const added = diff.added_entries || [];
  const removed = diff.removed_entries || [];
  const unchanged = diff.unchanged_entries_count || 0;
  const thresholdsChanged = diff.thresholds_changed;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 text-[12px] text-[var(--color-text-secondary)] border-b border-[var(--gray-200)] pb-3">
        <div className="flex-1">
          <p className="font-semibold text-[var(--color-text-primary)]">
            v{diff.version_a?.version_number}
          </p>
          <p className="text-[11px] text-[var(--color-text-tertiary)] line-clamp-1">
            {diff.version_a?.change_summary || "(no summary)"}
          </p>
        </div>
        <ArrowRight className="w-4 h-4 text-[var(--color-text-tertiary)]" />
        <div className="flex-1 text-right">
          <p className="font-semibold text-[var(--color-text-primary)]">
            v{diff.version_b?.version_number}
          </p>
          <p className="text-[11px] text-[var(--color-text-tertiary)] line-clamp-1">
            {diff.version_b?.change_summary || "(no summary)"}
          </p>
        </div>
      </div>

      {thresholdsChanged && (
        <div className="border border-[var(--color-warning-200)] bg-[var(--color-warning-50)] rounded-lg p-3">
          <p className="text-[12px] font-semibold text-[var(--color-warning-700)] mb-2">
            Thresholds changed
          </p>
          <div className="grid grid-cols-2 gap-3 text-[11px] font-mono">
            <pre className="text-[var(--color-text-secondary)] whitespace-pre-wrap break-all">
              {JSON.stringify(thresholdsChanged.from, null, 2)}
            </pre>
            <pre className="text-[var(--color-text-primary)] whitespace-pre-wrap break-all">
              {JSON.stringify(thresholdsChanged.to, null, 2)}
            </pre>
          </div>
        </div>
      )}

      {added.length > 0 && (
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-wide text-[var(--color-success-700)] mb-2 flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" />
            Added ({added.length})
          </p>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-1.5">
            {added.map((e, i) => (
              <div
                key={`add-${i}-${e.value}`}
                className="px-2 py-1 rounded border border-[#22c55e] bg-[var(--color-success-50)] text-[12px] text-[var(--color-success-700)]"
                title={e.reason || e.value}
              >
                <span className="font-mono">{e.value}</span>
                {e.sub_category && <span className="text-[10px] opacity-75 ml-1">[{e.sub_category}]</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {removed.length > 0 && (
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-wide text-[var(--color-error-700)] mb-2 flex items-center gap-1.5">
            <Minus className="w-3.5 h-3.5" />
            Removed ({removed.length})
          </p>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-1.5">
            {removed.map((e, i) => (
              <div
                key={`rm-${i}-${e.value}`}
                className="px-2 py-1 rounded border border-[#ef4444] bg-[var(--color-error-50)] text-[12px] text-[var(--color-error-700)] line-through"
              >
                <span className="font-mono">{e.value}</span>
                {e.sub_category && <span className="text-[10px] opacity-75 ml-1">[{e.sub_category}]</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {added.length === 0 && removed.length === 0 && !thresholdsChanged && (
        <p className="text-[13px] text-[var(--color-text-tertiary)] text-center py-6">
          These two versions are identical.
        </p>
      )}

      <p className="text-[11px] text-[var(--color-text-tertiary)] text-center pt-3 border-t border-[var(--gray-200)]">
        {unchanged} unchanged {unchanged === 1 ? "entry" : "entries"}
      </p>
    </div>
  );
}
