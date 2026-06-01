import { sendMessage, sendChatAction, sendDocument, typeMessage } from "./telegram.ts";
import { advanceStep, updateStudent, incrementScreenshotAttempts, resetScreenshotAttempts, recordStepCompletion, getRecentConversation } from "./db.ts";
import { geminiVision, geminiChat, geminiVisionGuide, buildVerificationPrompt } from "./gemini.ts";
import { generateCertificate } from "./certificate.ts";
import { notifyAdmin } from "./admin.ts";
import type { Student, TelegramMessage } from "./types.ts";

export async function handleDay4(
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
    default: await typeMessage(chatId, "We're almost at the finish line! Send me that screenshot 📸");
  }
}

// Step 1: Set environment variables in Supabase
async function handleStep1(student: Student, chatId: number, text: string | null, photo: { bytes: Uint8Array; mimeType: string } | null): Promise<void> {
  if (!photo) {
    if (text) {
      const history = await getRecentConversation(student.id, 6);
      const reply = await geminiChat(history, text, `Student is on Day 4 Step 1. They need to set environment variables in their Supabase Edge Function — Supabase is from their Tech Stack they purchased:
- BOT_TOKEN: their Telegram bot token (${student.bot_token ? "already collected: " + student.bot_token.slice(0, 15) + "..." : "need to add"})
- GEMINI_API_KEY: from Google AI Studio (aistudio.google.com)
- SUPABASE_URL: auto-injected usually
- SUPABASE_SERVICE_ROLE_KEY: from Supabase Settings → API → service_role`, student.id);
      await sendMessage(chatId, reply);
    } else {
      await typeMessage(chatId, `<b>Last connection — we're linking your bot to its brain! 🧠</b>\n\nThis is your Supabase from your Tech Stack 📦 — let's plug everything in.`);
      await typeMessage(chatId, `In your Supabase project:\n1️⃣ Click <b>Edge Functions</b> in the left menu\n2️⃣ Click on your <b>my-bot</b> function\n3️⃣ Click <b>Secrets</b> (or <b>Environment variables</b>)\n4️⃣ Add these one by one:\n\n<code>BOT_TOKEN</code> = your BotFather token\n<code>GEMINI_API_KEY</code> = your Google AI Studio key\n<code>SUPABASE_SERVICE_ROLE_KEY</code> = Settings → API → service_role key`);
      await typeMessage(chatId, `Send me a screenshot when the variables are set 📸`);
    }
    return;
  }

  const prompt = buildVerificationPrompt("Does this screenshot show Supabase Edge Function environment variables or secrets being set? Look for a secrets/environment panel with key-value inputs.");
  const result = await geminiVision(photo.bytes, photo.mimeType, prompt);

  if (result.verified) {
    await recordStepCompletion(student.id, 4, 1, true);
    await advanceStep(student.id, 4, 2);
    await typeMessage(chatId, `Environment variables set — YES! ✅ You don do am! 🙌`);
    await typeMessage(chatId, `Now let's connect your bot to Telegram with the <b>webhook</b>.\n\nRun this command:\n<code>curl -X POST "https://api.telegram.org/bot${student.bot_token ?? "YOUR_BOT_TOKEN"}/setWebhook" -H "Content-Type: application/json" -d '{"url": "https://YOUR_PROJECT_REF.supabase.co/functions/v1/my-bot"}'</code>\n\n(Replace <code>YOUR_PROJECT_REF</code> with your actual Supabase project ref)`);
    await typeMessage(chatId, `Or just say <b>"done"</b> if you've already set it — I'll walk you through it! 😊`);
  } else {
    await handleFailed(student, chatId, result.reason, result.guidance || "Go to Supabase → Edge Functions → your function → Secrets/Environment Variables, set them, then screenshot 📸",
      photo, "Student needs to show the Supabase Edge Function Secrets/Environment Variables panel with BOT_TOKEN, GEMINI_API_KEY, and SUPABASE_SERVICE_ROLE_KEY set. Guide them based on exactly what you see on their screen.");
  }
}

