import { sendMessage, sendChatAction, sendDocument } from "./telegram.ts";
import { advanceStep, updateStudent, incrementScreenshotAttempts, resetScreenshotAttempts, recordStepCompletion, computeNextUnlockAt, getRecentConversation } from "./db.ts";
import { geminiVision, geminiChat, buildVerificationPrompt } from "./gemini.ts";
import { generateStudentBotCode, STUDENT_BOT_SQL } from "./alex-template.ts";
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

  switch (student.current_step) {
    case 1: await handleStep1(student, chatId, text, photo); break;
    case 2: await handleStep2(student, chatId, text, photo); break;
    case 3: await handleStep3(student, chatId, text, photo); break;
    case 4: await handleStep4(student, chatId, text, photo); break;
    case 5: await handleStep5(student, chatId, text, photo); break;
    case 6: await handleStep6(student, chatId, text, photo); break;
    default: await sendMessage(chatId, "Send me that screenshot when you're ready 📸");
  }
}

// Step 1: Create Telegram bot with BotFather → collect token
async function handleStep1(student: Student, chatId: number, text: string | null, photo: { bytes: Uint8Array; mimeType: string } | null): Promise<void> {
  if (photo) {
    // Check if it's BotFather screenshot
    const prompt = buildVerificationPrompt("Does this screenshot show a Telegram chat with BotFather, showing the /newbot command response or a bot token?", ["bot_token"]);
    const result = await geminiVision(photo.bytes, photo.mimeType, prompt);
    if (result.verified && result.extracted?.bot_token && BOT_TOKEN_RE.test(result.extracted.bot_token)) {
      await saveBotToken(student, chatId, result.extracted.bot_token);
      return;
    }
    await sendMessage(chatId, "I can see BotFather! Now send me the <b>token</b> — the long code it gave you that looks like: <code>1234567890:ABCdef...</code>\n\nJust paste it in the chat 📋");
    return;
  }

  if (!text) return;

  const tokenMatch = text.match(BOT_TOKEN_RE);
  if (tokenMatch) {
    await saveBotToken(student, chatId, tokenMatch[0]);
    return;
  }

  // Not a token — they might have questions or sent something else
  const history = await getRecentConversation(student.id, 6);
  const reply = await geminiChat(history, text, `Student is on Day 3 Step 1. They need to:
1. Open Telegram and search for @BotFather
2. Start a chat with BotFather and send /newbot
3. Choose a name for their bot (suggest: "${(student.full_name ?? "").split(" ")[0]} EEM26 Assistant")
4. Choose a username (suggest: "${(student.full_name ?? "").split(" ")[0].toLowerCase()}eem26bot")
5. Copy and paste the bot TOKEN they receive

If they're asking a question, answer it. Always ask them to paste the bot token when ready.`, student.id);
  await sendMessage(chatId, reply);
}

async function saveBotToken(student: Student, chatId: number, token: string): Promise<void> {
  await recordStepCompletion(student.id, 3, 1, false, `Bot token: ${token.slice(0, 20)}...`);
  await advanceStep(student.id, 3, 2, { bot_token: token });
  await sendMessage(
    chatId,
    `Bot token saved! 🔐 Your bot is ready to be connected.\n\nNow you need a <b>Supabase</b> account — this is your bot's brain and memory (it's free!).\n\n👉 Go to: <a href="https://supabase.com">supabase.com</a>\nClick <b>"Start your project"</b> and sign up with your <b>GitHub account</b> (the one you created yesterday!)\n\nSend me a screenshot of your Supabase dashboard 📸`
  );
}

