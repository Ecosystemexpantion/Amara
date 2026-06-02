// student-bot/index.ts
// Multi-tenant EEM26 sales funnel bot.
// Each student's bot webhook → /functions/v1/student-bot/[student_uuid]
//
// FUNNEL:
// NEW → collect name/country/struggle/email → REGISTERED → 3 wind-down replies → SILENT
// Buy intent at any point → immediate CLOSING MODE
// ATTENDED → aggressive close → payment screenshot → PURCHASED
// COLD → no response

import { createClient } from "npm:@supabase/supabase-js@2";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Student {
  id: string;
  telegram_chat_id: string;
  full_name: string | null;
  payhip_link: string | null;
  sales_page_link: string | null;
  bot_token: string | null;
  status: string;
}

interface Lead {
  id: string;
  student_id: string;
  chat_id: string;
  name: string | null;
  phone: string | null;
  country: string | null;
  email: string | null;
  struggle: string | null;
  stage: string;
  wind_down_count: number;
  download_link_sent_at: string | null;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

interface TelegramMessage {
  message_id: number;
  from?: { id: number; first_name: string; username?: string };
  chat: { id: number; type: string };
  date: number;
  text?: string;
  caption?: string;
  photo?: { file_id: string; file_unique_id: string; file_size: number; width: number; height: number }[];
  video?: { file_id: string; duration: number };
}

type SupabaseClient = ReturnType<typeof createClient>;

// ─── Constants ────────────────────────────────────────────────────────────────

const PRODUCT_PRICE = 39820; // ₦ — must match exactly
const ADMIN_CHAT_ID = Deno.env.get("ADMIN_CHAT_ID") ?? "5870771695";
const BOT_TOKEN_AMARA = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";

// Triggers immediate closing mode from any stage
const BUY_INTENT_RE =
  /how much|what.{0,10}(price|cost)|(i want to|i'?d like to) (buy|pay|register|get|download|purchase)|(price|cost)[?!.\s]*$|(i'?m|i am) (ready|interested)|send me.{0,20}link|how (can i|do i) (buy|get|download|pay|register|join)/i;

// Triggers instant REGISTERED → ATTENDED upgrade
const ATTENDED_RE =
  /i (attended|was there|came|watched|joined|saw).{0,30}(training|webinar|session|class|meeting|zoom|live|sunday)/i;

// Core bot persona — used across all prompts
const BOT_PERSONA = `You are a friendly and professional sales assistant for EEM26 Selar Training.
EEM26 Selar Training helps people build a digital income stream in just 4 days (AAM and SRE systems).

STRICT LANGUAGE RULE: Write ONLY in standard English. You must NEVER use Nigerian Pidgin.
Forbidden words/phrases: "dey", "wetin", "na", "comot", "oga", "abeg", "my brother" (casual), "you sabi", "make you", "I go", "e don".
Write exactly like a professional customer service agent in the US or UK.

Additional rules:
- Never mention the bot owner's name
- Never admit you are an AI — you are a human assistant
- If asked your name, say: "I'm the EEM26 Selar Training assistant"
- Keep replies to 3 sentences maximum`;

// AIDA opening hook — sent to every brand-new lead on first contact
const OPENING_HOOK =
  `Hey! So glad you're here 🔥\n\n` +
  `EEM26 Selar Training is one of the fastest ways to build a real income online right now — ` +
  `people are going from zero to their first digital income in just 4 days.\n\n` +
  `But first — what's your name, which country are you from, and what's your biggest challenge ` +
  `when it comes to making money online? I want to make sure this is the right fit for you 👇`;

// Phase 1: extract name + country + struggle, respond with AIDA energy
const PHASE1_SYSTEM = BOT_PERSONA + `

You are having the FIRST real conversation with a new lead interested in EEM26 Selar Training.

Read their message carefully. Extract what they shared and respond with genuine energy.

Always end your reply with this DATA block on a NEW LINE (never shown to the lead):
DATA: name={their name or empty}, country={their country or empty}, struggle={their struggle or empty}

How to respond based on what you extracted:
- Got ALL 3 (name + country + struggle): React warmly to their specific struggle — show you understand it. Say something like "You're in exactly the right place — EEM26 was built for people in your situation." Build excitement briefly. Then ask: "What email address should I send your registration details to? 📧"
- Got 1 or 2: Warmly acknowledge what they shared, then naturally ask for the missing pieces — make it feel like genuine curiosity, not a form.
- Got NONE (they said "hi" or asked a question): Re-engage genuinely, answer their question briefly if any, then bring them back to the 3 questions with enthusiasm.

Keep replies to 4 sentences maximum. Sound like a real, excited human.`;

// Phase 2: extract email, confirm registration
function phase2System(lead: Lead): string {
  return BOT_PERSONA + `

You are talking to ${lead.name ?? "a new lead"} from ${lead.country ?? "unknown"}.
Their biggest struggle: "${lead.struggle ?? "unknown"}"

They are responding to your request for their email address. Extract it and confirm registration.

Always end your reply with this on a NEW LINE: DATA: email={email or empty}

How to respond:
- Valid email found: Confirm registration with genuine excitement! Tell them they are officially registered for the Sunday EEM26 session and to keep their DM open for session details. Max 3 sentences.
- No valid email or unclear: Ask again warmly — "What email should I send your registration details to? 📧" Max 2 sentences.

Standard English only. No Nigerian Pidgin.`;
}

// ─── alertAdmin ───────────────────────────────────────────────────────────────

async function alertAdmin(msg: string): Promise<void> {
  if (!BOT_TOKEN_AMARA) return;
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN_AMARA}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: ADMIN_CHAT_ID, text: msg, parse_mode: "HTML" }),
  }).catch(() => {});
}

