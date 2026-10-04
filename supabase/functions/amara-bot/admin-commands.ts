// Admin commands — only reachable when the message comes from ADMIN_CHAT_ID.
// Send "help" (or any unknown text with no pending escalation) to see them all.

import { sendMessage, sendWithKeyboard, answerCallbackQuery, removeButtons, escapeHtml } from "./telegram.ts";
import { getPendingEscalation, answerEscalation, skipEscalation, pendingCount } from "./knowledge.ts";
import { getStudentByChatId, saveConversation } from "./db.ts";
import { studentLabel, describePosition } from "./admin.ts";
import { unlockDay2, rejectPayment } from "./day1.ts";
import { GATE_STEP } from "./day1-content.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// ── Entry point (text messages) ───────────────────────────────────────────────

export async function handleAdminCommand(chatId: number, text: string, replyToText?: string): Promise<void> {
  const t = text.trim();

  // reply [id] [message] — talk to one student; the ID makes it impossible to mix replies
  const replyMatch = t.match(/^reply\s+(\d{5,})\s+([\s\S]+)$/i);
  if (replyMatch) {
    await replyToStudent(chatId, replyMatch[1], replyMatch[2].trim());
    return;
  }

  // Swipe-reply to any student card (it carries 🆔) = message that student
  const swipedId = replyToText?.match(/🆔\s*(\d{5,})/)?.[1];
  if (swipedId && t) {
    await replyToStudent(chatId, swipedId, t);
    return;
  }

  const lastMatch = t.match(/^(?:last|jump)\s+(\d{5,})$/i);
  if (lastMatch) {
    await showLastMessages(chatId, lastMatch[1]);
    return;
  }

  const approveMatch = t.match(/^approve\s+(\d{5,})$/i);
  if (approveMatch) {
    await approveById(chatId, approveMatch[1]);
    return;
  }

  if (/^waiting$/i.test(t)) {
    await listLocked(chatId);
    return;
  }

  if (/^help$/i.test(t)) {
    await sendHelp(chatId);
    return;
  }

  // list
  if (/^list\b/i.test(t)) {
    await listStudents(chatId);
    return;
  }

  // announce saturday — blast "training is TODAY" to graduates + Day 4 students.
  // Optional time (Nigeria, PM assumed): "announce saturday 9:30"
  const announceMatch = t.match(/^announce\s+saturday(?:\s+(\d{1,2})[:.](\d{2}))?$/i);
  if (announceMatch) {
    const hour = announceMatch[1] ? parseInt(announceMatch[1], 10) : 8;
    const min = announceMatch[2] ? parseInt(announceMatch[2], 10) : 30;
    await announceSaturday(chatId, hour, min);
    return;
  }

  // confirm [name] — manually confirm Tech Stack purchase and unlock Day 2
  const confirmMatch = t.match(/^confirm\s+(.+)/i);
  if (confirmMatch) {
    await confirmTechStack(chatId, confirmMatch[1].trim());
    return;
  }

  // Detect a payhip link anywhere in the message
  const payhipMatch = t.match(/https?:\/\/payhip\.com\/\S+/i);
  if (payhipMatch) {
    const payhipLink = payhipMatch[0].replace(/[.,;!?]+$/, ""); // strip trailing punctuation
    await sendWithKeyboard(
      chatId,
      `Create pages for this Payhip link?\n\n<code>${payhipLink}</code>`,
      [[
        { text: "✅ Yes, create pages", callback_data: `setup:${payhipLink}` },
        { text: "❌ Cancel",            callback_data: "setup_cancel" },
      ]]
    );
    return;
  }

  // ── Default: check if this is a reply to a pending escalation ───────────────
  const pending = await getPendingEscalation();
  if (pending) {
    if (/^skip$/i.test(t)) {
      await skipEscalation(pending.id);
      const remaining = await pendingCount();
      await sendMessage(chatId, `Skipped. ${remaining > 0 ? `${remaining} question(s) still waiting.` : "No more pending questions."}`);
      return;
    }
    // Any other text = the answer
    await answerEscalation(pending, t);
    const remaining = await pendingCount();
    const sentTo = pending.source === "student_bot"
      ? `customer via <b>${pending.bot_name ?? "student bot"}</b>`
      : `<b>${pending.student_name ?? "student"}</b>`;
    await sendMessage(
      chatId,
      `✅ Answer sent to ${sentTo} and saved to Amara's knowledge base 🧠\n\n` +
      (remaining > 0
        ? `📩 <b>${remaining} more question(s) waiting.</b> Next one:\n\n"${(await getPendingEscalation())?.question ?? ""}"\n\nJust reply with the answer.`
        : `No more pending questions.`)
    );
    return;
  }

  await sendHelp(chatId);
}

