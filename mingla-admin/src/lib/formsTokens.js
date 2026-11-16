// #4452 §5.6 — the merge fields an automation email may use: the base tokens
// plus {answers.<key>} for every field except consent (formTokens, the shared
// contract), in the composer's {value,label,example} shape. Single braces, as
// the shared composer writes them (D-2).
import { formTokens } from "../../../supabase/functions/_shared/formsContract.ts";
import { SAMPLE_VALUES } from "./flowModel";

const BASE_LABEL = Object.freeze({
  first_name: "First name", name: "Full name", page: "Page", spot: "Spot on the page",
  utm_source: "Ad source", utm_campaign: "Ad campaign", form_name: "Form name",
});
const SAMPLE_ANSWERS = Object.freeze({ city: "Lagos", what_do_you_make: "Video", your_main_social: "instagram.com/ada.makes" });

export function formTokenOptions(def) {
  return formTokens(def).map((t) => {
    if (t.startsWith("answers.")) {
      const key = t.slice(8);
      const f = (def?.fields || []).find((x) => x.key === key);
      return { value: `{${t}}`, label: f?.label || key, example: SAMPLE_ANSWERS[key] || (f?.options?.[0] ?? "…") };
    }
    return { value: `{${t}}`, label: BASE_LABEL[t] || t, example: SAMPLE_VALUES[t] ?? "" };
  });
}
