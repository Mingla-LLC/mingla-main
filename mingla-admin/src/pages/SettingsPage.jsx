import { useState, useEffect, useCallback, useRef } from "react";
import { Plus, Trash2, Edit3, Sun, Moon, Monitor, RotateCcw } from "lucide-react";
import { supabase } from "../lib/supabase";
import { SectionCard } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input, Toggle, Textarea } from "../components/ui/Input";
import { Badge } from "../components/ui/Badge";
import { SearchInput } from "../components/ui/SearchInput";
import { DataTable } from "../components/ui/Table";
import { Modal, ModalBody, ModalFooter } from "../components/ui/Modal";
import { Spinner } from "../components/ui/Spinner";
import { LoadError } from "../components/ui/LoadError";
import { useToast } from "../context/ToastContext";
import { useTheme } from "../context/ThemeContext";
import { useAuth } from "../context/AuthContext";
import { logAdminAction } from "../lib/auditLog";
import { PageHeader } from "../components/ui/PageHeader";
import { useOnline } from "../hooks/useCrmPipeline";
import { useHashTab } from "../hooks/useHashTab";
import { COMPETITOR_WATCH_FROM, RESTART_WORD, SETTINGS_SECTIONS, appConfigRow, canRestartTour, sectionFor } from "../lib/systemPages";
import { fetchTrialRunHistory, restartTourForEveryone, systemErrorWords } from "../services/systemPagesService";
import { TeamAutomationSettings } from "../components/ops/TeamSettingsPanels";
import { RunHistoryGroups } from "../components/placeIntelligenceTrial/RunHistoryGroups";
import { CompetitorOpsPanel } from "./ToolLeadsPage";
import { canOpenOwnPage } from "../lib/access";

// ─── Appearance Tab ─────────────────────────────────────────────────────────

function AppearanceView() {
  const { theme, setTheme } = useTheme();

  return (
    <SectionCard title="Theme">
      <p className="text-sm text-[var(--color-text-secondary)] mb-4">
        Choose how the dashboard looks. System follows your OS preference.
      </p>
      <div className="flex gap-3">
        <Button
          variant={theme === "light" ? "primary" : "secondary"}
          icon={Sun}
          onClick={() => setTheme("light")}
        >
          Light
        </Button>
        <Button
          variant={theme === "dark" ? "primary" : "secondary"}
          icon={Moon}
          onClick={() => setTheme("dark")}
        >
          Dark
        </Button>
        <Button
          variant={theme === "system" || !theme ? "primary" : "secondary"}
          icon={Monitor}
          onClick={() => setTheme("system")}
        >
          System
        </Button>
      </div>
    </SectionCard>
  );
}

// ─── App Config Tab ─────────────────────────────────────────────────────────

