/**
 * COMPANY TOOLS PAGE (#/company-tools) — the company MCP servers behind the
 * Mingla connector (issue #4294). Owner only.
 *
 * Each tool has a label, an address, an on/off switch, the roles that may
 * use it and the exact tool names it offers (default deny: nothing is
 * offered until listed). Its key is write-only: typed into a password box
 * (no reveal, no autofill), sent once, then cleared. The page shows only
 * "Key set, last updated <date> by <name>" or "No key yet": never any part
 * of a key, in the page, a toast, the address or browser storage.
 *
 * States: loading, error (nothing editable, Retry), empty, populated; every
 * save disables its button while it runs and says how it went.
 */
import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "../components/ui/PageHeader";
import { SectionCard, AlertCard } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Skeleton } from "../components/ui/Skeleton";
import { LoadError } from "../components/ui/LoadError";
import { Input, Textarea, Toggle } from "../components/ui/Input";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import { useCompanyTools } from "../hooks/useMinglaConnector";
import {
  CONNECT_WORDS,
  ROLE_OPTIONS,
  SLUG_RULE,
  clearCompanyToolKey,
  hostOf,
  keyLooksUsable,
  keyStatusLine,
  parseToolList,
  saveCompanyTool,
  setCompanyToolKey,
} from "../services/minglaConnectorService";

const fmtDate = (d) => {
  try {
    return new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return "";
  }
};

/** The words for a refused save. Never anything the person typed. */
function saveWords(err) {
  if (err?.token === "network") return CONNECT_WORDS.network;
  if (err?.token === "forbidden") return CONNECT_WORDS.ownerOnly;
  return err?.message || "That didn't save. Try again.";
}

/**
 * The write-only key box. The value lives only in this component's state and
 * is emptied on save, on cancel, and when the component goes away.
 */
