import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { SectionCard } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input, Textarea, Toggle } from "../components/ui/Input";
import { Badge } from "../components/ui/Badge";
import { DataTable } from "../components/ui/Table";
import { Modal, ModalBody, ModalFooter } from "../components/ui/Modal";
import { useToast } from "../context/ToastContext";
import {
  ToggleLeft, ToggleRight, Settings, Puzzle, Plus,
  Trash2, Pencil, Save, Check, X, Key, AlertTriangle,
} from "lucide-react";

// ─── Sub-tab definitions ────────────────────────────────────────────
const SUB_TABS = [
  { id: "flags", label: "Feature Flags", icon: ToggleLeft },
  { id: "config", label: "App Config", icon: Settings },
  { id: "integrations", label: "Integrations", icon: Puzzle },
];

// ─── Value-type badge variants ──────────────────────────────────────
const TYPE_BADGE = {
  string: "default",
  number: "info",
  boolean: "success",
  json: "brand",
};

// ─── Suggested defaults for empty config table ──────────────────────
const SUGGESTED_CONFIGS = [
  { key: "max_friends", value: "50", type: "number", desc: "Maximum friends per user" },
  { key: "card_pool_size", value: "20", type: "number", desc: "Cards per discover session" },
  { key: "discover_daily_limit", value: "100", type: "number", desc: "Max daily discovers" },
  { key: "min_app_version", value: "1.0.0", type: "string", desc: "Minimum supported app version" },
  { key: "maintenance_mode", value: "false", type: "boolean", desc: "Enable maintenance mode" },
];

// ─── Helpers ────────────────────────────────────────────────────────
function toSnakeCase(str) {
  return str.toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
}

const API_KEY_PREVIEW_MAX = 12;

function truncateKeyPreview(value) {
  if (!value) return value;
  return value.slice(0, API_KEY_PREVIEW_MAX);
}

