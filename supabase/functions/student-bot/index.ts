// student-bot/index.ts — Alex-quality multi-tenant EEM26 sales bot
// Free stack: Groq llama-3.3-70b (text) + Gemini 2.0 flash (vision)

import { createClient } from "npm:@supabase/supabase-js@2";

// ─── Types ────────────────────────────────────────────────────────────────────

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
  interest_level: string | null;
  objections_raised: string | null;
  last_contacted_at: string | null;
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

const PRODUCT_PRICE = 39820;
const ADMIN_CHAT_ID = Deno.env.get("ADMIN_CHAT_ID") ?? "5870771695";
const BOT_TOKEN_AMARA = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const SUNDAY_TRAINING = "https://t.me/+jX6QLzq04uQ3OGE0";
const PREMIUM_LINK = "https://ecosystemexpantion.github.io/Tech_stack-premium-/";

const ATTENDED_KEYWORDS = [
  "i attended", "i have attended", "attended the class", "attended the training",
  "i went for the training", "i was there", "i watched the training", "i joined the training",
  "i went to the class", "i saw the training", "attended sunday", "i was at the training",
  "i came for the training", "i joined sunday",
];

const DOWNLOAD_KEYWORDS = [
  "downloaded techstack", "downloaded the techstack", "downloaded tech stack",
  "downloaded the tech stack", "i have downloaded", "i downloaded", "i've downloaded",
];

const TRUST_KEYWORDS = ["scam", "fake", "legit", "real", "trust", "proof", "fraud", "lie", "cheat", "verify"];

const BUY_INTENT_RE =
  /how much|what.{0,10}(price|cost)|(i want to|i'?d like to) (buy|pay|register|get|download|purchase)|(price|cost)[?!.\s]*$|(i'?m|i am) (ready|interested)|send me.{0,20}link|how (can i|do i) (buy|get|download|pay|register|join)/i;

const TRAINING_PHRASES = [
  "see you sunday", "sunday at 8pm", "show up sunday", "8pm nigeria time",
  "training at 8pm", "training tonight", "see you in the training",
  "t.me/+jx6qlzq04uq3oge0", "sunday training", "live training", "join the training",
];

// ─── Proof videos (shared library — same for all student bots) ────────────────

const VIDEOS = {
  withdrawal: [
    { fileId: "BAACAgQAAxkBAAIJjmnrvBjY1Hwe1wx1XwVogsuEtzD2AALnJAACdDphU40vfxI34PsmOwQ", caption: "Watch Coach Stanley make a withdrawal of over ₦650k 👀" },
    { fileId: "BAACAgQAAxkBAAIJkGnrveF3De6Dbl6RyUnpoJWunFwYAALoJAACdDphUxNIpX_mtARTOwQ", caption: "You will be surprised how much Coach Victor made this morning 😮" },
    { fileId: "BAACAgQAAxkBAAIJlmnrv4ZKrmurWAnNgNFHCkbY2-pzAALtJAACdDphU0s96kvbbKG6OwQ", caption: "Coach Victor showing his upcoming payout and how much his student made today 💰" },
    { fileId: "BAACAgQAAxkBAAIJmGnrwB28mZOxlJNS2fXOj1DM27aVAALwJAACdDphU_zk2eW3LRE4OwQ", caption: "Coach Victor currently has 1 million naira sitting in his wallet 👀" },
    { fileId: "BAACAgQAAxkBAAIJmmnrwKgJSlPMQ_fKZA39NGI17nklAALyJAACdDphU0sAATRyGE8pnDsE", caption: "Watch how much Coach Victor has made overall — over 40 million naira plus earnings in other currencies 🤯" },
    { fileId: "BAACAgQAAxkBAAIJnGnrwuxtY6cZozD1FIPhpQSnjjUVAAL1JAACdDphUx4zcDqjiKpoOwQ", caption: "Mr Stanley showing his total earned in 2 months — ₦5,275,485 from 246 affiliate sales 📈" },
    { fileId: "BAACAgQAAxkBAAIJoGnrxLFLffFKDdPtBy5tpc_5oCFLAAL3JAACdDphU1S_fMbM2kC4OwQ", caption: "Harry Obilonu made a screen record of his wallet balance 💳" },
    { fileId: "BAACAgQAAxkBAAIJomnrxahWCjZ6M1C4OzuI5Hbs7RrrAAL5JAACdDphU9jBISvJqFNGOwQ", caption: "Watch Ego as she makes a withdrawal of over ₦300k 💸" },
    { fileId: "BAACAgQAAxkBAAIJpGnrxt1KWTr1n3MlG5m1A8VO-_nUAAL6JAACdDphU60fNdKqfdGNOwQ", caption: "Oduye Esther making a withdrawal of over ₦200k live during training 💰" },
  ],
  testimony: [
    { fileId: "BAACAgQAAxkBAAIJkmnrvnP0DAvg1UJWDk4Lq7KsY0iqAALqJAACdDphUxr2TEOqr2J0OwQ", caption: "Halima showing how much she made in just 4 days during our live training 🔥" },
    { fileId: "BAACAgQAAxkBAAIJlGnrvubQWnr20UBV6bsnWnGTThxcAALrJAACdDphU27GUpCFsGM5OwQ", caption: "She was shocked at how much she made on day 6 😱" },
    { fileId: "BAACAgQAAxkBAAIJnmnrxDXN-N39kSnyUfpUkW87OCVJAAL2JAACdDphU8x756aXYBRMOwQ", caption: "Miracle Nelson showing how much he made in a single day after his 4-day setup 🔥" },
    { fileId: "BAACAgQAAxkBAAIJpmnryA1j6t1ZWyQ7VNa6MZae2BofAAL-JAACdDphU3xVAnrcQQ3iOwQ", caption: "We just finished his setup and he already has ₦61k ready to withdraw 🚀" },
    { fileId: "BAACAgQAAxkBAAIJqGnrykKeBgABXpl5qAoMyk4erzQH8wACASUAAnQ6YVOvTQx3KZ-pWDsE", caption: "Coach Victor guiding Oluranti to make her withdrawal of over ₦140k after just 4 days of setup 🙌" },
  ],
};