// ── Entry point (button taps / callback queries) ──────────────────────────────

export async function handleAdminCallback(
  chatId: number,
  callbackQueryId: string,
  data: string,
  messageId?: number
): Promise<void> {
  await answerCallbackQuery(callbackQueryId);

  // Payment decisions are one-shot — drop the buttons so they can't be tapped twice.
  if (messageId && /^(approve|reject|lpa|lpr):/.test(data)) await removeButtons(chatId, messageId);

  if (data.startsWith("reject:")) {
    await rejectById(chatId, data.slice("reject:".length));
    return;
  }

  if (data.startsWith("lpa:") || data.startsWith("lpr:")) {
    await decideLeadPayment(chatId, data.slice(4), data.startsWith("lpa:"));
    return;
  }

  if (data === "setup_cancel") {
    await sendMessage(chatId, "Cancelled.");
    return;
  }

  if (data.startsWith("jump:")) {
    await showLastMessages(chatId, data.slice("jump:".length));
    return;
  }

  if (data.startsWith("approve:")) {
    await approveById(chatId, data.slice("approve:".length));
    return;
  }

  if (data.startsWith("setup:")) {
    const payhipLink = data.slice("setup:".length);
    await sendGitHubAuthLink(chatId, payhipLink);
    return;
  }
}

// ── Send GitHub OAuth link to admin ──────────────────────────────────────────

async function sendGitHubAuthLink(adminChatId: number, payhipLink: string): Promise<void> {
  const clientId   = Deno.env.get("GITHUB_OAUTH_CLIENT_ID");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");

  if (!clientId) {
    await sendMessage(adminChatId, `❌ <b>GITHUB_OAUTH_CLIENT_ID</b> not set in Supabase secrets.`);
    return;
  }

  // State encodes: admin:[chat_id]:[payhip_link]
  // github-oauth function detects "admin:" prefix and handles separately
  const state       = `admin:${adminChatId}:${payhipLink}`;
  const callbackUrl = `${supabaseUrl}/functions/v1/github-oauth`;
  const oauthUrl    =
    `https://github.com/login/oauth/authorize` +
    `?client_id=${clientId}` +
    `&scope=repo` +
    `&state=${encodeURIComponent(state)}` +
    `&redirect_uri=${encodeURIComponent(callbackUrl)}`;

  await sendMessage(
    adminChatId,
    `Tap to authorize GitHub — I'll create the pages automatically:\n\n` +
    `<a href="${oauthUrl}">👉 Authorize GitHub</a>\n\n` +
    `You'll be back in Telegram within seconds ✅`
  );
}

// ── Help ──────────────────────────────────────────────────────────────────────

async function sendHelp(chatId: number): Promise<void> {
  await sendMessage(
    chatId,
    `<b>Talking to students</b>\n` +
    `Every message from a student whose Day 2 is locked comes to you with their name and 🆔. Tap <b>💬 Jump in</b> to see their last 3 messages.\n\n` +
    `<code>reply [ID] [message]</code> → Send a message to that one student.\nExample: <code>reply 123456789 Hi John, did you get the link?</code>\n` +
    `Or just <b>swipe-reply</b> to any message that shows a 🆔 — it goes to that student only.\n\n` +
    `<code>last [ID]</code> → Show that student's last 3 messages.\n\n` +
    `<b>Day 2 lock (Tech Stack payment)</b>\n` +
    `<code>waiting</code> → Everyone locked at Day 2, with their 🆔.\n` +
    `Every payment screenshot comes to you with <b>✅ Accept</b> / <b>❌ Reject</b> buttons — nothing is verified automatically.\n` +
    `<code>approve [ID]</code> → Confirm their payment and unlock Day 2 (same as the ✅ Accept button).\n` +
    `<code>confirm [name]</code> → Same, by name.\n\n` +
    `<b>Other</b>\n` +
    `<code>announce saturday</code> → Blast "training is TONIGHT at 8:30 PM" to all graduates + Day 4 students.\nCustom time: <code>announce saturday 9:30</code> (PM Nigeria time)\n\n` +
    `<b>Create pages:</b> Send a message with a Payhip link — I'll ask to confirm, then send a GitHub authorization link.\n\n` +
    `<code>list</code> → Active students with their 🆔 and current day.`
  );
}

