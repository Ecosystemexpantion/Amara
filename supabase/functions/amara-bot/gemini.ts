import type { ConversationMessage, ScreenshotResult } from "./types.ts";
import { saveConversation } from "./db.ts";
import { searchKnowledge, createEscalation, incrementKnowledgeUse } from "./knowledge.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

// Returns all configured Gemini API keys so vision can rotate through them on 429
function getGeminiKeys(): string[] {
  const keys: string[] = [];
  for (const name of [
    "GEMINI_API_KEY", "GEMINI_API_KEY_2", "GEMINI_API_KEY_3",
    "GEMINI_API_KEY_4", "GEMINI_API_KEY_5", "GEMINI_API_KEY_6",
    "GEMINI_API_KEY_7", "GEMINI_API_KEY_8", "GEMINI_API_KEY_9", "GEMINI_API_KEY_10",
  ]) {
    const k = Deno.env.get(name);
    if (k) keys.push(k);
  }
  return keys;
}

// Returns all configured Groq API keys
function getGroqKeys(): string[] {
  const keys: string[] = [];
  for (const name of [
    "GROQ_API_KEY", "GROQ_API_KEY_2", "GROQ_API_KEY_3",
    "GROQ_API_KEY_4", "GROQ_API_KEY_5",
  ]) {
    const k = Deno.env.get(name);
    if (k) keys.push(k);
  }
  return keys;
}

// Primary key (used by Gemini chat fallback)
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";

const supabaseClient = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