// Step 2: Supabase signup
async function handleStep2(student: Student, chatId: number, text: string | null, photo: { bytes: Uint8Array; mimeType: string } | null): Promise<void> {
  if (!photo) {
    if (text) {
      const history = await getRecentConversation(student.id, 6);
      const reply = await geminiChat(history, text, "Student needs to go to supabase.com and sign up using their GitHub account, then send a screenshot of their dashboard.", student.id);
      await sendMessage(chatId, reply);
    } else {
      await sendMessage(chatId, "Go to <a href=\"https://supabase.com\">supabase.com</a> → Sign up with GitHub → send me a screenshot of your dashboard 📸");
    }
    return;
  }

  const prompt = buildVerificationPrompt("Does this screenshot show the Supabase website dashboard (after login), showing a projects page or welcome screen?");
  const result = await geminiVision(photo.bytes, photo.mimeType, prompt);

  if (result.verified) {
    await recordStepCompletion(student.id, 3, 2, true);
    await advanceStep(student.id, 3, 3);
    await sendMessage(
      chatId,
      `Supabase account confirmed! ✅\n\nNow create a new project:\n1️⃣ Click <b>"New Project"</b>\n2️⃣ Name it: <code>EEM26Bot</code>\n3️⃣ Set a <b>database password</b> (write it down somewhere safe!)\n4️⃣ Choose the <b>free tier</b>\n5️⃣ Click <b>"Create new project"</b>\n\nIt takes about 2 minutes to set up. Send me a screenshot when the <b>project dashboard is ready</b> (not still loading) 📸`
    );
  } else {
    await handleFailed(student, chatId, result.reason, result.guidance || "Go to <a href=\"https://supabase.com\">supabase.com</a>, sign in with your GitHub account, and send me a screenshot of the dashboard 📸");
  }
}

// Step 3: Supabase project dashboard
async function handleStep3(student: Student, chatId: number, text: string | null, photo: { bytes: Uint8Array; mimeType: string } | null): Promise<void> {
  if (!photo) {
    if (text) {
      const history = await getRecentConversation(student.id, 6);
      const reply = await geminiChat(history, text, "Student needs to create a new Supabase project named EEM26Bot (free tier) and wait for it to be ready, then send a screenshot.", student.id);
      await sendMessage(chatId, reply);
    } else {
      await sendMessage(chatId, "Create your EEM26Bot project on Supabase, wait for it to be ready, then send a screenshot 📸");
    }
    return;
  }

  const prompt = buildVerificationPrompt("Does this screenshot show a Supabase project dashboard that is fully loaded and ready (not still provisioning)? It should show sections like Table Editor, Authentication, Storage, or API.");
  const result = await geminiVision(photo.bytes, photo.mimeType, prompt);

  if (result.verified) {
    await recordStepCompletion(student.id, 3, 3, true);
    await advanceStep(student.id, 3, 4);
    await sendMessage(
      chatId,
      `Project is ready! 🚀\n\nNow get your API keys:\n1️⃣ In your Supabase project, click <b>⚙️ Settings</b> (bottom left)\n2️⃣ Click <b>"API"</b>\n3️⃣ You'll see your <b>Project URL</b> and <b>API keys</b>\n\nSend me a screenshot of that page — I'll extract what we need 📸\n\n(No worries, it's safe to share this with me!)`
    );
  } else {
    await handleFailed(student, chatId, result.reason, result.guidance || "Create the EEM26Bot project (free tier) and wait for the loading to finish, then screenshot the full dashboard 📸");
  }
}