// ── Talk to a student by Telegram ID ─────────────────────────────────────────

async function replyToStudent(adminChatId: number, studentChatId: string, text: string): Promise<void> {
  const student = await getStudentByChatId(studentChatId);
  if (!student) {
    await sendMessage(adminChatId, `❌ No student with 🆔 <code>${studentChatId}</code>. Nothing was sent.`);
    return;
  }
  const delivered = await sendMessage(studentChatId, escapeHtml(text));
  if (!delivered) {
    await sendMessage(adminChatId, `❌ Couldn't deliver to\n${studentLabel(student.full_name, studentChatId)}\n\nThey may have blocked Amara.`);
    return;
  }
  await saveConversation(student.id, "assistant", text, "text");
  await sendMessage(adminChatId, `✅ Sent to\n${studentLabel(student.full_name, studentChatId)}`);
}

async function showLastMessages(adminChatId: number, studentChatId: string): Promise<void> {
  const student = await getStudentByChatId(studentChatId);
  if (!student) {
    await sendMessage(adminChatId, `❌ No student with 🆔 <code>${studentChatId}</code>.`);
    return;
  }

  const { data } = await supabase
    .from("amara_conversations")
    .select("message, created_at")
    .eq("student_id", student.id)
    .eq("role", "user")
    .order("created_at", { ascending: false })
    .limit(3);

  const lines = ((data ?? []) as { message: string; created_at: string }[])
    .reverse()
    .map((m, i) => `${i + 1}. ${escapeHtml(m.message.slice(0, 500))} <i>(${timeAgo(m.created_at)})</i>`);

  await sendMessage(
    adminChatId,
    `💬 <b>Jumped in</b>\n\n${studentLabel(student.full_name, studentChatId)}\n📍 ${describePosition(student)}\n\n` +
    `<b>Last 3 messages:</b>\n${lines.join("\n") || "<i>No messages yet</i>"}\n\n` +
    `To reply, swipe-reply to this message or send:\n<code>reply ${studentChatId} your message</code>`
  );
}

async function approveById(adminChatId: number, studentChatId: string): Promise<void> {
  const student = await getStudentByChatId(studentChatId);
  if (!student) {
    await sendMessage(adminChatId, `❌ No student with 🆔 <code>${studentChatId}</code>.`);
    return;
  }
  if (student.current_day !== 1 || student.current_step !== GATE_STEP) {
    await sendMessage(adminChatId, `${studentLabel(student.full_name, studentChatId)}\n\nNot locked at Day 2 — they're at: ${describePosition(student)}.`);
    return;
  }
  const unlocked = await unlockDay2(student, studentChatId, "Payment approved by admin");
  await sendMessage(
    adminChatId,
    unlocked
      ? `✅ Day 2 unlocked for\n${studentLabel(student.full_name, studentChatId)}`
      : `ℹ️ Day 2 was already unlocked for\n${studentLabel(student.full_name, studentChatId)}`
  );
}

