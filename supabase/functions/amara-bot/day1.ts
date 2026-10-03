import { sendMessage, sendChatAction, typeMessage, downloadFile, copyMessage, sendWithKeyboard, escapeHtml } from "./telegram.ts";
import { advanceStep, advanceIfAt, recordStepCompletion, getRecentConversation, computeNextUnlockAt, saveConversation } from "./db.ts";
import { geminiVision, geminiChat, buildVerificationPrompt } from "./gemini.ts";
import { notifyAdmin, studentLabel } from "./admin.ts";
import { sendGitHubIntro } from "./day2.ts";
import { SRE_STEP, GATE_STEP, GATE_PITCH, sreIntroMessages, legacyUpgradeMessage } from "./day1-content.ts";
import type { Student, TelegramMessage } from "./types.ts";

const ADMIN_CHAT_ID = Deno.env.get("ADMIN_CHAT_ID") ?? "5870771695";
const BOT_TOKEN_RE = /\d{8,10}:[A-Za-z0-9_-]{35,}/;

// Day 1 — SRE: create a bot with BotFather → paste token → Amara wires it up.
export async function handleDay1(
  _msg: TelegramMessage,
  student: Student,
  chatId: number,
  text: string | null,
  photo: { bytes: Uint8Array; mimeType: string } | null
): Promise<void> {
  await sendChatAction(chatId, "typing");
  await handleSreStep(student, chatId, text, photo, 1);
}

export async function sendSreIntro(chatId: number | string, fullName: string | null): Promise<void> {
  for (const m of sreIntroMessages(fullName)) await typeMessage(chatId, m);
}

async function sendGatePitch(chatId: number | string): Promise<void> {
  for (const m of GATE_PITCH) await typeMessage(chatId, m);
}

// `day` is 1 for the normal flow, 3 for students who started on the old order and never built a bot.
export async function handleSreStep(
  student: Student,
  chatId: number,
  text: string | null,
  photo: { bytes: Uint8Array; mimeType: string } | null,
  day: 1 | 3
): Promise<void> {
  if (photo) {
    const prompt = buildVerificationPrompt(
      "Does this screenshot show a Telegram chat with BotFather showing the bot token? Extract the token if visible.",
      ["bot_token"]
    );
    const result = await geminiVision(photo.bytes, photo.mimeType, prompt);
    if (result.verified && result.extracted?.bot_token && BOT_TOKEN_RE.test(result.extracted.bot_token)) {
      await setupStudentBot(student, chatId, result.extracted.bot_token, day);
      return;
    }
    const history = await getRecentConversation(student.id, 4);
    const reply = await geminiChat(
      history,
      "[screenshot]",
      `Student is on Day ${day} (SRE bot setup). They sent a screenshot. They need to copy their BotFather bot token (format: 1234567890:ABCdef...) and paste it as text in this chat. Tell them to copy the token directly from BotFather and paste it here.`,
      student.id
    );
    await sendMessage(chatId, reply);
    return;
  }

  if (!text) return;

  const tokenMatch = text.match(BOT_TOKEN_RE);
  if (tokenMatch) {
    await setupStudentBot(student, chatId, tokenMatch[0], day);
    return;
  }

  const history = await getRecentConversation(student.id, 6);
  const firstName = student.full_name?.split(" ")[0] ?? "Student";
  const reply = await geminiChat(
    history,
    text,
    `Student is on Day ${day} — setting up their SRE (Smart Reply Engine) AI sales bot. They need to:
1. Open Telegram and search for @BotFather
2. Start a chat and send /newbot
3. Choose a bot display name (suggest: "${firstName} EEM26 Assistant")
4. Choose a username (suggest: "${firstName.toLowerCase()}eem26bot" — must end in "bot")
5. Copy the token BotFather sends and paste it here

If they're asking a question, answer it. Always ask them to paste the bot token when ready.`,
    student.id
  );
  await sendMessage(chatId, reply);
}