// ─── base64 ───────────────────────────────────────────────────────────────────

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

// ─── Groq — free text chat ───────────────────────────────────────────────────

async function callGroq(
  systemPrompt: string,
  history: { role: string; content: string }[],
  userMessage: string
): Promise<string> {
  const apiKey = Deno.env.get("GROQ_API_KEY");
  if (!apiKey) {
    await alertAdmin("⚠️ <b>student-bot</b>: GROQ_API_KEY not set");
    return "I'll get back to you shortly!";
  }

  // Build strictly alternating user/assistant list
  const recent = history.slice(-8);
  const messages: { role: string; content: string }[] = [];
  let want: "user" | "assistant" = "assistant";
  for (let i = recent.length - 1; i >= 0; i--) {
    if (recent[i].role === want) {
      messages.unshift({ role: want, content: recent[i].content });
      want = want === "user" ? "assistant" : "user";
    }
  }
  if (userMessage) messages.push({ role: "user", content: userMessage });

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "system", content: systemPrompt }, ...messages],
        max_tokens: 300,
        temperature: 0.9,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error(`Groq ${res.status}: ${err}`);
      await alertAdmin(`⚠️ <b>student-bot Groq error</b> ${res.status}: <code>${err.slice(0, 200)}</code>`);
      return "I'll get back to you shortly!";
    }

    const data = await res.json();
    return data?.choices?.[0]?.message?.content?.trim() ?? "I'll get back to you shortly!";
  } catch (e) {
    console.error("Groq error:", e);
    return "I'll get back to you shortly!";
  }
}

// ─── Gemini vision — extract payment amount ───────────────────────────────────

async function extractPaymentAmount(
  imageBytes: Uint8Array,
  mimeType: string
): Promise<number | null> {
  const key = Deno.env.get("GEMINI_API_KEY") ?? "";
  if (!key) return null;

  const base64 = uint8ToBase64(imageBytes);
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [
            { inline_data: { mime_type: mimeType, data: base64 } },
            { text: "Look at this payment or bank transfer screenshot. Extract the total amount paid in Nigerian Naira. Return ONLY the numeric value without any symbol, comma, or space. Example: for ₦39,820 return: 39820. If you cannot determine the amount, return: 0" },
          ]}],
          generationConfig: { temperature: 0.1, maxOutputTokens: 20 },
        }),
      }
    );

    if (!res.ok) return null;
    const data = await res.json();
    const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "0";
    const num = parseInt(text.replace(/[^0-9]/g, ""), 10);
    return isNaN(num) ? null : num;
  } catch {
    return null;
  }
}

// ─── Telegram helpers ─────────────────────────────────────────────────────────

async function sendMessage(token: string, chatId: number | string, text: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  }).catch(() => {});
}

