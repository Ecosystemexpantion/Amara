import { sendMessage, sendChatAction, sendDocument } from "./telegram.ts";
import { advanceStep, updateStudent, incrementScreenshotAttempts, resetScreenshotAttempts, recordStepCompletion, getRecentConversation } from "./db.ts";
import { geminiVision, geminiChat, buildVerificationPrompt } from "./gemini.ts";
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
    default: await sendMessage(chatId, "We're almost at the finish line! Send me that screenshot 📸");
  }
}

// Step 1: Set environment variables in Supabase
async function handleStep1(student: Student, chatId: number, text: string | null, photo: { bytes: Uint8Array; mimeType: string } | null): Promise<void> {
  const envVarInstructions = `<b>Step 1 — Set your bot's environment variables</b>\n\nIn your Supabase project:\n1️⃣ Click <b>Edge Functions</b> in the left menu\n2️⃣ Click on your <b>my-bot</b> function\n3️⃣ Click <b>Secrets</b> (or <b>Environment variables</b>)\n4️⃣ Add these variables one by one:\n\n<code>BOT_TOKEN</code> = (the token from BotFather you gave me)\n<code>GEMINI_API_KEY</code> = (your Google AI Studio key)\n<code>SUPABASE_URL</code> = (already auto-set, but add if needed)\n<code>SUPABASE_SERVICE_ROLE_KEY</code> = (from Settings → API → service_role key)\n\nSend me a screenshot when the variables are set 📸`;

  if (!photo) {
    if (text) {
      const history = await getRecentConversation(student.id, 6);
      const reply = await geminiChat(history, text, `Student is on Day 4 Step 1. They need to set environment variables in their Supabase Edge Function:
- BOT_TOKEN: their Telegram bot token (${student.bot_token ? "already collected: " + student.bot_token.slice(0, 15) + "..." : "need to add"})
- GEMINI_API_KEY: from Google AI Studio (aistudio.google.com)
- SUPABASE_URL: auto-injected usually
- SUPABASE_SERVICE_ROLE_KEY: from Supabase Settings → API → service_role`, student.id);
      await sendMessage(chatId, reply);
    } else {
      await sendMessage(chatId, envVarInstructions);
    }
    return;
  }

  const prompt = buildVerificationPrompt("Does this screenshot show Supabase Edge Function environment variables or secrets being set? Look for a secrets/environment panel with key-value inputs.");
  const result = await geminiVision(photo.bytes, photo.mimeType, prompt);

  if (result.verified) {
    await recordStepCompletion(student.id, 4, 1, true);
    await advanceStep(student.id, 4, 2);
    await sendMessage(
      chatId,
      `Environment variables set! ✅\n\nNow let's connect your bot to Telegram by setting the <b>webhook</b>.\n\nRun this command (replace YOUR_PROJECT_REF with your Supabase project reference):\n\n<code>curl -X POST "https://api.telegram.org/bot${student.bot_token?.slice(0, 20) ?? "YOUR_BOT_TOKEN"}...YOUR_BOT_TOKEN/setWebhook" -H "Content-Type: application/json" -d '{"url": "https://YOUR_PROJECT_REF.supabase.co/functions/v1/my-bot"}'</code>\n\nOr just send me the word <b>"done"</b> if you've already set it up — I'll walk you through it! 😊`
    );
  } else {
    await handleFailed(student, chatId, result.reason, "Go to Supabase → Edge Functions → your function → Secrets/Environment Variables, set them, then screenshot 📸");
  }
}

// Step 2: Set webhook
async function handleStep2(student: Student, chatId: number, text: string | null, photo: { bytes: Uint8Array; mimeType: string } | null): Promise<void> {
  const doneWords = /\b(done|set|connected|webhook|ok|okay|ready|yes|complete|finished)\b/i;

  if (text && doneWords.test(text)) {
    await recordStepCompletion(student.id, 4, 2, false, "Student confirmed webhook set");
    await advanceStep(student.id, 4, 3);
    await sendMessage(
      chatId,
      `Webhook confirmed! 🔗\n\nNow the REAL test — send a message to YOUR bot!\n\n1️⃣ Open Telegram\n2️⃣ Search for your bot's username (the one you created on Day 3)\n3️⃣ Send it a message — anything!\n4️⃣ Your bot should reply!\n\nSend me a screenshot of the conversation showing your bot responding 📸`
    );
    return;
  }

  if (photo) {
    const prompt = buildVerificationPrompt("Does this screenshot show a webhook confirmation response or a terminal/command output showing webhook was set successfully?");
    const result = await geminiVision(photo.bytes, photo.mimeType, prompt);

    if (result.verified) {
      await recordStepCompletion(student.id, 4, 2, true);
      await advanceStep(student.id, 4, 3);
      await sendMessage(
        chatId,
        `Webhook set! 🎯\n\nNow open Telegram, find your bot and send it a message. It should reply!\n\nSend me a screenshot showing your bot responding 📸`
      );
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
    await sendMessage(chatId, "Set your Telegram webhook and send me a screenshot, or just say <b>\"done\"</b> when it's set! 🔗");
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
      await sendMessage(chatId, "Open your bot on Telegram, send it a message, and send me a screenshot of it replying 📸");
    }
    return;
  }

  const prompt = buildVerificationPrompt("Does this screenshot show a Telegram chat conversation where a bot is replying to messages? Look for a bot account responding with text.");
  const result = await geminiVision(photo.bytes, photo.mimeType, prompt);

  if (result.verified) {
    await recordStepCompletion(student.id, 4, 3, true);
    await advanceStep(student.id, 4, 4);
    await sendMessage(
      chatId,
      `<b>YOUR BOT IS LIVE! 🔥🔥🔥</b>\n\nI can see it responding! Your Smart Reply Engine is RUNNING! 💪\n\n✅ Bot token — connected\n✅ Database — live\n✅ Webhook — set\n✅ Bot is replying — CONFIRMED\n\nThis is YOUR AI working for you 24/7 from this moment. Every person who messages your bot will be handled automatically. Money on autopilot! 🤖💰`
    );
    await new Promise((r) => setTimeout(r, 1500));
    await handleStep4Celebration(student, chatId);
  } else {
    await handleFailed(student, chatId, result.reason, "Open your bot on Telegram, send it a test message, and send me a screenshot of it replying 📸");
  }
}

