// deno-lint-ignore-file no-explicit-any -- fixtures are plain ES module data
/*
 * #4453 Website workspace — replay every workspace fixture and grade it with
 * grade.mjs's gradeTurn plus the workspace's own facts. Imported by the
 * workspace replay suite and by the #3355 replay harness.
 */
import {
  WEBSITE_WORKSPACE_FIXTURES,
} from "../../../../scripts/ari/eval/replay/websiteWorkspaceFixtures.mjs";
import {
  gradeTurn,
  round,
} from "../../../../scripts/ari/eval/replay/grade.mjs";
import {
  gradeWorkspaceTurn,
  replayWorkspaceTurn,
  type WorkspaceTurnFixture,
} from "./_issue4453WorkspaceReplay.ts";

interface Fact {
  fact: string;
  passed: boolean;
  expected: unknown;
  actual: unknown;
}

export interface GradedWorkspaceThread {
  id: string;
  passed: boolean;
  score: number;
  turns: Array<{ say: string; facts: Fact[] }>;
}

export async function replayWorkspaceFixtures(
  only: (fixture: { id: string }) => boolean = () => true,
): Promise<GradedWorkspaceThread[]> {
  const graded: GradedWorkspaceThread[] = [];
  for (const fixture of (WEBSITE_WORKSPACE_FIXTURES as any[]).filter(only)) {
    const turns: GradedWorkspaceThread["turns"] = [];
    let previous: unknown = null;
    for (const turn of fixture.turns as WorkspaceTurnFixture[]) {
      const run = await replayWorkspaceTurn(turn);
      const { workspace, ...expect } = turn.expect;
      const facts: Fact[] = [
        ...(gradeTurn(expect, run.observed, previous) as Fact[]),
        ...gradeWorkspaceTurn(workspace, run),
      ];
      turns.push({ say: turn.say, facts });
      previous = run.observed;
    }
    const facts = turns.flatMap((turn) => turn.facts);
    const passedFacts = facts.filter((item) => item.passed).length;
    graded.push({
      id: fixture.id,
      passed: facts.length > 0 && passedFacts === facts.length,
      score: facts.length ? round(passedFacts / facts.length * 100) : 0,
      turns,
    });
  }
  return graded;
}
