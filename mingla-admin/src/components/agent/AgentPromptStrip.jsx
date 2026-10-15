// Issue #3802 (Wave 4) — a local, copy-only prompt. It never loads key
// inventory, invokes an agent, changes the page's filters or sends anything.
import { AlertCard, SectionCard } from "../ui/Card";
import { Button } from "../ui/Button";
import { Skeleton } from "../ui/Skeleton";
import { useAgentGuide } from "../../hooks/useAgentGuide";
import { useOnline } from "../../hooks/useCrmPipeline";
import { agentPrompt, routineByName } from "../../lib/agentPrompts";
import { CopyBlock } from "./CopyBlock";

export function AgentPromptStrip({ routine, pipeline = "", icp = "", region = "", mine = false }) {
  const online = useOnline();
  const guide = useAgentGuide();
  const row = routineByName(guide.data, routine === "new_batch" ? "new_batch" : routine);
  const prompt =
    row && routine === "new_batch"
      ? agentPrompt({ pipeline, icp, region, mine }, row.text)
      : row?.text || "";

  return (
    <SectionCard
      title="Ask your agent"
      action={
        <a
          href="#/agent"
          className="inline-flex min-h-11 items-center rounded-md px-1 text-sm font-semibold text-[var(--color-brand-700)] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2"
        >
          My agent
        </a>
      }
    >
      {guide.loading ? (
        <div aria-busy="true" aria-label="Loading agent prompt" className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <Skeleton height={64} />
          <Skeleton width={124} height={44} />
        </div>
      ) : guide.error || !prompt ? (
        <AlertCard
          variant="warning"
          title="Couldn't load an agent prompt"
          action={
            <Button type="button" variant="secondary" size="sm" highContrastFocus disabled={!online} onClick={guide.retry} className="min-h-11 max-sm:h-11">
              Try again
            </Button>
          }
        >
          Your page still works. Check your connection and try this prompt again.
        </AlertCard>
      ) : (
        <CopyBlock
          id={`agent-page-prompt-${routine}`}
          text={prompt}
          copyLabel="Copy prompt"
          buttonVariant="brandContrast"
          note="This only copies the prompt. Nothing is sent."
        />
      )}
    </SectionCard>
  );
}
