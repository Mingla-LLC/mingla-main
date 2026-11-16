// #4452 §7.8 — the Google conversions setup card (Admin › Forms, admins only).
// One row per kind: ✓ Ready when the conversion action exists, else Create.
// The state comes from admin_google_conversion_kinds (ready flags only; no
// resource name or id ever reaches the browser). Create calls the existing
// admin-ad-google-provision-conversion with the consumer lane.
import { useCallback, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "../ui/Button";
import { LoadError } from "../ui/LoadError";
import { Skeleton } from "../ui/Skeleton";
import { useToast } from "../../context/ToastContext";
import { useServerRead } from "../../hooks/useServerRead";
import { GOOGLE_KINDS } from "../../lib/formsModel";
import { createGoogleConversion, formsErrorWords, googleConversionKinds } from "../../services/formsService";
import { Panel } from "./formsUi";

export function GoogleConversionsCard() {
  const { addToast } = useToast();
  const load = useCallback(() => googleConversionKinds(), []);
  const { status, data, error, retry } = useServerRead(load);
  const [busy, setBusy] = useState("");
  const create = async (kind) => {
    setBusy(kind);
    try {
      await createGoogleConversion(kind);
      addToast({ variant: "success", title: "Created in Google Ads." });
      retry();
    } catch (e) {
      addToast({ variant: "error", title: "Google did not create it", description: e.message });
    } finally {
      setBusy("");
    }
  };
  return <GoogleConversionsCardView status={status} data={data} error={error} retry={retry} busy={busy} onCreate={create} />;
}

/** The card itself (rendered by the tests with fixed data). */
export function GoogleConversionsCardView({ status = "ready", data, error, retry, busy, onCreate }) {
  return (
    <Panel title="Google conversions" data-google-conversions="">
      {status === "loading" ? <Skeleton height={120} /> : status === "error" ? (
        <LoadError message={formsErrorWords(error)} onRetry={retry} />
      ) : !data?.connected ? (
        <p className="text-sm text-[var(--color-text-secondary)]">Google Ads is not connected yet. Connect it in Ad engine › Settings, then come back to create these.</p>
      ) : (
        <ul className="divide-y divide-[var(--a-line)]">
          {GOOGLE_KINDS.map(({ kind, label }) => {
            const ready = data?.kinds?.[kind]?.ready === true;
            return (
              <li key={kind} data-google-kind={kind} className="flex items-center justify-between gap-3 py-2">
                <span className="text-sm text-[var(--color-text-primary)]">{label}</span>
                {ready ? (
                  <span className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--a-live-ink)]"><CheckCircle2 aria-hidden="true" className="h-4 w-4" /> Ready</span>
                ) : (
                  <Button size="sm" variant="secondary" loading={busy === kind} disabled={Boolean(busy)} onClick={() => onCreate(kind)}>Create</Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-2 text-xs text-[var(--color-text-tertiary)]">Until a kind is Ready, its Google uploads are skipped (there is no fallback to Host lead).</p>
    </Panel>
  );
}
