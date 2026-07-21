import { describe, expect, it } from "vitest";
import {
  AI_CRYPTO_GLOSSARY,
  selectGlossaryForText,
  type GlossaryProfile,
} from "./glossary";

const profile: GlossaryProfile = [
  { source: "rollup", target: "Rollup" },
  { source: "inference", target: "推論" },
  { source: "staking", target: "質押" },
  { source: "USDC", target: "USDC", case_sensitive: true },
];

describe("selectGlossaryForText", () => {
  it("includes present terms and excludes absent terms", () => {
    expect(
      selectGlossaryForText(profile, "The rollup improves inference latency."),
    ).toEqual({
      rollup: "Rollup",
      inference: "推論",
    });
  });

  it("honors case-sensitive entries while matching default entries case-insensitively", () => {
    expect(selectGlossaryForText(profile, "ROLLUP liquidity uses usdc")).toEqual({
      rollup: "Rollup",
    });

    expect(selectGlossaryForText(profile, "ROLLUP liquidity uses USDC")).toEqual({
      rollup: "Rollup",
      USDC: "USDC",
    });
  });

  it("returns an empty object for empty profiles or text with no matches", () => {
    expect(selectGlossaryForText([], "rollup")).toEqual({});
    expect(selectGlossaryForText(profile, "plain caption text")).toEqual({});
  });
});

describe("AI_CRYPTO_GLOSSARY", () => {
  it("contains the seed terms from the product spec", () => {
    const terms = Object.fromEntries(
      AI_CRYPTO_GLOSSARY.map(({ source, target }) => [source, target]),
    );

    expect(terms).toMatchObject({
      rollup: "Rollup",
      staking: "質押",
      settlement: "結算",
      inference: "推論",
      "fine-tuning": "微調",
      embedding: "embedding",
      "agentic coding": "agentic coding",
      "context window": "context window",
      liquidity: "流動性",
      slippage: "滑價",
      perpetual: "永續合約",
    });
  });
});