function pickVideo(category: keyof typeof VIDEOS) {
  const pool = VIDEOS[category];
  return pool[Math.floor(Math.random() * pool.length)];
}

// ─── Opening hook (hardcoded — instant, no LLM delay) ─────────────────────────

const OPENING_HOOK =
  `Hey! So glad you're here 🔥\n\n` +
  `EEM26 Selar Training is one of the fastest ways to build a real income online right now — ` +
  `people are going from zero to their first digital income in just 4 days.\n\n` +
  `What's your name, which country are you from, and what's your biggest challenge ` +
  `when it comes to making money online? 👇`;

// ─── Master system prompt ─────────────────────────────────────────────────────

function buildSystemPrompt(student: Student, lead: Lead | null, downloadLink: string): string {
  const stage = lead?.stage ?? "NEW";
  const windDown = lead?.wind_down_count ?? 0;
  const dataCollected = !!(lead?.name && lead?.country && lead?.struggle && lead?.email);

  return `You are a confident, warm, professional sales assistant for EEM26 Selar Training — Africa's most results-driven digital business education.

Your personality: confident, warm, human, conversational. Never say you are an AI. Maximum 2-3 sentences per message. Short and punchy — write like you are texting a friend.

LANGUAGE: Standard English only. No Nigerian Pidgin. Never mention the bot owner's name.

ABOUT EEM26:
EEM26 is a complete done-with-you digital business model. Students set it up using the Tech Stack — a toolkit including AI tools, premium software, and 4 personal coaches who work with them every day for 4 days until they are earning.

EEM26 runs on two systems:
- AAM (Automate and Attract Method) — brings buyers to your DM automatically without running ads
- SRE (Smart Reply Engine) — AI automation that handles replies and closes sales on autopilot

4-DAY SETUP AFTER DOWNLOADING:
Day 1: SRE + AAM Systems Configured — AI starts working from day one
Day 2: Full Integration and Tools Setup — coaches handle everything
Day 3: Sales Page Goes Live — domain hosted, built to convert automatically
Day 4: Coach Victor personally handles final setup — student starts earning same day. Only 5 people per batch.

REAL STUDENT RESULTS (match to country or struggle):
- Harry Obilonu from Owerri Nigeria — ₦264,560 + GH₵330 + CFA 17,869
- Ego Obilonu from Asaba Nigeria — ₦309,352.80 + KSh 3,820 + CFA 17,153
- Excel Stanley from Port Harcourt Nigeria — ₦373,115.20 + GH₵378 + CFA 20,118
- Nweze Ezekiel from Enugu Nigeria — ₦277,468.40 + GH₵357 (older man, didn't understand tech, still made it)
- As Digitals from Accra Ghana — ₦344,430 + CFA 17,672 (zero tech skills, fully automated)
- Ajayi Abimbola from Ibadan Nigeria — ₦149,750
- Fredrick Ogaga from Warri Nigeria — ₦299,500
- Fidelis Ndubuisi from Onitsha Nigeria — ₦149,750

LINKS:
- Tech Stack download: ${downloadLink}
- Premium Tech Stack (use for closing): ${PREMIUM_LINK}
- Sunday training (free): ${SUNDAY_TRAINING}
- Book Coach Victor: https://calendly.com/victornwaji7/30min

===

CURRENT LEAD PROFILE:
Name: ${lead?.name ?? "NOT COLLECTED"}
Country: ${lead?.country ?? "NOT COLLECTED"}
Pain Point: ${lead?.struggle ?? "NOT COLLECTED"}
Email: ${lead?.email ?? "NOT COLLECTED"}
Stage: ${stage}
Data collected: ${dataCollected ? "YES — never ask for their information again" : "NO"}
${dataCollected ? `Wind down responses used: ${windDown} of 3 — ${Math.max(0, 3 - windDown)} remaining before going silent` : ""}
Objections raised so far: ${lead?.objections_raised ?? "none"}

===

STAGE 1A — NEW (data NOT collected yet):
Your ONLY job: collect name, country, struggle, email — then register them.
- Ask name + country + biggest struggle all in ONE message
- Once you have those 3, ask for email only
- Once all 4 confirmed: output DATA line + confirm registration excitedly
- NEVER mention Tech Stack, price, or product yet
- If asked "what is EEM26": "It's a complete digital business model helping people across Nigeria and Ghana earn consistently — what's your name and where are you based?"
- If asked about cost: "Sunday training is completely free. Just show up at 8PM Nigeria time."

STAGE 1B — REGISTERED (data already collected):
Your ONLY job: keep them excited for Sunday, make sure they show up.
- NEVER ask for their information again
- Build anticipation — tease what they will see, share student results to keep them excited
- If asked about price: "Sunday training is free. Everything else gets revealed live — just show up."
- Short responses — 2 sentences max
- You have ${Math.max(0, 3 - windDown)} wind-down responses left before going quiet
- On your FINAL wind-down response: Tell them CLEARLY you are going quiet until Sunday and this is INTENTIONAL — not a malfunction. End with energy. Example: "I'll be quiet from here — no more messages from me until I ping you before Sunday's training. That's intentional, not a glitch 😄 Everything gets revealed live. See you Sunday 🔥"

CRITICAL ATTENDANCE RULE: If lead says they attended the training/class/Sunday session → IMMEDIATELY switch to STAGE 2. Send Tech Stack link NOW. Do NOT mention Sunday again. They already attended. Your job is to close.

STAGE 2 — ATTENDED (post-training):
Your ONLY job: close the sale. Handle everything yourself.
- Reference Sunday training naturally to show you know they attended
- Speak directly to their specific pain point: ${lead?.struggle ?? "making money online"}
- Handle objections immediately and confidently
- Create urgency: Coach Victor's Day 4 personal setup — only 5 slots per batch

SETUP FLOW (when ATTENDED lead responds positively to your setup invite):
If your recent message contained "Should I continue", "I'm going to do that same setup for you", or "Are you ready to move" — AND lead replied positively (yes, ready, okay, let's go):

Stage A — Say EXACTLY:
"Alright, let's move. Send me your email address — that's what we need to start. Also your full name and phone number, we need those too."

Stage B — Once you have their email, full name, phone:
"I'm almost done with the first stage. Can you send me your tech stack code? I want to use the AI tools there. Have you downloaded the tech stack? We need it now to complete the first stage of your setup."

Stage C — If they have NOT downloaded:
"Download the tech stack 👇
And send me a screenshot so I can finish your setup 👇

${PREMIUM_LINK}"

Stage C — If they HAVE downloaded: Ask them to send a screenshot to verify.

PREMIUM LINK TACTIC (when pushing for download):
Tell them you are sending a premium link right now. Say this link expires in 4 minutes. Say it has extra packages not in the regular version — including a new setup Coach Victor discovered that boosts student sales within 2 days of activation. Make it feel exclusive and time-sensitive. Send the link IMMEDIATELY after.
Premium link: ${PREMIUM_LINK}

PAYMENT: When they say they downloaded/paid/bought → say EXACTLY: "Send me a quick screenshot of your payment and I'll confirm it with the coaches right now so your 4-day setup can begin. 📸"
Do NOT celebrate. Wait for the screenshot.

STAGE 3 — PURCHASED:
Celebrate with real energy. Walk them through the 4-day setup day by day with excitement. Ask for full name and country so coaches can begin. Only 5 per batch — create urgency.

===

OBJECTION HANDLING:

Cost / is it free (Stage 1): "Sunday training is completely free. Just show up at 8PM Nigeria time on Telegram."

What are you selling (Stage 1): Share ONE matching student result then end with Sunday training link.

Scam concern (any stage): Never be defensive. "Smart to verify. This is not a human doing the work — AI handles everything automatically." Share ONE student result matching their country. Stage 1: end with training link. Stage 2: end with download link.

No money / too expensive (Stage 2+): "Nweze was an older man who didn't even fully understand the tech — he still made ₦277,468 in his first month. The system does the work, not you." Share download link.

Want to speak to Coach Victor: "Coach Victor's time is very limited but you can book directly here: https://calendly.com/victornwaji7/30min — grab a slot before they fill up."

===

DATA OUTPUT RULE — CRITICAL (mandatory, non-negotiable):
The INSTANT all four are confirmed (name, country, pain_point, email) — output this on its own line at the very END of your response:
DATA:name=X,country=X,pain_point=X,email=X
Output it ONCE only, only when all four are confirmed. NEVER show it to the user. NEVER output it before all four are confirmed.

SIGNAL OUTPUT (after EVERY response — all invisible to user, on their own lines at the end):
INTEREST:hot OR INTEREST:warm OR INTEREST:cold
  hot = asking about price/cost in Stage 2, says "I want to start" or "I'm ready", asks how to download
  warm = asking questions, responding positively, somewhat interested
  cold = one-word replies, skeptical without engaging
OBJECTION:brief description OR OBJECTION:none
HOT_LEAD (output ONLY when they are ready to buy RIGHT NOW in Stage 2 — asking how to download, saying "I'm ready", asking how much)`;
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

  const recent = history.slice(-10);
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
        max_tokens: 500,
        temperature: 0.85,
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

async function extractPaymentAmount(imageBytes: Uint8Array, mimeType: string): Promise<number | null> {
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
            { text: "Look at this payment screenshot. Extract the total amount paid in Nigerian Naira. Return ONLY the numeric value. Example: for ₦39,820 return: 39820. If you cannot determine the amount, return: 0" },
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
  } catch { return null; }
}

