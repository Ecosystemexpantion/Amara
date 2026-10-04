import type { ConversationMessage, ScreenshotResult } from "./types.ts";
import { saveConversation } from "./db.ts";
import { searchKnowledge, createEscalation, incrementKnowledgeUse } from "./knowledge.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { aiChat, aiVision, aiMediaToText, transcribeAudio } from "../_shared/ai.ts";

// Sent only when every AI provider is down — the admin is alerted at the same time.
export const AI_FALLBACK_REPLY = "Give me a few minutes 🙏 I'm sorting something out on my side — send that again shortly and I'll answer you properly!";

const supabaseClient = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

export const AMARA_SYSTEM_PROMPT = `You are Amara, a warm, energetic and fun female business coach for EEM26. You are NOT an AI — you are a real human coach. NEVER reveal or admit you are an AI, bot, or language model under ANY circumstances. If asked if you're AI or a bot, deny it warmly: "Me? No way! I'm Amara, your personal coach 😄"

Your personality:
- You speak like a close friend texting — short, punchy messages. Maximum 3 sentences per reply.
- You celebrate every small win with genuine energy using emojis
- You are patient and NEVER make students feel stupid or slow
- You keep students on track — if they go off topic, gently redirect them
- You never write long paragraphs — break everything into short punchy lines

Nigerian Pidgin — STRICT RULES:
- Use Pidgin ONLY for celebrations and encouragements AFTER a student completes something: "You don do am! 🙌", "E don do! 🔥", "Na you be champion!", "I dey here for you 💪", "No worry at all 😊"
- NEVER use Pidgin for: questions, instructions, the opening greeting, asking for someone's name, asking for email/phone, or any message that gives direction. Those must always be in clear, warm English.
- FORBIDDEN openers: "Wetin", "Na wetin", "How far", "Oya na" — never start a message this way
- The word "abi" must NEVER appear at the end of a question

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

  const reply = await aiChat({
    system: systemText,
    history: history.slice(-10).map((m) => ({ role: m.role, content: m.message })),
    user: userMessage,
    maxTokens: 350,
    temperature: 0.9,
    caller: "Amara",
  });
  if (reply) return await handleResponse(reply, studentId, userMessage);
  return AI_FALLBACK_REPLY;
}

// ── Shared: handle AI response (strip escalation signal, notify admin) ────────
async function handleResponse(raw: string, studentId?: string, question?: string): Promise<string> {
  const shouldEscalate = raw.includes("[ESCALATE]");

  if (shouldEscalate && studentId && question) {
    // Do NOT send the AI response — Amara stays quiet until admin answers
    const holdMsg = "Let me check that with Coach Victor for you 🙏 I'll come back to you shortly!";
    saveConversation(studentId, "assistant", holdMsg).catch(() => {});

    // Look up student, create escalation (fire-and-forget)
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

    return holdMsg;
  }

  const text = raw.replace(/\[ESCALATE\]/g, "").trim();

  if (studentId) {
    saveConversation(studentId, "assistant", text).catch(() => {});
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

// ── Vision verification (structured JSON) ────────────────────────────────────

export async function geminiVision(
  imageBytes: Uint8Array,
  mimeType: string,
  verificationPrompt: string
): Promise<ScreenshotResult> {
  const rawText = await aiVision({
    prompt: verificationPrompt,
    image: { base64: uint8ToBase64(imageBytes), mimeType },
    maxTokens: 700,
    temperature: 0.1,
    caller: "Amara screenshot check",
  });
  if (rawText) return parseVisionText(rawText);

  console.error("All vision providers exhausted");
  return { verified: false, reason: "verification_unavailable", guidance: undefined, extracted: {} };
}

// ── Vision guidance (natural language) ───────────────────────────────────────

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

  const rawText = await aiVision({
    prompt,
    image: { base64: uint8ToBase64(imageBytes), mimeType },
    maxTokens: 400,
    temperature: 0.7,
    caller: "Amara screenshot guidance",
  });
  if (rawText) return rawText;

  return "I can see your screenshot! 😊 Can you tell me which step you're having trouble with? I'll guide you through it!";
}

export async function geminiAudio(
  audioBytes: Uint8Array,
  mimeType = "audio/ogg"
): Promise<string> {
  const text = await transcribeAudio(audioBytes, mimeType, uint8ToBase64(audioBytes));
  if (text === null) throw new Error("Voice transcription failed on every provider");
  return text;
}

export async function geminiVideoTranscribe(
  videoBytes: Uint8Array,
  mimeType = "video/mp4"
): Promise<string> {
  const text = await aiMediaToText({
    prompt: "If there is any spoken content or narration in this video, transcribe it accurately. If there is no spoken content at all, reply with exactly: [no speech]",
    media: { base64: uint8ToBase64(videoBytes), mimeType },
    maxTokens: 500,
    caller: "video",
  });
  return !text || text === "[no speech]" ? "" : text;
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
