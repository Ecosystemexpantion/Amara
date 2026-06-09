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
  // Build a tsquery from significant words (3+ chars)
  const words = question
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3)
    .slice(0, 8)
    .join(" | ");

  if (!words) return [];

  const { data } = await supabase
    .from("amara_knowledge")
    .select("question, answer, use_count")
    .textSearch("question", words, { type: "plain", config: "english" })
    .order("use_count", { ascending: false })
    .limit(3);

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
  question: string
): Promise<void> {
  const { data } = await supabase
    .from("amara_escalations")
    .insert({ student_id: studentId, student_chat_id: studentChatId, student_name: studentName, question })
    .select("id")
    .single();

  if (!data) return;

  const name = studentName ?? "A student";
  await sendTg(
    ADMIN_CHAT,
    `📩 <b>${name} asked something I couldn't answer:</b>\n\n"${question}"\n\n` +
    `Just reply here with your answer and I'll:\n` +
    `✅ Forward it to them instantly\n` +
    `🧠 Remember it for future students\n\n` +
    `<i>(or type <code>skip</code> to ignore this one)</i>`
  );
}

/** Get the oldest unanswered escalation. */
export async function getPendingEscalation(): Promise<{
  id: string;
  student_chat_id: string;
  student_name: string | null;
  question: string;
} | null> {
  const { data } = await supabase
    .from("amara_escalations")
    .select("id, student_chat_id, student_name, question")
    .eq("status", "PENDING")
    .order("created_at", { ascending: true })
    .limit(1)
    .single();

  return data ?? null;
}

/** Answer an escalation: forward to student + save to KB. */
export async function answerEscalation(
  escalation: { id: string; student_chat_id: string; student_name: string | null; question: string },
  answer: string
): Promise<void> {
  await supabase
    .from("amara_escalations")
    .update({ answer, status: "ANSWERED" })
    .eq("id", escalation.id);

  await saveKnowledge(escalation.question, answer);
  await sendTg(escalation.student_chat_id, answer);
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