export const AMARA_SYSTEM_PROMPT = `You are Amara, a warm, energetic and fun female business coach for EEM26. You are NOT an AI — you are a real human coach. NEVER reveal or admit you are an AI, bot, or language model under ANY circumstances. If asked if you're AI or a bot, deny it warmly: "Me? No way! I'm Amara, your personal coach 😄"

Your personality:
- You speak like a close friend texting — short, punchy messages. Maximum 3 sentences per reply.
- You mix English and Nigerian Pidgin naturally: "You don do am!", "E easy, I promise", "Oya let's go", "No worry at all", "You sabi this one already", "Well done!", "My person!", "I dey here for you", "Na you be champion", "E don do!"
- You celebrate every small win with genuine energy using emojis
- You are patient and NEVER make students feel stupid or slow
- You keep students on track — if they go off topic, gently redirect them
- You never write long paragraphs — break everything into short punchy lines

Language variety: NEVER repeat the same phrase twice in a row. Rotate how you ask for screenshots — sometimes "send me a screenshot 📸", sometimes "snap that and send it over 📸", sometimes "show me what you're seeing 👀", sometimes "drop a screenshot here 📸". Vary your celebrations too — mix "You don do am! 🙌", "Yesss!! 🔥", "That's it!", "Perfect! 💪", "Nailed it! 🎯", "Na you be champion!". Use the student's name occasionally (roughly 1 in 3 replies) to keep it personal and warm. React to what they just did BEFORE jumping to the next task.

Tech Stack: Whenever you mention a platform or share a link — Selar, Payhip, GitHub, Supabase, BotFather — briefly remind the student it is from their Tech Stack they already purchased. Something like "from your Tech Stack 📦" or "already in your package". Keep it natural, not scripted.

Natural feel: Natural imperfections are fine — skip a comma occasionally, use "lol" or "haha" when genuinely funny, use "!!" when genuinely excited. You don't sound like a formal document.

Screenshots: When a student seems confused, lost, or unsure about WHERE to click or HOW to navigate, ask them to send you a screenshot so you can see exactly what's on their screen and guide them step by step — like a friend looking over their shoulder.

Device awareness: Some students are on a PHONE (Android/iPhone), some are on a LAPTOP/COMPUTER. When you know which device they're using, tailor your instructions to that device. For phone users: say "tap" not "click", refer to "Downloads folder" or "Files app", say they need to save the file from Telegram first before uploading. For laptop users: say "click" and "drag-and-drop". If you don't know their device, keep instructions general but friendly.

Tech level awareness: Some students are TECHNICAL (comfortable with computers and apps), some are NON-TECHNICAL (complete beginners). When guiding a non-technical student, explain EVERY click and be extra patient and reassuring — never assume they know what a repository is or how to find a downloaded file. For technical students, you can be more concise and trust they'll figure out the small details.

Current context: You are guiding a paid student through their 4-day EEM26 business setup program. They have already purchased the Tech Stack package. Your job is to make sure they complete every step successfully.

Escalation rule: If a student asks something very specific that only their admin coach would know — like exact prices, specific student income results with names, upcoming program changes, or anything genuinely outside your knowledge — answer as warmly and helpfully as you can, then add the exact text [ESCALATE] on its own line at the very end. Do NOT add [ESCALATE] for normal setup questions.`;

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
  // ── 1. Knowledge base injection ─────────────────────────────────────────────
  // Search for similar questions admin has already answered and inject them.
  let knowledgeContext = "";
  try {
    const relevant = await searchKnowledge(userMessage);
    if (relevant.length > 0) {
      const lines = relevant.map((k) => `Q: ${k.question}\nA: ${k.answer}`).join("\n\n");
      knowledgeContext = `\n\nKnowledge base (admin-trained answers for similar questions — use these if relevant):\n${lines}`;
      // Track usage (fire-and-forget)
      incrementKnowledgeUse(relevant[0].question).catch(() => {});
    }
  } catch (_) { /* non-critical */ }

  const systemText =
    AMARA_SYSTEM_PROMPT +
    knowledgeContext +
    (stepContext ? `\n\nCurrent step context: ${stepContext}` : "");

  // Try all Groq keys × models — Groq has higher free quota than Gemini for text
  // llama-3.1-8b-instant: 20k RPD free (vs 235 RPD for llama-3.3-70b)
  const GROQ_MODELS = ["llama-3.1-8b-instant", "llama-3.3-70b-versatile", "llama3-70b-8192"];
  const groqKeys = getGroqKeys();
  const messages = [
    { role: "system", content: systemText },
    ...history.slice(-10).map((m: ConversationMessage) => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.message,
    })),
    { role: "user", content: userMessage },
  ];
  for (const groqKey of groqKeys) {
    for (const model of GROQ_MODELS) {
      try {
        const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${groqKey}` },
          body: JSON.stringify({ model, messages, temperature: 0.9, max_tokens: 350 }),
        });
        if (groqRes.ok) {
          const groqData = await groqRes.json();
          const groqText = groqData.choices?.[0]?.message?.content?.trim();
          if (groqText) return await handleResponse(groqText, studentId, userMessage);
        }
        if (groqRes.status === 429) { console.warn(`Groq quota: ${model}`); continue; }
        console.warn(`Groq ${groqRes.status} (${model})`);
      } catch (e) {
        console.error(`Groq network error (${model}):`, e);
      }
    }
  }
  // Fall through to Gemini

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

  // Rotate through all Gemini keys in case primary is at quota
  const geminiKeys = getGeminiKeys();
  for (const key of geminiKeys) {
    try {
      const res = await fetch(`${GEMINI_URL}?key=${key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.status === 429) {
        console.warn("Gemini chat key quota exceeded, trying next key...");
        continue;
      }

      if (!res.ok) {
        const errText = await res.text();
        console.error(`Gemini chat error ${res.status}: ${errText}`);
        return "I dey here! Try again in a moment 😊";
      }

      const data = await res.json();
      const raw = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
      if (raw) {
        const result = await handleResponse(raw, studentId, userMessage);
        return result;
      }
    } catch (e) {
      console.error("Gemini chat fetch network error:", e);
    }
  }

  // ── Final fallback: Claude Haiku ────────────────────────────────────────────
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (anthropicKey) {
    try {
      const claudeMessages = [
        ...history.slice(-8).map((m: ConversationMessage) => ({
          role: m.role === "user" ? "user" : "assistant",
          content: m.message,
        })),
        { role: "user", content: userMessage },
      ];
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 350,
          system: systemText,
          messages: claudeMessages,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const raw = data.content?.[0]?.text?.trim() ?? "";
        if (raw) {
          const result = await handleResponse(raw, studentId, userMessage);
          return result;
        }
      }
    } catch (e) {
      console.error("Claude fallback error:", e);
    }
  }

  console.error("All AI providers exhausted");
  return "I dey here! Try again in a moment 😊";
}

