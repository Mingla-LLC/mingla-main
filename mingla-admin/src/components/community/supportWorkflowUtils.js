function words(value) {
  return new Set(String(value || "").toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 3));
}

export function findRelatedSignals(signals, title, productArea) {
  const titleWords = words(title);
  const area = String(productArea || "").trim().toLowerCase();
  if (titleWords.size === 0 && !area) return [];
  return signals
    .map((signal) => {
      const candidateWords = words(signal.title);
      const shared = [...titleWords].filter((word) => candidateWords.has(word)).length;
      const sameArea = area && String(signal.product_area || "").trim().toLowerCase() === area;
      return { signal, score: shared * 2 + (sameArea ? 3 : 0) };
    })
    .filter((item) => item.score >= 3)
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)
    .map((item) => item.signal);
}