// Step 4: Supabase API keys page — Gemini extracts URL and anon key
async function handleStep4(student: Student, chatId: number, text: string | null, photo: { bytes: Uint8Array; mimeType: string } | null): Promise<void> {
  if (!photo) {
    if (text) {
      const history = await getRecentConversation(student.id, 6);
      const reply = await geminiChat(history, text, "Student needs to go to Settings → API in their Supabase project and send a screenshot showing the Project URL and API keys.", student.id);
      await sendMessage(chatId, reply);
    } else {
      await sendMessage(chatId, "Settings → API → take a screenshot showing your Project URL and keys, then send it to me 📸");
    }
    return;
  }

  const prompt = buildVerificationPrompt(
    "Does this screenshot show the Supabase API settings page with a Project URL and API keys (anon/public key)?",
    ["supabase_url", "supabase_anon_key"]
  );
  const result = await geminiVision(photo.bytes, photo.mimeType, prompt);

  if (result.verified) {
    const supabaseUrl = result.extracted?.supabase_url ?? "";
    const anonKey = result.extracted?.supabase_anon_key ?? "";

    await recordStepCompletion(student.id, 3, 4, true, `URL: ${supabaseUrl}`);
    await advanceStep(student.id, 3, 5, {
      supabase_url: supabaseUrl || undefined,
      supabase_anon_key: anonKey || undefined,
    });

    // Send the SQL for student's bot tables
    const sqlBytes = new TextEncoder().encode(STUDENT_BOT_SQL);
    await sendDocument(chatId, "bot_tables.sql", sqlBytes, "Run this SQL in your Supabase SQL Editor to create your bot's database tables 🗄️");
    await new Promise((r) => setTimeout(r, 1000));
    await sendMessage(
      chatId,
      `Now create your bot's database:\n1️⃣ In your Supabase project, click <b>"SQL Editor"</b> in the left menu\n2️⃣ Click <b>"New query"</b>\n3️⃣ Paste the entire SQL from the file I just sent\n4️⃣ Click <b>"Run"</b>\n\nYou should see "Tables created successfully!" — send me a screenshot 📸`
    );
  } else {
    await handleFailed(student, chatId, result.reason, result.guidance || "Go to Settings → API in your Supabase project. Make sure you can see the Project URL and the anon key, then screenshot and send 📸");
  }
}

// Step 5: SQL editor screenshot → deploy bot code
async function handleStep5(student: Student, chatId: number, text: string | null, photo: { bytes: Uint8Array; mimeType: string } | null): Promise<void> {
  if (!photo) {
    if (text) {
      const history = await getRecentConversation(student.id, 6);
      const reply = await geminiChat(history, text, "Student needs to paste the SQL into their Supabase SQL Editor and run it, then send a screenshot showing success.", student.id);
      await sendMessage(chatId, reply);
    } else {
      await sendMessage(chatId, "Paste the SQL into the Supabase SQL Editor → Run → screenshot the result 📸");
    }
    return;
  }

  const prompt = buildVerificationPrompt("Does this screenshot show the Supabase SQL Editor with a successful query result? Look for a success message, query result rows, or 'Tables created successfully' text.");
  const result = await geminiVision(photo.bytes, photo.mimeType, prompt);

  if (result.verified) {
    await recordStepCompletion(student.id, 3, 5, true);
    await advanceStep(student.id, 3, 6);

    // Generate and send the customized bot code
    await sendChatAction(chatId, "upload_document");
    const botCode = generateStudentBotCode(student);
    const botBytes = new TextEncoder().encode(botCode);
    await sendDocument(chatId, "index.ts", botBytes, "Your personalized EEM26 sales bot! 🤖 This is your SRE — Smart Reply Engine from your Tech Stack 📦");
    await new Promise((r) => setTimeout(r, 1500));

    await sendMessage(
      chatId,
      `Your bot code is ready! 🎉 Now let's deploy it.\n\nYou'll need the <b>Supabase CLI</b> on your phone or computer. Here's the deployment guide:\n\n<b>Step 1 — Install Supabase CLI</b>\nIf you have a computer, open terminal and run:\n<code>npm install -g supabase</code>\n\nIf you're on a phone only, I'll guide you through the Supabase dashboard instead.\n\nWhich do you have — <b>computer</b> or <b>phone only</b>? Tell me and I'll guide you the right way! 📱💻`
    );
  } else {
    await handleFailed(student, chatId, result.reason, result.guidance || "Paste the SQL file content into SQL Editor → Run → screenshot the result showing 'Tables created successfully' 📸");
  }
}

