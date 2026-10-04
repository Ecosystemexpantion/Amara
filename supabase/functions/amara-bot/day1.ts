import { sendMessage, sendChatAction, typeMessage, copyMessage, sendWithKeyboard, escapeHtml } from "./telegram.ts";
import { advanceStep, advanceIfAt, recordStepCompletion, getRecentConversation, computeNextUnlockAt, saveConversation, countStudentMessagesToday } from "./db.ts";
import { geminiVision, geminiChat, geminiVisionGuide, buildVerificationPrompt } from "./gemini.ts";
import { notifyAdmin, studentLabel, describePosition } from "./admin.ts";
import { sendGitHubIntro } from "./day2.ts";
import { SRE_STEP, GATE_STEP, GATE_PITCH, BOTFATHER_LINK, sreIntroMessages, suggestedBotNames, legacyUpgradeMessage } from "./day1-content.ts";
import type { Student, TelegramMessage } from "./types.ts";

const ADMIN_CHAT_ID = Deno.env.get("ADMIN_CHAT_ID") ?? "5870771695";
// Daily AI allowance for students who haven't bought the Tech Stack yet.
const SRE_AI_REPLIES_PER_DAY = 20;

const BOT_TOKEN_RE = /\d{6,12}:[A-Za-z0-9_-]{30,}/;

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
  for (const m of sreIntroMessages(fullName, chatId)) await typeMessage(chatId, m);
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
  const { displayName, username } = suggestedBotNames(student.full_name, chatId);
  const botFatherSteps = `The student is creating their Telegram bot with BotFather (${BOTFATHER_LINK}). The steps, all sent to BotFather (NOT to Amara):
1. Open ${BOTFATHER_LINK} (the real BotFather has a blue tick) and press START
2. Send /newbot
3. When asked for a name, send: ${displayName}
4. When asked for a username, send: ${username} (must end in "bot"; if it's taken, add more numbers before "_bot")
5. BotFather replies "Done! Congratulations on your new bot" with a token like 1234567890:AAH...
6. Back in Amara's chat: press and hold that "Done!" message → Forward → Amara. Or copy the token and paste it here.`;

  // Messages are saved before routing, so this already includes the current one.
  const overAiLimit = day === 1 && (await countStudentMessagesToday(student.id)) > SRE_AI_REPLIES_PER_DAY;
  const limitReply =
    `Here's exactly what to do 👇\n\n1️⃣ Tap 👉 <a href="${BOTFATHER_LINK}">@BotFather</a> → <b>START</b>\n2️⃣ Send <code>/newbot</code>\n3️⃣ Name: <code>${displayName}</code>\n4️⃣ Username: <code>${username}</code>\n5️⃣ Press and hold BotFather's <b>"Done!"</b> message → <b>Forward</b> → <b>Amara</b>\n\nI'll set up everything the moment your token arrives 💪`;

  if (photo) {
    const prompt = buildVerificationPrompt(
      "Does this screenshot show a Telegram chat with BotFather showing the bot token? Extract the full token if it is completely visible.",
      ["bot_token"]
    );
    if (overAiLimit) {
      await typeMessage(chatId, limitReply);
      return;
    }
    const result = await geminiVision(photo.bytes, photo.mimeType, prompt);
    const token = result.extracted?.bot_token?.match(BOT_TOKEN_RE)?.[0];
    if (result.verified && token) {
      await setupStudentBot(student, chatId, token, day);
      return;
    }
    const guidance = await geminiVisionGuide(
      photo.bytes,
      photo.mimeType,
      `${botFatherSteps}

Look at their screen and tell them the ONE next thing to do:
- Not in BotFather yet, or in a fake BotFather without the blue tick → tell them to tap ${BOTFATHER_LINK}
- BotFather asking for a name → send: ${displayName}
- BotFather asking for a username → send: ${username}
- "Sorry, this username is already taken" or invalid username → send a new one with extra numbers, e.g. ${username.replace(/_bot$/, "1_bot")}
- The "Done! Congratulations" message is visible → press and hold it, tap Forward, choose Amara (screenshots can cut the token off, so forwarding is safest)`,
      text ?? undefined
    );
    await sendMessage(chatId, guidance);
    return;
  }

  if (!text) return;

  const tokenMatch = text.match(BOT_TOKEN_RE);
  if (tokenMatch) {
    await setupStudentBot(student, chatId, tokenMatch[0], day);
    return;
  }

  const hint = misplacedBotFatherInput(text, username, displayName);
  if (hint) {
    await typeMessage(chatId, hint);
    return;
  }

  if (overAiLimit) {
    await typeMessage(chatId, limitReply);
    return;
  }

  const history = await getRecentConversation(student.id, 6);
  const reply = await geminiChat(
    history,
    text,
    `Student is on Day ${day} — setting up their SRE (Smart Reply Engine) AI sales bot.
${botFatherSteps}

If they're asking a question, answer it in 2-3 short sentences and tell them the ONE next step. Remind them that the name and username go to BotFather, not to you.`,
    student.id
  );
  await sendMessage(chatId, reply);
}

