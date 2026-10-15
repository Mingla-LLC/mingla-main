// Issue #3802 (Wave 4) — the owner's view: who on the team has an agent
// connected, and a way to disconnect one. It never shows a key: the server
// does not send one.
import { ROLE_LABELS } from "../../lib/access";
import { useEffect, useRef, useState } from "react";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";

export function AgentStatusList({ row, loading = false, unavailable = false, busyKeyId = null, offline = false, onDisconnect }) {
  const [asking, setAsking] = useState(null);
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState("");
  const keepRef = useRef(null);
  const askRefs = useRef({});
  const returnTo = useRef(null);
  useEffect(() => {
    if (asking) {
      keepRef.current?.focus();
    } else if (returnTo.current) {
      askRefs.current[returnTo.current]?.focus();
      returnTo.current = null;
    }
  }, [asking]);
  const keep = (keyId) => {
    returnTo.current = keyId;
    setAsking(null);
    setProblem("");
  };

  return (
    <div className="min-w-0" role="region" aria-label={`Agent status for ${row?.name || row?.email || "team member"}`}>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">Agent</p>
      {loading ? (
        <div className="h-11 animate-pulse rounded-lg bg-[var(--gray-100)] motion-reduce:animate-none" aria-busy="true" aria-label="Loading agent status" />
      ) : unavailable ? (
        <p className="text-[13px] text-[var(--color-text-secondary)]">Status unavailable</p>
      ) : !row || row.agents.length === 0 ? (
        <p className="text-[13px] text-[var(--color-text-secondary)]">None</p>
      ) : (
        <div className="flex min-w-0 flex-col gap-2">
          {row.agents.map((a) =>
            asking === a.keyId ? (
              <div
                key={a.keyId}
                role="group"
                aria-label={`Disconnect ${row.name}'s ${a.label}?`}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    keep(a.keyId);
                  }
                }}
                className="flex min-w-0 flex-col gap-2 rounded-lg bg-[var(--color-warning-50)] p-3"
              >
                <p className="text-[13px] text-[var(--color-warning-700)]">
                  Disconnect {row.name}&apos;s {a.label}? Its key stops working at once. They can create a new one.
                </p>
                {problem ? <p role="alert" className="text-[13px] text-[var(--color-error-700)]">{problem}</p> : null}
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="danger"
                    loading={busyKeyId === a.keyId}
                    disabled={offline || (busyKeyId && busyKeyId !== a.keyId)}
                    title={offline ? "Reconnect to disconnect an agent." : undefined}
                    onClick={async () => {
                      setProblem("");
                      setNotice("");
                      const result = await onDisconnect(a.keyId, row.name, a.label);
                      if (result?.ok) {
                        setNotice(result.already ? "This agent was already disconnected." : `${a.label} disconnected.`);
                        keep(a.keyId);
                      } else {
                        setProblem(result?.message || "Couldn't disconnect this agent. Try again.");
                      }
                    }}
                    className="max-sm:h-11"
                  >
                    {busyKeyId === a.keyId ? "Disconnecting..." : "Disconnect"}
                  </Button>
                  <Button ref={keepRef} type="button" variant="secondary" disabled={!!busyKeyId} onClick={() => keep(a.keyId)} className="max-sm:h-11">
                    Keep
                  </Button>
                </div>
              </div>
            ) : (
              <div key={a.keyId} className="flex min-w-0 flex-wrap items-center gap-2">
                <div className="min-w-0">
                  <Badge variant="success" dot>{a.label}</Badge>
                  <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{a.line}</p>
                </div>
                <Button
                  ref={(el) => {
                    askRefs.current[a.keyId] = el;
                  }}
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={offline || !!busyKeyId}
                  title={offline ? "Reconnect to disconnect an agent." : undefined}
                  onClick={() => setAsking(a.keyId)}
                  aria-label={`Disconnect ${row.name}'s ${a.label}`}
                  className="max-sm:h-11"
                >
                  Disconnect
                </Button>
              </div>
            )
          )}
        </div>
      )}
      {notice ? <p role="status" className="mt-2 text-[13px] text-[var(--color-text-secondary)]">{notice}</p> : null}
    </div>
  );
}

export function AgentTeamList({ rows, busyKeyId, offline, onDisconnect }) {
  if (rows.length === 0) {
    return <p className="text-[13px] text-[var(--color-text-secondary)]">Nobody is on the team yet. Invite people from Team and roles.</p>;
  }

  return (
    <ul className="divide-y divide-[var(--gray-200)]">
      {rows.map((row) => (
        <li key={row.email} className="flex min-w-0 flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="break-words text-sm font-medium text-[var(--color-text-primary)]">{row.name}</p>
            <p className="break-all text-xs text-[var(--color-text-secondary)]">
              {row.email}
              {ROLE_LABELS[row.role] ? ` · ${ROLE_LABELS[row.role]}` : ""}
            </p>
          </div>
          <AgentStatusList row={row} busyKeyId={busyKeyId} offline={offline} onDisconnect={onDisconnect} />
        </li>
      ))}
    </ul>
  );
}