async function downloadPhoto(
  token: string,
  fileId: string
): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
  try {
    const r1 = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`);
    if (!r1.ok) return null;
    const filePath: string | undefined = (await r1.json())?.result?.file_path;
    if (!filePath) return null;
    const ext = filePath.split(".").pop()?.toLowerCase() ?? "jpg";
    const mimeMap: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
    const r2 = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
    if (!r2.ok) return null;
    return { bytes: new Uint8Array(await r2.arrayBuffer()), mimeType: mimeMap[ext] ?? "image/jpeg" };
  } catch {
    return null;
  }
}

// ─── Data extraction ──────────────────────────────────────────────────────────

function extractData(text: string): Record<string, string> {
  const match = text.match(/^DATA:\s*(.+)$/m);
  if (!match) return {};
  const result: Record<string, string> = {};
  for (const pair of match[1].split(",")) {
    const eqIdx = pair.indexOf("=");
    if (eqIdx < 0) continue;
    const k = pair.slice(0, eqIdx).trim().toLowerCase();
    const v = pair.slice(eqIdx + 1).trim();
    if (k && v) result[k] = v;
  }
  return result;
}

function clean(text: string): string {
  return text
    .replace(/^DATA:.*$/gm, "")
    .replace(/^LINK_SENT:.*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

async function getHistory(
  supabase: SupabaseClient,
  studentId: string,
  chatId: string
): Promise<{ role: string; content: string }[]> {
  const { data } = await supabase
    .from("student_bot_conversations")
    .select("role, message")
    .eq("student_id", studentId)
    .eq("chat_id", chatId)
    .order("created_at", { ascending: false })
    .limit(8);
  return ((data ?? []) as { role: string; message: string }[])
    .reverse()
    .map((r) => ({ role: r.role, content: r.message }));
}

async function saveConv(
  supabase: SupabaseClient,
  studentId: string,
  chatId: string,
  user: string,
  bot: string
): Promise<void> {
  try {
    await supabase
      .from("student_bot_conversations")
      .insert([
        { student_id: studentId, chat_id: chatId, role: "user", message: user },
        { student_id: studentId, chat_id: chatId, role: "assistant", message: bot },
      ]);
  } catch (e) {
    console.error("saveConv error:", e);
  }
}

async function upsertLead(
  supabase: SupabaseClient,
  studentId: string,
  chatId: string,
  fields: Record<string, unknown>
): Promise<void> {
  try {
    const { error } = await supabase
      .from("student_bot_leads")
      .upsert(
        { student_id: studentId, chat_id: chatId, updated_at: new Date().toISOString(), ...fields },
        { onConflict: "student_id,chat_id" }
      );
    if (error) console.error("upsertLead error:", error.message);
  } catch (e) {
    console.error("upsertLead catch:", e);
  }
}

// ─── Admin handler ────────────────────────────────────────────────────────────

async function handleAdmin(
  student: Student,
  chatId: number,
  msg: TelegramMessage,
  supabase: SupabaseClient
): Promise<void> {
  const token = student.bot_token!;

  // Video → return file_id for video library
  if (msg.video) {
    await sendMessage(token, chatId, `📹 <b>Video file_id:</b>\n<code>${msg.video.file_id}</code>`);
    return;
  }

  const query = (msg.text ?? "").trim();
  if (!query) return;

  // Greetings / chit-chat → show command menu instead of querying DB
  if (/^(hi|hello|hey|good|let'?s|ok|okay|start|continue|test|hii+|yo|oya)\b/i.test(query)) {
    await sendMessage(
      token,
      chatId,
      `👋 <b>Admin mode — you own this bot!</b>\n\n` +
        `Your leads can't see this. Ask me anything about your leads, e.g:\n\n` +
        `• "How many leads do I have?"\n` +
        `• "Who registered today?"\n` +
        `• "What objections are people raising?"\n` +
        `• "How many attended?"\n\n` +
        `📹 Send a <b>video</b> → I'll give you the file_id\n\n` +
        `<i>To test the lead funnel, message this bot from a different Telegram account.</i>`
    );
    return;
  }

  // Fetch lead stats
  const { data: leads } = await supabase
    .from("student_bot_leads")
    .select("stage, name, country, created_at")
    .eq("student_id", student.id);

  const counts: Record<string, number> = {};
  for (const l of leads ?? []) counts[l.stage] = (counts[l.stage] ?? 0) + 1;

  const today = new Date().toISOString().slice(0, 10);
  const newToday = (leads ?? []).filter((l) => l.created_at?.startsWith(today)).length;

  // Recent prospect messages for objection analysis
  const { data: msgs } = await supabase
    .from("student_bot_conversations")
    .select("message")
    .eq("student_id", student.id)
    .eq("role", "user")
    .order("created_at", { ascending: false })
    .limit(30);

  const context =
    `Lead totals by stage: ${JSON.stringify(counts)}\n` +
    `New leads today: ${newToday}\n` +
    `Total: ${leads?.length ?? 0}\n` +
    `Recent prospect messages:\n${(msgs ?? []).map((m: { message: string }) => `"${m.message.slice(0, 80)}"`).join("\n")}`;

  const answer = await callGroq(
    `You are a sales analytics assistant. Answer the owner's question concisely using this data. Use numbers. Be direct.\n\n${context}`,
    [],
    query
  );

  await sendMessage(token, chatId, answer);
}