// Students often type BotFather's answers into Amara's chat — catch the common cases without AI.
function misplacedBotFatherInput(text: string, username: string, displayName: string): string | null {
  const t = text.trim();
  const openBotFather = `👉 <a href="${BOTFATHER_LINK}">Tap here to open BotFather</a>`;

  if (/username is already taken|sorry, this username/i.test(t)) {
    return `That username is taken — no problem! 😊 Send BotFather this one instead (tap to copy):\n<code>${username.replace(/_bot$/, "1_bot")}</code>\n\n${openBotFather}`;
  }
  if (/^\/(newbot|start|mybots)\b/i.test(t)) {
    return `Almost! 😊 <code>${t.split(/\s/)[0]}</code> goes to <b>BotFather</b>, not to me.\n\n${openBotFather}, send it there, then follow BotFather's questions.`;
  }
  if (/^@?[a-z][a-z0-9_]{2,30}bot$/i.test(t)) {
    return `That looks like your bot's username 👍 — send it to <b>BotFather</b>, not to me.\n\n${openBotFather} and send it there. When BotFather says <i>"Done! Congratulations"</i>, press and hold that message → <b>Forward</b> → <b>Amara</b> 📲`;
  }
  if (t.toLowerCase() === displayName.toLowerCase()) {
    return `That's your bot's name 👍 — send it to <b>BotFather</b>, not to me.\n\n👉 <a href="${BOTFATHER_LINK}">Tap here to open BotFather</a> and send it there.`;
  }
  if (/how are we going to call it|choose a (name|username) for your bot/i.test(t)) {
    return `That's BotFather asking you a question 😊 Reply to it <b>inside BotFather's chat</b>, not here.\n\n${openBotFather}`;
  }
  if (/done! congratulations/i.test(t)) {
    return `I can see the "Done!" message but the token got cut off 🤔 Go back to BotFather, press and hold the <b>whole</b> "Done!" message → <b>Forward</b> → <b>Amara</b>.\n\n${openBotFather}`;
  }
  return null;
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
    `Rest up — <b>Day 4 unlocks at 8AM tomorrow!</b> 🌅\n\nTomorrow is your FINAL day. We test everything, confirm your bot is working, and issue your official <b>Certificate of Completion 🎓</b> — you're almost there!\n\nUntil then I'll stay quiet so you can rest 🤫 — no need to message me. I'll message you the moment it opens 🔔`
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
// Amara never replies here, except to confirm a screenshot reached the coach. Payments are checked by the admin only.
export async function handleGate(msg: TelegramMessage, student: Student, chatId: number): Promise<void> {
  const photo = msg.photo?.[msg.photo.length - 1];
  await saveConversation(student.id, "user", describeIncoming(msg), photo ? "photo" : msg.voice ? "voice" : "text");

  if (!photo) {
    await forwardToAdmin(student, msg, `💬 <b>Message from a locked student</b> — Amara stayed silent`, false);
    return;
  }

  await forwardToAdmin(student, msg, `🧾 <b>Payment screenshot</b> — check it and tap Accept or Reject`, true);
  await sendMessage(chatId, `Got it! 📸 Coach is checking your payment now — I'll message you as soon as it's confirmed 🙏`);
}

export async function rejectPayment(chatId: number | string): Promise<void> {
  await sendMessage(
    chatId,
    `We couldn't confirm your Tech Stack payment from that screenshot 😕\n\nPlease send a clear screenshot of your <b>successful payment receipt</b> — it should show the amount, the date and that the payment was successful 📸`
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
  if (withApprove) {
    buttons.unshift([
      { text: "✅ Accept", callback_data: `approve:${id}` },
      { text: "❌ Reject", callback_data: `reject:${id}` },
    ]);
  }
  const card = `${headline}\n\n${studentLabel(student.full_name, id)}\n📍 ${describePosition(student)}`;

  if (msg.text) {
    await sendWithKeyboard(ADMIN_CHAT_ID, `${card}\n\n💬 "${escapeHtml(msg.text.slice(0, 3000))}"`, buttons);
    return;
  }
  await copyMessage(ADMIN_CHAT_ID, id, msg.message_id);
  await sendWithKeyboard(ADMIN_CHAT_ID, card, buttons);
}

// ── Between days: Amara stays silent to save credit ─────────────────────────

export function isWaitingForNextDay(student: Student): boolean {
  return student.status === "ACTIVE" && student.current_step === 0 && student.current_day >= 2 && student.current_day <= 3;
}

export async function handleWaitingMessage(msg: TelegramMessage, student: Student): Promise<void> {
  await saveConversation(student.id, "user", describeIncoming(msg), msg.photo ? "photo" : msg.voice ? "voice" : "text");
  await forwardToAdmin(student, msg, `💤 <b>Message between days</b> — Amara stayed silent`, false);
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
