// Issue #3355 — Ari's recorded model identity, as a leaf module.
//
// Every Ari row stamps the model that produced it. Functions that only record
// that identity (agent-turn-control's flow resume) import this instead of the
// full provider wrapper in agentGemini.ts, so they do not pull in the Gemini
// key, Sentry, or the evaluation and rendition controls they never use.
import { GEMINI_MODEL_ID } from "./geminiModel.ts";

function modelVersionFromEnvironment(): string {
  try {
    return Deno.env.get("ARI_LOCAL_MODEL_ENABLED") === "true"
      ? `local:${Deno.env.get("ARI_LOCAL_MODEL_ID") ?? "qwen3:4b-instruct"}`
      : GEMINI_MODEL_ID;
  } catch (error) {
    if (
      error instanceof Deno.errors.PermissionDenied ||
      (error instanceof Error && error.name === "NotCapable")
    ) return GEMINI_MODEL_ID;
    throw error;
  }
}

// Keep importing the provider compiler permission-free. Runtime calls still
// read the full local-model configuration, but schema and contract consumers
// can inspect Ari's production model identity without --allow-env.
export const ARI_MODEL_VERSION = modelVersionFromEnvironment();
