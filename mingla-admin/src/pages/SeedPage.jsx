import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import {
  UserPlus,
  Trash2,
  RefreshCw,
  Eraser,
  Play,
  CheckCircle,
  AlertCircle,
  AlertTriangle,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { SEED_SCRIPTS } from "../lib/constants";
import { Button } from "../components/ui/Button";
import { SectionCard, AlertCard } from "../components/ui/Card";
import { Textarea } from "../components/ui/Input";
import { useToast } from "../context/ToastContext";

const ICON_MAP = { UserPlus, Trash2, RefreshCw, Eraser };

function splitSQL(sql) {
  const statements = [];
  let current = "";
  let inString = false;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (inString) {
      current += ch;
      if (ch === "'" && sql[i + 1] !== "'") inString = false;
      else if (ch === "'" && sql[i + 1] === "'") { current += sql[i + 1]; i++; }
    } else {
      if (ch === "'") { inString = true; current += ch; }
      else if (ch === ";") { const trimmed = current.trim(); if (trimmed) statements.push(trimmed); current = ""; }
      else current += ch;
    }
  }

  const trimmed = current.trim();
  if (trimmed) statements.push(trimmed);
  return statements;
}

export function SeedPage() {
  const { addToast } = useToast();
  const [results, setResults] = useState({});
  const [running, setRunning] = useState(null);
  const [customSQL, setCustomSQL] = useState("");
  const [customResult, setCustomResult] = useState(null);

  const runScript = useCallback(async (idx, sql) => {
    setRunning(idx);
    setResults((r) => { const next = { ...r }; delete next[idx]; return next; });
    try {
      const statements = splitSQL(sql);
      for (const stmt of statements) {
        const { error } = await supabase.rpc("exec_sql", { sql: stmt });
        if (error) {
          setResults((r) => ({ ...r, [idx]: { error: error.message } }));
          addToast({ variant: "error", title: "Script failed", description: error.message });
          setRunning(null);
          return;
        }
      }
      setResults((r) => ({ ...r, [idx]: { ok: true } }));
      addToast({ variant: "success", title: "Script executed successfully" });
    } catch (e) {
      const message = e?.message || "exec_sql RPC not found — run script manually in SQL editor";
      setResults((r) => ({ ...r, [idx]: { error: message } }));
      addToast({ variant: "error", title: "Script failed", description: message });
    }
    setRunning(null);
  }, [addToast]);

  const runCustom = useCallback(async () => {
    if (!customSQL.trim()) return;
    setRunning("custom");
    setCustomResult(null);
    try {
      const { data, error } = await supabase.rpc("exec_sql", { sql: customSQL });
      if (error) {
        setCustomResult({ error: error.message });
        addToast({ variant: "error", title: "SQL failed", description: error.message });
      } else {
        setCustomResult({ ok: true, data });
        addToast({ variant: "success", title: "SQL executed successfully" });
      }
    } catch {
      const message = "exec_sql RPC not available. Paste this in the Supabase SQL Editor instead.";
      setCustomResult({ error: message });
      addToast({ variant: "error", title: "SQL failed", description: message });
    }
    setRunning(null);
  }, [customSQL, addToast]);

  return (
    <div className="flex flex-col gap-8">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Seed & Scripts</h1>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1">
          Run predefined seed scripts or custom SQL queries
        </p>
      </div>

      {/* Warning Banner */}
      <div className="flex items-start gap-3 p-4 rounded-xl bg-[var(--color-warning-50)] border border-[rgba(245,158,11,0.3)]">
        <AlertTriangle className="w-5 h-5 text-[#d97706] shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-[#b45309]">Caution — Live Database</p>
          <p className="text-xs text-[#d97706] mt-0.5">
            These scripts run directly against your production Supabase database.
            Seed scripts insert or delete real data. Use with care.
          </p>
        </div>
      </div>

      {/* Seed Script Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {SEED_SCRIPTS.map((script, i) => {
          const Icon = ICON_MAP[script.icon] || Play;
          const result = results[i];
          const isRunning = running === i;

          return (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06, duration: 0.3, ease: "easeOut" }}
              className={[
                "bg-[var(--color-background-primary)] rounded-xl p-5",
                "border transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)]",
                result?.error ? "border-[rgba(239,68,68,0.4)]"
                  : result?.ok ? "border-[rgba(34,197,94,0.4)]"
                  : "border-[var(--gray-200)]",
              ].join(" ")}
            >
              <div className="flex items-start gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-[var(--color-brand-50)] text-[#f97316] flex items-center justify-center shrink-0">
                  <Icon className="w-5 h-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{script.label}</h3>
                  <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">{script.description}</p>
                </div>
              </div>

              {/* SQL Preview */}
              <div className="bg-[var(--color-background-tertiary)] rounded-lg p-3 mb-3 overflow-hidden">
                <pre className="text-[10px] text-[var(--color-text-tertiary)] font-mono leading-relaxed whitespace-pre-wrap line-clamp-3">
                  {script.sql.slice(0, 200)}
                </pre>
              </div>

              {/* Result */}
              {result && (
                <div className="mb-3">
                  {result.error ? (
                    <div className="flex items-start gap-2 text-xs text-[var(--color-error-700)] bg-[var(--color-error-50)] rounded-lg p-2">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span className="line-clamp-2">{result.error}</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-xs text-[var(--color-success-700)] bg-[var(--color-success-50)] rounded-lg p-2">
                      <CheckCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>Completed successfully</span>
                    </div>
                  )}
                </div>
              )}

              <Button
                variant="secondary"
                size="sm"
                loading={isRunning}
                icon={Play}
                onClick={() => runScript(i, script.sql)}
                className="w-full"
              >
                Run Script
              </Button>
            </motion.div>
          );
        })}
      </div>

      {/* Custom SQL Runner */}
      <SectionCard title="Custom SQL Runner">
        <p className="text-xs text-[var(--color-text-tertiary)] mb-3">
          Write any SQL query. Requires an{" "}
          <code className="font-mono bg-[var(--color-background-tertiary)] px-1 py-0.5 rounded">exec_sql</code>{" "}
          RPC function in Supabase, or copy the SQL and run it in the Supabase SQL Editor.
        </p>

        <Textarea
          value={customSQL}
          onChange={(e) => setCustomSQL(e.target.value)}
          placeholder="SELECT count(*) FROM profiles;"
          className="mb-3"
        />

        {customResult && (
          <div className="mb-3">
            {customResult.error ? (
              <AlertCard variant="error" title="Query failed">{customResult.error}</AlertCard>
            ) : (
              <AlertCard variant="success" title="Query succeeded">Executed successfully</AlertCard>
            )}
          </div>
        )}

        <Button
          variant="primary"
          icon={Play}
          loading={running === "custom"}
          disabled={!customSQL.trim()}
          onClick={runCustom}
        >
          Run SQL
        </Button>
      </SectionCard>
    </div>
  );
}
