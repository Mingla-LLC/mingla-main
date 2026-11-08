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
 *
 * Issue #4294 company sign-in: a row of kind "company sign-in" (Mingla
 * Studio) has no key. It shows Connect / Reconnect / Disconnect and
 * "Connected as X on DATE by Y" or "Reconnect needed"; Connect sends the
 * owner's browser to the tool's own sign-in page and back. It also has a
 * display name, words to hide from Claude, the tools that count as
 * generation calls and the daily limit per person.
 *
 * The On switch saves itself the moment it is pressed (it never shows On
 * before the server has it on), and goes back with a reason if the save is
 * refused. Save saves everything else.
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
  canTurnOn,
  clearCompanyToolKey,
  disconnectCompanySignin,
  hostOf,
  keyLooksUsable,
  keyStatusLine,
  parseDailyCap,
  parseHideWords,
  parseToolList,
  saveCompanyTool,
  setCompanyToolKey,
  signinStatusLine,
  startCompanySignin,
  switchCompanyTool,
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

/**
 * A company sign-in: its status and Connect / Reconnect / Disconnect. The
 * browser goes to the tool's own sign-in page and comes back to a plain page
 * from Mingla's server; no token ever reaches this page.
 */
function SigninPanel({ row, onChanged }) {
  const { addToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const connected = Boolean(row.signin?.connected);
  const reconnect = Boolean(row.signin?.reconnect_needed);

  const connect = async () => {
    setBusy(true);
    setError("");
    try {
      const to = await startCompanySignin(row.slug);
      // Leaves Mingla Admin for the tool's own sign-in page.
      window.location.assign(to);
    } catch (err) {
      setError(err?.message || CONNECT_WORDS.signinUnavailable);
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    setError("");
    try {
      await disconnectCompanySignin(row.slug);
      addToast({ variant: "success", title: `${row.label} is disconnected`, description: "The tool is off." });
      setConfirmDisconnect(false);
      onChanged();
    } catch (err) {
      setError(saveWords(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3">
      <p className="text-sm text-[var(--color-text-primary)]">
        <Badge variant={connected && !reconnect ? "success" : reconnect ? "warning" : "default"}>
          {signinStatusLine(row, fmtDate)}
        </Badge>
      </p>
      <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">
        Company sign-in: no key. Connect opens the tool's own sign-in page; sign in with the company account.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {!confirmDisconnect && (
          <Button size="sm" variant={connected && !reconnect ? "secondary" : "primary"} className="min-h-11 sm:min-h-0" loading={busy} onClick={connect}>
            {connected ? "Reconnect" : "Connect"}
          </Button>
        )}
        {connected && !confirmDisconnect && (
          <Button size="sm" variant="secondary" className="min-h-11 sm:min-h-0" disabled={busy} onClick={() => setConfirmDisconnect(true)}>
            Disconnect
          </Button>
        )}
        {confirmDisconnect && (
          <>
            <Button size="sm" variant="danger" className="min-h-11 sm:min-h-0" loading={busy} onClick={disconnect}>
              Disconnect and turn off
            </Button>
            <Button size="sm" variant="secondary" className="min-h-11 sm:min-h-0" disabled={busy} onClick={() => setConfirmDisconnect(false)}>
              Keep it
            </Button>
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-1 text-xs text-[#ef4444]">
          {error}
        </p>
      )}
    </div>
  );
}

function ToolRow({ row, onChanged }) {
  const { addToast } = useToast();
  const isSignin = row.auth_kind === "signin";
  const [enabled, setEnabled] = useState(row.enabled);
  const [toggling, setToggling] = useState(false);
  const [roles, setRoles] = useState(row.allowed_roles ?? []);
  const [toolsText, setToolsText] = useState((row.tool_allowlist ?? []).join("\n"));
  const [displayLabel, setDisplayLabel] = useState(row.display_label ?? "");
  const [hideText, setHideText] = useState((row.hide_words ?? []).join(", "));
  const [genText, setGenText] = useState((row.generation_tools ?? []).join("\n"));
  const [capText, setCapText] = useState(String(row.daily_generation_cap ?? 40));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [keyOpen, setKeyOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const parsed = parseToolList(toolsText);
  const hide = parseHideWords(hideText);
  const gen = parseToolList(genText);
  const cap = parseDailyCap(capText);
  const signinErrors = isSignin
    ? [...hide.errors, ...gen.errors, ...(cap === null ? ["The daily limit is a whole number from 0 to 10000."] : [])]
    : [];

  // The On switch saves itself at once: it shows On only once the server has it on.
  const toggle = async (next) => {
    setToggling(true);
    setError("");
    const result = await switchCompanyTool(row.slug, next);
    setEnabled(result.enabled);
    if (result.error) setError(saveWords(result.error));
    else addToast({ variant: "success", title: `${row.label} is ${result.enabled ? "on" : "off"}` });
    setToggling(false);
  };

  const save = async () => {
    if (parsed.errors.length || signinErrors.length) return;
    setSaving(true);
    setError("");
    try {
      const fields = { slug: row.slug, allowed_roles: roles, tool_allowlist: parsed.tools };
      if (isSignin) {
        Object.assign(fields, {
          display_label: displayLabel.trim(),
          hide_words: hide.words,
          generation_tools: gen.tools,
          daily_generation_cap: cap,
        });
      }
      await saveCompanyTool(fields);
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
        <div className="flex flex-col items-end">
          <Toggle
            label={toggling ? "Saving…" : enabled ? "On" : "Off"}
            checked={enabled}
            disabled={(!enabled && !canTurnOn(row)) || saving || toggling}
            onChange={toggle}
          />
          <span className="mt-1 text-xs text-[var(--color-text-tertiary)]">
            {canTurnOn(row) || enabled ? "Saves at once" : isSignin ? "Connect first" : "Set a key first"}
          </span>
        </div>
      </div>

      {isSignin ? (
        <SigninPanel row={row} onChanged={onChanged} />
      ) : (
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
      )}

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

      {isSignin && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Input
            label="Name Claude sees"
            helper="Shown instead of the tool's own name, for example Mingla Studio."
            value={displayLabel}
            onChange={(e) => setDisplayLabel(e.target.value)}
          />
          <Input
            label="Words to hide"
            helper="Comma separated. Rewritten to the name above in tool descriptions and answers (never inside links)."
            value={hideText}
            error={hide.errors[0]}
            onChange={(e) => setHideText(e.target.value)}
          />
          <Textarea
            label="Generation tools, one per line"
            helper="Each person's calls to these count toward the daily limit."
            rows={3}
            value={genText}
            error={gen.errors[0]}
            onChange={(e) => setGenText(e.target.value)}
          />
          <Input
            label="Generation calls per person per day"
            helper="0 to 10000. Counted per UTC day."
            inputMode="numeric"
            value={capText}
            error={cap === null ? "A whole number from 0 to 10000." : undefined}
            onChange={(e) => setCapText(e.target.value)}
          />
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-sm text-[#ef4444]">
          {error}
        </p>
      )}
      <div className="mt-3">
        <Button size="sm" className="min-h-11 sm:min-h-0" loading={saving} disabled={parsed.errors.length > 0 || signinErrors.length > 0} onClick={save}>
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
  const [kind, setKind] = useState("key");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const slugOk = SLUG_RULE.test(slug);
  const add = async () => {
    setSaving(true);
    setError("");
    try {
      await saveCompanyTool({ slug, label: label.trim(), mcp_url: url.trim(), auth_kind: kind });
      addToast({
        variant: "success",
        title: `${label.trim()} added`,
        description: kind === "signin" ? "Connect it, then choose roles and tools." : "Set its key, then choose roles and tools.",
      });
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
      <fieldset className="mt-3">
        <legend className="text-sm font-medium text-[var(--color-text-primary)]">How it signs in</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {[
            { id: "key", label: "A key" },
            { id: "signin", label: "Company sign-in (no key)" },
          ].map((k) => (
            <label key={k.id} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-[var(--gray-300)] px-3 text-sm sm:min-h-0 sm:py-1">
              <input type="radio" name="company-tool-kind" checked={kind === k.id} onChange={() => setKind(k.id)} />
              {k.label}
            </label>
          ))}
        </div>
      </fieldset>
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
