import { useState, useCallback, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import {
  UserPlus, Trash2, RefreshCw, Eraser, Play,
  CheckCircle, AlertCircle, AlertTriangle,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { SEED_SCRIPTS } from "../lib/constants";
import { Button } from "../components/ui/Button";
import { AlertCard } from "../components/ui/Card";
import { Modal, ModalBody, ModalFooter } from "../components/ui/Modal";
import { useToast } from "../context/ToastContext";
import { logAdminAction } from "../lib/auditLog";

const ICON_MAP = { UserPlus, Trash2, RefreshCw, Eraser };

export function SeedPage() {
  const { addToast } = useToast();
  const { session } = useAuth();
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const [results, setResults] = useState({});
  const [running, setRunning] = useState(null);
  const [confirmModal, setConfirmModal] = useState(null);

  const runScript = useCallback(async (idx) => {
    const script = SEED_SCRIPTS[idx];
    setRunning(idx);
    setResults((r) => { const next = { ...r }; delete next[idx]; return next; });
    try {
      const { error } = await supabase.rpc(script.rpc);
      if (!mountedRef.current) return;
      if (error) {
        // PGRST202 = function not found
        const msg = error.code === "PGRST202"
          ? `RPC "${script.rpc}" not found. Run the admin dashboard migration first.`
          : error.message;
        setResults((r) => ({ ...r, [idx]: { error: msg } }));
        addToast({ variant: "error", title: "Script failed", description: msg });
      } else {
        setResults((r) => ({ ...r, [idx]: { ok: true } }));
        addToast({ variant: "success", title: "Script executed successfully" });
        logAdminAction("seed.run", "script", script.rpc, { script_label: script.label });
      }
    } catch (e) {
      if (!mountedRef.current) return;
      const message = e?.message || "Unexpected error";
      setResults((r) => ({ ...r, [idx]: { error: message } }));
      addToast({ variant: "error", title: "Script failed", description: message });
    }
    if (mountedRef.current) setRunning(null);
  }, [addToast]);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Database Tools</h1>
      </div>

      {/* Warning Banner */}
      <div className="flex items-start gap-3 p-4 rounded-xl bg-[var(--color-warning-50)] border border-[rgba(245,158,11,0.3)]">
        <AlertTriangle className="w-5 h-5 text-[#d97706] shrink-0 mt-0.5" />
        <p className="text-sm text-[#b45309]">
          These scripts modify live data. Changes cannot be undone. Proceed with care.
        </p>
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
                onClick={() => setConfirmModal({ type: "script", idx: i, label: script.label })}
                className="w-full"
              >
                Run Script
              </Button>
            </motion.div>
          );
        })}
      </div>

      {/* Confirmation Modal */}
      <Modal
        open={!!confirmModal}
        onClose={() => setConfirmModal(null)}
        title={`Run "${confirmModal?.label}"?`}
        destructive
      >
        <ModalBody>
          <p className="text-sm text-[var(--color-text-secondary)]">
            This script will modify live data. This cannot be undone.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setConfirmModal(null)}>Cancel</Button>
          <Button
            variant="danger"
            onClick={() => {
              const m = confirmModal;
              setConfirmModal(null);
              runScript(m.idx);
            }}
          >
            Run
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
