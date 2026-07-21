export interface GlossaryEntry {
  source: string;
  target: string;
  note?: string;
  case_sensitive?: boolean;
  domain?: string;
}

export type GlossaryProfile = GlossaryEntry[];

export const AI_CRYPTO_GLOSSARY: GlossaryProfile = [
  { source: "rollup", target: "Rollup" },
  { source: "staking", target: "質押" },
  { source: "settlement", target: "結算" },
  { source: "inference", target: "推論" },
  { source: "fine-tuning", target: "微調" },
  { source: "embedding", target: "embedding" },
  { source: "agentic coding", target: "agentic coding" },
  { source: "context window", target: "context window" },
  { source: "liquidity", target: "流動性" },
  { source: "slippage", target: "滑價" },
  { source: "perpetual", target: "永續合約" },
];

export function selectGlossaryForText(
  profile: GlossaryProfile,
  sourceText: string,
): Record<string, string> {
  const selected: Record<string, string> = {};
  const lowerSourceText = sourceText.toLowerCase();

  for (const entry of profile) {
    if (!entry.source) continue;

    const matches = entry.case_sensitive
      ? sourceText.includes(entry.source)
      : lowerSourceText.includes(entry.source.toLowerCase());

    if (matches) selected[entry.source] = entry.target;
  }

  return selected;
}