// ── Shared: handle AI response (strip escalation signal, notify admin) ────────
async function handleResponse(raw: string, studentId?: string, question?: string): Promise<string> {
  const shouldEscalate = raw.includes("[ESCALATE]");
  const text = raw.replace(/\[ESCALATE\]/g, "").trim();

  if (studentId) {
    saveConversation(studentId, "assistant", text).catch(() => {});
  }

  if (shouldEscalate && studentId && question) {
    // Look up student chat ID and name, then create escalation (fire-and-forget)
    supabaseClient
      .from("amara_students")
      .select("telegram_chat_id, full_name")
      .eq("id", studentId)
      .single()
      .then(({ data }) => {
        if (data) {
          createEscalation(studentId, data.telegram_chat_id, data.full_name, question).catch(() => {});
        }
      })
      .catch(() => {});
  }

  return text;
}

function parseVisionText(rawText: string): ScreenshotResult {
  const jsonStr = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(jsonStr) as ScreenshotResult;
  } catch {
    const verified = /\b(yes|correct|verified|true|confirmed|i can see)\b/i.test(rawText);
    return { verified, reason: rawText.slice(0, 200), extracted: {} };
  }
}

// Each Gemini model has its own free quota bucket — trying all of them maximises capacity
const GEMINI_VISION_MODELS = [
  "gemini-2.0-flash",
  "gemini-1.5-flash",
  "gemini-2.0-flash-lite",
  "gemini-1.5-flash-8b",
];

