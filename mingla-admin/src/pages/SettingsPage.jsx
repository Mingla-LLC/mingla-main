import { useState, useEffect, useCallback, useRef } from "react";
import {
  Settings, Flag, Sliders, Plug, Plus, Trash2, Edit3, Save, X,
  History, Sun, Moon, Monitor, Search, FlaskConical, RotateCcw,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { SectionCard } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input, Toggle, Textarea } from "../components/ui/Input";
import { Badge } from "../components/ui/Badge";
import { SearchInput } from "../components/ui/SearchInput";
import { DataTable } from "../components/ui/Table";
import { Modal, ModalBody, ModalFooter } from "../components/ui/Modal";
import { Tabs } from "../components/ui/Tabs";
import { Spinner } from "../components/ui/Spinner";
import { useToast } from "../context/ToastContext";
import { useTheme } from "../context/ThemeContext";
import { logAdminAction } from "../lib/auditLog";
import { formatDate } from "../lib/formatters";

const SUB_TABS = [
  { id: "appearance", label: "Appearance" },
  { id: "flags", label: "Feature Flags" },
  { id: "config", label: "App Config" },
  { id: "integrations", label: "Integrations" },
  { id: "testing", label: "Testing Tools" },
];

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

// ─── Feature Flags Tab ──────────────────────────────────────────────────────

