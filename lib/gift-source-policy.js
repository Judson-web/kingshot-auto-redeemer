const SOURCE_WEIGHTS = Object.freeze({
  "kingshot-api": 1.00,
  "kingshot-page": 0.95,
  "whiteout-bot-aggregator": 0.92,
  pocketgamer: 0.70,
  beebom: 0.68,
  progameguides: 0.68,
  gamesradar: 0.65,
  "kingshot-guides": 0.55,
  admin: 0.90,
  fallback: 0.50
});

function weightFor(source) {
  return SOURCE_WEIGHTS[String(source || "").toLowerCase()] ?? 0.45;
}

export function scoreGiftCodeEvidence(row) {
  const sources = [...new Set((row?.sources || [row?.source]).filter(Boolean).map(String))];
  if (!sources.length) return { confidence: 0, evidence: [], tier: "unverified" };

  const weights = sources.map(weightFor).sort((a, b) => b - a);
  const strongest = weights[0] || 0;
  const corroboration = Math.min(0.28, Math.max(0, sources.length - 1) * 0.07);
  const independentPremium = sources.some(source =>
    ["kingshot-api", "kingshot-page", "whiteout-bot-aggregator"].includes(source)
  );
  const premiumBonus = independentPremium ? 0.08 : 0;
  const confidence = Math.min(0.99, strongest * 0.72 + corroboration + premiumBonus);

  const tier =
    confidence >= 0.90 ? "verified" :
    confidence >= 0.75 ? "strong" :
    confidence >= 0.55 ? "probable" :
    "unverified";

  return {
    confidence: Number(confidence.toFixed(2)),
    evidence: sources.map(source => ({
      source,
      weight: weightFor(source)
    })),
    tier
  };
}

export function enrichGiftCodeEvidence(row) {
  const evidence = scoreGiftCodeEvidence(row);
  return {
    ...row,
    confidence: evidence.confidence,
    confidenceTier: evidence.tier,
    evidence: evidence.evidence
  };
}
