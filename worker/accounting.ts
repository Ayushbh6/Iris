import {
  PRICING_USD_PER_M,
  TEXT_PRICING_USD_PER_M,
} from "../lib/agent/config.ts";

export const bytes = (value: string) =>
  new TextEncoder().encode(value).byteLength;
export const textPricing = (at = Date.now()) =>
  at >= Date.UTC(2027, 0, 1)
    ? { input: 1.5, output: 7.5 }
    : TEXT_PRICING_USD_PER_M;
export const textCost = (input: number, output: number, at = Date.now()) => {
  const price = textPricing(at);
  return Math.ceil(input * price.input + output * price.output);
};

// Usage is per generation, including reprocessed context. Missing modality
// details are charged at the more expensive audio rate, never at zero.
export function liveCost(u: Record<string, any>) {
  const count = (n: unknown) =>
    Number.isSafeInteger(n) && Number(n) >= 0 ? Number(n) : 0;
  const cost = (details: any[], total: number, text: number, audio: number) => {
    let known = 0,
      micros = 0;
    for (const d of details ?? []) {
      const n = count(d.tokenCount);
      known += n;
      micros += n * (d.modality === "TEXT" ? text : audio);
    }
    return micros + Math.max(0, total - known) * audio;
  };
  return Math.ceil(
    cost(
      u.promptTokensDetails,
      count(u.promptTokenCount),
      PRICING_USD_PER_M.inputText,
      PRICING_USD_PER_M.inputAudio,
    ) +
      cost(
        u.responseTokensDetails,
        count(u.responseTokenCount),
        PRICING_USD_PER_M.outputText,
        PRICING_USD_PER_M.outputAudio,
      ) +
      (count(u.thoughtsTokenCount) + count(u.toolUsePromptTokenCount)) *
        PRICING_USD_PER_M.outputAudio,
  );
}