function FeatureFlagsView() {
  const { addToast } = useToast();
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const [flags, setFlags] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [newFlag, setNewFlag] = useState({ key: "", description: "", enabled: false });
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [historyModal, setHistoryModal] = useState(null);
  const [historyData, setHistoryData] = useState([]);

  const fetchFlags = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from("feature_flags").select("*").order("key");
    if (!mountedRef.current) return;
    if (!error) setFlags(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchFlags(); }, [fetchFlags]);

  const toSnakeCase = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

  const handleCreate = async () => {
    const key = toSnakeCase(newFlag.key);
    if (!key) { addToast("Key is required", "error"); return; }
    const { error } = await supabase.from("feature_flags").insert({ key, description: newFlag.description, enabled: newFlag.enabled });
    if (error) { addToast(error.message, "error"); return; }
    addToast("Flag created", "success");
    logAdminAction("config.create", "flag", key, { key });
    setCreating(false);
    setNewFlag({ key: "", description: "", enabled: false });
    fetchFlags();
  };

  const handleToggle = async (flag) => {
    const { error } = await supabase.from("feature_flags").update({ enabled: !flag.enabled }).eq("id", flag.id);
    if (error) { addToast(error.message, "error"); return; }
    logAdminAction("config.update", "flag", flag.key, { key: flag.key, old_value: flag.enabled, new_value: !flag.enabled });
    fetchFlags();
  };

  const handleDelete = async (flag) => {
    const { error } = await supabase.from("feature_flags").delete().eq("id", flag.id);
    if (error) { addToast(error.message, "error"); return; }
    addToast("Flag deleted", "success");
    logAdminAction("config.delete", "flag", flag.key, { key: flag.key });
    setConfirmDelete(null);
    fetchFlags();
  };

  const handleSaveEdit = async () => {
    const { error } = await supabase.from("feature_flags").update({ description: editing.description, enabled: editing.enabled }).eq("id", editing.id);
    if (error) { addToast(error.message, "error"); return; }
    addToast("Flag updated", "success");
    logAdminAction("config.update", "flag", editing.key, { key: editing.key, fields_changed: ["description", "enabled"] });
    setEditing(null);
    fetchFlags();
  };

  const openHistory = async (flag) => {
    setHistoryModal(flag);
    const { data } = await supabase.from("admin_audit_log").select("*").eq("target_type", "flag").eq("target_id", flag.key).order("created_at", { ascending: false }).limit(20);
    if (mountedRef.current) setHistoryData(data || []);
  };

  const filtered = flags.filter((f) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return f.key?.toLowerCase().includes(q) || f.description?.toLowerCase().includes(q);
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} onClear={() => setSearch("")} placeholder="Search flags..." className="flex-1" />
        <Button icon={Plus} onClick={() => setCreating(true)}>New Flag</Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-[var(--color-text-tertiary)] text-center py-12">
          {search ? "No flags match that search." : "No feature flags. Create one to control app features remotely."}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((flag) => (
            <div key={flag.id} className="flex items-center gap-3 p-3 rounded-lg border border-[var(--gray-200)] bg-[var(--color-background-primary)]">
              <Toggle checked={flag.enabled} onChange={() => handleToggle(flag)} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[var(--color-text-primary)] font-mono">{flag.key}</p>
                {flag.description && <p className="text-xs text-[var(--color-text-tertiary)] truncate">{flag.description}</p>}
              </div>
              <Badge variant={flag.enabled ? "success" : "default"}>{flag.enabled ? "On" : "Off"}</Badge>
              <Button variant="ghost" size="sm" icon={History} onClick={() => openHistory(flag)} />
              <Button variant="ghost" size="sm" icon={Edit3} onClick={() => setEditing({ ...flag })} />
              <Button variant="ghost" size="sm" icon={Trash2} onClick={() => setConfirmDelete(flag)} />
            </div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      <Modal open={creating} onClose={() => setCreating(false)} title="New Feature Flag">
        <ModalBody>
          <div className="flex flex-col gap-3">
            <Input label="Key" value={newFlag.key} onChange={(e) => setNewFlag((f) => ({ ...f, key: e.target.value }))} placeholder="my_feature_flag" />
            <Input label="Description" value={newFlag.description} onChange={(e) => setNewFlag((f) => ({ ...f, description: e.target.value }))} placeholder="What this flag controls" />
            <div className="flex items-center gap-2">
              <Toggle checked={newFlag.enabled} onChange={(v) => setNewFlag((f) => ({ ...f, enabled: v }))} />
              <span className="text-sm">Enabled by default</span>
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setCreating(false)}>Cancel</Button>
          <Button onClick={handleCreate}>Create Flag</Button>
        </ModalFooter>
      </Modal>

      {/* Edit Modal */}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={`Edit "${editing?.key}"`}>
        <ModalBody>
          <div className="flex flex-col gap-3">
            <Input label="Description" value={editing?.description || ""} onChange={(e) => setEditing((f) => ({ ...f, description: e.target.value }))} />
            <div className="flex items-center gap-2">
              <Toggle checked={editing?.enabled || false} onChange={(v) => setEditing((f) => ({ ...f, enabled: v }))} />
              <span className="text-sm">Enabled</span>
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
          <Button onClick={handleSaveEdit}>Save</Button>
        </ModalFooter>
      </Modal>

      {/* Delete Confirm */}
      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Delete Feature Flag" destructive>
        <ModalBody>
          <p className="text-sm text-[var(--color-text-secondary)]">
            This will permanently remove the flag <strong>{confirmDelete?.key}</strong>. The app will no longer be able to check this flag.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setConfirmDelete(null)}>Cancel</Button>
          <Button variant="danger" onClick={() => handleDelete(confirmDelete)}>Delete Flag</Button>
        </ModalFooter>
      </Modal>

      {/* History Modal */}
      <Modal open={!!historyModal} onClose={() => { setHistoryModal(null); setHistoryData([]); }} title={`History: ${historyModal?.key}`} size="lg">
        <ModalBody>
          {historyData.length === 0 ? (
            <p className="text-sm text-[var(--color-text-tertiary)] text-center py-6">No history recorded.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {historyData.map((entry) => (
                <div key={entry.id} className="flex items-center gap-3 text-sm py-2 border-b border-[var(--gray-100)]">
                  <span className="text-[var(--color-text-tertiary)] w-32 shrink-0">{formatDate(entry.created_at)}</span>
                  <span className="text-[var(--color-text-primary)]">{entry.action}</span>
                  <span className="text-[var(--color-text-tertiary)] text-xs truncate">{entry.admin_email}</span>
                </div>
              ))}
            </div>
          )}
        </ModalBody>
      </Modal>
    </div>
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
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [newConfig, setNewConfig] = useState({ key: "", value: "", type: "string" });
  const [confirmDelete, setConfirmDelete] = useState(null);

  const fetchConfigs = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from("app_config").select("*").order("key");
    if (!mountedRef.current) return;
    if (!error) setConfigs(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchConfigs(); }, [fetchConfigs]);

  const handleCreate = async () => {
    if (!newConfig.key.trim()) { addToast("Key is required", "error"); return; }
    const { error } = await supabase.from("app_config").insert({
      key: newConfig.key.trim(),
      value: newConfig.value,
      value_type: newConfig.type,
    });
    if (error) { addToast(error.message, "error"); return; }
    addToast("Config created", "success");
    logAdminAction("config.create", "config", newConfig.key, { key: newConfig.key });
    setCreating(false);
    setNewConfig({ key: "", value: "", type: "string" });
    fetchConfigs();
  };

  const handleSaveEdit = async () => {
    const oldVal = configs.find((c) => c.id === editing.id)?.value;
    const { error } = await supabase.from("app_config").update({ value: editing.value }).eq("id", editing.id);
    if (error) { addToast(error.message, "error"); return; }
    addToast("Config updated", "success");
    logAdminAction("config.update", "config", editing.key, { key: editing.key, old_value: oldVal, new_value: editing.value });
    setEditing(null);
    fetchConfigs();
  };

  const handleDelete = async (cfg) => {
    const { error } = await supabase.from("app_config").delete().eq("id", cfg.id);
    if (error) { addToast(error.message, "error"); return; }
    addToast("Config deleted", "success");
    logAdminAction("config.delete", "config", cfg.key, { key: cfg.key });
    setConfirmDelete(null);
    fetchConfigs();
  };

  const filtered = configs.filter((c) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return c.key?.toLowerCase().includes(q) || c.value?.toLowerCase().includes(q);
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} onClear={() => setSearch("")} placeholder="Search config..." className="flex-1" />
        <Button icon={Plus} onClick={() => setCreating(true)}>New Config</Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Spinner /></div>
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
                <p className="text-xs text-[var(--color-text-tertiary)] truncate">{String(cfg.value)}</p>
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