async function setupStudentBot(student: Student, chatId: number, token: string, day: 1 | 3): Promise<void> {
  await typeMessage(chatId, `Got your token! Let me verify it and set up your bot... 🔧`);

  let botUsername = "";
  try {
    const getMeRes = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const getMeData = await getMeRes.json();
    if (!getMeData.ok) {
      await typeMessage(
        chatId,
        `That token doesn't look right 🤔 Please copy it directly from BotFather — it should look like:\n<code>1234567890:ABCDefGHIjklMNOpqrstUVWxyz12345678901</code>`
      );
      return;
    }
    botUsername = getMeData.result.username ?? "";
  } catch {
    await typeMessage(chatId, `Had trouble verifying the token — please paste it again 😊`);
    return;
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const webhookUrl = `${supabaseUrl}/functions/v1/student-bot/${student.id}`;

  try {
    await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: webhookUrl }),
    });
  } catch {
    // Non-fatal — bot still works, just webhook may need retry
    console.error("Webhook registration failed for student", student.id);
  }

  const now = new Date().toISOString();
  if (day === 1) {
    await advanceStep(student.id, 1, GATE_STEP, {
      bot_token: token,
      day1_completed_at: now,
      next_day_unlocks_at: null,
      last_proactive_at: now,
    });
  } else {
    await advanceStep(student.id, 3, 0, {
      bot_token: token,
      day3_completed_at: now,
      next_day_unlocks_at: computeNextUnlockAt(),
    });
  }
  await recordStepCompletion(student.id, day, day === 1 ? SRE_STEP : 1, false, `Bot: @${botUsername} | Webhook: ${webhookUrl}`);

  await typeMessage(
    chatId,
    `<b>YOUR BOT IS LIVE!! 🤖🔥</b>\n\n@${botUsername} is now running 24/7 — I set it all up automatically for you! No terminal, no Supabase account, no code. Done! 💪`
  );
  await typeMessage(
    chatId,
    `Your SRE — Smart Reply Engine from your Tech Stack 📦 — is now ACTIVE. Anyone who messages @${botUsername} will get an intelligent reply and be guided toward buying your EEM26 package automatically 💰`
  );

  if (day === 1) {
    await typeMessage(chatId, `<b>Day 1 — COMPLETE ✅</b>`);
    await sendGatePitch(chatId);
    await notifyAdmin(
      `✅ <b>DAY 1 COMPLETE (SRE)</b>\n\n${studentLabel(student.full_name, chatId)}\nCountry: ${student.country ?? "?"}\nBot: @${botUsername}\n\n🔒 Day 2 is locked until they send Tech Stack payment proof. Amara stays silent and forwards their messages to you.`
    );
    return;
  }

  await typeMessage(
    chatId,
    `Rest up — <b>Day 4 unlocks at 8AM tomorrow!</b> 🌅\n\nTomorrow is your FINAL day. We test everything, confirm your bot is working, and issue your official <b>Certificate of Completion 🎓</b> — you're almost there!`
  );
  await notifyAdmin(
    `✅ <b>DAY 3 COMPLETE (SRE)</b>\n\n${studentLabel(student.full_name, chatId)}\nCountry: ${student.country ?? "?"}\nBot: @${botUsername}\nSales page: ${student.sales_page_link ?? "N/A"}`
  );
}

// ── Day 2 lock ────────────────────────────────────────────────────────────────

export function isGated(student: Student): boolean {
  return student.status === "ACTIVE" && student.current_day === 1 && student.current_step === GATE_STEP;
}