function AppConfigView() {
  const { addToast } = useToast();
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const [configs, setConfigs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [newConfig, setNewConfig] = useState({ key: "", value: "", type: "string" });
  const [confirmDelete, setConfirmDelete] = useState(null);

  // #4130: the table's columns are config_key and config_value. A failed read
  // shows the error with Retry, never "No app config entries yet".
  const fetchConfigs = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from("app_config").select("id, config_key, config_value, value_type, description").order("config_key");
    if (!mountedRef.current) return;
    if (error) {
      setLoadError(error);
    } else {
      setLoadError(null);
      setConfigs((data || []).map(appConfigRow));
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchConfigs(); }, [fetchConfigs]);

  const handleCreate = async () => {
    if (!newConfig.key.trim()) { addToast({ variant: "error", title: "Key is required" }); return; }
    const { error } = await supabase.from("app_config").insert({
      config_key: newConfig.key.trim(),
      config_value: newConfig.value,
      value_type: newConfig.type,
    });
    if (error) { addToast({ variant: "error", title: "Couldn't create the setting", description: error.message }); return; }
    addToast({ variant: "success", title: "Setting created" });
    logAdminAction("config.create", "config", newConfig.key, { key: newConfig.key });
    setCreating(false);
    setNewConfig({ key: "", value: "", type: "string" });
    fetchConfigs();
  };

  const handleSaveEdit = async () => {
    const oldVal = configs.find((c) => c.id === editing.id)?.value;
    const { error } = await supabase.from("app_config").update({ config_value: editing.value }).eq("id", editing.id);
    if (error) { addToast({ variant: "error", title: "Couldn't save the setting", description: error.message }); return; }
    addToast({ variant: "success", title: "Setting saved" });
    logAdminAction("config.update", "config", editing.key, { key: editing.key, old_value: oldVal, new_value: editing.value });
    setEditing(null);
    fetchConfigs();
  };

  const handleDelete = async (cfg) => {
    const { error } = await supabase.from("app_config").delete().eq("id", cfg.id);
    if (error) { addToast({ variant: "error", title: "Couldn't delete the setting", description: error.message }); return; }
    addToast({ variant: "success", title: "Setting deleted" });
    logAdminAction("config.delete", "config", cfg.key, { key: cfg.key });
    setConfirmDelete(null);
    fetchConfigs();
  };

  const filtered = configs.filter((c) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return c.key.toLowerCase().includes(q) || c.value.toLowerCase().includes(q);
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} onClear={() => setSearch("")} placeholder="Search config..." className="flex-1" />
        <Button icon={Plus} onClick={() => setCreating(true)}>New Config</Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : loadError ? (
        <LoadError title="Couldn't load app config" message={systemErrorWords(loadError)} onRetry={fetchConfigs} />
      ) : filtered.length === 0 ? (
        <p className="text-sm text-[var(--color-text-tertiary)] text-center py-12">
          {search ? "No config items match that search." : "No app config entries yet."}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((cfg) => (
            <div key={cfg.id} className="flex items-center gap-3 p-3 rounded-lg border border-[var(--gray-200)] bg-[var(--color-background-primary)]">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[var(--color-text-primary)] font-mono">{cfg.key}</p>
                <p className="text-xs text-[var(--color-text-tertiary)] truncate">{cfg.value}</p>
              </div>
              <Badge variant="default">{cfg.value_type || "string"}</Badge>
              <Button variant="ghost" size="sm" icon={Edit3} onClick={() => setEditing({ ...cfg })} />
              <Button variant="ghost" size="sm" icon={Trash2} onClick={() => setConfirmDelete(cfg)} />
            </div>
          ))}
        </div>
      )}

      <Modal open={creating} onClose={() => setCreating(false)} title="New Config">
        <ModalBody>
          <div className="flex flex-col gap-3">
            <Input label="Key" value={newConfig.key} onChange={(e) => setNewConfig((c) => ({ ...c, key: e.target.value }))} placeholder="config_key" />
            <Input label="Value" value={newConfig.value} onChange={(e) => setNewConfig((c) => ({ ...c, value: e.target.value }))} placeholder="value" />
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Type</label>
              <select value={newConfig.type} onChange={(e) => setNewConfig((c) => ({ ...c, type: e.target.value }))} className="w-full h-10 rounded-lg border border-[var(--gray-200)] bg-[var(--color-background-primary)] px-3 text-sm">
                <option value="string">String</option>
                <option value="number">Number</option>
                <option value="boolean">Boolean</option>
                <option value="json">JSON</option>
              </select>
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setCreating(false)}>Cancel</Button>
          <Button onClick={handleCreate}>Create</Button>
        </ModalFooter>
      </Modal>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={`Edit "${editing?.key}"`}>
        <ModalBody>
          <Input label="Value" value={editing?.value || ""} onChange={(e) => setEditing((c) => ({ ...c, value: e.target.value }))} />
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
          <Button onClick={handleSaveEdit}>Save</Button>
        </ModalFooter>
      </Modal>

      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Delete Config" destructive>
        <ModalBody>
          <p className="text-sm text-[var(--color-text-secondary)]">This will permanently remove <strong>{confirmDelete?.key}</strong>.</p>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setConfirmDelete(null)}>Cancel</Button>
          <Button variant="danger" onClick={() => handleDelete(confirmDelete)}>Delete</Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}

// ─── Danger zone (owner only) ───────────────────────────────────────────────
// #4130 (Wave 4b): restarting the tour for everyone was one click that updated
// every profile from the browser. It is now the owner's alone, needs the typed
// word RESTART and a reason, and runs on the server, which logs it.

