// Issue #4130 (Wave 5) — Data room › Documents. The documents list as it was
// before the analytics tabs: same admin-data-room edge function, same gate,
// every room and document open recorded by the server.
import { useCallback, useEffect, useState } from "react";
import { Download, ExternalLink } from "lucide-react";
import { AlertCard, SectionCard } from "../ui/Card";
import { Button } from "../ui/Button";
import * as collaboration from "../../services/teamCollaborationService";

function sizeLabel(bytes) {
  if (!Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function DataRoomDocuments() {
  const [state, setState] = useState({ loading: true, error: false, documents: [] });
  const [opening, setOpening] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    collaboration.loadDataRoom()
      .then((manifest) => { if (live) setState({ loading: false, error: false, documents: Array.isArray(manifest?.documents) ? manifest.documents : [] }); })
      .catch(() => { if (live) setState({ loading: false, error: true, documents: [] }); });
    return () => { live = false; };
  }, [attempt]);
  const load = useCallback(() => {
    setState((current) => ({ ...current, loading: true, error: false }));
    setAttempt((n) => n + 1);
  }, []);

  const open = async (document) => {
    setOpening(document.key);
    try {
      const blob = await collaboration.openDataRoomDocument(document.key);
      const url = URL.createObjectURL(blob);
      const link = globalThis.document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } finally { setOpening(""); }
  };

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <AlertCard variant="info" title="Private by design">Documents stay in the private Data room project. Every room and document open is recorded; no provider link or credential is exposed here.</AlertCard>
      {state.error ? <AlertCard variant="error" title="Couldn’t open the Data room" action={<Button variant="secondary" onClick={load}>Try again</Button>}>Nothing was downloaded.</AlertCard> : <SectionCard title="Documents" noPadding>
        {state.loading ? <p role="status" className="p-5 text-sm text-[var(--color-text-secondary)]">Loading Data room…</p> : state.documents.length === 0 ? <p className="p-5 text-sm text-[var(--color-text-secondary)]">No documents are available.</p> : <ul className="divide-y divide-[var(--gray-200)]">{state.documents.map((document) => <li key={document.key} className="flex min-w-0 flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5"><div className="min-w-0"><p className="truncate text-sm font-semibold text-[var(--color-text-primary)]">{document.label}</p><p className="text-xs text-[var(--color-text-tertiary)]">{sizeLabel(document.size_bytes)}{document.updated_at ? ` · Updated ${new Date(document.updated_at).toLocaleDateString()}` : ""}</p></div><Button type="button" variant="secondary" icon={document.content_type === "application/pdf" ? ExternalLink : Download} loading={opening === document.key} disabled={!!opening} onClick={() => open(document)}>Open</Button></li>)}</ul>}
      </SectionCard>}
    </div>
  );
}