// Step 6: Bot deployment — guide through CLI or dashboard
async function handleStep6(student: Student, chatId: number, text: string | null, photo: { bytes: Uint8Array; mimeType: string } | null): Promise<void> {
  if (photo) {
    const prompt = buildVerificationPrompt("Does this screenshot show a successful Supabase Edge Function deployment? Look for a success message in terminal, Supabase CLI output, or the Supabase Edge Functions dashboard showing a deployed function.");
    const result = await geminiVision(photo.bytes, photo.mimeType, prompt);

    if (result.verified) {
      await recordStepCompletion(student.id, 3, 6, true);
      const nextUnlock = computeNextUnlockAt();
      await advanceStep(student.id, 3, 0, {
        day3_completed_at: new Date().toISOString(),
        next_day_unlocks_at: nextUnlock,
      });

      await sendMessage(
        chatId,
        `<b>Bot deployed! 🚀🚀🚀</b>\n\nYou're amazing — Day 3 DONE! 💪\n\nYour Smart Reply Engine is built. Tomorrow on Day 4, we:\n✅ Set all your environment variables\n✅ Connect your bot to Telegram\n✅ Test everything live\n✅ Issue your certificate! 🎓\n\n<b>Day 4 unlocks tomorrow at 8AM Nigeria time!</b> Rest well — tomorrow is your finish line! 🏁`
      );

      await notifyAdmin(
        `✅ <b>DAY 3 COMPLETE</b>\n\nStudent: ${student.full_name}\nCountry: ${student.country}\nBot token: ${student.bot_token ? "✅" : "❌"}\nSupabase URL: ${student.supabase_url ?? "not captured"}`
      );
      return;
    }
  }

  if (text) {
    const history = await getRecentConversation(student.id, 8);
    const lowerText = text.toLowerCase();

    let context = "";
    if (lowerText.includes("computer") || lowerText.includes("laptop") || lowerText.includes("pc")) {
      context = `Student has a computer. Guide them through deploying the bot using Supabase CLI:
1. Install CLI: npm install -g supabase
2. Login: supabase login (will open browser)
3. Create the function folder and copy the index.ts file: mkdir -p supabase/functions/my-bot && cp index.ts supabase/functions/my-bot/
4. Link project: supabase link --project-ref [their-project-ref from Supabase dashboard URL]
5. Deploy: supabase functions deploy my-bot --no-verify-jwt
6. The function URL will be: https://[project-ref].supabase.co/functions/v1/my-bot
Guide them step by step, one step at a time. Ask for a screenshot after each step.`;
    } else if (lowerText.includes("phone") || lowerText.includes("mobile")) {
      context = `Student only has a phone. Guide them to deploy via Supabase Dashboard:
1. Go to supabase.com, open their project
2. Go to Edge Functions in the left menu
3. Click "Create a new function"
4. Name it: my-bot
5. Copy and paste the index.ts code I sent them into the editor
6. Click Deploy
Then guide them to set environment variables in the function settings.`;
    } else {
      context = "Student is deploying their EEM26 bot to Supabase. Ask them if they have a computer or just a phone so you can guide them the right way. Be encouraging and patient — this is the most technical step and you're right here with them!";
    }

    const reply = await geminiChat(history, text, context, student.id);
    await sendMessage(chatId, reply);
  }
}

async function handleFailed(student: Student, chatId: number, reason: string, retryMsg: string): Promise<void> {
  if (reason === "verification_unavailable") {
    await sendMessage(chatId, "Photo check had a small hiccup 😊 — please send that screenshot again!");
    return;
  }
  const attempts = student.screenshot_attempts + 1;
  if (attempts >= 3) {
    await resetScreenshotAttempts(student.id);
    await notifyAdmin(`⚠️ <b>STUDENT STUCK</b>\nName: ${student.full_name}\nDay: ${student.current_day}, Step: ${student.current_step}\nReason: ${reason}`);
    await sendMessage(chatId, `No wahala! Let me explain differently 😊\n\n${retryMsg}`);
  } else {
    await incrementScreenshotAttempts(student.id, student.screenshot_attempts);
    await sendMessage(chatId, `Hmm, that's not quite it — no worries! 😊\n\nTry again: ${retryMsg}`);
  }
}