async function rejectById(adminChatId: number, studentChatId: string): Promise<void> {
  const student = await getStudentByChatId(studentChatId);
  if (!student || student.current_day !== 1 || student.current_step !== GATE_STEP) {
    await sendMessage(adminChatId, `ℹ️ Nothing to reject — ${student ? `they're at: ${describePosition(student)}` : "student not found"}.`);
    return;
  }
  await rejectPayment(studentChatId);
  await sendMessage(adminChatId, `❌ Payment rejected — they've been asked for a clearer receipt.\n${studentLabel(student.full_name, studentChatId)}`);
}

// Payment screenshots that leads send to a student's sales bot.
async function decideLeadPayment(adminChatId: number, leadId: string, accept: boolean): Promise<void> {
  const { data: lead } = await supabase
    .from("student_bot_leads")
    .select("id, student_id, chat_id, name, country, stage")
    .eq("id", leadId)
    .single();
  if (!lead) {
    await sendMessage(adminChatId, "❌ Lead not found.");
    return;
  }
  const { data: owner } = await supabase
    .from("amara_students")
    .select("telegram_chat_id, full_name, bot_token")
    .eq("id", lead.student_id)
    .single();
  if (!owner?.bot_token) {
    await sendMessage(adminChatId, "❌ That student's bot is no longer connected — reply to the lead isn't possible.");
    return;
  }

  const sendViaBot = (text: string) =>
    fetch(`https://api.telegram.org/bot${owner.bot_token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: lead.chat_id, text, parse_mode: "HTML", disable_web_page_preview: true }),
    }).catch(() => {});
  const leadLabel = `<b>${escapeHtml(lead.name ?? "Unknown")}</b> (${escapeHtml(lead.country ?? "?")}) via ${escapeHtml(owner.full_name ?? "a student")}'s bot`;

  if (!accept) {
    const reply = "We couldn't confirm your payment from that screenshot 😕 Please send a clear screenshot of your successful payment receipt — it should show the amount, the date and that the payment was successful 📸";
    await sendViaBot(reply);
    await supabase.from("student_bot_conversations").insert({ student_id: lead.student_id, chat_id: lead.chat_id, role: "assistant", message: reply });
    await sendMessage(adminChatId, `❌ Payment rejected for ${leadLabel}. They've been asked for a clearer receipt.`);
    return;
  }

  if (lead.stage === "PURCHASED") {
    await sendMessage(adminChatId, `ℹ️ ${leadLabel} was already marked as purchased.`);
    return;
  }

  await supabase.from("student_bot_leads").update({ stage: "PURCHASED", updated_at: new Date().toISOString() }).eq("id", lead.id);
  const reply1 = `Congratulations 🎊\n\nClick the link to access the tech stack 👇\n\nhttps://ecosystemexpantion.github.io/Product_page/\n\nSet your password and read all the instructions there. You will know the next step`;
  const reply2 = `Your personal setup coach is waiting for you here 👇\n\nhttps://t.me/Amara_EEM26bot`;
  await sendViaBot(reply1);
  await sendViaBot(reply2);
  await supabase.from("student_bot_conversations").insert({ student_id: lead.student_id, chat_id: lead.chat_id, role: "assistant", message: `${reply1}\n\n${reply2}` });
  await sendMessage(owner.telegram_chat_id, `💰 <b>NEW PURCHASE!</b>\n<b>Name:</b> ${escapeHtml(lead.name ?? "Unknown")}\n<b>Country:</b> ${escapeHtml(lead.country ?? "Unknown")}`);
  await sendMessage(adminChatId, `✅ Payment accepted for ${leadLabel}. They've been sent the Tech Stack access link.`);
}

async function listLocked(adminChatId: number): Promise<void> {
  const { data } = await supabase
    .from("amara_students")
    .select("telegram_chat_id, full_name, day1_completed_at")
    .eq("status", "ACTIVE")
    .eq("current_day", 1)
    .eq("current_step", GATE_STEP)
    .order("day1_completed_at", { ascending: true })
    .limit(50);

  const rows = (data ?? []) as { telegram_chat_id: string; full_name: string | null; day1_completed_at: string | null }[];
  if (rows.length === 0) {
    await sendMessage(adminChatId, "Nobody is locked at Day 2 right now.");
    return;
  }

  const lines = rows.map((s) => {
    const since = s.day1_completed_at ? timeAgo(s.day1_completed_at) : "?";
    const expired = s.day1_completed_at && Date.now() - new Date(s.day1_completed_at).getTime() >= 48 * 3600_000;
    return `• <b>${escapeHtml(s.full_name ?? "unnamed")}</b> — 🆔 <code>${s.telegram_chat_id}</code> — locked ${since}${expired ? " ⚠️ expiry sent" : ""}`;
  });
  await sendMessage(adminChatId, `<b>🔒 Locked at Day 2 (${rows.length}):</b>\n\n${lines.join("\n")}`);
}

function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

// ── Confirm Tech Stack purchase by name — unlock Day 2 ──────────────────────

async function confirmTechStack(adminChatId: number, name: string): Promise<void> {
  const { data: matches } = await supabase
    .from("amara_students")
    .select("id, telegram_chat_id, full_name, current_day, current_step, status")
    .eq("status", "ACTIVE")
    .ilike("full_name", `%${name}%`);

  if (!matches || matches.length === 0) {
    await sendMessage(adminChatId, `❌ No active student found matching "<b>${escapeHtml(name)}</b>".`);
    return;
  }

  type Row = { id: string; telegram_chat_id: string; full_name: string | null; current_day: number; current_step: number; status: string };
  const rows = matches as Row[];

  if (rows.length > 1) {
    const list = rows
      .map(s => `• ${escapeHtml(s.full_name ?? "unnamed")} — 🆔 <code>${s.telegram_chat_id}</code> (${describePosition(s)})`)
      .join("\n");
    await sendMessage(adminChatId, `Multiple students match "<b>${escapeHtml(name)}</b>":\n\n${list}\n\nUse <code>approve [ID]</code> instead.`);
    return;
  }

  const student = rows[0];
  if (student.current_day !== 1 || student.current_step !== GATE_STEP) {
    await sendMessage(adminChatId, `${studentLabel(student.full_name, student.telegram_chat_id)}\n\nNot locked at Day 2 — they're at: ${describePosition(student)}.`);
    return;
  }

  const unlocked = await unlockDay2(student, student.telegram_chat_id, "Payment confirmed by admin");
  await sendMessage(
    adminChatId,
    unlocked
      ? `✅ Confirmed — Day 2 unlocked for\n${studentLabel(student.full_name, student.telegram_chat_id)}`
      : `ℹ️ Day 2 was already unlocked for\n${studentLabel(student.full_name, student.telegram_chat_id)}`
  );
}

// ── Announce Saturday training ───────────────────────────────────────────────

async function announceSaturday(adminChatId: number, pmHour = 8, minute = 30): Promise<void> {
  const timeLabel = `${pmHour}:${String(minute).padStart(2, "0")} PM`;

  // 1. ALL COMPLETED graduates — no matter when they finished. The admin
  // controls when to blast, so every graduate hears about the session.
  const { data: graduates } = await supabase
    .from("amara_students")
    .select("telegram_chat_id")
    .eq("status", "COMPLETED");

  const eligibleGrads: { telegram_chat_id: string }[] = graduates ?? [];

  // 2. Day 4 active students
  const { data: day4Students } = await supabase
    .from("amara_students")
    .select("telegram_chat_id")
    .eq("status", "ACTIVE")
    .eq("current_day", 4);

  const allChatIds = new Set<string>();
  for (const s of eligibleGrads) allChatIds.add(String(s.telegram_chat_id));
  for (const s of day4Students ?? []) allChatIds.add(String(s.telegram_chat_id));

  if (allChatIds.size === 0) {
    await sendMessage(adminChatId, "No eligible students to announce to right now.");
    return;
  }

  const announcement =
    `🚨 <b>TODAY is the day!</b>\n\n` +
    `Coach Victor's <b>Final Stage Setup session</b> is <b>TONIGHT at ${timeLabel} Nigeria time!</b> 🎯\n\n` +
    `👉 <a href="https://t.me/+kU414VXm1N0zYjQ8">Join the group here</a>\n\n` +
    `Be there — this is where your business goes live! 🔥`;

  let sent = 0;
  for (const chatId of allChatIds) {
    try {
      await sendMessage(Number(chatId), announcement);
      sent++;
    } catch (e) {
      console.error(`Failed to send Saturday announcement to ${chatId}:`, e);
    }
  }

  await sendMessage(adminChatId, `✅ Saturday announcement sent to <b>${sent}</b> student(s).`);
}

// ── List students ─────────────────────────────────────────────────────────────

async function listStudents(chatId: number): Promise<void> {
  const { data } = await supabase
    .from("amara_students")
    .select("telegram_chat_id, full_name, current_day, current_step, status")
    .eq("status", "ACTIVE")
    .order("created_at", { ascending: false })
    .limit(30);

  if (!data || data.length === 0) {
    await sendMessage(chatId, "No active students yet.");
    return;
  }

  type Row = { telegram_chat_id: string; full_name: string | null; current_day: number; current_step: number; status: string };
  const lines = (data as Row[]).map((s) =>
    `• <b>${escapeHtml(s.full_name ?? "unnamed")}</b> — 🆔 <code>${s.telegram_chat_id}</code> — ${describePosition(s)}`
  );

  await sendMessage(chatId, `<b>Active students (${data.length}):</b>\n\n${lines.join("\n")}`);
}
