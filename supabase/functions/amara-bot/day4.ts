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

  // New 4-step Day 4 (bot deploy is now automated in Day 3):
  // Step 1: Test bot is responding → screenshot
  // Step 2: Celebration bridge → auto-advance + prompt signature
  // Step 3: Collect handwritten signature photo
  // Step 4: Certificate + grand finale
  switch (student.current_step) {
    case 1: await handleStep1(student, chatId, text, photo); break;
    case 2: await handleStep2(student, chatId, text, photo); break;
    case 3: await handleStep3(student, chatId, text, photo); break;
    case 4: await handleStep4(student, chatId, text, photo); break;
    default: await typeMessage(chatId, "We're at the finish line! Send me that screenshot 📸");
  }
}

// Step 1: Test that the student's bot is responding
async function handleStep1(student: Student, chatId: number, text: string | null, photo: { bytes: Uint8Array; mimeType: string } | null): Promise<void> {
  if (!photo) {
    if (text) {
      const history = await getRecentConversation(student.id, 6);
      const botName = student.bot_token ? "your bot" : "your EEM26 bot";
      const reply = await geminiChat(
        history,
        text,
        `Student is on Day 4 Step 1. They need to test their Telegram bot by opening it and sending it a message, then send a screenshot showing the bot replying. Amara already set the bot up automatically — they just need to find it on Telegram and test it. The bot is ${botName}.`,
        student.id
      );
      await sendMessage(chatId, reply);
    } else {
      await typeMessage(
        chatId,
        `<b>🚀 Day 4 — Final Day!</b>\n\nYour bot is already live and running 24/7 from your Tech Stack 📦 — I set it all up yesterday!\n\nNow let's confirm it's working. Open Telegram, find your bot (search for its username), send it any message, and send me a screenshot of it replying 📸`
      );
      await typeMessage(
        chatId,
        `⚠️ <b>IMPORTANT — Final Stage Setup with Coach Victor!</b>\n\nCoach Victor holds a <b>live group session every Saturday at 8:30 PM Nigeria time</b> for your final stage setup.\n\n👉 <a href="https://t.me/+kU414VXm1N0zYjQ8">Join the group here</a>\n\n⚠️ If you miss it, you wait another full week! Join the group now so you don't miss it 🔥`
      );
    }
    return;
  }

  const prompt = buildVerificationPrompt(
    "Does this screenshot show a Telegram chat where a bot is replying to messages? Look for a bot account (bot icon or name ending in Bot) responding with text."
  );
  const result = await geminiVision(photo.bytes, photo.mimeType, prompt);

  if (result.verified) {
    await recordStepCompletion(student.id, 4, 1, true);
    // Advance directly to step 3 (signature) — skipping the bridge step entirely.
    // Advancing to step 2 first caused a race: if the student immediately sent their
    // signature photo, handleStep2 would fire (ignoring the photo) and ask for it again.
    await advanceStep(student.id, 4, 3);

    await typeMessage(chatId, `<b>YOUR BOT IS CONFIRMED LIVE! 🔥🔥🔥</b>\n\nI can see it responding perfectly! Your SRE — Smart Reply Engine from your Tech Stack 📦 — is RUNNING and making money for you 24/7!`);
    await typeMessage(chatId, `✅ GitHub Pages — 2 live sales pages\n✅ Selar store — accepting orders\n✅ Payhip affiliate — earning commissions\n✅ AI sales bot — running 24/7\n\nNow there's just ONE last step... 👇`);
    await new Promise((r) => setTimeout(r, 300));
    await sendCertificateRequest(chatId);
  } else {
    await handleFailed(
      student, chatId, result.reason,
      result.guidance || "Open Telegram, find your bot by username, send it a message, screenshot the reply 📸",
      photo,
      `Student is on Day 4. Their Telegram bot was set up automatically and should be running. They need to open Telegram, find their bot (search for its username from BotFather), send it any message, and screenshot the bot's reply. If they can't find the bot, ask them to search for the username they chose during Day 3.`
    );
  }
}

// Step 2: Celebration bridge — auto-advances and requests signature
async function handleStep2(student: Student, chatId: number, _text: string | null, _photo: { bytes: Uint8Array; mimeType: string } | null): Promise<void> {
  await advanceStep(student.id, 4, 3);
  await sendCertificateRequest(chatId);
}

async function sendCertificateRequest(chatId: number): Promise<void> {
  await typeMessage(chatId, `<b>🎓 Your Certificate of Completion!</b>`);
  await typeMessage(
    chatId,
    `One final thing — please <b>sign your name</b> on plain paper, take a <b>clear photo</b> of just the signature, and send it to me ✍️\n\nI'll embed it in your official EEM26 Certificate!`
  );
}

