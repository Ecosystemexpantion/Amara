// Admin commands — only reachable when the message comes from ADMIN_CHAT_ID.
// Send "help" (or any unknown text with no pending escalation) to see them all.

import { sendMessage, sendWithKeyboard, answerCallbackQuery, removeButtons, escapeHtml } from "./telegram.ts";
import { getPendingEscalation, answerEscalation, skipEscalation, pendingCount } from "./knowledge.ts";
import { getStudentByChatId, saveConversation } from "./db.ts";
import { studentLabel, describePosition } from "./admin.ts";
import { unlockDay2, rejectPayment } from "./day1.ts";
import { GATE_STEP } from "./day1-content.ts";
import { buildGitHubAuthUrl } from "./github.ts";
import { PAGES_VERSION, publishPage } from "../_shared/pages.ts";
import { AMARA_WEB_HTML } from "../_shared/web-page.ts";
import { PREMIUM_PAGE_HTML } from "../_shared/premium-page.ts";
import { webLink, WEB_APP_URL } from "./sre-pipeline.ts";
import { WEB_APP_REPO, SRE_CHAT_REPO } from "../_shared/runs.ts";
import { SRE_CHAT_HTML } from "../_shared/chat-page.ts";
import { isWebVisitor } from "../_shared/web-inbox.ts";
import { issueLoginCode, CODE_MINUTES } from "../_shared/web-auth.ts";
import { BOOKING_URL, BOOKING_REPO, cancelBooking, upcomingBookings, getSettings, updateSettings, formatNigeria, waLink } from "../_shared/booking.ts";
import { BOOKING_HTML } from "../_shared/book-page.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// ── Entry point (text messages) ───────────────────────────────────────────────