function KeyForm({ row, onSaved, onClose }) {
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => () => setValue(""), []);
  const save = async () => {
    if (!keyLooksUsable(value)) {
      setError(CONNECT_WORDS.keyRefused);
      return;
    }
    setSaving(true);
    setError("");
    try {
      await setCompanyToolKey(row.slug, value);
      setValue("");
      onSaved();
    } catch (err) {
      setValue("");
      setError(err?.message || "That key wasn't saved. Try again.");
    } finally {
      setSaving(false);
    }
  };
  const cancel = () => {
    setValue("");
    onClose();
  };
  const id = `key-${row.slug}`;
  return (
    <div className="mt-2 rounded-lg border border-[var(--gray-200)] p-3">
      <label htmlFor={id} className="block text-sm font-medium text-[var(--color-text-primary)]">
        {row.key_set ? "New key" : "Key"} for {row.label}
      </label>
      <input
        id={id}
        type="password"
        name={`company-tool-key-${row.slug}`}
        autoComplete="new-password"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        data-1p-ignore="true"
        data-lpignore="true"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="mt-1.5 w-full h-10 px-3 text-sm bg-[var(--color-background-primary)] text-[var(--color-text-primary)] border border-[var(--gray-300)] rounded-lg outline-none focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-100)]"
      />
      <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">
        Stored encrypted. It is never shown again, not even in part.
      </p>
      {error && (
        <p role="alert" className="mt-1 text-xs text-[#ef4444]">
          {error}
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <Button size="sm" className="min-h-11 sm:min-h-0" disabled={!value} loading={saving} onClick={save}>
          Save key
        </Button>
        <Button size="sm" variant="secondary" className="min-h-11 sm:min-h-0" disabled={saving} onClick={cancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function ToolRow({ row, onChanged }) {
  const { addToast } = useToast();
  const [enabled, setEnabled] = useState(row.enabled);
  const [roles, setRoles] = useState(row.allowed_roles ?? []);
  const [toolsText, setToolsText] = useState((row.tool_allowlist ?? []).join("\n"));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [keyOpen, setKeyOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const parsed = parseToolList(toolsText);

  const save = async () => {
    if (parsed.errors.length) return;
    setSaving(true);
    setError("");
    try {
      await saveCompanyTool({ slug: row.slug, enabled, allowed_roles: roles, tool_allowlist: parsed.tools });
      addToast({ variant: "success", title: `${row.label} saved` });
      onChanged();
    } catch (err) {
      setError(saveWords(err));
    } finally {
      setSaving(false);
    }
  };

  const removeKey = async () => {
    setRemoving(true);
    try {
      await clearCompanyToolKey(row.slug);
      addToast({ variant: "success", title: `${row.label}'s key was removed`, description: "The tool is off." });
      setConfirmRemove(false);
      onChanged();
    } catch (err) {
      setError(saveWords(err));
    } finally {
      setRemoving(false);
    }
  };

  const toggleRole = (id) => setRoles((r) => (r.includes(id) ? r.filter((x) => x !== id) : [...r, id]));

  return (
    <li className="border-t border-[var(--gray-200)] px-4 py-4 first:border-t-0 sm:px-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-[var(--color-text-primary)]">
            {row.label} <span className="text-xs text-[var(--color-text-tertiary)]">({row.slug})</span>
          </p>
          <p className="text-xs text-[var(--color-text-secondary)] break-all">{hostOf(row.mcp_url)}</p>
        </div>
        <Toggle
          label={enabled ? "On" : "Off"}
          checked={enabled}
          disabled={!row.key_set || saving}
          onChange={setEnabled}
        />
      </div>

      <div className="mt-3">
        <p className="text-sm text-[var(--color-text-primary)]">
          <Badge variant={row.key_set ? "success" : "default"}>{keyStatusLine(row, fmtDate)}</Badge>
        </p>
        {!keyOpen && (
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" className="min-h-11 sm:min-h-0" onClick={() => setKeyOpen(true)}>
              {row.key_set ? "Replace key" : "Set key"}
            </Button>
            {row.key_set && !confirmRemove && (
              <Button size="sm" variant="secondary" className="min-h-11 sm:min-h-0" onClick={() => setConfirmRemove(true)}>
                Remove key
              </Button>
            )}
            {confirmRemove && (
              <>
                <Button size="sm" variant="danger" className="min-h-11 sm:min-h-0" loading={removing} onClick={removeKey}>
                  Remove key and turn off
                </Button>
                <Button size="sm" variant="secondary" className="min-h-11 sm:min-h-0" disabled={removing} onClick={() => setConfirmRemove(false)}>
                  Keep it
                </Button>
              </>
            )}
          </div>
        )}
        {keyOpen && (
          <KeyForm
            row={row}
            onClose={() => setKeyOpen(false)}
            onSaved={() => {
              setKeyOpen(false);
              addToast({ variant: "success", title: `${row.label}'s key is set` });
              onChanged();
            }}
          />
        )}
      </div>

      <fieldset className="mt-4">
        <legend className="text-sm font-medium text-[var(--color-text-primary)]">Roles that may use it</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {ROLE_OPTIONS.map((r) => (
            <label key={r.id} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-[var(--gray-300)] px-3 text-sm sm:min-h-0 sm:py-1">
              <input type="checkbox" checked={roles.includes(r.id)} onChange={() => toggleRole(r.id)} />
              {r.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-4">
        <Textarea
          label="Tools to offer, one per line"
          helper="Exact names only. Nothing is offered until it is listed."
          rows={4}
          value={toolsText}
          error={parsed.errors[0]}
          onChange={(e) => setToolsText(e.target.value)}
        />
      </div>

      {error && (
        <p role="alert" className="mt-2 text-sm text-[#ef4444]">
          {error}
        </p>
      )}
      <div className="mt-3">
        <Button size="sm" className="min-h-11 sm:min-h-0" loading={saving} disabled={parsed.errors.length > 0} onClick={save}>
          Save
        </Button>
      </div>
    </li>
  );
}

function AddTool({ onAdded }) {
  const { addToast } = useToast();
  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState("");
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const slugOk = SLUG_RULE.test(slug);
  const add = async () => {
    setSaving(true);
    setError("");
    try {
      await saveCompanyTool({ slug, label: label.trim(), mcp_url: url.trim() });
      addToast({ variant: "success", title: `${label.trim()} added`, description: "Set its key, then choose roles and tools." });
      setOpen(false);
      setSlug("");
      setLabel("");
      setUrl("");
      onAdded();
    } catch (err) {
      setError(saveWords(err));
    } finally {
      setSaving(false);
    }
  };
  if (!open) {
    return (
      <Button size="sm" className="min-h-11 sm:min-h-0" onClick={() => setOpen(true)}>
        Add company tool
      </Button>
    );
  }
  return (
    <SectionCard title="Add a company tool">
      <div className="grid gap-3 sm:grid-cols-3">
        <Input
          label="Short name"
          helper="2 to 20 lower-case letters and digits"
          value={slug}
          error={slug && !slugOk ? "Lower-case letters and digits, starting with a letter." : undefined}
          onChange={(e) => setSlug(e.target.value.trim())}
        />
        <Input label="Label" value={label} onChange={(e) => setLabel(e.target.value)} />
        <Input label="MCP address" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} />
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-[#ef4444]">
          {error}
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <Button size="sm" loading={saving} disabled={!slugOk || !label.trim() || !url.trim()} onClick={add}>
          Add
        </Button>
        <Button size="sm" variant="secondary" disabled={saving} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </SectionCard>
  );
}

export function CompanyToolsPage() {
  const { access } = useAuth();
  const isOwner = access?.role === "owner";
  const tools = useCompanyTools(isOwner);
  const refresh = useCallback(() => {
    tools.refetch();
    tools.refetchCalls();
  }, [tools]);

  const pageHeader = (
    <PageHeader
      title="Company tools"
      description="Company MCP servers your team can use from Claude through the Mingla connector."
    />
  );

  if (!isOwner) {
    return (
      <div className="space-y-6">
        {pageHeader}
        <AlertCard variant="info" title="Owner only">
          {CONNECT_WORDS.ownerOnly}
        </AlertCard>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {pageHeader}
      {!tools.loading && !tools.error && <AddTool onAdded={refresh} />}
      {tools.loading && !tools.rows.length ? (
        <SectionCard title="Tools">
          <div aria-busy="true" className="space-y-3">
            <Skeleton height={20} />
            <Skeleton height={20} />
            <Skeleton height={20} width="60%" />
          </div>
        </SectionCard>
      ) : tools.error ? (
        <LoadError title="Couldn't load company tools" onRetry={tools.refetch} />
      ) : tools.rows.length === 0 ? (
        <SectionCard title="Tools">
          <p className="text-sm text-[var(--color-text-secondary)]">No company tools yet.</p>
        </SectionCard>
      ) : (
        <SectionCard title="Tools" noPadding>
          <ul>
            {tools.rows.map((row) => (
              // A row read again after a save starts its form from the new values.
              <ToolRow key={`${row.slug}|${row.updated_at}`} row={row} onChanged={refresh} />
            ))}
          </ul>
        </SectionCard>
      )}

      <SectionCard title="Last 20 calls" subtitle="Who, which tool, when and how it ended. Never what was asked or answered.">
        {tools.callsLoading ? (
          <Skeleton height={20} />
        ) : tools.callsError ? (
          <LoadError title="Couldn't load the latest calls" onRetry={tools.refetchCalls} />
        ) : tools.calls.length === 0 ? (
          <p className="text-sm text-[var(--color-text-secondary)]">No calls yet.</p>
        ) : (
          <ul className="divide-y divide-[var(--gray-200)] text-sm">
            {tools.calls.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="text-[var(--color-text-primary)]">
                  {c.who} · {c.upstream}__{c.tool}
                </span>
                <span className="text-xs text-[var(--color-text-secondary)]">
                  <Badge variant={c.outcome === "ok" ? "success" : "default"}>{c.outcome}</Badge>{" "}
                  <time dateTime={c.started_at}>{fmtDate(c.started_at)}</time>
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