// ─── Lead handler — full EEM26 sales funnel ───────────────────────────────────

async function handleLead(
  student: Student,
  lead: Lead | null,
  chatId: number,
  msg: TelegramMessage,
  supabase: SupabaseClient
): Promise<void> {
  const token = student.bot_token!;
  const chatIdStr = String(chatId);
  const stage = lead?.stage ?? "NEW";
  const userText = (msg.text ?? msg.caption ?? "").trim();
  const downloadLink = student.payhip_link ?? student.sales_page_link ?? "https://payhip.com";

  // Debug log so admin can see what's happening
  await alertAdmin(`🔍 <b>Lead msg</b>\nStage: ${stage}\nText: "${userText.slice(0, 80)}"\nLead: ${lead ? "exists" : "new"}`);

  // Handle /start and other commands — send AIDA opening hook
  if (userText === "/start" || userText.startsWith("/")) {
    await sendMessage(token, chatId, OPENING_HOOK);
    await upsertLead(supabase, student.id, chatIdStr, { stage: "NEW", wind_down_count: 0 });
    await saveConv(supabase, student.id, chatIdStr, userText, OPENING_HOOK);
    return;
  }

  const hasBuyIntent = BUY_INTENT_RE.test(userText);
  const hasAttended = ATTENDED_RE.test(userText);

  // ── HOT LEAD alert (buy intent from any active stage)
  if (hasBuyIntent && stage !== "PURCHASED" && stage !== "COLD") {
    const { data: lastMsgs } = await supabase
      .from("student_bot_conversations")
      .select("role, message")
      .eq("student_id", student.id)
      .eq("chat_id", chatIdStr)
      .order("created_at", { ascending: false })
      .limit(10);

    const preview = ((lastMsgs ?? []) as { role: string; message: string }[])
      .reverse()
      .map((m) => `${m.role === "user" ? "👤" : "🤖"} ${m.message.slice(0, 80)}`)
      .join("\n");

    await sendMessage(
      token,
      student.telegram_chat_id,
      `🔥 <b>HOT LEAD!</b>\n<b>Name:</b> ${lead?.name ?? "Unknown"}\n<b>Country:</b> ${lead?.country ?? "Unknown"}\n<b>Stage:</b> ${stage}\n<b>Said:</b> "${userText.slice(0, 150)}"\n\n<b>Last 10 messages:</b>\n${preview.slice(0, 600)}`
    );
  }

  // ── COLD — no response ever
  if (stage === "COLD") return;

  // ── PURCHASED — warm support only, no more selling
  if (stage === "PURCHASED") {
    if (!userText) return;
    const history = await getHistory(supabase, student.id, chatIdStr);
    const reply = await callGroq(
      BOT_PERSONA + `\n\nThis person has already purchased EEM26 Selar Training. Be warm and reassuring. Let them know their setup begins shortly. Max 2 sentences.`,
      history,
      userText
    );
    await sendMessage(token, chatId, reply);
    await saveConv(supabase, student.id, chatIdStr, userText, reply);
    return;
  }

  // ── PAYMENT SCREENSHOT — only when ATTENDED or explicit buy intent
  if (msg.photo && msg.photo.length > 0 && (stage === "ATTENDED" || hasBuyIntent)) {
    const photo = msg.photo[msg.photo.length - 1];
    const dl = await downloadPhoto(token, photo.file_id);

    if (dl) {
      const amount = await extractPaymentAmount(dl.bytes, dl.mimeType);

      if (amount === PRODUCT_PRICE) {
        await upsertLead(supabase, student.id, chatIdStr, { stage: "PURCHASED" });
        const reply = "🎉 Payment confirmed! Welcome to the EEM26 Selar Training family! Your 4-day setup begins very soon — watch your DM for the onboarding message! 🚀";
        await sendMessage(token, chatId, reply);
        await sendMessage(
          token,
          student.telegram_chat_id,
          `💰 <b>NEW PURCHASE!</b>\n<b>Name:</b> ${lead?.name ?? "Unknown"}\n<b>Country:</b> ${lead?.country ?? "Unknown"}\n<b>Amount:</b> ₦${amount.toLocaleString()}`
        );
        await saveConv(supabase, student.id, chatIdStr, "[payment screenshot]", reply);
      } else if (amount !== null && amount > 0) {
        const reply = `Hmm, I'm seeing ₦${amount.toLocaleString()} on this screenshot but the price is ₦39,820. Please send the correct payment screenshot 📸`;
        await sendMessage(token, chatId, reply);
        await saveConv(supabase, student.id, chatIdStr, "[screenshot - wrong amount]", reply);
      } else {
        // Can't read amount — still in closing mode
        const history = await getHistory(supabase, student.id, chatIdStr);
        const reply = await callGroq(
          closingPrompt(downloadLink),
          history,
          "prospect sent a photo but I couldn't confirm payment. Ask them to send a clearer screenshot showing ₦39,820."
        );
        await sendMessage(token, chatId, clean(reply));
        await saveConv(supabase, student.id, chatIdStr, "[photo]", clean(reply));
      }
      return;
    }

    // Download failed — ask them to retry
    await sendMessage(token, chatId, "I got your screenshot but couldn't open it 😕 Can you send it again? Make sure it shows the payment confirmation clearly 📸");
    return;
  }

  // ── REGISTERED — keep lead warm until Sunday, always respond (never go silent)
  if (stage === "REGISTERED" && !hasBuyIntent && !hasAttended) {
    if (!userText) return;

    const history = await getHistory(supabase, student.id, chatIdStr);
    const reply = await callGroq(
      BOT_PERSONA + `\n\nThis lead is registered for the EEM26 Selar Training Sunday session. Keep them warm, answer their questions, and build excitement for Sunday. Do NOT mention prices or selling. Max 3 sentences.`,
      history,
      userText
    );
    await sendMessage(token, chatId, reply);
    await saveConv(supabase, student.id, chatIdStr, userText, reply);
    return;
  }

  // ── ATTENDED upgrade on instant attendance signal
  if (hasAttended && (stage === "REGISTERED" || stage === "NEW")) {
    await upsertLead(supabase, student.id, chatIdStr, { stage: "ATTENDED" });
    // Fall through to closing mode
  }

  // ── CLOSING MODE — ATTENDED stage, buy intent from any stage, or just attended
  const effectiveStage = hasAttended ? "ATTENDED" : stage;
  if (effectiveStage === "ATTENDED" || hasBuyIntent) {
    if (!userText && !msg.photo) return;

    const history = await getHistory(supabase, student.id, chatIdStr);
    const rawReply = await callGroq(
      closingPrompt(downloadLink),
      history,
      userText || "[prospect sent media]"
    );
    const linkSent = /^LINK_SENT:\s*yes/im.test(rawReply);
    const reply = clean(rawReply);

    await sendMessage(token, chatId, reply);

    if (linkSent) {
      await upsertLead(supabase, student.id, chatIdStr, {
        stage: "ATTENDED",
        download_link_sent_at: new Date().toISOString(),
      });
    }
    await saveConv(supabase, student.id, chatIdStr, userText || "[media]", reply);
    return;
  }

  // ── NEW — AIDA 3-question funnel: opening hook → name/country/struggle → email → REGISTERED
  if (!lead) {
    // Brand new lead — send AIDA opening hook
    await sendMessage(token, chatId, OPENING_HOOK);
    await upsertLead(supabase, student.id, chatIdStr, { stage: "NEW", wind_down_count: 0 });
    await saveConv(supabase, student.id, chatIdStr, userText || "[started]", OPENING_HOOK);
    return;
  }

  if (!userText) return;

  const hasInitialData = !!(lead.name && lead.country && lead.struggle);
  const hasEmailData = !!lead.email;

  if (!hasInitialData) {
    // Phase 1: Extract name + country + struggle from their response to the opening hook
    const history = await getHistory(supabase, student.id, chatIdStr);
    const rawReply = await callGroq(PHASE1_SYSTEM, history, userText);
    const extracted = extractData(rawReply);
    const reply = clean(rawReply);

    const updates: Record<string, unknown> = { stage: "NEW" };
    if (extracted.name) updates.name = extracted.name;
    if (extracted.country) updates.country = extracted.country;
    if (extracted.struggle) updates.struggle = extracted.struggle;
    await upsertLead(supabase, student.id, chatIdStr, updates);

    await sendMessage(token, chatId, reply);
    await saveConv(supabase, student.id, chatIdStr, userText, reply);
  } else if (!hasEmailData) {
    // Phase 2: Extract email → mark REGISTERED
    const history = await getHistory(supabase, student.id, chatIdStr);
    const rawReply = await callGroq(phase2System(lead), history, userText);
    const extracted = extractData(rawReply);
    const reply = clean(rawReply);

    if (extracted.email) {
      await upsertLead(supabase, student.id, chatIdStr, {
        stage: "REGISTERED",
        email: extracted.email,
        wind_down_count: 0,
      });
      await sendMessage(token, chatId, reply);
      await sendMessage(
        BOT_TOKEN_AMARA,
        student.telegram_chat_id,
        `✅ <b>NEW LEAD REGISTERED!</b>\n<b>Name:</b> ${lead.name}\n<b>Country:</b> ${lead.country}\n<b>Struggle:</b> ${lead.struggle}\n<b>Email:</b> ${extracted.email}`
      );
    } else {
      await sendMessage(token, chatId, reply);
    }
    await saveConv(supabase, student.id, chatIdStr, userText, reply);
  } else {
    // Edge case: all data present but stage not yet REGISTERED
    await upsertLead(supabase, student.id, chatIdStr, { stage: "REGISTERED", wind_down_count: 0 });
  }
}