export async function handleAdminCommand(chatId: number, text: string, replyToText?: string): Promise<void> {
  const t = text.trim();

  // reply [id] [message] — talk to one student; the ID makes it impossible to mix replies
  const replyMatch = t.match(/^reply\s+(w?\d{5,})\s+([\s\S]+)$/i);
  if (replyMatch) {
    await replyToStudent(chatId, replyMatch[1], replyMatch[2].trim());
    return;
  }

  // Swipe-reply to any student card (it carries 🆔) = message that student
  const swipedId = replyToText?.match(/🆔\s*(w?\d{5,})/)?.[1];
  if (swipedId && t) {
    await replyToStudent(chatId, swipedId, t);
    return;
  }

  const lastMatch = t.match(/^(?:last|jump)\s+(w?\d{5,})$/i);
  if (lastMatch) {
    await showLastMessages(chatId, lastMatch[1]);
    return;
  }

  // code [id] — a one-time login code for the web app (password reset / linking without Telegram)
  const codeMatch = t.match(/^code\s+(w?\d{5,})$/i);
  if (codeMatch) {
    await sendLoginCode(chatId, codeMatch[1]);
    return;
  }

  const approveMatch = t.match(/^approve\s+(w?\d{5,})$/i);
  if (approveMatch) {
    await approveById(chatId, approveMatch[1]);
    return;
  }

  // Booking page (our Calendly): bookings · block / unblock YYYY-MM-DD · hours 10 18 · booking days mon-sat
  if (/^bookings?$/i.test(t)) {
    await listBookings(chatId);
    return;
  }
  const blockMatch = t.match(/^(block|unblock)\s+(\d{4}-\d{2}-\d{2})$/i);
  if (blockMatch) {
    await blockDate(chatId, blockMatch[2], blockMatch[1].toLowerCase() === "block");
    return;
  }
  const hoursMatch = t.match(/^hours\s+(\d{1,2})\s*(?:-|to|\s)\s*(\d{1,2})$/i);
  if (hoursMatch) {
    await setBookingHours(chatId, Number(hoursMatch[1]), Number(hoursMatch[2]));
    return;
  }
  const daysMatch = t.match(/^booking\s+days\s+([a-z,\s-]+)$/i);
  if (daysMatch) {
    await setBookingDays(chatId, daysMatch[1]);
    return;
  }

  if (/^waiting$/i.test(t)) {
    await listLocked(chatId);
    return;
  }

  if (/^web\s+publish$/i.test(t)) {
    await publishWebApp(chatId);
    return;
  }

  // premium preview → publish the new Premium Tech Stack page to a preview address
  // premium live    → replace the live Premium Tech Stack page (previous version stays in GitHub history)
  const premiumMatch = t.match(/^premium\s+(preview|live)$/i);
  if (premiumMatch) {
    const live = premiumMatch[1].toLowerCase() === "live";
    await publishToAdminPages(
      chatId,
      live ? PREMIUM_LIVE_REPO : PREMIUM_PREVIEW_REPO,
      live ? "EEM26 Tech Stack Premium" : "EEM26 Tech Stack Premium — preview",
      PREMIUM_PAGE_HTML,
      live ? "✅ The new Premium Tech Stack page is LIVE" : "👀 Premium page preview published"
    );
    return;
  }

  const webMatch = t.match(/^web\s+(w?\d{5,})$/i);
  if (webMatch) {
    await sendWebLink(chatId, webMatch[1]);
    return;
  }

  if (/^pages$/i.test(t)) {
    await pagesReport(chatId);
    return;
  }

  if (/^pages\s+notify$/i.test(t)) {
    await pagesNotify(chatId);
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
  // Optional audience: "last 6 days" = only students who got their certificate in that window.
  // "announce live <link> [last N days [and day 4]]" — the session has started; join now.
  const liveMatch = t.match(/^announce\s+live\s+(https?:\/\/\S+)(?:\s+last\s+(\d{1,3})\s*days?(\s+(?:and|plus|\+)\s*day\s*4)?)?$/i);
  if (liveMatch) {
    await announceSaturday(chatId, 8, 30, liveMatch[2] ? parseInt(liveMatch[2], 10) : undefined, !!liveMatch[3], undefined, liveMatch[1]);
    return;
  }

  // "announce saturday|today [h:mm] [last N days [and day 4]]" — the session is TODAY.
  // "announce reschedule <weekday> [h:mm] [last N days [and day 4]]" — the session has moved.
  const announceMatch = t.match(
    /^announce\s+(saturday|today|reschedule\s+([a-z]+))(?:\s+(\d{1,2})[:.](\d{2}))?(?:\s+last\s+(\d{1,3})\s*days?(\s+(?:and|plus|\+)\s*day\s*4)?)?$/i
  );
  if (announceMatch) {
    const hour = announceMatch[3] ? parseInt(announceMatch[3], 10) : 8;
    const min = announceMatch[4] ? parseInt(announceMatch[4], 10) : 30;
    const days = announceMatch[5] ? parseInt(announceMatch[5], 10) : undefined;
    const movedTo = announceMatch[2] ? announceMatch[2][0].toUpperCase() + announceMatch[2].slice(1).toLowerCase() : undefined;
    await announceSaturday(chatId, hour, min, days, !!announceMatch[6], movedTo);
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

  if (data.startsWith("bkc:")) {
    const b = await cancelBooking(data.slice(4));
    await sendMessage(
      chatId,
      b
        ? `🚫 Call with <b>${escapeHtml(b.name)}</b> on ${formatNigeria(b.slot_start)} cancelled — the time is free again.\n\nLet them know: <a href="${waLink(b.phone, `Hi ${b.name}, this is the EEM26 team. We need to move our call — please pick a new time here: ${BOOKING_URL}`)}">message ${escapeHtml(b.name)} on WhatsApp</a>`
        : "ℹ️ That call was already cancelled."
    );
    if (messageId) await removeButtons(chatId, messageId);
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
    `<b>Sales pages</b>\n` +
    `<code>pages</code> → Status of every student's sales pages (live / being updated / broken and why).\n` +
    `<code>pages notify</code> → Message students whose pages can't be fixed automatically, with the exact step they need to take.\n\n` +
    `<b>Amara on the web</b>\n` +
    `<code>web [ID]</code> → That student's private link to watch their AI agents build live.\n` +
    `<code>web publish</code> → Re-publish the web app (${WEB_APP_URL}) and the AI assistant chat page.\n` +
    `<code>code [ID]</code> → A one-time web login code to give a student (forgot password).\n` +
    `<code>bookings</code> → Upcoming calls from the booking page (${BOOKING_URL}).\n` +
    `<code>block 2026-11-02</code> / <code>unblock 2026-11-02</code> → Close or reopen a day for bookings.\n` +
    `<code>hours 10 18</code> → Booking hours (Nigeria time). <code>booking days mon-sat</code> → Booking days.\n` +
    `<code>premium preview</code> → Publish the new Premium Tech Stack sales page to a preview link.\n` +
    `<code>premium live</code> → Put the new Premium Tech Stack page on the live link.\n\n` +
    `<b>Other</b>\n` +
    `<code>announce saturday</code> → Blast "training is TONIGHT at 8:30 PM" to all graduates + Day 4 students.\nCustom time: <code>announce saturday 9:30</code> (PM Nigeria time)\nOnly recent graduates: <code>announce saturday 8:30 last 6 days</code> (add <code>and day 4</code> to include Day 4 students)\n` +
    `Moved session: <code>announce reschedule sunday 8:30 last 7 days and day 4</code>\n` +
    `Session started: <code>announce live [call link] last 8 days and day 4</code>\n\n` +
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

async function sendLoginCode(adminChatId: number, studentChatId: string): Promise<void> {
  const student = await getStudentByChatId(studentChatId);
  if (!student) {
    await sendMessage(adminChatId, `❌ No student with 🆔 <code>${studentChatId}</code>.`);
    return;
  }
  const code = await issueLoginCode(student.id);
  await sendMessage(
    adminChatId,
    `🔐 Web login code for\n${studentLabel(student.full_name, studentChatId)}\n📧 ${escapeHtml(student.email ?? "no email")}\n\n<code>${code}</code>\n\nGive it to them — they type it on the web page under <b>Forgot password</b> with their email. It works once and expires in ${CODE_MINUTES} minutes.`
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
  // Web chat visitors read their replies from student_bot_conversations, so only Telegram leads need the bot.
  const webLead = isWebVisitor(lead.chat_id);
  if (!owner || (!webLead && !owner.bot_token)) {
    await sendMessage(adminChatId, "❌ That student's bot is no longer connected — reply to the lead isn't possible.");
    return;
  }

  const sendViaBot = async (text: string) => {
    if (webLead) return;
    await fetch(`https://api.telegram.org/bot${owner.bot_token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: lead.chat_id, text, parse_mode: "HTML", disable_web_page_preview: true }),
    }).catch(() => {});
  };
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
  const reply2 = webLead
    ? `Start your 4-day setup here — create your account with the same email 👇\n\n${WEB_APP_URL}`
    : `Your personal setup coach is waiting for you here 👇\n\nhttps://t.me/Amara_EEM26bot`;
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

// ── Amara on the web ──────────────────────────────────────────────────────────

const PREMIUM_LIVE_REPO = "Tech_stack-premium-";
const PREMIUM_PREVIEW_REPO = "tech-stack-premium-preview";

// Pages Amara hosts on the admin's own GitHub account (the one Amara already has access to).
async function publishToAdminPages(adminChatId: number, repo: string, description: string, html: string, doneLabel: string): Promise<void> {
  const owner = Deno.env.get("ADMIN_GITHUB_USERNAME") ?? "Ecosystemexpantion";
  const { data } = await supabase
    .from("amara_students")
    .select("github_access_token")
    .ilike("github_username", owner)
    .not("github_access_token", "is", null)
    .order("updated_at", { ascending: false })
    .limit(1);
  const token = data?.[0]?.github_access_token as string | undefined;
  if (!token) {
    await sendMessage(adminChatId, `❌ No GitHub access saved for <b>${escapeHtml(owner)}</b>. Connect that GitHub account through Amara's Day 2 link first.`);
    return;
  }
  try {
    await publishPage(token, owner, repo, description, html);
    await sendMessage(adminChatId, `${doneLabel}:\nhttps://${owner.toLowerCase()}.github.io/${repo}/\n\n<i>GitHub takes about a minute to update it.</i>`);
  } catch (e) {
    await sendMessage(adminChatId, `❌ Publishing failed: <code>${escapeHtml(String(e).slice(0, 300))}</code>`);
  }
}

async function publishWebApp(adminChatId: number): Promise<void> {
  await publishToAdminPages(adminChatId, WEB_APP_REPO, "EEM26 — 4-day business setup on the web", AMARA_WEB_HTML, "✅ The EEM26 web app is published");
  await publishToAdminPages(adminChatId, SRE_CHAT_REPO, "EEM26 — AI sales assistant chat", SRE_CHAT_HTML, "✅ The AI assistant chat page is published");
  await publishToAdminPages(adminChatId, BOOKING_REPO, "EEM26 — book a call with the team", BOOKING_HTML, "✅ The booking page is published");
  // Older private links (?k=…) still point here.
  await publishToAdminPages(adminChatId, "amara-live", "EEM26 — live AI setup", AMARA_WEB_HTML, "✅ Old build-room links updated");
}

async function sendWebLink(adminChatId: number, studentChatId: string): Promise<void> {
  const student = await getStudentByChatId(studentChatId);
  const link = webLink(student?.web_key);
  if (!student || !link) {
    await sendMessage(adminChatId, `❌ No student with 🆔 <code>${studentChatId}</code>.`);
    return;
  }
  await sendMessage(adminChatId, `🌐 Web link for\n${studentLabel(student.full_name, studentChatId)}\n📍 ${describePosition(student)}\n\n${link}`);
}

// ── Sales pages status ───────────────────────────────────────────────────────

type PageRow = { student_id: string; version: number; status: string; detail: string | null };
type PageStudent = { id: string; telegram_chat_id: string; full_name: string | null };

async function pageProblems(): Promise<{ students: PageStudent[]; rows: Map<string, PageRow> }> {
  const { data: students } = await supabase
    .from("amara_students")
    .select("id, telegram_chat_id, full_name")
    .not("github_access_token", "is", null);
  const { data: rows } = await supabase.from("student_pages").select("student_id, version, status, detail");
  return {
    students: (students ?? []) as PageStudent[],
    rows: new Map(((rows ?? []) as PageRow[]).map((r) => [r.student_id, r])),
  };
}

const PAGE_REASON: Record<string, string> = {
  token_revoked: "GitHub access removed — must reconnect",
  email_unverified: "GitHub email not verified",
  error: "GitHub error",
};

async function pagesReport(adminChatId: number): Promise<void> {
  const { students, rows } = await pageProblems();
  let live = 0, pending = 0;
  const broken: string[] = [];
  for (const s of students) {
    const r = rows.get(s.id);
    if (!r || (r.status === "ok" && r.version < PAGES_VERSION)) pending++;
    else if (r.status === "ok") live++;
    else broken.push(`• <b>${escapeHtml(s.full_name ?? "unnamed")}</b> 🆔 <code>${s.telegram_chat_id}</code> — ${PAGE_REASON[r.status] ?? r.status}${r.status === "error" ? `: <i>${escapeHtml((r.detail ?? "").slice(0, 90))}</i>` : ""}`);
  }
  await sendMessage(
    adminChatId,
    `<b>🌐 Sales pages (${students.length} students)</b>\n\n` +
    `✅ Live with the new design: <b>${live}</b>\n` +
    `⏳ Waiting to be updated: <b>${pending}</b> (about 10 every 5 minutes)\n` +
    `⚠️ Need the student's help: <b>${broken.length}</b>\n\n` +
    (broken.length ? `${broken.slice(0, 40).join("\n")}${broken.length > 40 ? `\n…and ${broken.length - 40} more` : ""}\n\nSend <code>pages notify</code> to message them the fix.` : "")
  );
}

async function pagesNotify(adminChatId: number): Promise<void> {
  const { students, rows } = await pageProblems();
  let sent = 0;
  for (const s of students) {
    const r = rows.get(s.id);
    if (!r || (r.status !== "token_revoked" && r.status !== "email_unverified")) continue;
    const link = `<a href="${buildGitHubAuthUrl(s.telegram_chat_id)}">👉 Reconnect GitHub here</a>`;
    const text = r.status === "email_unverified"
      ? `Hi${s.full_name ? ` ${escapeHtml(s.full_name.split(" ")[0])}` : ""}! 👋 Your sales pages aren't showing yet because <b>GitHub needs you to verify your email</b>.\n\n1️⃣ Open the email from GitHub and tap <b>Verify email address</b>\n2️⃣ Then tap this link so I can publish your pages:\n${link}`
      : `Hi${s.full_name ? ` ${escapeHtml(s.full_name.split(" ")[0])}` : ""}! 👋 Your sales pages need a quick fix — GitHub disconnected from me.\n\nTap the link, log in, and tap the green <b>Authorize</b> button. I'll repair and update your pages automatically:\n${link}`;
    if (await sendMessage(s.telegram_chat_id, text)) sent++;
  }
  await sendMessage(adminChatId, `✅ Sent the fix to <b>${sent}</b> student(s). Their pages are repaired automatically as soon as they do it.`);
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

async function announceSaturday(
  adminChatId: number,
  pmHour = 8,
  minute = 30,
  certifiedWithinDays?: number,
  withDay4 = false,
  movedTo?: string,
  liveLink?: string
): Promise<void> {
  const timeLabel = `${pmHour}:${String(minute).padStart(2, "0")} PM`;
  const allChatIds = new Set<string>();

  if (certifiedWithinDays !== undefined) {
    const since = new Date(Date.now() - certifiedWithinDays * 86400_000).toISOString();
    const { data: recent } = await supabase
      .from("amara_students")
      .select("telegram_chat_id")
      .gte("certificate_issued_at", since);
    for (const s of recent ?? []) allChatIds.add(String(s.telegram_chat_id));
    if (withDay4) {
      const { data: day4 } = await supabase.from("amara_students").select("telegram_chat_id").eq("status", "ACTIVE").eq("current_day", 4);
      for (const s of day4 ?? []) allChatIds.add(String(s.telegram_chat_id));
    }
  } else {
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

    for (const s of eligibleGrads) allChatIds.add(String(s.telegram_chat_id));
    for (const s of day4Students ?? []) allChatIds.add(String(s.telegram_chat_id));
  }

  if (allChatIds.size === 0) {
    await sendMessage(adminChatId, "No eligible students to announce to right now.");
    return;
  }

  const announcement = liveLink
    ? `🔴 <b>WE'RE LIVE NOW!</b>\n\n` +
      `The EEM26 team's <b>Final Stage Setup training has started</b> 🎯\n\n` +
      `👉 <a href="${escapeHtml(liveLink)}">Tap here to join the call now</a>\n\n` +
      `Join right away — this is where your business goes live! 🔥`
    : movedTo
    ? `📢 <b>Change of plan</b>\n\n` +
      `The EEM26 team's <b>Final Stage Setup session</b> has moved to <b>${movedTo} at ${timeLabel} Nigeria time</b> — we had technical issues with Telegram Live. Sorry for the change 🙏\n\n` +
      `Same group, same link 👇\n👉 <a href="https://t.me/+kU414VXm1N0zYjQ8">Join the group here</a>\n\n` +
      `See you ${movedTo} — this is where your business goes live! 🔥`
    :
    `🚨 <b>TODAY is the day!</b>\n\n` +
    `The EEM26 team's <b>Final Stage Setup session</b> is <b>TONIGHT at ${timeLabel} Nigeria time!</b> 🎯\n\n` +
    `👉 <a href="https://t.me/+kU414VXm1N0zYjQ8">Join the group here</a>\n\n` +
    `Be there — this is where your business goes live! 🔥`;

  let sent = 0;
  for (const chatId of allChatIds) {
    try {
      if (await sendMessage(chatId, announcement)) sent++;
    } catch (e) {
      console.error(`Failed to send Saturday announcement to ${chatId}:`, e);
    }
  }

  const audience = certifiedWithinDays !== undefined
    ? `students who got their certificate in the last ${certifiedWithinDays} days${withDay4 ? " + Day 4 students" : ""}`
    : "graduates + Day 4 students";
  await sendMessage(adminChatId, `✅ ${liveLink ? "\"We're live\" notice" : movedTo ? `Reschedule notice (${movedTo} ${timeLabel})` : `Session announcement (${timeLabel})`} sent to <b>${sent}</b> ${audience}.`);
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

// ── Booking page (our replacement for Calendly) ──────────────────────────────

const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

async function listBookings(adminChatId: number): Promise<void> {
  const [list, s] = await Promise.all([upcomingBookings(), getSettings()]);
  const open = `🕘 Open ${s.days.map((d) => DAY_NAMES[d]).join(", ")} · ${s.start_hour}:00–${s.end_hour}:00 Nigeria time · ${s.slot_minutes}-min calls` +
    (s.blocked_dates.length ? `\n🚫 Closed: ${s.blocked_dates.join(", ")}` : "");
  if (!list.length) {
    await sendMessage(adminChatId, `📅 No upcoming calls.\n\n${open}\n\n🔗 ${BOOKING_URL}`);
    return;
  }
  const lines = list.map((b) => `• <b>${formatNigeria(b.slot_start)}</b> — ${escapeHtml(b.name)} · <a href="${waLink(b.phone)}">${escapeHtml(b.phone)}</a>${b.topic ? `\n   <i>${escapeHtml(b.topic.slice(0, 120))}</i>` : ""}`);
  await sendMessage(adminChatId, `📅 <b>Upcoming calls (${list.length})</b>\n\n${lines.join("\n")}\n\n${open}`);
}

async function blockDate(adminChatId: number, date: string, block: boolean): Promise<void> {
  const s = await getSettings();
  const dates = new Set(s.blocked_dates);
  if (block) dates.add(date);
  else dates.delete(date);
  await updateSettings({ blocked_dates: [...dates].sort() });
  const booked = (await upcomingBookings(100)).filter((b) => new Date(new Date(b.slot_start).getTime() + 3600_000).toISOString().slice(0, 10) === date);
  await sendMessage(
    adminChatId,
    `${block ? "🚫 Closed" : "✅ Reopened"} <b>${date}</b> for bookings.` +
      (block && booked.length ? `\n\n⚠️ ${booked.length} call(s) are already booked that day — send <code>bookings</code> to see them and cancel if needed.` : "")
  );
}

async function setBookingHours(adminChatId: number, start: number, end: number): Promise<void> {
  if (start < 0 || end > 24 || start >= end) {
    await sendMessage(adminChatId, "❌ Use hours in 24-hour time, e.g. <code>hours 10 18</code> for 10 AM to 6 PM.");
    return;
  }
  await updateSettings({ start_hour: start, end_hour: end });
  await sendMessage(adminChatId, `✅ Booking hours are now <b>${start}:00 to ${end}:00</b> Nigeria time.`);
}

async function setBookingDays(adminChatId: number, spec: string): Promise<void> {
  const days = new Set<number>();
  for (const part of spec.toLowerCase().split(/[\s,]+/).filter(Boolean)) {
    const [a, b] = part.split("-").map((x) => DAY_NAMES.indexOf(x.slice(0, 3)));
    if (a < 0 || (part.includes("-") && b < 0)) {
      await sendMessage(adminChatId, "❌ Use day names, e.g. <code>booking days mon-sat</code> or <code>booking days mon,wed,fri</code>.");
      return;
    }
    if (part.includes("-")) for (let d = a; ; d = (d + 1) % 7) { days.add(d); if (d === b) break; }
    else days.add(a);
  }
  await updateSettings({ days: [...days].sort() });
  await sendMessage(adminChatId, `✅ Bookings are open on <b>${[...days].sort().map((d) => DAY_NAMES[d]).join(", ")}</b>.`);
}