async function handleStep4Celebration(student: Student, chatId: number): Promise<void> {
  await advanceStep(student.id, 4, 5);
  await sendMessage(
    chatId,
    `Now — the final moment. Your <b>Certificate of Completion! 🎓</b>\n\nI need one last thing from you.\n\nPlease <b>sign your name</b> on a plain white paper, take a <b>clear photo</b> of just the signature, and send it to me.\n\nI'll add it to your official EEM26 certificate to make it real! ✍️`
  );
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
      await sendMessage(
        chatId,
        `I need a <b>photo of your signature</b> — sign your name on white paper and take a clear photo, then send it to me 📸\n\nThis goes on your official certificate! ✍️`
      );
    }
    return;
  }

  // Verify it looks like a signature
  const prompt = buildVerificationPrompt("Does this photo show a handwritten signature or name written on paper? It doesn't need to be on white paper — any clear handwriting/signature counts.");
  const result = await geminiVision(photo.bytes, photo.mimeType, prompt);

  if (result.verified) {
    await sendChatAction(chatId, "upload_document");
    await sendMessage(chatId, `Got your signature! ✍️ Generating your certificate now... 🎓`);

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
      await sendMessage(
        chatId,
        `Certificate is being generated! There was a small hiccup — please try sending your signature photo again 📸`
      );
    }
  } else {
    // Not a signature — gently ask again
    await sendMessage(
      chatId,
      `I need a photo of your <b>handwritten signature</b> on paper 📝\n\nJust sign your name on any paper, take a photo, and send it to me — I'll use it for your certificate! ✍️`
    );
  }
}

// Step 6: Grand finale (already handled in step 5, but catch any messages)
async function handleStep6(student: Student, chatId: number, text: string | null, _photo: { bytes: Uint8Array; mimeType: string } | null): Promise<void> {
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

  await sendMessage(
    chatId,
    `<b>🎓 CONGRATULATIONS, ${student.full_name?.toUpperCase() ?? "CHAMPION"}! 🎓</b>\n\nYour official EEM26 Certificate of Completion is DONE!\n\nYou did something most people only talk about — you actually showed up and BUILT it. 💪\n\nYou now have:\n✅ Two live sales pages\n✅ A Selar store\n✅ A Payhip store\n✅ Your own AI sales bot running 24/7\n✅ Official EEM26 Certificate\n\n<b>Welcome to the EEM26 family. Now go make money! 🔥</b>`
  );

  await notifyAdmin(
    `🏆 <b>PROGRAM COMPLETE — CERTIFICATE ISSUED</b>\n\nStudent: ${student.full_name}\nCountry: ${student.country}\nEmail: ${student.email}\n\n🌐 Normal page: ${student.sales_page_link ?? "N/A"}\n💎 Premium page: ${student.github_repo_premium ?? "N/A"}\n🛒 Payhip: ${student.payhip_link ?? "N/A"}\n🤖 Bot: ${student.bot_token ? "✅ deployed" : "❌"}`
  );
}

async function handleFailed(student: Student, chatId: number, reason: string, retryMsg: string): Promise<void> {
  if (reason === "verification_unavailable") {
    await sendMessage(chatId, "Photo check had a small hiccup 😊 — please send that screenshot again!");
    return;
  }
  const attempts = student.screenshot_attempts + 1;
  if (attempts >= 3) {
    await resetScreenshotAttempts(student.id);
    await notifyAdmin(`⚠️ <b>STUDENT STUCK</b>\nName: ${student.full_name}\nDay: 4, Step: ${student.current_step}\nReason: ${reason}`);
    await sendMessage(chatId, `No wahala! Let me explain it a different way 😊\n\n${retryMsg}`);
  } else {
    await incrementScreenshotAttempts(student.id, student.screenshot_attempts);
    await sendMessage(chatId, `Hmm, that's not quite it — no worries! 😊\n\nTry again: ${retryMsg}`);
  }
}