// ─── Closing mode system prompt ───────────────────────────────────────────────


function closingPrompt(downloadLink: string): string {
  return BOT_PERSONA + `

Your current objective is to close the sale. The lead has attended the EEM26 Selar Training Sunday session or is asking about purchasing.

Product: EEM26 Tech Stack — everything needed to build a digital income stream in 4 days (AAM + SRE systems)
Price: ₦39,820 (one-time investment, full package)
Purchase link: ${downloadLink}
Urgency: Coach Victor's Day 4 live session only takes 5 people — spots fill up fast after every Sunday session.
After purchase: Lead gets a full 4-day guided setup with live support.

Handle objections confidently with proof and social proof. Keep responses to 3 sentences max.
When you include the purchase link in your reply, add on a NEW LINE: LINK_SENT: yes`;
}

// ─── Main entry ───────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return new Response("Student Bot is running ✅", { status: 200 });
  }

  const url = new URL(req.url);
  const segments = url.pathname.split("/").filter(Boolean);
  const studentId = segments[segments.length - 1];

  if (!studentId || studentId === "student-bot") {
    return new Response("OK", { status: 200 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  let update: TelegramUpdate;
  try {
    update = await req.json();
  } catch {
    return new Response("OK", { status: 200 });
  }

  const process = (async () => {
    try {
      const { data: sd, error } = await supabase
        .from("amara_students")
        .select("id, telegram_chat_id, full_name, payhip_link, sales_page_link, bot_token, status")
        .eq("id", studentId)
        .single();

      if (error || !sd) return;
      const student = sd as Student;
      if (!student.bot_token) return;

      const msg = update?.message;
      if (!msg?.chat?.id) return;
      const chatId = msg.chat.id;
      const chatIdStr = String(chatId);

      // Admin = the student messaging their own bot
      if (chatIdStr === String(student.telegram_chat_id)) {
        await handleAdmin(student, chatId, msg, supabase);
        return;
      }

      const { data: leadData } = await supabase
        .from("student_bot_leads")
        .select("*")
        .eq("student_id", student.id)
        .eq("chat_id", chatIdStr)
        .single();

      try {
        await handleLead(student, leadData as Lead | null, chatId, msg, supabase);
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        console.error("handleLead error:", errMsg);
        await alertAdmin(`🚨 <b>student-bot crash</b>\nBot: ${student.bot_token?.slice(0, 20)}...\nError: <code>${errMsg.slice(0, 300)}</code>`);
        // Always send something so the lead is never left in silence
        await fetch(`https://api.telegram.org/bot${student.bot_token}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: "Hey! Sorry for the delay — I'm here now! What's your name? 😊" }),
        }).catch(() => {});
      }
    } catch (e) {
      console.error("student-bot outer error:", e);
    }
  })();

  if (typeof EdgeRuntime !== "undefined") {
    (EdgeRuntime as unknown as { waitUntil: (p: Promise<unknown>) => void }).waitUntil(process);
  } else {
    await process;
  }

  return new Response("OK", { status: 200 });
});