// ─── Integrations Tab ───────────────────────────────────────────────────────

function IntegrationsView() {
  const { addToast } = useToast();
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const [integrations, setIntegrations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [newInt, setNewInt] = useState({ name: "", api_key: "", base_url: "", enabled: true });
  const [confirmDelete, setConfirmDelete] = useState(null);

  const fetchIntegrations = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from("integrations").select("*").order("name");
    if (!mountedRef.current) return;
    if (!error) setIntegrations(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchIntegrations(); }, [fetchIntegrations]);

  const handleCreate = async () => {
    if (!newInt.name.trim()) { addToast("Name is required", "error"); return; }
    const { error } = await supabase.from("integrations").insert(newInt);
    if (error) { addToast(error.message, "error"); return; }
    addToast("Integration added", "success");
    logAdminAction("config.create", "integration", newInt.name, { key: newInt.name });
    setCreating(false);
    setNewInt({ name: "", api_key: "", base_url: "", enabled: true });
    fetchIntegrations();
  };

  const handleToggle = async (intg) => {
    const { error } = await supabase.from("integrations").update({ enabled: !intg.enabled }).eq("id", intg.id);
    if (error) { addToast(error.message, "error"); return; }
    logAdminAction("config.update", "integration", intg.name, { key: intg.name, old_value: intg.enabled, new_value: !intg.enabled });
    fetchIntegrations();
  };

  const handleDelete = async (intg) => {
    const { error } = await supabase.from("integrations").delete().eq("id", intg.id);
    if (error) { addToast(error.message, "error"); return; }
    addToast("Integration removed", "success");
    logAdminAction("config.delete", "integration", intg.name, { key: intg.name });
    setConfirmDelete(null);
    fetchIntegrations();
  };

  const filtered = integrations.filter((i) => {
    if (!search) return true;
    return i.name?.toLowerCase().includes(search.toLowerCase());
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} onClear={() => setSearch("")} placeholder="Search integrations..." className="flex-1" />
        <Button icon={Plus} onClick={() => setCreating(true)}>Add Integration</Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-[var(--color-text-tertiary)] text-center py-12">
          {search ? "No integrations match." : "No integrations configured."}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((intg) => (
            <div key={intg.id} className="flex items-center gap-3 p-3 rounded-lg border border-[var(--gray-200)] bg-[var(--color-background-primary)]">
              <Toggle checked={intg.enabled} onChange={() => handleToggle(intg)} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[var(--color-text-primary)]">{intg.name}</p>
                {intg.base_url && <p className="text-xs text-[var(--color-text-tertiary)] truncate">{intg.base_url}</p>}
              </div>
              <Badge variant={intg.enabled ? "success" : "default"}>{intg.enabled ? "Active" : "Off"}</Badge>
              <Button variant="ghost" size="sm" icon={Trash2} onClick={() => setConfirmDelete(intg)} />
            </div>
          ))}
        </div>
      )}

      <Modal open={creating} onClose={() => setCreating(false)} title="Add Integration">
        <ModalBody>
          <div className="flex flex-col gap-3">
            <Input label="Name" value={newInt.name} onChange={(e) => setNewInt((n) => ({ ...n, name: e.target.value }))} placeholder="Service Name" />
            <Input label="API Key" value={newInt.api_key} onChange={(e) => setNewInt((n) => ({ ...n, api_key: e.target.value }))} placeholder="sk-..." type="password" />
            <Input label="Base URL" value={newInt.base_url} onChange={(e) => setNewInt((n) => ({ ...n, base_url: e.target.value }))} placeholder="https://api.example.com" />
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setCreating(false)}>Cancel</Button>
          <Button onClick={handleCreate}>Add</Button>
        </ModalFooter>
      </Modal>

      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Remove Integration" destructive>
        <ModalBody>
          <p className="text-sm text-[var(--color-text-secondary)]">This will remove the <strong>{confirmDelete?.name}</strong> integration.</p>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setConfirmDelete(null)}>Cancel</Button>
          <Button variant="danger" onClick={() => handleDelete(confirmDelete)}>Remove</Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}

