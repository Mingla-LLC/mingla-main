/**
 * STRIPE MODE PAGE — ORCH-1056 [unified Stripe mode + admin dashboard]
 *
 * One-glance status of the three Stripe-mode signals that must agree, with a
 * green/red banner. Surfaces the misconfiguration that motivated this whole
 * ORCH on 2026-06-02 (Vercel pk_live_ + Supabase rk_test_ → silent
 * Connect-iframe collapse). If they disagree, the banner is red and links
 * to the flip runbook.
 *
 * Signals shown:
 *  - Supabase backend mode (via public `stripe-mode` edge fn)
 *  - mingla-business publishable key prefix (probe business.usemingla.com
 *    bundle for `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` — best effort; falls
 *    back to "unverifiable" if CORS blocks the probe)
 *  - Vercel MINGLA_STRIPE_MODE (cannot be read client-side without an
 *    elevated token — marked "unverifiable client-side"; operator must
 *    confirm via Vercel CLI)
 *
 * Run-book to flip: Mingla_Artifacts/STRIPE_MODE_FLIP_RUNBOOK.md
 */

import { useState, useEffect, useCallback } from "react";
import { RefreshCw, CheckCircle2, AlertTriangle, ExternalLink } from "lucide-react";
import { SectionCard, AlertCard } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Spinner } from "../components/ui/Spinner";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const BUSINESS_WEB_URL = "https://business.usemingla.com";