function validateConfigValue(value, valueType) {
  if (!value && value !== "0") return "Value is required";
  if (valueType === "number") {
    const trimmed = value.trim();
    if (!trimmed || isNaN(Number(trimmed))) return "Value must be a valid number";
  }
  if (valueType === "boolean" && !["true", "false"].includes(value.trim())) return "Value must be 'true' or 'false'";
  if (valueType === "json") {
    try { JSON.parse(value); } catch { return "Value must be valid JSON"; }
  }
  return null;
}

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ═════════════════════════════════════════════════════════════════════
// FEATURE FLAGS SUB-VIEW
// ═════════════════════════════════════════════════════════════════════
function FeatureFlagsView() {
  const { addToast } = useToast();
  const [flags, setFlags] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newFlag, setNewFlag] = useState({ flag_key: "", description: "" });
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState(null);

  const fetchFlags = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("feature_flags")
      .select("*")
      .order("flag_key", { ascending: true });
    if (error) {
      addToast({ variant: "error", title: "Failed to load flags", description: error.message });
    }
    setFlags(data || []);
    setLoading(false);
  }, [addToast]);

  useEffect(() => { fetchFlags(); }, [fetchFlags]);

  async function handleCreate() {
    const key = toSnakeCase(newFlag.flag_key);
    if (!key) {
      addToast({ variant: "error", title: "Flag key is required" });
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("feature_flags").insert({
      flag_key: key,
      description: newFlag.description || null,
      is_enabled: false,
    });
    setSaving(false);
    if (error) {
      addToast({ variant: "error", title: "Failed to create flag", description: error.message });
      return;
    }
    addToast({ variant: "success", title: `Flag "${key}" created` });
    setShowCreate(false);
    setNewFlag({ flag_key: "", description: "" });
    fetchFlags();
  }

  async function toggleFlag(id, currentlyEnabled) {
    setTogglingId(id);
    const { error } = await supabase
      .from("feature_flags")
      .update({ is_enabled: !currentlyEnabled })
      .eq("id", id);
    setTogglingId(null);
    if (error) {
      addToast({ variant: "error", title: "Toggle failed", description: error.message });
      return;
    }
    addToast({ variant: "success", title: `Flag ${currentlyEnabled ? "disabled" : "enabled"}` });
    fetchFlags();
  }

  async function deleteFlag(id, key) {
    if (!confirm(`Delete flag "${key}"? The app will no longer be able to check this flag.`)) return;
    const { error } = await supabase.from("feature_flags").delete().eq("id", id);
    if (error) {
      addToast({ variant: "error", title: "Delete failed", description: error.message });
      return;
    }
    addToast({ variant: "success", title: "Flag deleted" });
    fetchFlags();
  }

  return (
    <SectionCard
      title="Feature Flags"
      subtitle="Manage feature toggles. The mobile app reads these to enable/disable features without redeployment."
      action={
        <Button size="sm" icon={Plus} onClick={() => setShowCreate(true)}>
          New Flag
        </Button>
      }
    >
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-6 h-6 border-2 border-[var(--color-accent,#f97316)] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : flags.length === 0 ? (
        <div className="text-center py-12">
          <ToggleLeft className="w-10 h-10 mx-auto mb-3" style={{ color: "var(--color-text-tertiary)" }} />
          <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>No feature flags yet</p>
          <p className="text-xs mt-1" style={{ color: "var(--color-text-tertiary)" }}>
            Create your first flag to control app features remotely.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {flags.map(flag => (
            <div
              key={flag.id}
              className="flex items-center justify-between p-4 rounded-lg border"
              style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-surface, var(--color-background-primary))" }}
            >
              <div className="min-w-0 flex-1 mr-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <code className="text-sm font-mono" style={{ color: "var(--color-text-primary)" }}>
                    {flag.flag_key}
                  </code>
                  <Badge variant={flag.is_enabled ? "success" : "default"} dot>
                    {flag.is_enabled ? "Enabled" : "Disabled"}
                  </Badge>
                </div>
                {flag.description && (
                  <p className="text-xs mt-1 truncate" style={{ color: "var(--color-text-secondary)" }}>
                    {flag.description}
                  </p>
                )}
                <p className="text-xs mt-1" style={{ color: "var(--color-text-tertiary)" }}>
                  Updated: {formatDate(flag.updated_at)}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  variant={flag.is_enabled ? "primary" : "ghost"}
                  size="sm"
                  loading={togglingId === flag.id}
                  onClick={() => toggleFlag(flag.id, flag.is_enabled)}
                >
                  {flag.is_enabled ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => deleteFlag(flag.id, flag.flag_key)}>
                  <Trash2 size={14} />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Flag Modal */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New Feature Flag" size="sm">
        <ModalBody>
          <div className="space-y-4">
            <Input
              label="Flag Key"
              placeholder="e.g. dark_mode_v2"
              value={newFlag.flag_key}
              onChange={e => setNewFlag(f => ({ ...f, flag_key: e.target.value }))}
              helper="Auto-converted to snake_case"
            />
            <Textarea
              label="Description (optional)"
              placeholder="What this flag controls..."
              value={newFlag.description}
              onChange={e => setNewFlag(f => ({ ...f, description: e.target.value }))}
            />
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
          <Button icon={Plus} loading={saving} onClick={handleCreate}>Create Flag</Button>
        </ModalFooter>
      </Modal>
    </SectionCard>
  );
}

// ═════════════════════════════════════════════════════════════════════
// APP CONFIG SUB-VIEW
// ═════════════════════════════════════════════════════════════════════
function AppConfigView() {
  const { addToast } = useToast();
  const [configs, setConfigs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newConfig, setNewConfig] = useState({ config_key: "", config_value: "", value_type: "string", description: "" });
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState("");
  const [createSaving, setCreateSaving] = useState(false);
  const [editSavingId, setEditSavingId] = useState(null);

  const fetchConfigs = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("app_config")
      .select("*")
      .order("config_key", { ascending: true });
    if (error) {
      addToast({ variant: "error", title: "Failed to load configs", description: error.message });
    }
    setConfigs(data || []);
    setLoading(false);
  }, [addToast]);

  useEffect(() => { fetchConfigs(); }, [fetchConfigs]);

  async function handleCreate() {
    const key = toSnakeCase(newConfig.config_key);
    if (!key) {
      addToast({ variant: "error", title: "Config key is required" });
      return;
    }
    const valError = validateConfigValue(newConfig.config_value, newConfig.value_type);
    if (valError) {
      addToast({ variant: "error", title: valError });
      return;
    }
    setCreateSaving(true);
    const { error } = await supabase.from("app_config").insert({
      config_key: key,
      config_value: newConfig.config_value,
      value_type: newConfig.value_type,
      description: newConfig.description || null,
    });
    setCreateSaving(false);
    if (error) {
      addToast({ variant: "error", title: "Failed to create config", description: error.message });
      return;
    }
    addToast({ variant: "success", title: `Config "${key}" created` });
    setShowCreate(false);
    setNewConfig({ config_key: "", config_value: "", value_type: "string", description: "" });
    fetchConfigs();
  }

  function startEdit(config) {
    setEditingId(config.id);
    setEditValue(config.config_value);
  }

  async function handleSave(id, valueType) {
    const valError = validateConfigValue(editValue, valueType);
    if (valError) {
      addToast({ variant: "error", title: valError });
      return;
    }
    setEditSavingId(id);
    const { error } = await supabase.from("app_config").update({ config_value: editValue }).eq("id", id);
    setEditSavingId(null);
    if (error) {
      addToast({ variant: "error", title: "Update failed", description: error.message });
      return;
    }
    addToast({ variant: "success", title: "Config updated" });
    setEditingId(null);
    fetchConfigs();
  }

  async function deleteConfig(id, key) {
    if (!confirm(`Delete config "${key}"?`)) return;
    const { error } = await supabase.from("app_config").delete().eq("id", id);
    if (error) {
      addToast({ variant: "error", title: "Delete failed", description: error.message });
      return;
    }
    addToast({ variant: "success", title: "Config deleted" });
    fetchConfigs();
  }

  const columns = [
    {
      key: "config_key",
      label: "Key",
      render: (_v, row) => (
        <code className="text-xs font-mono" style={{ color: "var(--color-text-primary)" }}>
          {row.config_key}
        </code>
      ),
    },
    {
      key: "config_value",
      label: "Value",
      render: (_v, row) => {
        if (editingId === row.id) {
          return (
            <div className="flex items-center gap-2">
              {row.value_type === "boolean" ? (
                <select
                  value={editValue}
                  onChange={e => setEditValue(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter") handleSave(row.id, row.value_type);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  className="text-xs px-2 py-1 rounded border bg-transparent"
                  style={{
                    borderColor: "var(--color-border)",
                    color: "var(--color-text-primary)",
                    backgroundColor: "var(--color-background-primary)",
                  }}
                  autoFocus
                >
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              ) : (
                <input
                  type={row.value_type === "number" ? "number" : "text"}
                  value={editValue}
                  onChange={e => setEditValue(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter") handleSave(row.id, row.value_type);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  className="text-xs px-2 py-1 rounded border bg-transparent w-full max-w-[200px]"
                  style={{
                    borderColor: "var(--color-border)",
                    color: "var(--color-text-primary)",
                    backgroundColor: "var(--color-background-primary)",
                  }}
                  autoFocus
                />
              )}
              <Button variant="ghost" size="sm" loading={editSavingId === row.id} onClick={() => handleSave(row.id, row.value_type)}>
                <Check size={14} />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>
                <X size={14} />
              </Button>
            </div>
          );
        }
        return (
          <span className="text-xs font-mono" style={{ color: "var(--color-text-primary)" }}>
            {row.config_value}
          </span>
        );
      },
    },
    {
      key: "value_type",
      label: "Type",
      render: (_v, row) => <Badge variant={TYPE_BADGE[row.value_type] || "default"}>{row.value_type}</Badge>,
    },
    {
      key: "description",
      label: "Description",
      render: (_v, row) => (
        <span className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
          {row.description || "—"}
        </span>
      ),
    },
    {
      key: "updated_at",
      label: "Updated",
      render: (_v, row) => (
        <span className="text-xs" style={{ color: "var(--color-text-tertiary)" }}>
          {formatDate(row.updated_at)}
        </span>
      ),
    },
    {
      key: "actions",
      label: "",
      width: "100px",
      render: (_v, row) => (
        <div className="flex items-center gap-1 justify-end">
          <Button variant="ghost" size="sm" onClick={() => startEdit(row)}>
            <Pencil size={14} />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => deleteConfig(row.id, row.config_key)}>
            <Trash2 size={14} />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <SectionCard
      title="App Config"
      subtitle="Key-value configuration store. The mobile app reads these to tune behavior without redeployment."
      action={
        <Button size="sm" icon={Plus} onClick={() => setShowCreate(true)}>
          New Config
        </Button>
      }
      noPadding
    >
      <DataTable
        columns={columns}
        rows={configs}
        loading={loading}
        emptyIcon={Settings}
        emptyMessage="No config values yet"
        emptyAction={
          <div className="mt-4 text-left max-w-md mx-auto">
            <p className="text-xs font-medium mb-2" style={{ color: "var(--color-text-secondary)" }}>
              Suggested configs to create:
            </p>
            <div className="space-y-1">
              {SUGGESTED_CONFIGS.map(s => (
                <p key={s.key} className="text-xs font-mono" style={{ color: "var(--color-text-tertiary)" }}>
                  {s.key}: {s.value} ({s.type}) — {s.desc}
                </p>
              ))}
            </div>
          </div>
        }
      />

      {/* Create Config Modal */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New Config Value" size="sm">
        <ModalBody>
          <div className="space-y-4">
            <Input
              label="Config Key"
              placeholder="e.g. max_friends"
              value={newConfig.config_key}
              onChange={e => setNewConfig(c => ({ ...c, config_key: e.target.value }))}
              helper="Auto-converted to snake_case"
            />
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--color-text-secondary)" }}>
                Value Type
              </label>
              <select
                value={newConfig.value_type}
                onChange={e => setNewConfig(c => ({ ...c, value_type: e.target.value, config_value: "" }))}
                className="w-full text-sm px-3 py-2 rounded-lg border bg-transparent"
                style={{
                  borderColor: "var(--color-border)",
                  color: "var(--color-text-primary)",
                  backgroundColor: "var(--color-background-primary)",
                }}
              >
                <option value="string">String</option>
                <option value="number">Number</option>
                <option value="boolean">Boolean</option>
                <option value="json">JSON</option>
              </select>
            </div>
            {newConfig.value_type === "boolean" ? (
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--color-text-secondary)" }}>
                  Value
                </label>
                <select
                  value={newConfig.config_value}
                  onChange={e => setNewConfig(c => ({ ...c, config_value: e.target.value }))}
                  className="w-full text-sm px-3 py-2 rounded-lg border bg-transparent"
                  style={{
                    borderColor: "var(--color-border)",
                    color: "var(--color-text-primary)",
                    backgroundColor: "var(--color-background-primary)",
                  }}
                >
                  <option value="">Select...</option>
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              </div>
            ) : newConfig.value_type === "json" ? (
              <Textarea
                label="Value"
                placeholder='{"key": "value"}'
                value={newConfig.config_value}
                onChange={e => setNewConfig(c => ({ ...c, config_value: e.target.value }))}
              />
            ) : (
              <Input
                label="Value"
                type={newConfig.value_type === "number" ? "number" : "text"}
                placeholder={newConfig.value_type === "number" ? "e.g. 50" : "e.g. 1.0.0"}
                value={newConfig.config_value}
                onChange={e => setNewConfig(c => ({ ...c, config_value: e.target.value }))}
              />
            )}
            <Input
              label="Description (optional)"
              placeholder="What this config controls..."
              value={newConfig.description}
              onChange={e => setNewConfig(c => ({ ...c, description: e.target.value }))}
            />
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
          <Button icon={Plus} loading={createSaving} onClick={handleCreate}>Create Config</Button>
        </ModalFooter>
      </Modal>
    </SectionCard>
  );
}

// ═════════════════════════════════════════════════════════════════════
// INTEGRATIONS SUB-VIEW
// ═════════════════════════════════════════════════════════════════════
function IntegrationsView() {
  const { addToast } = useToast();
  const [integrations, setIntegrations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newIntegration, setNewIntegration] = useState({ service_name: "", display_name: "", description: "", api_key_preview: "" });
  const [editTarget, setEditTarget] = useState(null);
  const [editPreview, setEditPreview] = useState("");
  const [editConfigData, setEditConfigData] = useState("");
  const [updateSaving, setUpdateSaving] = useState(false);
  const [addSaving, setAddSaving] = useState(false);

  const fetchIntegrations = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("integrations")
      .select("*")
      .order("display_name", { ascending: true });
    if (error) {
      addToast({ variant: "error", title: "Failed to load integrations", description: error.message });
    }
    setIntegrations(data || []);
    setLoading(false);
  }, [addToast]);

  useEffect(() => { fetchIntegrations(); }, [fetchIntegrations]);

  function openEdit(integration) {
    setEditTarget(integration);
    setEditPreview(integration.api_key_preview || "");
    setEditConfigData(integration.config_data ? JSON.stringify(integration.config_data, null, 2) : "{}");
  }

  async function handleUpdate() {
    if (!editTarget) return;
    // Validate config_data JSON if provided
    let parsedConfig = {};
    if (editConfigData.trim()) {
      try {
        parsedConfig = JSON.parse(editConfigData);
      } catch {
        addToast({ variant: "error", title: "Config data must be valid JSON" });
        return;
      }
    }
    const truncatedPreview = truncateKeyPreview(editPreview);
    setUpdateSaving(true);
    const { error } = await supabase
      .from("integrations")
      .update({
        api_key_preview: truncatedPreview || null,
        is_configured: !!truncatedPreview,
        config_data: parsedConfig,
        last_verified_at: new Date().toISOString(),
      })
      .eq("id", editTarget.id);
    setUpdateSaving(false);
    if (error) {
      addToast({ variant: "error", title: "Update failed", description: error.message });
      return;
    }
    addToast({ variant: "success", title: "Integration updated" });
    setEditTarget(null);
    fetchIntegrations();
  }

  async function handleAdd() {
    const serviceName = toSnakeCase(newIntegration.service_name);
    if (!serviceName || !newIntegration.display_name) {
      addToast({ variant: "error", title: "Service name and display name are required" });
      return;
    }
    const truncatedPreview = truncateKeyPreview(newIntegration.api_key_preview);
    setAddSaving(true);
    const { error } = await supabase.from("integrations").insert({
      service_name: serviceName,
      display_name: newIntegration.display_name,
      description: newIntegration.description || null,
      api_key_preview: truncatedPreview || null,
      is_configured: !!truncatedPreview,
    });
    setAddSaving(false);
    if (error) {
      addToast({ variant: "error", title: "Failed to add integration", description: error.message });
      return;
    }
    addToast({ variant: "success", title: "Integration added" });
    setShowAdd(false);
    setNewIntegration({ service_name: "", display_name: "", description: "", api_key_preview: "" });
    fetchIntegrations();
  }

  async function deleteIntegration(id, name) {
    if (!confirm(`Remove integration "${name}"?`)) return;
    const { error } = await supabase.from("integrations").delete().eq("id", id);
    if (error) {
      addToast({ variant: "error", title: "Delete failed", description: error.message });
      return;
    }
    addToast({ variant: "success", title: "Integration removed" });
    fetchIntegrations();
  }

  return (
    <SectionCard
      title="Integrations"
      subtitle="View and manage third-party service connections. API keys are stored in Supabase secrets — only previews are shown here."
      action={
        <Button size="sm" icon={Plus} onClick={() => setShowAdd(true)}>
          Add Integration
        </Button>
      }
    >
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-6 h-6 border-2 border-[var(--color-accent,#f97316)] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : integrations.length === 0 ? (
        <div className="text-center py-12">
          <Puzzle className="w-10 h-10 mx-auto mb-3" style={{ color: "var(--color-text-tertiary)" }} />
          <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>No integrations configured</p>
          <p className="text-xs mt-1" style={{ color: "var(--color-text-tertiary)" }}>
            Run the SQL migration to seed default integrations, or add one manually.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {integrations.map(int => (
            <div
              key={int.id}
              className="p-4 rounded-lg border"
              style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-surface, var(--color-background-primary))" }}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Key size={16} style={{ color: "var(--color-text-tertiary)" }} />
                  <span className="text-sm font-medium" style={{ color: "var(--color-text-primary)" }}>
                    {int.display_name}
                  </span>
                </div>
                <Badge variant={int.is_configured ? "success" : "error"} dot>
                  {int.is_configured ? "Configured" : "Not Configured"}
                </Badge>
              </div>
              {int.description && (
                <p className="text-xs mb-3" style={{ color: "var(--color-text-secondary)" }}>
                  {int.description}
                </p>
              )}
              <div className="space-y-1 mb-3">
                {int.api_key_preview && (
                  <p className="text-xs font-mono" style={{ color: "var(--color-text-tertiary)" }}>
                    API Key: {int.api_key_preview}
                  </p>
                )}
                <p className="text-xs" style={{ color: "var(--color-text-tertiary)" }}>
                  Last Verified: {formatDate(int.last_verified_at)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => openEdit(int)}>
                  Update
                </Button>
                <Button variant="ghost" size="sm" onClick={() => deleteIntegration(int.id, int.display_name)}>
                  <Trash2 size={14} />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Edit Integration Modal */}
      <Modal
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
        title={editTarget ? `Update ${editTarget.display_name}` : ""}
        size="md"
      >
        <ModalBody>
          <div className="space-y-4">
            <div
              className="flex items-start gap-2 p-3 rounded-lg text-xs"
              style={{ backgroundColor: "var(--color-warning-bg, rgba(251,191,36,0.1))", color: "var(--color-text-secondary)" }}
            >
              <AlertTriangle size={16} className="shrink-0 mt-0.5" style={{ color: "var(--color-warning, #fbbf24)" }} />
              <span>
                The actual API key is stored in Supabase secrets, not here.
                This is just a visual reference (first 8 chars + &ldquo;...&rdquo;).
              </span>
            </div>
            <Input
              label="API Key Preview"
              placeholder="e.g. AIzaSyBx..."
              value={editPreview}
              maxLength={API_KEY_PREVIEW_MAX}
              onChange={e => setEditPreview(truncateKeyPreview(e.target.value))}
              helper={`Max ${API_KEY_PREVIEW_MAX} characters — never store full keys here`}
            />
            <Textarea
              label="Additional Config (JSON)"
              placeholder='{"app_id": "..."}'
              value={editConfigData}
              onChange={e => setEditConfigData(e.target.value)}
            />
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setEditTarget(null)}>Cancel</Button>
          <Button icon={Save} loading={updateSaving} onClick={handleUpdate}>Save</Button>
        </ModalFooter>
      </Modal>

      {/* Add Integration Modal */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add Integration" size="sm">
        <ModalBody>
          <div className="space-y-4">
            <Input
              label="Service Name"
              placeholder="e.g. stripe"
              value={newIntegration.service_name}
              onChange={e => setNewIntegration(i => ({ ...i, service_name: e.target.value }))}
              helper="Auto-converted to snake_case (used as unique identifier)"
            />
            <Input
              label="Display Name"
              placeholder="e.g. Stripe Connect"
              value={newIntegration.display_name}
              onChange={e => setNewIntegration(i => ({ ...i, display_name: e.target.value }))}
            />
            <Input
              label="Description (optional)"
              placeholder="What this service does..."
              value={newIntegration.description}
              onChange={e => setNewIntegration(i => ({ ...i, description: e.target.value }))}
            />
            <Input
              label="API Key Preview (optional)"
              placeholder="e.g. sk_live_..."
              value={newIntegration.api_key_preview}
              maxLength={API_KEY_PREVIEW_MAX}
              onChange={e => setNewIntegration(i => ({ ...i, api_key_preview: truncateKeyPreview(e.target.value) }))}
              helper={`Max ${API_KEY_PREVIEW_MAX} characters — never store full keys here`}
            />
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setShowAdd(false)}>Cancel</Button>
          <Button icon={Plus} loading={addSaving} onClick={handleAdd}>Add Integration</Button>
        </ModalFooter>
      </Modal>
    </SectionCard>
  );
}

// ═════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═════════════════════════════════════════════════════════════════════
export function AppConfigPage() {
  const [activeSubTab, setActiveSubTab] = useState("flags");

  return (
    <div className="space-y-6">
      {/* Sub-tab navigation */}
      <div className="flex items-center gap-1 bg-[var(--gray-100)] rounded-lg p-1 w-fit">
        {SUB_TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = activeSubTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveSubTab(tab.id)}
              className={[
                "flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md",
                "transition-all duration-150 cursor-pointer",
                isActive
                  ? "bg-[var(--color-background-primary)] text-[var(--color-text-primary)] shadow-sm"
                  : "text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]",
              ].join(" ")}
            >
              <Icon className="w-4 h-4" />
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Active sub-view */}
      {activeSubTab === "flags" && <FeatureFlagsView />}
      {activeSubTab === "config" && <AppConfigView />}
      {activeSubTab === "integrations" && <IntegrationsView />}
    </div>
  );
}
