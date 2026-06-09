// Knowledge base + escalation queue for Amara's learning system.
//
// How it works:
// 1. When Amara doesn't know something, Gemini includes [ESCALATE] in the reply.
// 2. The question is saved as PENDING and admin is notified.
// 3. Admin replies to Amara with the answer.
// 4. Answer is forwarded to the student and saved in the knowledge base.
// 5. Future similar questions hit the knowledge base first — admin isn't bothered again.

import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const BOT_TOKEN   = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const ADMIN_CHAT  = Deno.env.get("ADMIN_CHAT_ID") ?? "5870771695";

// ── Knowledge base ────────────────────────────────────────────────────────────

/** Search stored Q&As for questions similar to the current one. */
export async function searchKnowledge(question: string): Promise<{ question: string; answer: string }[]> {
  // Extract significant words (2+ chars, skip stopwords) and join with OR
  // so paraphrases like "What's the price?" match "How much does it cost?" if they share key words
  const stopwords = new Set(["is", "it", "in", "on", "at", "to", "do", "be", "of", "or", "an", "as", "by", "up", "if"]);
  const words = question
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !stopwords.has(w.toLowerCase()))
    .slice(0, 15)
    .join(" | ");

  if (!words) return [];

  const { data } = await supabase
    .from("amara_knowledge")
    .select("question, answer, use_count")
    .textSearch("question", words, { type: "websearch", config: "english" })
    .order("use_count", { ascending: false })
    .limit(5);

  return (data ?? []) as { question: string; answer: string }[];
}

/** Save a new Q&A pair to the knowledge base. */
export async function saveKnowledge(question: string, answer: string): Promise<void> {
  await supabase.from("amara_knowledge").insert({ question, answer }).select();
}

/** Increment use count when a stored answer is served. */
export async function incrementKnowledgeUse(question: string): Promise<void> {
  // Best-effort: update the row whose question starts the same
  await supabase.rpc("increment_knowledge_use", { q: question }).catch(() => {});
}

// ── Escalation queue ──────────────────────────────────────────────────────────

/** Create an escalation and notify admin. */
export async function createEscalation(
  studentId: string,
  studentChatId: string,
  studentName: string | null,
  question: string,
  options?: {
    source?: string;
    customerChatId?: string;
    botToken?: string;
    botName?: string;
  }
): Promise<void> {
  const source = options?.source ?? "amara";

  const { data } = await supabase
    .from("amara_escalations")
    .insert({
      student_id: studentId,
      student_chat_id: studentChatId,
      student_name: studentName,
      question,
      source,
      customer_chat_id: options?.customerChatId ?? null,
      bot_token: options?.botToken ?? null,
      bot_name: options?.botName ?? null,
    })
    .select("id")
    .single();

  if (!data) return;

  let notificationText: string;
  if (source === "student_bot" && options?.botName) {
    notificationText =
      `📩 <b>Question via ${options.botName}:</b>\n\n"${question}"\n\n` +
      `Just reply here with your answer and I'll:\n` +
      `✅ Forward it to the customer instantly\n` +
      `🧠 Remember it for future similar questions\n\n` +
      `<i>(or type <code>skip</code> to ignore this one)</i>`;
  } else {
    const name = studentName ?? "A student";
    notificationText =
      `📩 <b>${name} asked something I couldn't answer:</b>\n\n"${question}"\n\n` +
      `Just reply here with your answer and I'll:\n` +
      `✅ Forward it to them instantly\n` +
      `🧠 Remember it for future students\n\n` +
      `<i>(or type <code>skip</code> to ignore this one)</i>`;
  }

  await sendTg(ADMIN_CHAT, notificationText);
}

/** Get the oldest unanswered escalation. */
export async function getPendingEscalation(): Promise<{
  id: string;
  student_chat_id: string;
  student_name: string | null;
  question: string;
  source: string;
  customer_chat_id: string | null;
  bot_token: string | null;
  bot_name: string | null;
} | null> {
  const { data } = await supabase
    .from("amara_escalations")
    .select("id, student_chat_id, student_name, question, source, customer_chat_id, bot_token, bot_name")
    .eq("status", "PENDING")
    .order("created_at", { ascending: true })
    .limit(1)
    .single();

  return data ?? null;
}

/** Check if a specific Amara student has any of their own pending escalations. */
export async function hasStudentPendingEscalation(studentId: string): Promise<boolean> {
  const { count } = await supabase
    .from("amara_escalations")
    .select("id", { count: "exact", head: true })
    .eq("student_id", studentId)
    .eq("source", "amara")
    .eq("status", "PENDING");
  return (count ?? 0) > 0;
}

/** Answer an escalation: forward to student/customer + save to KB. */
export async function answerEscalation(
  escalation: {
    id: string;
    student_chat_id: string;
    student_name: string | null;
    question: string;
    source: string;
    customer_chat_id: string | null;
    bot_token: string | null;
    bot_name: string | null;
  },
  answer: string
): Promise<void> {
  await supabase
    .from("amara_escalations")
    .update({ answer, status: "ANSWERED" })
    .eq("id", escalation.id);

  await saveKnowledge(escalation.question, answer);

  if (escalation.source === "student_bot" && escalation.customer_chat_id && escalation.bot_token) {
    // Route answer to the customer via the student's own bot token
    await sendTgWithToken(escalation.bot_token, escalation.customer_chat_id, answer);
    // Notify the bot owner (EEM26 student) that their customer got an answer
    await sendTg(
      escalation.student_chat_id,
      `✅ Customer question answered via your bot!\n\n<b>Q:</b> ${escalation.question}\n<b>A:</b> ${answer}`
    );
  } else {
    // Regular Amara escalation — forward answer to the EEM26 student
    await sendTg(escalation.student_chat_id, answer);
  }
}

async function sendTgWithToken(token: string, chatId: string | number, text: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
  }).catch(() => {});
}

/** Mark an escalation as skipped (admin typed "skip"). */
export async function skipEscalation(id: string): Promise<void> {
  await supabase.from("amara_escalations").update({ status: "SKIPPED" }).eq("id", id);
}

/** Count how many questions are waiting for admin. */
export async function pendingCount(): Promise<number> {
  const { count } = await supabase
    .from("amara_escalations")
    .select("id", { count: "exact", head: true })
    .eq("status", "PENDING");
  return count ?? 0;
}

// ── Telegram helper ───────────────────────────────────────────────────────────

async function sendTg(chatId: string | number, text: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
  }).catch(() => {});
}
