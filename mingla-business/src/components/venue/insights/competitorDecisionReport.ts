import type {
  CompetitorBriefEvidence,
  CompetitorBriefResult,
  CompetitorDecisionConfidence,
  CompetitorSignalType,
} from "../../../types/growthTools";

export interface CompetitorSignalView {
  id: string;
  number: number;
  label: string;
  summary: string;
  sourceName: string;
  evidence: CompetitorBriefEvidence;
}

export interface CompetitorInterpretationView {
  text: string;
  type: CompetitorSignalType;
  confidence: CompetitorDecisionConfidence;
  signalNumber: number;
}

export interface CompetitorActionView {
  id: string;
  text: string;
  timeframe: "this_week" | "this_month" | "bigger_project";
  primary: boolean;
}

export interface CompetitorDecisionView {
  happened: string;
  whyCare: string;
  doNext: string;
  signals: CompetitorSignalView[];
  interpretations: CompetitorInterpretationView[];
  comparisons: Array<{
    id: string;
    label: "Your advantage" | "Competitor pressure" | "Different approach";
    ownerText: string;
    competitorText: string;
    confidence: CompetitorDecisionConfidence;
  }>;
  actions: CompetitorActionView[];
}

const sourceLabel = (url: string): string =>
  /instagram\.com/i.test(url) ? "Instagram" : /tiktok\.com/i.test(url) ? "TikTok" : "Website";

export function buildCompetitorDecisionView(
  result: CompetitorBriefResult,
): CompetitorDecisionView | null {
  const brief = result.brief;
  if (!brief) return null;
  if (result.schemaVersion !== 3) {
    const seen = new Set<string>();
    const signals = brief.whatChanged.flatMap((fact) => {
      const evidence = brief.evidence.find((item) => item.id === fact.evidenceId);
      if (!evidence || seen.has(evidence.id)) return [];
      seen.add(evidence.id);
      return [{
        id: fact.id,
        number: seen.size,
        label: "Observed fact",
        summary: fact.text,
        sourceName: sourceLabel(evidence.publicUrl),
        evidence,
      }];
    });
    const primary = brief.worthDoing.find((item) => item.isPrimary);
    return {
      happened: brief.whatChanged[0]?.text ?? "No verified public signal yet.",
      whyCare: brief.whyItMatters[0]?.text ?? "Keep watching for a decision-ready pattern.",
      doNext: primary?.text ?? "Keep watching this competitor.",
      signals,
      interpretations: brief.whyItMatters.map((item, index) => ({
        text: item.text,
        type: "neutral" as const,
        confidence: "low" as const,
        signalNumber: Math.min(index + 1, Math.max(1, signals.length)),
      })),
      comparisons: [],
      actions: brief.worthDoing.map((item) => ({
        id: item.id,
        text: item.text,
        timeframe: item.isPrimary ? "this_week" as const : "this_month" as const,
        primary: item.isPrimary,
      })),
    };
  }

  const report = result.decisionReport;
  const evidenceById = new Map(report.signalEvidence.map((item) => [item.id, item]));
  const signals = report.signals.flatMap((signal, index) => {
    const source = evidenceById.get(signal.evidenceIds[0] ?? "");
    if (!source) return [];
    return [{
      id: signal.id,
      number: index + 1,
      label: signal.label,
      summary: signal.summary,
      sourceName: sourceLabel(source.sourceUrl),
      evidence: {
        id: source.id,
        sourceId: source.sourceId,
        publicUrl: source.sourceUrl,
        ...(source.observedAt ? { observedAt: source.observedAt } : {}),
        checkedAt: source.checkedAt,
        observation: source.observation,
      },
    }];
  });
  const signalNumber = new Map(signals.map((signal) => [signal.id, signal.number]));
  const plan = [...report.actionPlan].sort((a, b) => a.order - b.order);
  const actions = plan.flatMap((meta) => {
    const action = brief.worthDoing[meta.index];
    return action ? [{ id: action.id, text: action.text, timeframe: meta.timeframe, primary: meta.isPrimary }] : [];
  });
  const primary = actions.find((action) => action.primary);
  return {
    happened: report.decision.headline,
    whyCare: brief.whyItMatters[0]?.text ?? report.decision.rationale,
    doNext: primary?.text ?? report.decision.rationale,
    signals,
    interpretations: report.interpretationMeta.map((meta) => ({
      text: brief.whyItMatters[meta.index]?.text ?? "",
      type: meta.signalType,
      confidence: meta.confidence,
      signalNumber: signalNumber.get(meta.signalIds[0] ?? "") ?? 1,
    })).filter((item) => item.text !== ""),
    comparisons: report.comparisons.flatMap((item) => item.outcome === "not_comparable" ? [] : [{
      id: item.id,
      label: item.outcome === "owner_advantage" ? "Your advantage" as const : item.outcome === "competitor_pressure" ? "Competitor pressure" as const : "Different approach" as const,
      ownerText: item.ownerText,
      competitorText: item.competitorText,
      confidence: item.confidence,
    }]),
    actions,
  };
}

export const actionTimeframeLabel = (timeframe: CompetitorActionView["timeframe"]): string =>
  timeframe === "this_week" ? "This week" : timeframe === "this_month" ? "This month" : "Bigger project";
