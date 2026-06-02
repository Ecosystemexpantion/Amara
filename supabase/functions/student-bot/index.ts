// student-bot/index.ts
// Multi-tenant Supabase Edge Function — handles webhook for every EEM26 student's personal Telegram bot.
// Each student's bot webhook points to: [SUPABASE_URL]/functions/v1/student-bot/[student_uuid]
//
// Deno / TypeScript — fully self-contained (no imports from amara-bot/ modules).

import { createClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@0.27";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Student {
  id: string;
  telegram_chat_id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  country: string | null;
  current_day: number;
  current_step: number;
  payhip_link: string | null;
  sales_page_link: string | null;
  bot_token: string | null;
  status: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
}

interface TelegramMessage {
  message_id: number;
  from?: { id: number; first_name: string; username?: string };
  chat: { id: number; type: string };
  date: number;
  text?: string;
  caption?: string;
  photo?: TelegramPhoto[];
}

interface TelegramPhoto {
  file_id: string;
  file_unique_id: string;
  file_size: number;
  width: number;
  height: number;
}

interface ConversationRow {
  role: string;
  message: string;
}

interface LeadRow {
  id: string;
  student_id: string;
  chat_id: string;
  name: string | null;
  phone: string | null;
  stage: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GEMINI_VISION_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

const ADMIN_CHAT_ID = Deno.env.get("ADMIN_CHAT_ID") ?? "5870771695";
const BOT_TOKEN_AMARA = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";

async function alertAdmin(msg: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN_AMARA}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: ADMIN_CHAT_ID, text: msg, parse_mode: "HTML" }),
  }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Helpers — base64 encoding (chunked to avoid call-stack overflow on large images)
// ---------------------------------------------------------------------------

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

// ---------------------------------------------------------------------------
// Claude Haiku — text chat (replaces Gemini for text; higher rate limits)
// ---------------------------------------------------------------------------

async function callClaude(
  systemPrompt: string,
  history: { role: string; content: string }[],
  userMessage: string
): Promise<string> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY not set");
    await alertAdmin("⚠️ <b>student-bot</b>: ANTHROPIC_API_KEY not configured");
    return "I'll get back to you shortly!";
  }

  const client = new Anthropic({ apiKey });

  // Build message list — must strictly alternate user/assistant
  const recent = history.slice(-8);
  const messages: Anthropic.MessageParam[] = [];
  let wantRole: "user" | "assistant" = "assistant";
  for (let i = recent.length - 1; i >= 0; i--) {
    if (recent[i].role === wantRole) {
      messages.unshift({ role: wantRole, content: recent[i].content });
      wantRole = wantRole === "user" ? "assistant" : "user";
    }
  }
  messages.push({ role: "user", content: userMessage });

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      system: systemPrompt,
      messages,
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    return text || "I'll get back to you shortly!";
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error("Claude chat error:", errMsg);
    await alertAdmin(`⚠️ <b>student-bot Claude error</b>: <code>${errMsg.slice(0, 300)}</code>`);
    return "I'll get back to you shortly!";
  }
}

// ---------------------------------------------------------------------------
// Gemini — vision (payment screenshot check)
// ---------------------------------------------------------------------------

async function checkPaymentScreenshot(
  imageBytes: Uint8Array,
  mimeType: string
): Promise<boolean> {
  const key = Deno.env.get("GEMINI_API_KEY") ?? "";
  const base64 = uint8ToBase64(imageBytes);

  const prompt =
    "Does this image look like a payment confirmation, bank transfer receipt, or purchase screenshot? " +
    "Answer with a single word: YES or NO.";

  // Try multiple vision-capable models in case of quota exhaustion
  const models = [
    "gemini-2.0-flash",
    "gemini-1.5-flash",
    "gemini-2.0-flash-lite",
    "gemini-1.5-flash-8b",
  ];

  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;  // vision only
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { inline_data: { mime_type: mimeType, data: base64 } },
                { text: prompt },
              ],
            },
          ],
          generationConfig: { temperature: 0.1, maxOutputTokens: 10 },
        }),
      });

      if (res.status === 429) {
        console.warn(`Gemini vision quota exceeded: ${model}`);
        continue;
      }
      if (!res.ok) {
        console.warn(`Gemini vision ${res.status} (${model}): ${await res.text()}`);
        continue;
      }

      const data = await res.json();
      const text: string =
        data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
      console.log(`Vision check (${model}): "${text}"`);
      return /^yes/i.test(text);
    } catch (e) {
      console.error(`Gemini vision exception (${model}):`, e);
    }
  }

  // Default to false if all models failed
  return false;
}

// ---------------------------------------------------------------------------
// Telegram helpers
// ---------------------------------------------------------------------------