// ─── Testing Tools Tab ─────────────────────────────────────────────────────

function TestingToolsView() {
  const { addToast } = useToast();
  const [userEmail, setUserEmail] = useState("");
  const [resettingSingle, setResettingSingle] = useState(false);
  const [resettingAll, setResettingAll] = useState(false);
  const [confirmResetAll, setConfirmResetAll] = useState(false);

  const handleResetSingle = async () => {
    if (!userEmail.trim()) {
      addToast("Enter a user email", "error");
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
        addToast(findError.message, "error");
      } else if (!user) {
        addToast("No user found with that email", "error");
      } else {
        // Always set to 0, even if already 0
        const { error: updateError } = await supabase
          .from("profiles")
          .update({ coach_mark_step: 0 })
          .eq("id", user.id);

        if (updateError) {
          addToast(updateError.message, "error");
        } else {
          const prev = user.coach_mark_step;
          addToast(`Coach mark reset for ${userEmail.trim()}${prev === 0 ? " (was already at start)" : ` (was on step ${prev})`}`, "success");
          logAdminAction("testing.reset_coach_mark", "profile", userEmail.trim(), { scope: "single", previous_step: prev });
          setUserEmail("");
        }
      }
    } catch (e) {
      addToast("Reset failed", "error");
    } finally {
      setResettingSingle(false);
    }
  };

  const handleResetAll = async () => {
    setResettingAll(true);
    try {
      const { error, count } = await supabase
        .from("profiles")
        .update({ coach_mark_step: 0 })
        .neq("coach_mark_step", 0);

      if (error) {
        addToast(error.message, "error");
      } else {
        addToast(`Coach mark reset for all users`, "success");
        logAdminAction("testing.reset_coach_mark", "profile", "all", { scope: "all" });
      }
    } catch (e) {
      addToast("Reset failed", "error");
    } finally {
      setResettingAll(false);
      setConfirmResetAll(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <SectionCard title="Coach Mark Tour" icon={FlaskConical}>
        <p className="text-sm text-[var(--color-text-secondary)] mb-4">
          Reset the guided tour so it restarts from Step 1. Use this to test the first-time user experience without deleting accounts.
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
              onClick={() => setConfirmResetAll(true)}
              disabled={resettingAll}
              icon={RotateCcw}
            >
              Reset ALL Users
            </Button>
            <span className="text-xs text-[var(--color-text-tertiary)]">
              Restarts the tour for every user in the database
            </span>
          </div>
        </div>
      </SectionCard>

      <Modal open={confirmResetAll} onClose={() => setConfirmResetAll(false)} title="Reset Coach Marks for All Users" destructive>
        <ModalBody>
          <p className="text-sm text-[var(--color-text-secondary)]">
            This will restart the guided tour for <strong>every user</strong>. They will all see the coach mark tour again on their next app open. Are you sure?
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setConfirmResetAll(false)}>Cancel</Button>
          <Button variant="danger" onClick={handleResetAll} disabled={resettingAll}>
            {resettingAll ? "Resetting..." : "Yes, Reset All"}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}

// ─── Main Settings Page ─────────────────────────────────────────────────────

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState("appearance");

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Settings</h1>

      <Tabs tabs={SUB_TABS} activeTab={activeTab} onChange={setActiveTab} />

      {activeTab === "appearance" && <AppearanceView />}
      {activeTab === "flags" && <FeatureFlagsView />}
      {activeTab === "config" && <AppConfigView />}
      {activeTab === "integrations" && <IntegrationsView />}
      {activeTab === "testing" && <TestingToolsView />}
    </div>
  );
}