// Step 2: Set webhook
async function handleStep2(student: Student, chatId: number, text: string | null, photo: { bytes: Uint8Array; mimeType: string } | null): Promise<void> {
  const doneWords = /\b(done|set|connected|webhook|ok|okay|ready|yes|complete|finished)\b/i;

  if (text && doneWords.test(text)) {
    await recordStepCompletion(student.id, 4, 2, false, "Student confirmed webhook set");
    await advanceStep(student.id, 4, 3);
    await typeMessage(chatId, `Webhook confirmed! 🔗 We're SO close now!!`);
    await typeMessage(chatId, `Now the REAL test — go message YOUR bot!\n\n1️⃣ Open Telegram\n2️⃣ Search for your bot's username (from Day 3)\n3️⃣ Send it anything!\n4️⃣ It should reply! 🤖`);
    await typeMessage(chatId, `Send me a screenshot of the conversation with your bot responding 📸`);
    return;
  }

  if (photo) {
    const prompt = buildVerificationPrompt("Does this screenshot show a webhook confirmation response or a terminal/command output showing webhook was set successfully?");
    const result = await geminiVision(photo.bytes, photo.mimeType, prompt);

    if (result.verified) {
      await recordStepCompletion(student.id, 4, 2, true);
      await advanceStep(student.id, 4, 3);
      await typeMessage(chatId, `Webhook set! 🎯 That's it!`);
      await typeMessage(chatId, `Open Telegram, find your bot and send it a message — it should reply! Send me a screenshot of it responding 📸`);
      return;
    }
  }

  if (text) {
    const botToken = student.bot_token ?? "YOUR_BOT_TOKEN";
    const supaUrl = student.supabase_url ?? "https://YOUR_PROJECT_REF.supabase.co";
    const webhookUrl = `${supaUrl}/functions/v1/my-bot`;

    const history = await getRecentConversation(student.id, 6);
    const reply = await geminiChat(history, text, `Student needs to set the Telegram webhook for their bot.
Their bot token starts with: ${botToken.slice(0, 20)}...
Their Supabase URL is: ${student.supabase_url ?? "not yet captured — they need to find it from their Supabase project URL"}
The webhook URL format: ${webhookUrl}
The curl command to run: curl -X POST "https://api.telegram.org/bot${botToken}/setWebhook" -d '{"url":"${webhookUrl}"}'
Guide them step by step. If they don't have curl, suggest using a browser or Postman.`, student.id);
    await sendMessage(chatId, reply);
  } else {
    await typeMessage(chatId, "Set your Telegram webhook and send me a screenshot, or just say <b>\"done\"</b> when it's set! 🔗");
  }
}

// Step 3: Test bot is responding
async function handleStep3(student: Student, chatId: number, text: string | null, photo: { bytes: Uint8Array; mimeType: string } | null): Promise<void> {
  if (!photo) {
    if (text) {
      const history = await getRecentConversation(student.id, 6);
      const reply = await geminiChat(history, text, "Student needs to test their Telegram bot by sending it a message and showing a screenshot of it responding.", student.id);
      await sendMessage(chatId, reply);
    } else {
      await typeMessage(chatId, "Open your bot on Telegram, send it a message, and send me a screenshot of it replying 📸");
    }
    return;
  }

  const prompt = buildVerificationPrompt("Does this screenshot show a Telegram chat conversation where a bot is replying to messages? Look for a bot account responding with text.");
  const result = await geminiVision(photo.bytes, photo.mimeType, prompt);

  if (result.verified) {
    await recordStepCompletion(student.id, 4, 3, true);
    await advanceStep(student.id, 4, 4);
    await typeMessage(chatId, `<b>YOUR BOT IS LIVE! 🔥🔥🔥</b>\n\nI can see it responding! Your SRE — Smart Reply Engine from your Tech Stack 📦 — is RUNNING!`);
    await typeMessage(chatId, `✅ Bot token — connected\n✅ Database — live\n✅ Webhook — set\n✅ Bot is replying — CONFIRMED 💪\n\nThis is YOUR AI working for you 24/7 from this moment. Every person who messages your bot will be handled automatically. Money on autopilot! 🤖💰`);
    await new Promise((r) => setTimeout(r, 300));
    await handleStep4Celebration(student, chatId);
  } else {
    await handleFailed(student, chatId, result.reason, result.guidance || "Open your bot on Telegram, send it a test message, and send me a screenshot of it replying 📸",
      photo, "Student needs to show a Telegram chat conversation where their bot is responding to messages. Guide them based on what you can see on their screen.");
  }
}