async function sendMessage(
  botToken: string,
  chatId: number | string,
  text: string
): Promise<void> {
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  }).catch(() => {});
}

async function downloadPhoto(
  botToken: string,
  fileId: string
): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
  try {
    const fileRes = await fetch(
      `https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`
    );
    if (!fileRes.ok) return null;
    const fileData = await fileRes.json();
    const filePath: string | undefined = fileData?.result?.file_path;
    if (!filePath) return null;

    const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
    const mimeMap: Record<string, string> = {
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      webp: "image/webp",
    };
    const mimeType = mimeMap[ext] ?? "image/jpeg";

    const imgRes = await fetch(
      `https://api.telegram.org/file/bot${botToken}/${filePath}`
    );
    if (!imgRes.ok) return null;

    const buffer = await imgRes.arrayBuffer();
    return { bytes: new Uint8Array(buffer), mimeType };
  } catch (e) {
    console.error("downloadPhoto error:", e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Data extraction helpers
// ---------------------------------------------------------------------------

function extractData(text: string): {
  name?: string;
  phone?: string;
  stage?: string;
} {
  const match = text.match(/^DATA:\s*(.+)$/m);
  if (!match) return {};
  const result: Record<string, string> = {};
  for (const pair of match[1].split(",")) {
    const [k, v] = pair.split("=").map((s) => s.trim());
    if (k && v) result[k.toLowerCase()] = v;
  }
  return result;
}

function extractHotLead(text: string): string | null {
  const match = text.match(/^HOT_LEAD:\s*(.+)$/m);
  return match ? match[1].trim() : null;
}

function cleanResponse(text: string): string {
  return text
    .replace(/^DATA:.*$/gm, "")
    .replace(/^HOT_LEAD:.*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------------------------------------------------------------------------
// System prompt builder
// ---------------------------------------------------------------------------

function buildSystemPrompt(student: Student): string {
  const firstName = (student.full_name ?? "").split(" ")[0] || "Your host";
  const payhipLink = student.payhip_link ?? "https://payhip.com";
  const salesPageLink = student.sales_page_link ?? payhipLink;

  return `You are a warm, friendly business assistant representing ${firstName}'s EEM26 digital business.
You are NOT an AI — you are a real human assistant for this business. NEVER admit to being AI.
Your goal: understand prospects' needs and guide them to buy the EEM26 digital business package.

The product (EEM26) helps people build a digital income stream in 4 days:
- AAM (Automate and Attract Method) — gets buyers coming to you automatically
- SRE (Smart Reply Engine) — AI that closes sales 24/7
Price: varies by package. Send interested buyers to: ${payhipLink}
Learn more at: ${salesPageLink}

Lead stages (track in DATA: blocks):
- NEW: Just started chatting, hasn't shown interest yet
- ATTENDED: Engaged, interested, asking about price/details
- PURCHASED: Shows payment screenshot

When collecting leads, output on a NEW LINE (invisible to prospect):
DATA: name={first name they mentioned}, phone={phone if shared}, stage={NEW|ATTENDED|PURCHASED}

When someone is VERY interested or shows payment, output on a NEW LINE:
HOT_LEAD: {brief reason why}

Rules:
- Max 3 sentences per reply. Short and punchy.
- Mix English with light Nigerian Pidgin naturally
- NEVER mention competitor products or price directly — send to the link
- If they show a payment screenshot, celebrate and tag HOT_LEAD`;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  // Always respond 200 to Telegram — even for errors — to prevent retries
  if (req.method !== "POST") {
    return new Response("Student Bot is running ✅", { status: 200 });
  }

  // 1. Extract student_id from URL path (last segment)
  const url = new URL(req.url);
  const pathSegments = url.pathname.split("/").filter(Boolean);
  const studentId = pathSegments[pathSegments.length - 1];

  if (!studentId || studentId === "student-bot") {
    console.warn("No student_id in URL path:", url.pathname);
    return new Response("OK", { status: 200 });
  }

  // 2. Create Supabase client using auto-injected env vars
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Parse request body early — must happen before async processing because
  // the Request body stream can only be consumed once.
  let update: TelegramUpdate;
  try {
    update = await req.json();
  } catch {
    return new Response("OK", { status: 200 });
  }

  // Process asynchronously so we return 200 to Telegram within its 5-second
  // webhook timeout window even when Gemini or file downloads are slow.
  const processingPromise = (async () => {
    try {
      // 3. Look up student from amara_students table by id
      const { data: studentData, error: studentError } = await supabase
        .from("amara_students")
        .select("*")
        .eq("id", studentId)
        .single();

      if (studentError || !studentData) {
        console.warn(`Student not found: ${studentId}`, studentError?.message);
        return;
      }

      const student = studentData as Student;

      if (!student.bot_token) {
        console.warn(`Student ${studentId} has no bot_token configured`);
        return;
      }

      // 4. Parse Telegram update — extract message
      const msg = update?.message;
      if (!msg) return;

      // 5. Extract chatId — bail if missing
      const chatId = msg?.chat?.id;
      if (!chatId) return;

      const chatIdStr = String(chatId);

      // Extract text from message.text or message.caption (caption is set on photo messages)
      const userText = (msg.text ?? msg.caption ?? "").trim();

      // 6. Get conversation history from DB (fetched DESC, then reversed to chronological)
      const { data: convRows } = await supabase
        .from("student_bot_conversations")
        .select("role, message")
        .eq("student_id", student.id)
        .eq("chat_id", chatIdStr)
        .order("created_at", { ascending: false })
        .limit(8);

      const history: { role: string; content: string }[] = (
        (convRows ?? []) as ConversationRow[]
      )
        .reverse()
        .map((r) => ({ role: r.role, content: r.message }));

      // 7. Look up current lead for stage context
      const { data: leadData } = await supabase
        .from("student_bot_leads")
        .select("*")
        .eq("student_id", student.id)
        .eq("chat_id", chatIdStr)
        .single();

      const lead = leadData as LeadRow | null;
      const currentStage = lead?.stage ?? "NEW";

      // 8. Build system prompt with student config + current stage context
      const systemPrompt = buildSystemPrompt(student);
      const stageContext =
        `\n\nCurrent lead stage: ${currentStage}. Lead name: ${lead?.name ?? "unknown"}.`;
      const fullSystemPrompt = systemPrompt + stageContext;

      // -----------------------------------------------------------------------
      // Handle photo messages (payment screenshot check via Gemini vision)
      // -----------------------------------------------------------------------
      if (msg.photo && msg.photo.length > 0) {
        // Pick highest-resolution photo (last in Telegram's array)
        const photo = msg.photo[msg.photo.length - 1];

        const downloaded = await downloadPhoto(student.bot_token, photo.file_id);

        if (downloaded) {
          const isPayment = await checkPaymentScreenshot(
            downloaded.bytes,
            downloaded.mimeType
          );

          let replyText: string;
          let hotLeadReason: string | null = null;

          if (isPayment) {
            // Congratulate and mark PURCHASED
            replyText =
              "Yasssss!! 🎉🔥 Payment confirmed! Welcome to the EEM26 family! " +
              "You don do am! Your 4-day setup begins shortly — get ready to blow up! 🚀";
            hotLeadReason = "Sent payment screenshot — PURCHASED";

            // Upsert lead as PURCHASED
            await supabase
              .from("student_bot_leads")
              .upsert(
                {
                  student_id: student.id,
                  chat_id: chatIdStr,
                  name: lead?.name ?? null,
                  phone: lead?.phone ?? null,
                  stage: "PURCHASED",
                  updated_at: new Date().toISOString(),
                },
                { onConflict: "student_id,chat_id" }
              )
              .catch((e) => console.error("upsert lead (payment photo) error:", e));
          } else {
            // Not a payment screenshot — use Gemini to respond naturally
            const imageContext = userText
              ? `The prospect sent an image with caption: "${userText}". Respond naturally and keep the conversation going.`
              : "The prospect sent an image. Acknowledge it warmly and keep the conversation going.";

            const rawReply = await callClaude(fullSystemPrompt, history, imageContext);
            hotLeadReason = extractHotLead(rawReply);
            replyText = cleanResponse(rawReply);

            // Extract any DATA signals from Gemini's response for non-payment photos
            const extractedData = extractData(rawReply);
            const upsertPayload: Record<string, unknown> = {
              student_id: student.id,
              chat_id: chatIdStr,
              updated_at: new Date().toISOString(),
            };
            if (extractedData.name) upsertPayload.name = extractedData.name;
            if (extractedData.phone) upsertPayload.phone = extractedData.phone;
            if (extractedData.stage) upsertPayload.stage = extractedData.stage;
            if (!upsertPayload.name && lead?.name) upsertPayload.name = lead.name;
            if (!upsertPayload.phone && lead?.phone) upsertPayload.phone = lead.phone;
            if (!upsertPayload.stage) upsertPayload.stage = currentStage;

            await supabase
              .from("student_bot_leads")
              .upsert(upsertPayload, { onConflict: "student_id,chat_id" })
              .catch((e) => console.error("upsert lead (non-payment photo) error:", e));
          }

          // Send reply to prospect
          await sendMessage(student.bot_token, chatId, replyText);

          // Save conversation (user side logged as [photo] or caption text)
          await supabase
            .from("student_bot_conversations")
            .insert([
              {
                student_id: student.id,
                chat_id: chatIdStr,
                role: "user",
                message: userText || "[photo]",
              },
              {
                student_id: student.id,
                chat_id: chatIdStr,
                role: "assistant",
                message: replyText,
              },
            ])
            .catch((e) => console.error("insert conversation (photo) error:", e));

          // 15. Alert student via their own bot if HOT_LEAD detected
          if (hotLeadReason && student.telegram_chat_id) {
            const leadName = lead?.name ?? "Unknown";
            const leadStage = isPayment ? "PURCHASED" : currentStage;
            const alertText =
              `🔥 <b>HOT LEAD ALERT</b>\n\n` +
              `A prospect in your bot just showed strong buying intent!\n\n` +
              `<b>Reason:</b> ${hotLeadReason}\n` +
              `<b>Name:</b> ${leadName}\n` +
              `<b>Stage:</b> ${leadStage}`;
            await sendMessage(student.bot_token, student.telegram_chat_id, alertText);
          }

          return;
        }

        // Photo download failed — send a safe fallback reply
        await sendMessage(
          student.bot_token,
          chatId,
          "I received your image! 😊 Can you tell me more about what you're looking for?"
        );
        return;
      }

      // -----------------------------------------------------------------------
      // Handle text messages
      // -----------------------------------------------------------------------
      if (!userText) return;

      // 9. Call Gemini for text reply
      const rawReply = await callClaude(fullSystemPrompt, history, userText);

      // 10. Extract DATA and HOT_LEAD signals from raw response
      const extractedData = extractData(rawReply);
      const hotLeadReason = extractHotLead(rawReply);

      // 11. Clean response — strip DATA/HOT_LEAD lines before sending to prospect
      const cleanReply = cleanResponse(rawReply);

      // 12. Send clean reply to the prospect
      await sendMessage(student.bot_token, chatId, cleanReply);

      // 13. Upsert lead — merge extracted fields, preserve existing data where no new value
      const upsertPayload: Record<string, unknown> = {
        student_id: student.id,
        chat_id: chatIdStr,
        updated_at: new Date().toISOString(),
      };

      if (extractedData.name) upsertPayload.name = extractedData.name;
      if (extractedData.phone) upsertPayload.phone = extractedData.phone;
      if (extractedData.stage) upsertPayload.stage = extractedData.stage;

      // Fall back to existing lead values to avoid overwriting with null
      if (!upsertPayload.name && lead?.name) upsertPayload.name = lead.name;
      if (!upsertPayload.phone && lead?.phone) upsertPayload.phone = lead.phone;
      if (!upsertPayload.stage) upsertPayload.stage = currentStage;

      await supabase
        .from("student_bot_leads")
        .upsert(upsertPayload, { onConflict: "student_id,chat_id" })
        .catch((e) => console.error("upsert lead error:", e));

      // 14. Save conversation to DB
      await supabase
        .from("student_bot_conversations")
        .insert([
          {
            student_id: student.id,
            chat_id: chatIdStr,
            role: "user",
            message: userText,
          },
          {
            student_id: student.id,
            chat_id: chatIdStr,
            role: "assistant",
            message: cleanReply,
          },
        ])
        .catch((e) => console.error("insert conversation error:", e));

      // 15. If HOT_LEAD: alert the student via their own Telegram chat
      if (hotLeadReason && student.telegram_chat_id) {
        const leadName = extractedData.name ?? lead?.name ?? "Unknown";
        const leadStage = extractedData.stage ?? currentStage;
        const alertText =
          `🔥 <b>HOT LEAD ALERT</b>\n\n` +
          `One of your prospects is very interested right now!\n\n` +
          `<b>Reason:</b> ${hotLeadReason}\n` +
          `<b>Name:</b> ${leadName}\n` +
          `<b>Stage:</b> ${leadStage}\n` +
          `<b>Their message:</b> "${userText.slice(0, 200)}"`;

        // Use student's own bot_token to DM them — they are already a user of their own bot
        await sendMessage(student.bot_token, student.telegram_chat_id, alertText);
      }
    } catch (e) {
      console.error("student-bot processing error:", e);
    }
  })();

  // Use EdgeRuntime.waitUntil when available (Supabase Edge Runtime) so the
  // function continues processing after the HTTP 200 is returned to Telegram.
  if (typeof EdgeRuntime !== "undefined") {
    (
      EdgeRuntime as unknown as { waitUntil: (p: Promise<unknown>) => void }
    ).waitUntil(processingPromise);
  } else {
    // Local dev: await inline
    await processingPromise;
  }

  return new Response("OK", { status: 200 });
});