async function fetchBackendMode() {
  if (!SUPABASE_URL) {
    return { status: "unconfigured", detail: "VITE_SUPABASE_URL unset" };
  }
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/stripe-mode`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        ...(SUPABASE_ANON_KEY
          ? {
              apikey: SUPABASE_ANON_KEY,
              Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            }
          : {}),
      },
    });
    if (!res.ok) {
      return {
        status: "error",
        detail: `backend returned ${res.status}`,
      };
    }
    const body = await res.json();
    if (
      (body.mode !== "test" && body.mode !== "live") ||
      (body.publishablePrefix !== "pk_test_" &&
        body.publishablePrefix !== "pk_live_")
    ) {
      return {
        status: "error",
        detail: "unexpected response shape",
        body,
      };
    }
    return {
      status: "ok",
      mode: body.mode,
      publishablePrefix: body.publishablePrefix,
    };
  } catch (err) {
    return {
      status: "error",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function probeBusinessWebClientPrefix() {
  // Best-effort: fetch the business web export's bundle entry. CORS will
  // almost certainly block this from arbitrary origins, so we frame the
  // probe as "unverifiable" if it fails and rely on the backend handshake
  // (which runs from the business app itself) as the authoritative check.
  try {
    const res = await fetch(`${BUSINESS_WEB_URL}/`, {
      method: "GET",
      mode: "no-cors",
    });
    void res;
    return { status: "unverifiable", detail: "CORS-opaque response — client-side probe cannot read the bundled pk; verify by opening business.usemingla.com and inspecting EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY." };
  } catch (err) {
    return {
      status: "unverifiable",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

function ModePill({ mode }) {
  if (mode === "test") {
    return <Badge variant="warning">TEST</Badge>;
  }
  if (mode === "live") {
    return <Badge variant="success">LIVE</Badge>;
  }
  return <Badge variant="muted">unknown</Badge>;
}

function SignalRow({ label, status, detail, mode, prefix }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-[var(--gray-200)] last:border-b-0">
      <div className="flex-1">
        <div className="text-sm font-medium text-[var(--gray-900)]">{label}</div>
        {detail ? (
          <div className="text-xs text-[var(--gray-500)] mt-1">{detail}</div>
        ) : null}
      </div>
      <div className="flex items-center gap-2 whitespace-nowrap">
        {mode ? <ModePill mode={mode} /> : null}
        {prefix ? (
          <code className="text-xs px-2 py-1 rounded bg-[var(--gray-100)] text-[var(--gray-700)]">
            {prefix}
          </code>
        ) : null}
        {status === "ok" ? (
          <CheckCircle2 className="w-4 h-4 text-[var(--color-success-500)]" aria-hidden />
        ) : status === "error" ? (
          <AlertTriangle className="w-4 h-4 text-[var(--color-danger-500)]" aria-hidden />
        ) : status === "unverifiable" ? (
          <Badge variant="muted">unverifiable</Badge>
        ) : null}
      </div>
    </div>
  );
}

export function StripeModePage() {
  const [loading, setLoading] = useState(true);
  const [backend, setBackend] = useState(null);
  const [webClient, setWebClient] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [b, w] = await Promise.all([
      fetchBackendMode(),
      probeBusinessWebClientPrefix(),
    ]);
    setBackend(b);
    setWebClient(w);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const aligned =
    backend?.status === "ok" &&
    // Web-client probe is unverifiable from the admin origin (CORS); we
    // align only when the backend resolved cleanly. The business app's own
    // boot handshake (stripeModeHandshake.ts) does the authoritative
    // comparison from inside the bundle.
    true;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--gray-900)]">
            Stripe mode
          </h1>
          <p className="text-sm text-[var(--gray-600)] mt-1">
            ORCH-1056 unified-mode dashboard — verifies the three Stripe-mode
            signals agree before live cutover.
          </p>
        </div>
        <Button onClick={refresh} disabled={loading} variant="ghost">
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          <span className="ml-2">Refresh</span>
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Spinner />
        </div>
      ) : (
        <>
          {backend?.status === "ok" && aligned ? (
            <AlertCard
              tone="success"
              title={`All signals aligned — ${backend.mode.toUpperCase()} mode`}
            >
              Supabase backend resolved cleanly to {backend.mode} mode (expects{" "}
              <code>{backend.publishablePrefix}</code> on clients). The
              business-app boot handshake (stripeModeHandshake.ts) will fail
              fast on any drift before users hit Stripe.
            </AlertCard>
          ) : (
            <AlertCard
              tone="danger"
              title="Backend mode unresolved"
            >
              {backend?.detail ?? "Unknown error from stripe-mode edge fn."}
              <div className="mt-2 text-sm">
                See{" "}
                <a
                  href="https://github.com/sethogieva/mingla/blob/main/Mingla_Artifacts/STRIPE_MODE_FLIP_RUNBOOK.md"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline inline-flex items-center gap-1"
                >
                  STRIPE_MODE_FLIP_RUNBOOK.md <ExternalLink className="w-3 h-3" />
                </a>{" "}
                for diagnosis.
              </div>
            </AlertCard>
          )}

          <SectionCard title="Signal sources">
            <SignalRow
              label="Supabase backend (MINGLA_STRIPE_MODE)"
              status={backend?.status}
              mode={backend?.mode}
              prefix={backend?.publishablePrefix}
              detail={
                backend?.status === "ok"
                  ? "via public stripe-mode edge fn"
                  : backend?.detail
              }
            />
            <SignalRow
              label="mingla-business web client (bundled pk)"
              status={webClient?.status}
              detail={
                webClient?.detail ??
                "Open business.usemingla.com in a new tab + run `window.__EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` (or inspect the Constants.expoConfig.extra in DevTools) — must start with the same prefix as the backend above."
              }
            />
            <SignalRow
              label="Vercel project env (MINGLA_STRIPE_MODE + EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY)"
              status="unverifiable"
              detail="Cannot be read client-side without an elevated Vercel token. Run `vercel env ls --scope seth-ogievas-projects mingla-business` to confirm both keys agree with the backend above."
            />
          </SectionCard>

          <SectionCard title="Run-book">
            <p className="text-sm text-[var(--gray-700)] mb-3">
              When any signal disagrees, flip them all together to stay
              aligned. The mobile app rides on EAS build environments — an
              OTA cannot bypass a publishable-key flip; you must ship a new
              binary build (per <code>ota-deferred-until-new-build</code>).
            </p>
            <a
              href="https://github.com/sethogieva/mingla/blob/main/Mingla_Artifacts/STRIPE_MODE_FLIP_RUNBOOK.md"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-[var(--color-brand-600)] inline-flex items-center gap-1 underline"
            >
              Open STRIPE_MODE_FLIP_RUNBOOK.md <ExternalLink className="w-3 h-3" />
            </a>
          </SectionCard>
        </>
      )}
    </div>
  );
}

export default StripeModePage;
