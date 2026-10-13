// Issue #3802 (Wave 4) — the owner's view: who on the team has an agent
// connected, and a way to disconnect one. It never shows a key: the server
// does not send one.
import { useEffect, useRef, useState } from "react";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { ROLE_LABELS } from "../../lib/access";

export function AgentTeamList({ rows, busyKeyId, offline, onDisconnect }) {
  const [asking, setAsking] = useState(null); // a key id
  const keepRef = useRef(null);
  useEffect(() => {
    if (asking) keepRef.current?.focus();
  }, [asking]);

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
          <div className="flex min-w-0 flex-col gap-2 sm:items-end">
            {row.agents.length === 0 && <Badge>No agent connected</Badge>}
            {row.agents.map((a) =>
              asking === a.keyId ? (
                <div
                  key={a.keyId}
                  role="group"
                  aria-label={`Disconnect ${row.name}'s ${a.label}?`}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setAsking(null);
                  }}
                  className="flex min-w-0 flex-col gap-2 rounded-lg bg-[var(--color-warning-50)] p-3"
                >
                  <p className="text-[13px] text-[var(--color-warning-700)]">
                    Disconnect {row.name}&apos;s {a.label}? Its key stops working at once. They can create a new one.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="danger"
                      disabled={offline}
                      onClick={() => {
                        setAsking(null);
                        onDisconnect(a.keyId, row.name, a.label);
                      }}
                      className="max-sm:h-11"
                    >
                      Disconnect
                    </Button>
                    <Button ref={keepRef} type="button" variant="secondary" onClick={() => setAsking(null)} className="max-sm:h-11">
                      Keep
                    </Button>
                  </div>
                </div>
              ) : (
                <div key={a.keyId} className="flex min-w-0 flex-wrap items-center gap-2">
                  <Badge variant="success" dot className="!whitespace-normal">
                    {a.label} · {a.line}
                  </Badge>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    loading={busyKeyId === a.keyId}
                    disabled={offline}
                    title={offline ? "You're offline. This works again once you're back." : undefined}
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
        </li>
      ))}
    </ul>
  );
}