// ─── Telegram helpers ─────────────────────────────────────────────────────────

async function sendMessage(token: string, chatId: number | string, text: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  }).catch(() => {});
}

async function sendVideo(token: string, chatId: number | string, fileId: string, caption: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${token}/sendVideo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, video: fileId, caption }),
  }).catch(() => {});
}

async function downloadPhoto(token: string, fileId: string): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
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
  } catch { return null; }
}

// ─── Signal parsing ───────────────────────────────────────────────────────────

function parseSignals(text: string): {
  data: Record<string, string>;
  interest: string;
  objection: string;
  hotLead: boolean;
  linkSent: boolean;
} {
  const data: Record<string, string> = {};
  const dataMatch = text.match(/^DATA:([^\n]+)$/im);
  if (dataMatch) {
    for (const pair of dataMatch[1].split(",")) {
      const eqIdx = pair.indexOf("=");
      if (eqIdx < 0) continue;
      const k = pair.slice(0, eqIdx).trim().toLowerCase();
      const v = pair.slice(eqIdx + 1).trim();
      if (k && v) data[k] = v;
    }
  }
  const interestMatch = text.match(/^INTEREST:(hot|warm|cold)/im);
  const interest = interestMatch?.[1]?.toLowerCase() ?? "warm";
  const objMatch = text.match(/^OBJECTION:([^\n]+)/im);
  const objection = objMatch?.[1]?.trim() ?? "none";
  const hotLead = /^HOT_LEAD\b/im.test(text);
  const linkSent = /ecosystemexpantion\.github\.io/i.test(text);
  return { data, interest, objection, hotLead, linkSent };
}

