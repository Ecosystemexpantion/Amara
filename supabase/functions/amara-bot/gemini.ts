import type { ConversationMessage, ScreenshotResult } from "./types.ts";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;
const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent";

export const AMARA_SYSTEM_PROMPT = `You are Amara, a warm, energetic and fun female business coach for EEM26. You are NOT an AI — you are a real human coach. NEVER reveal or admit you are an AI, bot, or language model under ANY circumstances. If asked if you're AI or a bot, deny it warmly: "Me? No way! I'm Amara, your personal coach 😄"

Your personality:
- You speak like a close friend texting — short, punchy messages. Maximum 3 sentences per reply.
- You mix English and Nigerian Pidgin naturally: "You don do am!", "E easy, I promise", "Oya let's go", "No worry at all", "You sabi this one already", "Well done!", "My person!", "I dey here for you"
- You celebrate every small win with genuine energy using emojis
- You are patient and NEVER make students feel stupid or slow
- You always remind students that tools and links you share are from their Tech Stack purchase
- You keep students on track — if they go off topic, gently redirect them
- You never write long paragraphs — break everything into short punchy lines

Current context: You are guiding a paid student through their 4-day EEM26 business setup program. They have already purchased the Tech Stack package. Your job is to make sure they complete every step successfully.`;

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export async function geminiChat(
  history: ConversationMessage[],
  userMessage: string,
  stepContext?: string
): Promise<string> {
  const systemText = stepContext
    ? `${AMARA_SYSTEM_PROMPT}\n\nCurrent step context: ${stepContext}`
    : AMARA_SYSTEM_PROMPT;

  const contents: unknown[] = [];

  // Build alternating user/model history (max 10 messages)
  const recent = history.slice(-10);
  for (const msg of recent) {
    contents.push({
      role: msg.role === "user" ? "user" : "model",
      parts: [{ text: msg.message }],
    });
  }
  contents.push({ role: "user", parts: [{ text: userMessage }] });

  const body = {
    systemInstruction: { parts: [{ text: systemText }] },
    contents,
    generationConfig: {
      temperature: 0.9,
      maxOutputTokens: 350,
      topP: 0.95,
      candidateCount: 1,
    },
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
    ],
  };

  const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini chat error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "I dey here! Try again in a moment 😊";
}

export async function geminiVision(
  imageBytes: Uint8Array,
  mimeType: string,
  verificationPrompt: string
): Promise<ScreenshotResult> {
  const base64 = uint8ToBase64(imageBytes);

  const body = {
    contents: [
      {
        parts: [
          { inline_data: { mime_type: mimeType, data: base64 } },
          { text: verificationPrompt },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 600,
      candidateCount: 1,
    },
  };

  const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini vision error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const rawText: string = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";

  // Strip markdown code fences
  const jsonStr = rawText
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(jsonStr) as ScreenshotResult;
  } catch {
    // Fallback: infer from text
    const verified = /\b(yes|correct|verified|true|confirmed|i can see)\b/i.test(rawText);
    return { verified, reason: rawText.slice(0, 200), extracted: {} };
  }
}

export async function geminiAudio(
  audioBytes: Uint8Array,
  mimeType = "audio/ogg"
): Promise<string> {
  const base64 = uint8ToBase64(audioBytes);

  const body = {
    contents: [
      {
        parts: [
          { inline_data: { mime_type: mimeType, data: base64 } },
          {
            text: "Transcribe this voice message accurately. Return only the transcription text, nothing else.",
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 500,
    },
  };

  const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini audio error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
}

// Build a step-specific vision verification prompt that requests structured JSON output
export function buildVerificationPrompt(task: string, extractions?: string[]): string {
  const extractionStr = extractions
    ? `Also extract these values if visible: ${extractions.join(", ")}.`
    : "";

  return `${task}
${extractionStr}
Answer ONLY in valid JSON format (no markdown, no explanation outside the JSON):
{"verified": true/false, "reason": "brief explanation of what you see", "extracted": {${
    extractions ? extractions.map((e) => `"${e}": "value or empty string"`).join(", ") : ""
  }}}
verified=true only if the screenshot clearly shows what was asked.`;
}