// Step 3: Collect student signature
async function handleStep3(student: Student, chatId: number, text: string | null, photo: { bytes: Uint8Array; mimeType: string } | null): Promise<void> {
  if (!photo) {
    if (text) {
      await typeMessage(
        chatId,
        `I need a <b>photo of your handwritten signature</b> on paper ✍️\n\nSign your name on any paper, take a clear photo, and drop it here — I'll add it to your official certificate! 📝`
      );
    }
    return;
  }

  const prompt = buildVerificationPrompt(
    "Does this photo show a handwritten signature or name written on paper? Any clear handwriting/signature on paper counts — it doesn't need to be on white paper."
  );
  const result = await geminiVision(photo.bytes, photo.mimeType, prompt);

  if (result.verified) {
    await sendChatAction(chatId, "upload_document");
    await typeMessage(chatId, `Got your signature! ✍️ Generating your certificate now... 🎓`);

    try {
      const certBytes = await generateCertificate(student, photo.bytes, photo.mimeType);
      const certFilename = `${(student.full_name ?? "Student").replace(/\s+/g, "_")}_EEM26_Certificate.pdf`;

      await sendDocument(chatId, certFilename, certBytes, `🎓 Your official EEM26 Certificate of Completion!`);

      await sendDocument(
        Deno.env.get("ADMIN_CHAT_ID") ?? "5870771695",
        certFilename,
        certBytes,
        `🎓 Certificate issued for: ${student.full_name}\nCountry: ${student.country}\nEmail: ${student.email}`
      );

      await recordStepCompletion(student.id, 4, 3, true, "Certificate generated");
      await advanceStep(student.id, 4, 4, {
        certificate_issued: true,
        certificate_issued_at: new Date().toISOString(),
      });

      await new Promise((r) => setTimeout(r, 2000));
      await sendGrandFinale(student, chatId);
    } catch (e) {
      console.error("Certificate generation error:", e);
      await typeMessage(chatId, `Small hiccup with the certificate — please send your signature photo again 📸`);
    }
  } else {
    await typeMessage(
      chatId,
      `I need a photo of your <b>handwritten signature</b> on paper 📝\n\nJust sign your name on any paper, take a photo, and drop it here — I'll use it for your certificate! ✍️`
    );
  }
}

// Step 4: Grand finale catch-all (certificate already sent in step 3)
async function handleStep4(student: Student, chatId: number, text: string | null, photo: { bytes: Uint8Array; mimeType: string } | null): Promise<void> {
  if (photo) {
    const guidance = await geminiVisionGuide(
      photo.bytes,
      photo.mimeType,
      `This student is an EEM26 graduate. They may be sending you ANY type of image — look carefully at what is ACTUALLY visible in the photo and describe only what you genuinely see. Do not assume it is a website, dashboard, or business screenshot. It could be a document, signature, photo, or anything else. If you see handwriting or a signature, acknowledge that. Respond helpfully based on what is truly in the image.`,
      text ?? undefined
    );
    await sendMessage(chatId, guidance);
    return;
  }
  if (text) {
    const history = await getRecentConversation(student.id, 6);
    const reply = await geminiChat(
      history,
      text,
      `This student has COMPLETED the full EEM26 4-day program. They are a graduate! 🎓
Their setup:
- Two live GitHub Pages sales pages: ${student.sales_page_link ?? "live"} and ${student.github_repo_premium ?? "live"}
- Payhip store: ${student.payhip_link ?? "active"}
- AI sales bot: running 24/7 from their Tech Stack
- Certificate: issued ✅
Celebrate with them and answer any questions about growing their business!`,
      student.id
    );
    await sendMessage(chatId, reply);
  } else {
    await typeMessage(chatId, `You're an EEM26 graduate! 🎓 Your business is fully set up and running. Ask me anything about growing your sales! 💪`);
  }
}

async function sendGrandFinale(student: Student, chatId: number): Promise<void> {
  await updateStudent(student.id, {
    day4_completed_at: new Date().toISOString(),
    status: "COMPLETED",
  });

  await typeMessage(
    chatId,
    `<b>🎓 CONGRATULATIONS, ${student.full_name?.toUpperCase() ?? "CHAMPION"}! 🎓</b>\n\nYou did something most people only talk about — you actually showed up and BUILT it. 💪 Na you be champion!! 🏆`
  );
  await typeMessage(
    chatId,
    `Everything from your Tech Stack 📦 is now LIVE and working:\n✅ Two GitHub Pages sales pages — live\n✅ Selar store — accepting orders\n✅ Payhip affiliate — earning commissions\n✅ AI sales bot (SRE) — running 24/7, zero effort from you\n✅ Official EEM26 Certificate of Completion 🎓`
  );
  await typeMessage(
    chatId,
    `<b>Welcome to the EEM26 family. Now go make money! 🔥</b>`
  );
  await typeMessage(
    chatId,
    `🎯 <b>One last thing — your Final Stage Setup with Coach Victor!</b>\n\nEvery <b>Saturday at 8:30 PM Nigeria time</b>, Coach Victor holds a live session for EEM26 graduates.\n\n👉 <a href="https://t.me/+kU414VXm1N0zYjQ8">Join the group now</a>\n\n⚠️ Miss it and you wait another full week — don't miss it! 🏆`
  );
  await typeMessage(
    chatId,
    `I'll send you a morning reminder every day until you attend the session 📅 See you on Saturday! 💪`
  );

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
    await notifyAdmin(
      `⚠️ <b>STUDENT STUCK — 5 ATTEMPTS</b>\nName: ${student.full_name}\nDay: 4, Step: ${student.current_step}\n\nAmara has guided ${attempts} times without success.\nLast screenshot: ${reason}\n\nManual help may be needed.`
    );
  }

  if (photo && stepContext) {
    const guidance = await geminiVisionGuide(photo.bytes, photo.mimeType, stepContext);
    await sendMessage(chatId, guidance);
  } else {
    const history = await getRecentConversation(student.id, 3);
    const reply = await geminiChat(
      history,
      `[screenshot analysis]`,
      `Student sent a screenshot that wasn't correct. What the screenshot shows: "${reason}". What they need to do: "${retryMsg}". In Amara's warm style: tell them exactly what you can see, then give precise step-by-step instructions. Be like a friend looking at their screen.`,
      student.id
    );
    await sendMessage(chatId, reply);
  }
}
