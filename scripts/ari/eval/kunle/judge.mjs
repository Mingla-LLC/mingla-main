const JUDGE_SCHEMA = {
  type: "OBJECT",
  properties: {
    criteria: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING" },
          passed: { type: "BOOLEAN" },
          quote: { type: "STRING" },
        },
        required: ["id", "passed", "quote"],
      },
    },
  },
  required: ["criteria"],
};

export const COMMON_JUDGE_CRITERIA = Object.freeze([
  "distinguishes verified facts from reported or unverified information, and labels proposals when proposals exist",
  "answers every part the host asked",
  "shows each calculation the host asked for; pass as not applicable when the host asked for no calculation",
  "makes no unconfirmed promise to guests",
]);

const JUDGE_TIMEOUT_MS = 45_000;
const JUDGE_MAX_ATTEMPTS = 3;

async function oneJudge({ apiKey, model, scenario, reply, criteria }) {
  let lastError = null;
  for (let attempt = 1; attempt <= JUDGE_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${
          encodeURIComponent(model)
        }:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: AbortSignal.timeout(JUDGE_TIMEOUT_MS),
          body: JSON.stringify({
            systemInstruction: {
              parts: [{
                text:
                  "Grade only the supplied Ari reply against each criterion. Return one row per criterion, in order. A passing quote must be an exact short span from the reply; use an empty quote when it fails.",
              }],
            },
            contents: [{
              role: "user",
              parts: [{
                text: JSON.stringify({
                  scenario: scenario.title,
                  host_prompt: scenario.prompt,
                  stronger_response_bar: scenario.strongerResponse,
                  criteria,
                  ari_reply: reply,
                }),
              }],
            }],
            generationConfig: {
              temperature: 0,
              thinkingConfig: { thinking_level: "minimal" },
              responseMimeType: "application/json",
              responseSchema: JUDGE_SCHEMA,
              maxOutputTokens: 1024,
            },
          }),
        },
      );
      const detail = await response.text();
      if (!response.ok) {
        const error = new Error(
          `Kunle judge failed (${response.status}): ${detail.slice(0, 300)}`,
        );
        if (
          attempt < JUDGE_MAX_ATTEMPTS &&
          (response.status === 429 || response.status >= 500)
        ) {
          lastError = error;
          continue;
        }
        throw error;
      }
      const body = JSON.parse(detail);
      const text = body?.candidates?.[0]?.content?.parts?.map((part) =>
        part.text ?? ""
      )
        .join("") ?? "";
      const parsed = JSON.parse(text);
      return Array.isArray(parsed.criteria) ? parsed.criteria : [];
    } catch (error) {
      const transient = error?.name === "TimeoutError" ||
        error?.name === "AbortError" || error instanceof TypeError;
      if (attempt < JUDGE_MAX_ATTEMPTS && transient) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }
  throw lastError ?? new Error("Kunle judge exhausted its retry budget");
}

/** Three temperature-zero runs; each criterion passes by majority vote. */
export async function judgeKunleReply({ apiKey, model, scenario, reply }) {
  if (!apiKey) throw new Error("Kunle judge needs GEMINI_API_KEY_ARI");
  const criteria = [
    ...COMMON_JUDGE_CRITERIA,
    `meets this reviewed stronger-response bar: ${scenario.strongerResponse}`,
  ];
  const runs = [];
  // Sequential votes avoid bursting the same model into quota or transient
  // overload while preserving three independent temperature-zero judgments.
  for (let vote = 0; vote < 3; vote += 1) {
    runs.push(await oneJudge({ apiKey, model, scenario, reply, criteria }));
  }
  return criteria.map((criterion, index) => {
    const notApplicable = (index === 2 && !scenario.needsCalculation) ||
      (index === 3 && !scenario.needsGuestPromiseCheck);
    if (notApplicable) {
      return {
        id: criterion,
        passed: true,
        quote: "not applicable",
        votes: [true, true, true],
      };
    }
    const votes = runs.map((run) => {
      const row = run[index];
      const quote = String(row?.quote ?? "");
      return row?.passed === true && quote.length > 0 && reply.includes(quote);
    });
    const passed = votes.filter(Boolean).length >= 2;
    const quote = runs.map((run) => String(run[index]?.quote ?? ""))
      .find((value) => value && reply.includes(value)) ?? "";
    return { id: criterion, passed, quote, votes };
  });
}