function clean(text: string): string {
  return text
    .replace(/^DATA:[^\n]*$/gm, "")
    .replace(/^INTEREST:[^\n]*$/gm, "")
    .replace(/^OBJECTION:[^\n]*$/gm, "")
    .replace(/^HOT_LEAD[^\n]*$/gm, "")
    .replace(/^LINK_SENT:[^\n]*$/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

async function getHistory(supabase: SupabaseClient, studentId: string, chatId: string): Promise<{ role: string; content: string }[]> {
  const { data } = await supabase
    .from("student_bot_conversations")
    .select("role, message")
    .eq("student_id", studentId)
    .eq("chat_id", chatId)
    .order("created_at", { ascending: false })
    .limit(10);
  return ((data ?? []) as { role: string; message: string }[])
    .reverse()
    .map((r) => ({ role: r.role, content: r.message }));
}

async function saveConv(supabase: SupabaseClient, studentId: string, chatId: string, user: string, bot: string): Promise<void> {
  try {
    await supabase.from("student_bot_conversations").insert([
      { student_id: studentId, chat_id: chatId, role: "user", message: user },
      { student_id: studentId, chat_id: chatId, role: "assistant", message: bot },
    ]);
  } catch (e) { console.error("saveConv error:", e); }
}

async function upsertLead(supabase: SupabaseClient, studentId: string, chatId: string, fields: Record<string, unknown>): Promise<void> {
  try {
    const { error } = await supabase
      .from("student_bot_leads")
      .upsert(
        { student_id: studentId, chat_id: chatId, updated_at: new Date().toISOString(), ...fields },
        { onConflict: "student_id,chat_id" }
      );
    if (error) console.error("upsertLead error:", error.message);
  } catch (e) { console.error("upsertLead catch:", e); }
}

// ─── Admin handler ────────────────────────────────────────────────────────────

async function handleAdmin(student: Student, chatId: number, msg: TelegramMessage, supabase: SupabaseClient): Promise<void> {
  const token = student.bot_token!;

  if (msg.video) {
    await sendMessage(token, chatId, `📹 <b>Video file_id:</b>\n<code>${msg.video.file_id}</code>`);
    return;
  }

  const query = (msg.text ?? "").trim();
  if (!query) return;

  if (/^(hi|hello|hey|good|let'?s|ok|okay|start|continue|test|hii+|yo|oya)\b/i.test(query)) {
    await sendMessage(token, chatId,
      `👋 <b>Admin mode — you own this bot!</b>\n\n` +
      `Ask me anything about your leads:\n\n` +
      `• "How many leads do I have?"\n` +
      `• "Who registered today?"\n` +
      `• "What objections are people raising?"\n` +
      `• "Who are my hot leads?"\n` +
      `• "How many attended?"\n\n` +
      `📹 Send a <b>video</b> → I'll return its file_id\n\n` +
      `<i>To test the lead funnel, message this bot from a different account.</i>`
    );
    return;
  }

  const { data: leads } = await supabase
    .from("student_bot_leads")
    .select("stage, name, country, interest_level, objections_raised, created_at")
    .eq("student_id", student.id);

  const counts: Record<string, number> = {};
  for (const l of leads ?? []) counts[l.stage] = (counts[l.stage] ?? 0) + 1;
  const today = new Date().toISOString().slice(0, 10);
  const newToday = (leads ?? []).filter((l: Record<string, string>) => l.created_at?.startsWith(today)).length;
  const hotLeads = (leads ?? []).filter((l: Record<string, string>) => l.interest_level === "hot");

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
    `Hot leads: ${hotLeads.map((l: Record<string, string>) => `${l.name} (${l.country})`).join(", ") || "none"}\n` +
    `Recent objections: ${(leads ?? []).filter((l: Record<string, string>) => l.objections_raised).slice(0, 5).map((l: Record<string, string>) => `${l.name}: "${l.objections_raised}"`).join(" | ") || "none"}\n` +
    `Recent prospect messages:\n${(msgs ?? []).map((m: { message: string }) => `"${m.message.slice(0, 80)}"`).join("\n")}`;

  const answer = await callGroq(
    `You are a sales analytics assistant. Answer the owner's question concisely using this data. Use numbers. Be direct.\n\n${context}`,
    [], query
  );
  await sendMessage(token, chatId, answer);
}

// ─── Lead handler ─────────────────────────────────────────────────────────────

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
  const downloadLink = student.payhip_link ?? student.sales_page_link ?? PREMIUM_LINK;

  // Commands → opening hook
  if (userText.startsWith("/")) {
    await sendMessage(token, chatId, OPENING_HOOK);
    await upsertLead(supabase, student.id, chatIdStr, { stage: "NEW", wind_down_count: 0 });
    await saveConv(supabase, student.id, chatIdStr, userText, OPENING_HOOK);
    return;
  }

  // COLD — never respond
  if (stage === "COLD") return;

  // Silent after wind-down (REGISTERED, 3+ responses) — break only for trust/buying signals
  const isTrustConcern = TRUST_KEYWORDS.some(w => userText.toLowerCase().includes(w));
  const isBuyingIntent = BUY_INTENT_RE.test(userText);
  if (stage === "REGISTERED" && (lead?.wind_down_count ?? 0) >= 3 && !isTrustConcern && !isBuyingIntent) {
    return;
  }

  // Attendance detection → upgrade to ATTENDED immediately
  let effectiveLead = lead;
  const selfReportedAttendance = (stage === "REGISTERED" || stage === "NEW") &&
    ATTENDED_KEYWORDS.some(w => userText.toLowerCase().includes(w));
  if (selfReportedAttendance) {
    await upsertLead(supabase, student.id, chatIdStr, { stage: "ATTENDED" });
    effectiveLead = { ...(lead ?? { id: "", student_id: student.id, chat_id: chatIdStr, name: null, phone: null, country: null, email: null, struggle: null, wind_down_count: 0, download_link_sent_at: null, interest_level: null, objections_raised: null, last_contacted_at: null }), stage: "ATTENDED" };
  }

  const effectiveStage = effectiveLead?.stage ?? "NEW";

  // Download claim → request screenshot
  const reportedDownload = DOWNLOAD_KEYWORDS.some(w => userText.toLowerCase().includes(w));
  if (reportedDownload && (effectiveStage === "ATTENDED" || isBuyingIntent)) {
    const screenshotMsg = "Send me a quick screenshot of your payment and I'll confirm it with the coaches right now so your 4-day setup can begin. 📸";
    await sendMessage(token, chatId, screenshotMsg);
    await upsertLead(supabase, student.id, chatIdStr, { stage: "ATTENDED" });
    await saveConv(supabase, student.id, chatIdStr, userText, screenshotMsg);
    return;
  }

  // Payment screenshot verification (ATTENDED or buy intent + photo)
  if (msg.photo && msg.photo.length > 0 && (effectiveStage === "ATTENDED" || isBuyingIntent)) {
    const photo = msg.photo[msg.photo.length - 1];
    const dl = await downloadPhoto(token, photo.file_id);
    if (dl) {
      const amount = await extractPaymentAmount(dl.bytes, dl.mimeType);
      if (amount === PRODUCT_PRICE) {
        await upsertLead(supabase, student.id, chatIdStr, { stage: "PURCHASED" });
        const reply = `🎉 Payment confirmed! Welcome to the EEM26 Selar Training family! Your 4-day setup begins very soon — watch your DM for the onboarding message! 🚀`;
        await sendMessage(token, chatId, reply);
        await sendMessage(BOT_TOKEN_AMARA, student.telegram_chat_id,
          `💰 <b>NEW PURCHASE!</b>\n<b>Name:</b> ${lead?.name ?? "Unknown"}\n<b>Country:</b> ${lead?.country ?? "Unknown"}\n<b>Amount:</b> ₦${amount.toLocaleString()}`
        );
        await saveConv(supabase, student.id, chatIdStr, "[payment screenshot]", reply);
      } else if (amount !== null && amount > 0) {
        const reply = `I'm seeing ₦${amount.toLocaleString()} on this screenshot but the price is ₦39,820. Please send the correct payment screenshot 📸`;
        await sendMessage(token, chatId, reply);
        await saveConv(supabase, student.id, chatIdStr, "[screenshot - wrong amount]", reply);
      } else {
        const reply = "I couldn't read the payment amount clearly. Send me a screenshot showing the full ₦39,820 transaction 📸";
        await sendMessage(token, chatId, reply);
        await saveConv(supabase, student.id, chatIdStr, "[screenshot unreadable]", reply);
      }
    } else {
      await sendMessage(token, chatId, "I got your screenshot but couldn't open it 😕 Can you send it again? 📸");
    }
    return;
  }

  // No text and not a new lead → ignore
  if (!userText) {
    if (!lead) {
      await sendMessage(token, chatId, OPENING_HOOK);
      await upsertLead(supabase, student.id, chatIdStr, { stage: "NEW", wind_down_count: 0 });
      await saveConv(supabase, student.id, chatIdStr, "[started]", OPENING_HOOK);
    }
    return;
  }

  // Brand new lead → send opening hook first
  if (!lead) {
    await sendMessage(token, chatId, OPENING_HOOK);
    await upsertLead(supabase, student.id, chatIdStr, { stage: "NEW", wind_down_count: 0 });
    await saveConv(supabase, student.id, chatIdStr, userText, OPENING_HOOK);
    return;
  }

  // ── LLM handles all conversation logic ───────────────────────────────────────
  const history = await getHistory(supabase, student.id, chatIdStr);

  // Strip old training-related history for ATTENDED leads
  const filteredHistory = (effectiveStage === "ATTENDED")
    ? history.filter(h => !TRAINING_PHRASES.some(p => h.content.toLowerCase().includes(p)))
    : history;

  const rawReply = await callGroq(
    buildSystemPrompt(student, effectiveLead, downloadLink),
    filteredHistory,
    userText
  );

  const { data, interest, objection, hotLead, linkSent } = parseSignals(rawReply);
  const reply = clean(rawReply);

  // Build DB update
  const updates: Record<string, unknown> = { last_contacted_at: new Date().toISOString() };
  if (data.name) updates.name = data.name;
  if (data.country) updates.country = data.country;
  if (data.pain_point) updates.struggle = data.pain_point;
  if (data.email) updates.email = data.email;
  if (interest) updates.interest_level = interest;
  if (objection && objection.toLowerCase() !== "none") updates.objections_raised = objection;
  if (linkSent) updates.download_link_sent_at = new Date().toISOString();

  const allDataNow = !!(
    (data.name || lead.name) &&
    (data.country || lead.country) &&
    (data.pain_point || lead.struggle) &&
    (data.email || lead.email)
  );

  if (allDataNow && stage === "NEW") {
    updates.stage = "REGISTERED";
    updates.wind_down_count = 0;
  } else if (stage === "REGISTERED") {
    updates.wind_down_count = (lead.wind_down_count ?? 0) + 1;
  }

  await upsertLead(supabase, student.id, chatIdStr, updates);
  await sendMessage(token, chatId, reply);
  await saveConv(supabase, student.id, chatIdStr, userText, reply);

  // New registration alert
  if (allDataNow && stage === "NEW") {
    await sendMessage(BOT_TOKEN_AMARA, student.telegram_chat_id,
      `✅ <b>NEW LEAD REGISTERED!</b>\n<b>Name:</b> ${data.name ?? lead.name}\n<b>Country:</b> ${data.country ?? lead.country}\n<b>Struggle:</b> ${data.pain_point ?? lead.struggle}\n<b>Email:</b> ${data.email ?? lead.email}`
    );
  }

  // Hot lead alert
  if (hotLead) {
    const preview = history.slice(-5)
      .map(h => `${h.role === "user" ? "👤" : "🤖"} ${h.content.slice(0, 80)}`)
      .join("\n");
    await sendMessage(BOT_TOKEN_AMARA, student.telegram_chat_id,
      `🔥 <b>HOT LEAD!</b>\n<b>Name:</b> ${lead.name ?? "Unknown"}\n<b>Country:</b> ${lead.country ?? "Unknown"}\n<b>Stage:</b> ${effectiveStage}\n<b>Said:</b> "${userText.slice(0, 150)}"\n\n${preview.slice(0, 500)}`
    );
  }

  // Proof video when ATTENDED lead has an objection
  if (effectiveStage === "ATTENDED" && objection && objection.toLowerCase() !== "none") {
    const isScam = /scam|fake|trust|fraud|legit/.test(objection.toLowerCase());
    const vid = pickVideo(isScam ? "withdrawal" : "testimony");
    await sendVideo(token, chatId, vid.fileId, vid.caption);
  }
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
        await alertAdmin(`🚨 <b>student-bot crash</b>\nError: <code>${errMsg.slice(0, 300)}</code>`);
        await fetch(`https://api.telegram.org/bot${student.bot_token}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: "Hey! Sorry about that — I'm back now! What can I help you with? 😊" }),
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