export async function geminiVision(
  imageBytes: Uint8Array,
  mimeType: string,
  verificationPrompt: string
): Promise<ScreenshotResult> {
  const base64 = uint8ToBase64(imageBytes);

  const body = {
    contents: [{ parts: [
      { inline_data: { mime_type: mimeType, data: base64 } },
      { text: verificationPrompt },
    ]}],
    generationConfig: { temperature: 0.1, maxOutputTokens: 700, candidateCount: 1 },
  };

  // Try every key × every model — each combination has its own daily quota
  const keys = getGeminiKeys();
  for (const key of keys) {
    for (const model of GEMINI_VISION_MODELS) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.status === 429) {
          console.warn(`Gemini vision quota: ${model} key[...${key.slice(-6)}]`);
          continue;
        }
        if (!res.ok) {
          console.warn(`Gemini vision ${res.status} for ${model}: ${await res.text()}`);
          continue;
        }
        const data = await res.json();
        const rawText: string = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
        if (rawText) {
          console.log(`Vision OK: ${model}`);
          return parseVisionText(rawText);
        }
      } catch (e) {
        console.error(`Gemini vision exception (${model}):`, e);
      }
    }
  }

  // All Gemini quota exhausted — try Groq vision as last resort
  const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY");
  if (GROQ_API_KEY) {
    const groqModels = [
      "meta-llama/llama-4-scout-17b-16e-instruct",
      "llama-3.2-90b-vision-preview",
      "llama-3.2-11b-vision-preview",
    ];
    for (const model of groqModels) {
      try {
        const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${GROQ_API_KEY}` },
          body: JSON.stringify({
            model,
            messages: [{
              role: "user",
              content: [
                { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } },
                { type: "text", text: verificationPrompt },
              ],
            }],
            temperature: 0.1,
            max_tokens: 700,
          }),
        });
        if (groqRes.ok) {
          const groqData = await groqRes.json();
          const rawText: string = groqData.choices?.[0]?.message?.content?.trim() ?? "";
          if (rawText) { console.log(`Groq vision OK: ${model}`); return parseVisionText(rawText); }
        } else if (groqRes.status === 429) {
          console.warn(`Groq vision quota: ${model}`);
        } else {
          console.warn(`Groq vision ${groqRes.status} (${model}): ${await groqRes.text()}`);
        }
      } catch (e) {
        console.error(`Groq vision exception (${model}):`, e);
      }
    }
  }

  console.error("All vision providers exhausted");
  return { verified: false, reason: "verification_unavailable", guidance: undefined, extracted: {} };
}

// Read a screenshot and return warm, natural-language guidance (not JSON verification)
export async function geminiVisionGuide(
  imageBytes: Uint8Array,
  mimeType: string,
  stepContext: string,
  studentQuestion?: string
): Promise<string> {
  const questionPart = studentQuestion
    ? `The student also said: "${studentQuestion}"`
    : "The student sent this screenshot — guide them based on what you see.";

  const prompt = `${AMARA_SYSTEM_PROMPT}

You are looking directly at a student's phone or computer screen.

What this student is currently working on: ${stepContext}
${questionPart}

Look at this screenshot carefully and respond as Amara:
1. Tell them EXACTLY what screen/page you can see — be specific (website name, page title, which section they are in)
2. Tell them exactly what to click or tap next — name the button, its color, its location ("top right corner", "blue button at the bottom", "under the Settings menu")
3. If what they need is NOT visible on screen, tell them to scroll (say which direction) and describe what to look for
4. If they are on a completely wrong page or site, tell them the exact URL or steps to navigate back on track
5. Maximum 4 short punchy sentences — like a friend watching their screen and guiding them step by step

Respond in Amara's warm, natural style with Nigerian Pidgin where it fits.`;

  const base64 = uint8ToBase64(imageBytes);
  const body = {
    contents: [{ parts: [
      { inline_data: { mime_type: mimeType, data: base64 } },
      { text: prompt },
    ]}],
    generationConfig: { temperature: 0.7, maxOutputTokens: 400, candidateCount: 1 },
  };

  const keys = getGeminiKeys();
  for (const key of keys) {
    for (const model of GEMINI_VISION_MODELS) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.status === 429) { console.warn(`geminiVisionGuide quota: ${model}`); continue; }
        if (!res.ok) { console.warn(`geminiVisionGuide ${res.status} (${model})`); continue; }
        const data = await res.json();
        const text: string = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
        if (text) return text;
      } catch (e) {
        console.error(`geminiVisionGuide exception (${model}):`, e);
      }
    }
  }

  // Groq vision fallback
  const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY");
  if (GROQ_API_KEY) {
    const groqModels = [
      "meta-llama/llama-4-scout-17b-16e-instruct",
      "llama-3.2-90b-vision-preview",
      "llama-3.2-11b-vision-preview",
    ];
    for (const model of groqModels) {
      try {
        const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${GROQ_API_KEY}` },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: [
              { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } },
              { type: "text", text: prompt },
            ]}],
            temperature: 0.7,
            max_tokens: 400,
          }),
        });
        if (groqRes.ok) {
          const groqData = await groqRes.json();
          const text: string = groqData.choices?.[0]?.message?.content?.trim() ?? "";
          if (text) return text;
        } else if (groqRes.status !== 429) {
          console.warn(`geminiVisionGuide Groq ${groqRes.status} (${model})`);
        }
      } catch (e) {
        console.error(`geminiVisionGuide Groq exception (${model}):`, e);
      }
    }
  }

  return "I can see your screenshot! 😊 Can you tell me which step you're having trouble with? I'll guide you through it!";
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

  const keys = getGeminiKeys();
  for (const key of keys) {
    const res = await fetch(`${GEMINI_URL}?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status === 429) { console.warn("Gemini video key quota exceeded, trying next..."); continue; }
    if (!res.ok) return "";
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
    return text === "[no speech]" ? "" : text;
  }
  return "";
}

// Build a step-specific vision verification prompt that requests structured JSON output
export function buildVerificationPrompt(task: string, extractions?: string[]): string {
  const extractionStr = extractions
    ? `Also extract these values if visible: ${extractions.join(", ")}.`
    : "";

  return `${task}
${extractionStr}
Look at the screenshot carefully and answer in valid JSON only (no markdown):
{"verified": true/false, "reason": "describe exactly what you see in the screenshot", "guidance": "if verified=false, tell the student in 1-2 sentences exactly what they need to do or click on to get to the right page, based on what you can see", "extracted": {${
    extractions ? extractions.map((e) => `"${e}": "value or empty string"`).join(", ") : ""
  }}}
verified=true only if the screenshot clearly shows what was asked.`;
}
