import type { ConversationMessage, ScreenshotResult } from "./types.ts";
import { saveConversation } from "./db.ts";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;
const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

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
  stepContext?: string,
  studentId?: string
): Promise<string> {
  const systemText = stepContext
    ? `${AMARA_SYSTEM_PROMPT}\n\nCurrent step context: ${stepContext}`
    : AMARA_SYSTEM_PROMPT;

  // Prefer Groq Llama for text chat — far higher free-tier quota than Gemini
  const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY");
  if (GROQ_API_KEY) {
    const messages = [
      { role: "system", content: systemText },
      ...history.slice(-10).map((m: ConversationMessage) => ({
        role: m.role === "user" ? "user" : "assistant",
        content: m.message,
      })),
      { role: "user", content: userMessage },
    ];
    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify({ model: "llama-3.1-70b-versatile", messages, temperature: 0.9, max_tokens: 350 }),
    });
    if (groqRes.ok) {
      const groqData = await groqRes.json();
      const groqText = groqData.choices?.[0]?.message?.content?.trim() ?? "I dey here! Try again in a moment 😊";
      if (studentId) saveConversation(studentId, "assistant", groqText).catch(() => {});
      return groqText;
    }
    console.error(`Groq chat error ${groqRes.status}: ${await groqRes.text()}`);
    // Fall through to Gemini
  }

  const contents: unknown[] = [];

  // Build a strictly alternating user/model sequence from recent history.
  // Walk backwards keeping only messages that alternate, ending with "model"
  // so the new "user" message can follow without triggering a Gemini 400 error.
  // (The DB often has only user messages; this handles that gracefully.)
  const recent = history.slice(-10);
  const alternating: ConversationMessage[] = [];
  let wantRole: "user" | "assistant" = "assistant";
  for (let i = recent.length - 1; i >= 0; i--) {
    if (recent[i].role === wantRole) {
      alternating.unshift(recent[i]);
      wantRole = wantRole === "user" ? "assistant" : "user";
    }
  }
  for (const msg of alternating) {
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
  };

  const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`Gemini chat error ${res.status}: ${errText}`);
    return "I dey here! Try again in a moment 😊";
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "I dey here! Try again in a moment 😊";
  if (studentId) {
    saveConversation(studentId, "assistant", text).catch(() => {});
  }
  return text;
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
    console.error(`Gemini vision error ${res.status} (mime: ${mimeType}): ${errText}`);
    return { verified: false, reason: "verification_unavailable", extracted: {} };
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

// Voice transcription — uses Groq Whisper if GROQ_API_KEY is set, falls back to Gemini
export async function geminiAudio(
  audioBytes: Uint8Array,
  mimeType = "audio/ogg"
): Promise<string> {
  const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY");

  if (GROQ_API_KEY) {
    const ext = mimeType.includes("ogg") ? "ogg" : mimeType.includes("mp4") ? "mp4" : "ogg";
    const form = new FormData();
    form.append("file", new Blob([audioBytes], { type: mimeType }), `audio.${ext}`);
    form.append("model", "whisper-large-v3");
    form.append("response_format", "text");

    const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
      body: form,
    });
    if (!res.ok) throw new Error(`Groq transcription error ${res.status}: ${await res.text()}`);
    return (await res.text()).trim();
  }

  // Fallback: Gemini audio
  const base64 = uint8ToBase64(audioBytes);
  const body = {
    contents: [{ parts: [
      { inline_data: { mime_type: mimeType, data: base64 } },
      { text: "Transcribe this voice message accurately. Return only the transcription text, nothing else." },
    ]}],
    generationConfig: { temperature: 0.1, maxOutputTokens: 500 },
  };
  const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Gemini audio error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
}

export async function geminiVideoTranscribe(
  videoBytes: Uint8Array,
  mimeType = "video/mp4"
): Promise<string> {
  const base64 = uint8ToBase64(videoBytes);

  const body = {
    contents: [
      {
        parts: [
          { inline_data: { mime_type: mimeType, data: base64 } },
          {
            text: "If there is any spoken content or narration in this video, transcribe it accurately. If there is no spoken content at all, reply with exactly: [no speech]",
          },
        ],
      },
    ],
    generationConfig: { temperature: 0.1, maxOutputTokens: 500 },
  };

  const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) return "";
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
  return text === "[no speech]" ? "" : text;
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