async function handleStep4Celebration(student: Student, chatId: number): Promise<void> {
  await advanceStep(student.id, 4, 5);
  await typeMessage(chatId, `Now — the final moment. Your <b>Certificate of Completion! 🎓</b>`);
  await typeMessage(chatId, `I need one last thing from you — please <b>sign your name</b> on plain paper, take a <b>clear photo</b> of just the signature, and send it to me.\n\nI'll add it to your official EEM26 certificate! ✍️`);
}

// Step 4: Wait for student to say something (celebration buffer step)
async function handleStep4(student: Student, chatId: number, text: string | null, photo: { bytes: Uint8Array; mimeType: string } | null): Promise<void> {
  // This step bridges celebration → certificate request
  // It was auto-advanced in step 3 success, so if we land here,
  // just re-send the signature request
  await handleStep4Celebration(student, chatId);
  // Actually advance immediately
  await advanceStep(student.id, 4, 5);
}

// Step 5: Collect student signature photo
async function handleStep5(student: Student, chatId: number, text: string | null, photo: { bytes: Uint8Array; mimeType: string } | null): Promise<void> {
  if (!photo) {
    if (text) {
      await typeMessage(chatId, `I need a <b>photo of your signature</b> — sign your name on paper, take a clear photo, and send it to me 📸 This goes on your official certificate! ✍️`);
    }
    return;
  }

  // Verify it looks like a signature
  const prompt = buildVerificationPrompt("Does this photo show a handwritten signature or name written on paper? It doesn't need to be on white paper — any clear handwriting/signature counts.");
  const result = await geminiVision(photo.bytes, photo.mimeType, prompt);

  if (result.verified) {
    await sendChatAction(chatId, "upload_document");
    await typeMessage(chatId, `Got your signature! ✍️ Generating your certificate now... 🎓`);

    try {
      const certBytes = await generateCertificate(student, photo.bytes, photo.mimeType);
      const certFilename = `${(student.full_name ?? "Student").replace(/\s+/g, "_")}_EEM26_Certificate.pdf`;

      // Send to student
      await sendDocument(chatId, certFilename, certBytes, `🎓 Your official EEM26 Certificate of Completion!`);

      // Send copy to admin
      await sendDocument(
        Deno.env.get("ADMIN_CHAT_ID") ?? "5870771695",
        certFilename,
        certBytes,
        `🎓 Certificate issued for: ${student.full_name}\nCountry: ${student.country}\nEmail: ${student.email}`
      );

      await recordStepCompletion(student.id, 4, 5, true, "Certificate generated");
      await advanceStep(student.id, 4, 6, {
        certificate_issued: true,
        certificate_issued_at: new Date().toISOString(),
      });

      // Grand finale
      await new Promise((r) => setTimeout(r, 2000));
      await sendGrandFinale(student, chatId);
    } catch (e) {
      console.error("Certificate generation error:", e);
      await typeMessage(chatId, `Small hiccup with the certificate — please send your signature photo again 📸`);
    }
  } else {
    // Not a signature — gently ask again
    await typeMessage(chatId, `I need a photo of your <b>handwritten signature</b> on paper 📝\n\nJust sign your name on any paper, take a photo, and drop it here — I'll use it for your certificate! ✍️`);
  }
}

