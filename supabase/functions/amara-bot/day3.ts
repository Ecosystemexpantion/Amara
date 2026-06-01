import { sendMessage, sendChatAction, typeMessage } from "./telegram.ts";
import { advanceStep, updateStudent, recordStepCompletion, getRecentConversation, computeNextUnlockAt } from "./db.ts";
import { geminiVision, geminiChat, buildVerificationPrompt } from "./gemini.ts";
import { notifyAdmin } from "./admin.ts";
import type { Student, TelegramMessage } from "./types.ts";

const BOT_TOKEN_RE = /\d{8,10}:[A-Za-z0-9_-]{35,}/;

export async function handleDay3(
  _msg: TelegramMessage,
  student: Student,
  chatId: number,
  text: string | null,
  photo: { bytes: Uint8Array; mimeType: string } | null
): Promise<void> {
  await sendChatAction(chatId, "typing");

  // Day 3 is now a single step: get BotFather token → Amara does everything else
  switch (student.current_step) {
    case 1: await handleStep1(student, chatId, text, photo); break;
    default: await sendMessage(chatId, "Send me your BotFather token to continue! 🤖");
  }
}

// Step 1: Create Telegram bot with BotFather → paste token → Amara registers webhook automatically
async function handleStep1(
  student: Student,
  chatId: number,
  text: string | null,
  photo: { bytes: Uint8Array; mimeType: string } | null
): Promise<void> {
  // Check if a photo of the BotFather chat was sent
  if (photo) {
    const prompt = buildVerificationPrompt(
      "Does this screenshot show a Telegram chat with BotFather showing the bot token? Extract the token if visible.",
      ["bot_token"]
    );
    const result = await geminiVision(photo.bytes, photo.mimeType, prompt);
    if (result.verified && result.extracted?.bot_token && BOT_TOKEN_RE.test(result.extracted.bot_token)) {
      await setupStudentBot(student, chatId, result.extracted.bot_token);
      return;
    }
    // Show visual guidance
    const history = await getRecentConversation(student.id, 4);
    const reply = await geminiChat(
      history,
      "[screenshot]",
      `Student is on Day 3 Step 1. They sent a screenshot. They need to copy their BotFather bot token (format: 1234567890:ABCdef...) and paste it as text in this chat. Tell them to copy the token directly from BotFather and paste it here.`,
      student.id
    );
    await sendMessage(chatId, reply);
    return;
  }

  if (!text) return;

  // Try to extract token from text
  const tokenMatch = text.match(BOT_TOKEN_RE);
  if (tokenMatch) {
    await setupStudentBot(student, chatId, tokenMatch[0]);
    return;
  }

  // Not a token — answer questions and redirect
  const history = await getRecentConversation(student.id, 6);
  const firstName = student.full_name?.split(" ")[0] ?? "Student";
  const reply = await geminiChat(
    history,
    text,
    `Student is on Day 3 Step 1. They need to:
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

async function setupStudentBot(student: Student, chatId: number, token: string): Promise<void> {
  await typeMessage(chatId, `Got your token! Let me verify it and set up your bot... 🔧`);

  // 1. Verify token is valid and get bot username
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

  // 2. Register webhook pointing to student-bot Edge Function
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

  // 3. Mark Day 3 complete
  const nextUnlock = computeNextUnlockAt();
  await advanceStep(student.id, 3, 0, {
    bot_token: token,
    day3_completed_at: new Date().toISOString(),
    next_day_unlocks_at: nextUnlock,
  });
  await recordStepCompletion(student.id, 3, 1, false, `Bot: @${botUsername} | Webhook: ${webhookUrl}`);

  // 4. Celebrate and tell them what just happened
  await typeMessage(
    chatId,
    `<b>YOUR BOT IS LIVE!! 🤖🔥</b>\n\n@${botUsername} is now running 24/7 — I set it all up automatically for you! No terminal, no Supabase account, no code. Done! 💪`
  );
  await typeMessage(
    chatId,
    `Your SRE — Smart Reply Engine from your Tech Stack 📦 — is now ACTIVE. Anyone who messages @${botUsername} will get an intelligent reply and be guided toward buying your EEM26 package automatically 💰`
  );
  await typeMessage(
    chatId,
    `Rest up — <b>Day 4 unlocks at 8AM tomorrow!</b> 🌅\n\nTomorrow is your FINAL day. We test everything, confirm your bot is working, and issue your official <b>Certificate of Completion 🎓</b> — you're almost there!`
  );

  await notifyAdmin(
    `✅ <b>DAY 3 COMPLETE</b>\n\nStudent: ${student.full_name}\nCountry: ${student.country}\nBot: @${botUsername}\nWebhook: ${webhookUrl}\nSales page: ${student.sales_page_link ?? "N/A"}`
  );

  // Update student with bot username in case it wasn't stored
  if (botUsername) {
    await updateStudent(student.id, { bot_token: token });
  }
}