function DangerZone() {
  const { addToast } = useToast();
  const [userEmail, setUserEmail] = useState("");
  const [resettingSingle, setResettingSingle] = useState(false);
  const [resettingAll, setResettingAll] = useState(false);
  const [confirmResetAll, setConfirmResetAll] = useState(false);
  const [typed, setTyped] = useState("");
  const [resetReason, setResetReason] = useState("");
  const [resetError, setResetError] = useState("");

  const handleResetSingle = async () => {
    if (!userEmail.trim()) {
      addToast({ variant: "error", title: "Enter a user email" });
      return;
    }
    setResettingSingle(true);
    try {
      // First verify user exists
      const { data: user, error: findError } = await supabase
        .from("profiles")
        .select("id, coach_mark_step")
        .eq("email", userEmail.trim())
        .maybeSingle();

      if (findError) {
        console.error("[CoachMarkReset] Find error:", findError);
        addToast({ variant: "error", title: findError.message || "Failed to look up user" });
      } else if (!user) {
        addToast({ variant: "error", title: `No user found with email "${userEmail.trim()}"` });
      } else {
        // Always set to 0, even if already 0
        const { error: updateError } = await supabase
          .from("profiles")
          .update({ coach_mark_step: 0 })
          .eq("id", user.id);

        if (updateError) {
          console.error("[CoachMarkReset] Update error:", updateError);
          addToast({ variant: "error", title: updateError.message || "Failed to update" });
        } else {
          const prev = user.coach_mark_step;
          addToast({ variant: "success", title: `Coach mark reset for ${userEmail.trim()}`, description: prev === 0 ? "Was already at start" : `Was on step ${prev}` });
          logAdminAction("testing.reset_coach_mark", "profile", userEmail.trim(), { scope: "single", previous_step: prev });
          setUserEmail("");
        }
      }
    } catch (e) {
      addToast({ variant: "error", title: "Reset failed" });
    } finally {
      setResettingSingle(false);
    }
  };

  const handleResetAll = async () => {
    if (!canRestartTour(typed, resetReason)) return;
    setResettingAll(true);
    setResetError("");
    try {
      const result = await restartTourForEveryone(typed, resetReason.trim());
      addToast({
        variant: "success",
        title: "Tour restarted for everyone",
        description: `${Number(result?.restarted ?? 0).toLocaleString()} accounts will see it next time they open the app. Logged with your reason.`,
      });
      setConfirmResetAll(false);
      setTyped("");
      setResetReason("");
    } catch (err) {
      setResetError(systemErrorWords(err));
    } finally {
      setResettingAll(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <SectionCard title="Danger zone" subtitle="Owner only. These change the live app.">
        <p className="text-sm text-[var(--color-text-secondary)] mb-4">
          Restart the welcome tour for one person, to test the first-time experience without deleting their account.
        </p>

        <div className="flex flex-col gap-3">
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">User email</label>
              <input
                type="email"
                value={userEmail}
                onChange={(e) => setUserEmail(e.target.value)}
                placeholder="user@example.com"
                className="w-full h-10 rounded-lg border border-[var(--gray-200)] bg-[var(--color-background-primary)] px-3 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]"
                onKeyDown={(e) => e.key === "Enter" && handleResetSingle()}
              />
            </div>
            <Button
              onClick={handleResetSingle}
              disabled={resettingSingle || !userEmail.trim()}
              icon={RotateCcw}
            >
              {resettingSingle ? "Resetting..." : "Reset This User"}
            </Button>
          </div>

          <div className="flex items-center gap-3 pt-2 border-t border-[var(--gray-100)]">
            <Button
              variant="danger"
              onClick={() => { setTyped(""); setResetReason(""); setResetError(""); setConfirmResetAll(true); }}
              disabled={resettingAll}
              icon={RotateCcw}
            >
              Restart tour for everyone…
            </Button>
            <span className="text-xs text-[var(--color-text-tertiary)]">
              Every user sees the welcome tour again next time they open the app.
            </span>
          </div>
        </div>
      </SectionCard>

      <Modal open={confirmResetAll} onClose={() => !resettingAll && setConfirmResetAll(false)} title="Restart the welcome tour for everyone?" destructive>
        <ModalBody>
          <div className="flex flex-col gap-3">
            <p className="text-sm text-[var(--color-text-secondary)]">
              Every user sees the welcome tour again next time they open the app. This can&apos;t be undone.
            </p>
            <Input label={`Type ${RESTART_WORD} to confirm`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
            <Input label="Reason (saved with your name)" value={resetReason} onChange={(e) => setResetReason(e.target.value)} placeholder="e.g. the new tour shipped" />
            {resetError && <p role="alert" className="text-sm text-[var(--color-error-700)]">{resetError}</p>}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" disabled={resettingAll} onClick={() => setConfirmResetAll(false)}>Cancel</Button>
          <Button variant="danger" onClick={handleResetAll} disabled={resettingAll || !canRestartTour(typed, resetReason)} loading={resettingAll}>
            Restart for everyone
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}

// ─── Intelligence Trial history (read-only) ─────────────────────────────────
// The trial is retired (last run in June). Its runs stay readable here; nothing
// can be started, retried or cancelled.

function TrialHistory() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const load = useCallback(async () => {
    setError("");
    try {
      setRows(await fetchTrialRunHistory());
    } catch (err) {
      setError(err.message);
    }
  }, []);
  return (
    <SectionCard
      title="Intelligence Trial history"
      subtitle="Retired research tool. Its past runs, read-only."
      action={!open ? <Button size="sm" variant="secondary" onClick={() => { setOpen(true); void load(); }}>Show runs</Button> : null}
    >
      {!open ? (
        <p className="text-sm text-[var(--color-text-tertiary)]">Hidden until you ask, so Settings opens fast.</p>
      ) : error ? (
        <LoadError title="Couldn't load the trial history" message={error} onRetry={load} />
      ) : rows === null ? (
        <div className="flex justify-center py-6"><Spinner /></div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-[var(--color-text-tertiary)]">No runs were recorded.</p>
      ) : (
        <RunHistoryGroups allRows={rows} onFilterByRun={() => {}} retryFailedDisabled />
      )}
    </SectionCard>
  );
}

// ─── Main Settings Page ─────────────────────────────────────────────────────
// #4130 (Wave 4b): one page of sections instead of tabs. Feature flags have
// their own page; the empty Integrations tab is gone. Old addresses
// (#/place-intelligence-trial -> tab=intelligence-trial) scroll to their section.

function Section({ id, title, children }) {
  return (
    <section id={`settings-${id}`} aria-labelledby={`settings-${id}-heading`} className="flex min-w-0 flex-col gap-3">
      <h2 id={`settings-${id}-heading`} className="text-[15px] font-semibold text-[var(--color-text-primary)]">{title}</h2>
      {children}
    </section>
  );
}

export function SettingsPage() {
  const { access } = useAuth();
  const online = useOnline();
  const isOwner = access?.role === "owner";
  const { addToast } = useToast();
  // #4130 (integration): Competitor Ops keeps the access it had on Tool leads.
  const canSeeCompetitorWatch = canOpenOwnPage(access, COMPETITOR_WATCH_FROM);
  const [requested] = useHashTab("settings");
  const focus = sectionFor(SETTINGS_SECTIONS, requested);

  useEffect(() => {
    if (focus) document.getElementById(`settings-${focus}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focus]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Settings"
        description="Appearance, app configuration, team automation and the danger zone."
      />

      {/* Automatic steps — moved from the Team dashboard (#4130 Wave 1). Each
          panel shows only to someone who can change it; the server checks too. */}
      <Section id="automatic-steps" title="Automatic steps">
        <TeamAutomationSettings online={online} />
      </Section>

      <Section id="appearance" title="Appearance">
        <AppearanceView />
      </Section>

      <Section id="app-config" title="App configuration">
        <p className="text-sm text-[var(--color-text-secondary)]">The values the apps read when they start.</p>
        <AppConfigView />
      </Section>

      {/* Competitor watch — Competitor Ops from the old Tool leads page (#4130
          Wave 4a exports it), shown to exactly who could open Tool leads. The
          server's admin_competitor_intel_* RPCs check again. */}
      {canSeeCompetitorWatch && (
        <Section id="competitor-watch" title="Competitor watch">
          <p className="text-sm text-[var(--color-text-secondary)]">
            Which competitor sources Mingla checks, and the checks that failed.
          </p>
          <CompetitorOpsPanel addToast={addToast} />
        </Section>
      )}

      <Section id="intelligence-trial" title="Research history">
        <TrialHistory />
      </Section>

      {isOwner && (
        <Section id="danger-zone" title="Danger zone">
          <DangerZone />
        </Section>
      )}
    </div>
  );
}