// Step 6: Grand finale (already handled in step 5, but catch any messages)
async function handleStep6(student: Student, chatId: number, text: string | null, photo: { bytes: Uint8Array; mimeType: string } | null): Promise<void> {
  if (photo) {
    const guidance = await geminiVisionGuide(
      photo.bytes,
      photo.mimeType,
      `Student has COMPLETED the full EEM26 program — Day 4 is done! They have two live sales pages, Selar, Payhip (${student.payhip_link ?? "linked"}), their own AI bot, and a certificate. They are now a full EEM26 graduate. Celebrate what you can see and answer any questions.`,
      text ?? undefined
    );
    await sendMessage(chatId, guidance);
    return;
  }
  if (text) {
    const history = await getRecentConversation(student.id, 6);
    const reply = await geminiChat(history, text,
      `This student has COMPLETED the full EEM26 program! They have:
- Two live sales pages (normal: ${student.sales_page_link}, premium: ${student.github_repo_premium})
- A Selar account and Payhip store (${student.payhip_link})
- Their own AI sales bot running 24/7
- A certificate of completion

Celebrate with them! Answer any questions they have about growing their business, getting more sales, sharing their pages, etc. Be warm, fun and encouraging. They're now a full EEM26 member! 🎉`,
      student.id
    );
    await sendMessage(chatId, reply);
  }
}

async function sendGrandFinale(student: Student, chatId: number): Promise<void> {
  // Set day 4 complete
  await updateStudent(student.id, {
    day4_completed_at: new Date().toISOString(),
    status: "COMPLETED",
  });

  await typeMessage(chatId, `<b>🎓 CONGRATULATIONS, ${student.full_name?.toUpperCase() ?? "CHAMPION"}! 🎓</b>\n\nYou did something most people only talk about — you actually showed up and BUILT it. 💪 Na you be champion!! 🏆`);
  await typeMessage(chatId, `Everything from your Tech Stack 📦 is now LIVE and working for you:\n✅ Two live sales pages (GitHub Pages)\n✅ Selar store — accepting orders\n✅ Payhip affiliate — earning commissions\n✅ Your own AI sales bot (SRE) — running 24/7\n✅ Official EEM26 Certificate of Completion`);
  await typeMessage(chatId, `<b>Welcome to the EEM26 family. Now go make money! 🔥</b>\n\nAsk me anything, any time — I dey here for you! 💪`);

  await notifyAdmin(
    `🏆 <b>PROGRAM COMPLETE — CERTIFICATE ISSUED</b>\n\nStudent: ${student.full_name}\nCountry: ${student.country}\nEmail: ${student.email}\n\n🌐 Normal page: ${student.sales_page_link ?? "N/A"}\n💎 Premium page: ${student.github_repo_premium ?? "N/A"}\n🛒 Payhip: ${student.payhip_link ?? "N/A"}\n🤖 Bot: ${student.bot_token ? "✅ deployed" : "❌"}`
  );
}

async function handleFailed(
  student: Student,
  chatId: number,
  reason: string,
  retryMsg: string,
  photo?: { bytes: Uint8Array; mimeType: string } | null,
  stepContext?: string
): Promise<void> {
  if (reason === "verification_unavailable") {
    await sendMessage(chatId, "Photo check had a small hiccup 😊 — please send that screenshot again!");
    return;
  }
  const attempts = student.screenshot_attempts + 1;
  await incrementScreenshotAttempts(student.id, student.screenshot_attempts);
  if (attempts >= 5) {
    await resetScreenshotAttempts(student.id);
    await notifyAdmin(`⚠️ <b>STUDENT STUCK — 5 ATTEMPTS</b>\nName: ${student.full_name}\nDay: 4, Step: ${student.current_step}\n\nAmara has guided ${attempts} times without success.\nLast screenshot: ${reason}\n\nManual help may be needed.`);
  }

  if (photo && stepContext) {
    const guidance = await geminiVisionGuide(photo.bytes, photo.mimeType, stepContext);
    await sendMessage(chatId, guidance);
  } else {
    const history = await getRecentConversation(student.id, 3);
    const reply = await geminiChat(
      history,
      `[screenshot analysis]`,
      `Student sent a screenshot that wasn't correct. Here is what the screenshot actually shows: "${reason}". Here is what they need to do: "${retryMsg}".
In Amara's warm, friendly style: tell the student EXACTLY what you can see in their screenshot (be specific about what page/screen it is), then give them PRECISE step-by-step instructions on what to click or do next to get to the right place. Don't be generic — be like a friend looking at their phone screen and guiding them.`,
      student.id
    );
    await sendMessage(chatId, reply);
  }
}