// Amara never replies here. Payment proof that passes vision unlocks Day 2; everything else goes to the admin.
export async function handleGate(msg: TelegramMessage, student: Student, chatId: number): Promise<void> {
  const photo = msg.photo?.[msg.photo.length - 1];
  await saveConversation(student.id, "user", describeIncoming(msg), photo ? "photo" : msg.voice ? "voice" : "text");

  if (!photo) {
    await forwardToAdmin(student, msg, `💬 <b>Message from a locked student</b> — Amara stayed silent`, false);
    return;
  }

  let verified = false;
  let reason = "";
  try {
    const file = await downloadFile(photo.file_id);
    const result = await geminiVision(file.bytes, file.mimeType, buildVerificationPrompt(
      "Does this screenshot show proof of payment or a purchase confirmation? Accept ANY of these:\n" +
      "- A bank or payment app receipt (OPay, Paystack, Flutterwave, bank transfer) showing a successful transaction\n" +
      "- An email or page saying 'Payment Confirmed', 'Your Access is Ready', 'Order Successful', 'Transaction Successful' or similar\n" +
      "- A Selar order confirmation or purchase receipt\n" +
      "- Any document clearly showing a completed payment\n" +
      "verified=true if this clearly shows a successful payment/purchase. verified=false if it shows something unrelated."
    ));
    verified = result.verified;
    reason = result.reason;
  } catch (e) {
    console.error("Gate photo verification error:", e);
    reason = "couldn't download the photo";
  }

  if (verified) {
    const unlocked = await unlockDay2(student, chatId, "Payment proof auto-verified");
    await forwardToAdmin(student, msg, unlocked
      ? `✅ <b>Payment proof auto-verified — Day 2 unlocked</b>`
      : `🧾 <b>Payment screenshot</b> (Day 2 was already unlocked)`, false);
    return;
  }

  await forwardToAdmin(
    student,
    msg,
    `🧾 <b>Screenshot from a locked student</b> — not auto-verified as payment${reason ? `\n<i>${escapeHtml(reason.slice(0, 300))}</i>` : ""}\n\nTap <b>Approve payment</b> if it's valid.`,
    true
  );
}

export async function unlockDay2(student: { id: string }, chatId: number | string, note: string): Promise<boolean> {
  const moved = await advanceIfAt(student.id, 1, GATE_STEP, 2, 2, { next_day_unlocks_at: null });
  if (!moved) return false;
  await recordStepCompletion(student.id, 1, GATE_STEP, true, note);
  await typeMessage(chatId, `Payment confirmed! ✅ <b>Day 2 is UNLOCKED</b> 🔓\n\nWelcome back — let's build your sales pages! 🔥`);
  await sendGitHubIntro(chatId);
  return true;
}

function describeIncoming(msg: TelegramMessage): string {
  if (msg.text) return msg.text;
  if (msg.photo) return msg.caption ? `[photo] ${msg.caption}` : "[photo]";
  if (msg.voice) return "[voice note]";
  if (msg.video || msg.video_note) return "[video]";
  if (msg.document) return `[file] ${msg.document.file_name ?? ""}`.trim();
  if (msg.sticker) return "[sticker]";
  return "[message]";
}

async function forwardToAdmin(student: Student, msg: TelegramMessage, headline: string, withApprove: boolean): Promise<void> {
  const id = student.telegram_chat_id;
  const buttons = [[{ text: "💬 Jump in", callback_data: `jump:${id}` }]];
  if (withApprove) buttons[0].push({ text: "✅ Approve payment", callback_data: `approve:${id}` });
  const card = `${headline}\n\n${studentLabel(student.full_name, id)}\n📍 Day 1 done — Day 2 locked (no Tech Stack yet)`;

  if (msg.text) {
    await sendWithKeyboard(ADMIN_CHAT_ID, `${card}\n\n💬 "${escapeHtml(msg.text.slice(0, 3000))}"`, buttons);
    return;
  }
  await copyMessage(ADMIN_CHAT_ID, id, msg.message_id);
  await sendWithKeyboard(ADMIN_CHAT_ID, card, buttons);
}

// ── Students who started on the old day order ────────────────────────────────

// Old Day 1 (Selar/Payhip, steps 0–6) and old Day 2 step 1 (Tech Stack payment) — none of them have paid.
export function isLegacyUnpaid(student: Student): boolean {
  if (student.status !== "ACTIVE") return false;
  if (student.current_day === 1) return student.current_step !== SRE_STEP && student.current_step !== GATE_STEP;
  return student.current_day === 2 && student.current_step === 1;
}

export async function migrateLegacyToSre(student: Student, chatId: number): Promise<void> {
  const toGate = !!student.bot_token;
  const now = new Date().toISOString();
  const moved = await advanceIfAt(
    student.id,
    student.current_day,
    student.current_step,
    1,
    toGate ? GATE_STEP : SRE_STEP,
    toGate
      ? { day1_completed_at: now, next_day_unlocks_at: null, last_proactive_at: now }
      : { next_day_unlocks_at: null }
  );
  if (!moved) return;

  await typeMessage(chatId, legacyUpgradeMessage(student.full_name));
  if (toGate) await sendGatePitch(chatId);
  else await sendSreIntro(chatId, student.full_name);
}
