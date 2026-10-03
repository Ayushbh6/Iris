import { KNOWLEDGE_VERSION } from "./knowledge.generated.ts";
import { buildSystemInstruction } from "./prompt.ts";
import { functionDeclarations } from "./tools.ts";

export const LIVE_MODEL = "gemini-3.8-live";
export const TEXT_MODEL = "gemini-3.8-flash";
export const LIVE_API_VERSION = "v1alpha"; // pinned Live protocol, verified by the relay E2E suite
export { KNOWLEDGE_VERSION };

// Chosen by ear on 2 October 2026: says "Ayush Bhattacharya" correctly with the
// pronunciation hint in prompt.ts.
export const VOICE_NAME = "Kore";

// Paid-tier USD per 1M tokens, gemini-3.8-live, checked 1 October 2026.
export const PRICING_USD_PER_M = {
  inputText: 0.75,
  inputAudio: 3,
  outputText: 4.5,
  outputAudio: 12,
} as const;

// Paid-tier USD per 1M tokens, gemini-3.8-flash, standard, through 31 December 2026
// (doubles from 1 January 2027): input 0.75, output and thinking 3.75.
export const TEXT_PRICING_USD_PER_M = { input: 0.75, output: 3.75 } as const;

// Live connect config. The server owns setup; the browser cannot change it.
export function buildLiveConfig() {
  return {
    responseModalities: ["AUDIO"],
    speechConfig: {
      voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE_NAME } },
    },
    systemInstruction: buildSystemInstruction(),
    tools: [{ functionDeclarations }],
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    maxOutputTokens: 2048,
    temperature: 0.6,
    contextWindowCompression: {
      triggerTokens: "12000",
      slidingWindow: { targetTokens: "6000" },
    },
  };
}
