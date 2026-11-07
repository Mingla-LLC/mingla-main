/**
 * CONNECT SCREEN (#/connect) — approve a Claude app (issue #4294).
 *
 * Claude sends a teammate here to sign in to the Mingla connector. The
 * request arrives in the address fragment and is kept in this tab's
 * sessionStorage (one key) across Mingla Admin sign-in, then removed on
 * Approve or Cancel. It reaches Mingla only as the approve function's
 * arguments; the page never sends the fragment anywhere else.
 *
 * States: loading, ready, approving, and three errors (link not valid,
 * not a team member, network with Retry). Cancel sends access_denied back.
 * Full screen, outside the admin shell: nothing else is clickable while a
 * sign-in is being decided (like the invite and sign-in screens).
 */
import { useCallback, useState } from "react";
import { Button } from "./ui/Button";
import { AlertCard } from "./ui/Card";
import { Skeleton } from "./ui/Skeleton";
import { useAuth } from "../context/AuthContext";
import { ROLE_LABELS } from "../lib/access";
import {
  CONNECT_WORDS,
  approveConnect,
  approvedRedirect,
  connectPageState,
  connectRequestValid,
  deniedRedirect,
  forgetConnectRequest,
  readConnectRequest,
} from "../services/minglaConnectorService";

const session = () => (typeof window !== "undefined" ? window.sessionStorage : null);

function Frame({ children }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 sm:p-6 bg-[--color-background-secondary]">
      <section
        aria-labelledby="connect-title"
        className="w-full max-w-[460px] rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-6 shadow-[var(--shadow-md)]"
      >
        {children}
      </section>
    </div>
  );
}

export function ConnectScreen() {
  const { access, loading } = useAuth();
  // Read once, from this tab's storage; the address no longer holds it.
  const [req] = useState(() => {
    const store = session();
    return store ? readConnectRequest(store) : null;
  });
  const [phase, setPhase] = useState("idle");
  const [problem, setProblem] = useState("");

  const view = loading ? { phase: "loading" } : connectPageState(req, access);
  const shown = phase === "approving" || phase === "network" || phase === "refused" ? phase : view.phase;

  const approve = useCallback(async () => {
    setPhase("approving");
    setProblem("");
    try {
      const made = await approveConnect(req);
      if (typeof made?.code !== "string") throw new Error("no code");
      const store = session();
      if (store) forgetConnectRequest(store);
      window.location.assign(approvedRedirect(req, made.code));
    } catch (err) {
      if (err?.token === "network") {
        setPhase("network");
      } else if (err?.token === "forbidden") {
        setPhase("refused");
        setProblem(CONNECT_WORDS.notMember);
      } else {
        setPhase("refused");
        setProblem(err?.token === "invalid_request" ? CONNECT_WORDS.invalid : err?.message || CONNECT_WORDS.invalid);
      }
    }
  }, [req]);

  const cancel = useCallback(() => {
    const store = session();
    if (store) forgetConnectRequest(store);
    if (connectRequestValid(req)) window.location.assign(deniedRedirect(req));
    else window.location.hash = "#/agent";
  }, [req]);

  if (shown === "loading") {
    return (
      <Frame>
        <div aria-busy="true" aria-live="polite">
          <Skeleton height={24} width="70%" />
          <Skeleton height={16} className="mt-4" />
          <Skeleton height={16} width="85%" className="mt-2" />
          <Skeleton height={44} className="mt-6" />
        </div>
      </Frame>
    );
  }

  if (shown === "invalid" || shown === "not_member" || shown === "refused") {
    const words = shown === "invalid" ? CONNECT_WORDS.invalid : shown === "not_member" ? CONNECT_WORDS.notMember : problem;
    return (
      <Frame>
        <h1 id="connect-title" className="text-lg font-semibold text-[var(--color-text-primary)]">
          Connect Claude to Mingla
        </h1>
        <div role="alert" className="mt-4">
          <AlertCard variant="error" title="Claude can't connect">
            {words}
          </AlertCard>
        </div>
        {connectRequestValid(req) && (
          <div className="mt-5">
            <Button variant="secondary" className="min-h-11 w-full" onClick={cancel}>
              Back to Claude
            </Button>
          </div>
        )}
      </Frame>
    );
  }

  const app = view.app ?? "Claude";
  return (
    <Frame>
      <h1 id="connect-title" className="text-lg font-semibold text-[var(--color-text-primary)]">
        {app} wants to act as you in Mingla
      </h1>
      <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
        You will be sent back to <strong className="text-[var(--color-text-primary)]">{view.host}</strong>.
      </p>
      <div className="mt-4 rounded-lg border border-[var(--gray-200)] p-4 text-sm text-[var(--color-text-secondary)]">
        <p className="font-medium text-[var(--color-text-primary)]">What it can do</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            Act as you, with your role ({ROLE_LABELS[access?.role] ?? "team"}) and nothing more.
          </li>
          <li>Your pipelines, Work cards, calendar and drafts, as your role allows.</li>
          <li>Company tools an owner has opened to your role.</li>
          <li>It never sends a message, spends money or publishes. Disconnect it any time from My agent.</li>
        </ul>
      </div>
      {shown === "network" && (
        <div role="alert" className="mt-4">
          <AlertCard variant="error" title="That didn't go through">
            {CONNECT_WORDS.network}
          </AlertCard>
        </div>
      )}
      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" className="min-h-11" disabled={shown === "approving"} onClick={cancel}>
          Cancel
        </Button>
        <Button variant="primary" className="min-h-11" loading={shown === "approving"} onClick={approve}>
          {shown === "network" ? "Try again" : "Approve"}
        </Button>
      </div>
    </Frame>
  );
}
