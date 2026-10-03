import { sendMessage, sendChatAction, downloadFile, typeMessage } from "./telegram.ts";
import { saveConversation, getRecentConversation } from "./db.ts";
import { geminiAudio, geminiChat, geminiVideoTranscribe, geminiVisionGuide } from "./gemini.ts";
import { handleOnboarding } from "./onboarding.ts";
import { handleDay1, handleGate, isGated, isLegacyUnpaid, migrateLegacyToSre, isWaitingForNextDay, handleWaitingMessage } from "./day1.ts";
import { handleDay2 } from "./day2.ts";
import { handleDay3 } from "./day3.ts";
import { handleDay4 } from "./day4.ts";
import type { Student, TelegramMessage } from "./types.ts";

export async function routeMessage(
  msg: TelegramMessage,
  student: Student,
  chatId: number
): Promise<void> {
  // Day 2 is locked until Tech Stack payment proof — no typing indicator, no reply, no error fallback.
  if (isGated(student)) {
    try {
      await handleGate(msg, student, chatId);
    } catch (e) {
      console.error("handleGate error:", e);
    }
    return;
  }

  // Day finished, next one not open yet — no reply and no AI; the admin sees the message instead.
  if (isWaitingForNextDay(student)) {
    try {
      await handleWaitingMessage(msg, student);
    } catch (e) {
      console.error("handleWaitingMessage error:", e);
    }
    return;
  }

  let textPayload: string | null = null;
  let photoPayload: { bytes: Uint8Array; mimeType: string } | null = null;

  try {
    if (isLegacyUnpaid(student)) {
      await migrateLegacyToSre(student, chatId);
      return;
    }

    // Resolve message content
    if (msg.voice) {
      // Download and transcribe voice message
      await sendChatAction(chatId, "typing");
      try {
        const { bytes, mimeType } = await downloadFile(msg.voice.file_id);
        const transcribed = await geminiAudio(bytes, mimeType);
        if (transcribed) textPayload = `[Voice message] ${transcribed}`;
        // textPayload stays null if transcription returned empty (silent clip, background noise, etc.)
      } catch (e) {
        console.error("Voice transcription error:", e);
        await typeMessage(chatId, "I couldn't catch that voice note 😊 — just type it out for me and I'll respond!");
        return;
      }
    } else if (msg.photo && msg.photo.length > 0) {
      // Download the largest photo
      const largestPhoto = msg.photo[msg.photo.length - 1];
      try {
        photoPayload = await downloadFile(largestPhoto.file_id);
      } catch (e) {
        console.error("Photo download error:", e);
        await typeMessage(chatId, "I got your photo but couldn't open it 😊 — try sending it again!");
        return;
      }
      textPayload = msg.caption ?? null;
    } else if (msg.text) {
      textPayload = msg.text.trim();
    } else if (msg.video || msg.video_note) {
      // Screen recording or round video — transcribe speech only.
      // We do NOT pass video bytes as photoPayload because Gemini vision only accepts images,
      // not video inline_data. Handlers will ask for a screenshot if photo is required.
      const fileId = msg.video?.file_id ?? msg.video_note?.file_id;
      if (!fileId) return;
      await sendChatAction(chatId, "typing");
      try {
        const downloaded = await downloadFile(fileId);
        const transcript = await geminiVideoTranscribe(downloaded.bytes, downloaded.mimeType);
        if (transcript) {
          textPayload = `[Screen recording] ${transcript}`;
        } else {
          await typeMessage(chatId, "Got your recording! 📱 For this step I need a screenshot — just take one and send it to me 📸");
          return;
        }
      } catch (e) {
        console.error("Video processing error:", e);
        await typeMessage(chatId, "Couldn't process that video 😊 — try sending a screenshot instead 📸");
        return;
      }
    } else if (msg.document || msg.sticker) {
      await typeMessage(chatId, "Send me a text message or photo — that's all I need right now 😊");
      return;
    } else {
      return;
    }

    // Save user message to conversation history
    const displayText = textPayload ?? (photoPayload ? "[photo]" : "[media]");
    if (displayText !== "[media]") {
      await saveConversation(student.id, "user", displayText, msg.photo ? "photo" : msg.voice ? "voice" : (msg.video || msg.video_note) ? "video" : "text");
    }

    // Show typing indicator
    await sendChatAction(chatId, "typing");

    // Strip voice prefix for actual processing in handlers
    const cleanText = textPayload?.startsWith("[Voice message] ")
      ? textPayload.slice("[Voice message] ".length)
      : textPayload;

    // Route to day handler
    // Completed students get no reply — the cron sends daily Saturday session reminders
    if (student.status === "COMPLETED") return;

    switch (student.current_day) {
      case 0:
        await handleOnboarding(msg, student, chatId, cleanText);
        break;
      case 1:
        await handleDay1(msg, student, chatId, cleanText, photoPayload);
        break;
      case 2:
        await handleDay2(msg, student, chatId, cleanText, photoPayload);
        break;
      case 3:
        await handleDay3(msg, student, chatId, cleanText, photoPayload);
        break;
      case 4:
        await handleDay4(msg, student, chatId, cleanText, photoPayload);
        break;
      default:
        // Program complete
        await handleCompleted(student, chatId, cleanText, photoPayload);
    }
  } catch (e) {
    console.error("routeMessage error:", e);
    try {
      await typeMessage(chatId, "I dey here! Had a small hiccup — try again in a moment 😊");
    } catch (_) { /* ignore */ }
  }
}

// Program fully completed
async function handleCompleted(
  student: Student,
  chatId: number,
  text: string | null,
  photo: { bytes: Uint8Array; mimeType: string } | null = null
): Promise<void> {
  if (photo) {
    const guidance = await geminiVisionGuide(
      photo.bytes,
      photo.mimeType,
      `This student is an EEM26 graduate. Look carefully at what is ACTUALLY visible in this photo and describe only what you genuinely see — do not assume it is a website or dashboard. It could be a document, handwriting, screenshot, or anything else. Respond helpfully based only on what is truly in the image.`,
      text ?? undefined
    );
    await sendMessage(chatId, guidance);
    return;
  }
  if (text) {
    const history = await getRecentConversation(student.id, 8);
    const reply = await geminiChat(history, text,
      `This student has COMPLETED the full EEM26 4-day program. They are a graduate! 🎓
Their setup:
- Sales pages: ${student.sales_page_link ?? "live"} and ${student.github_repo_premium ?? "live"}
- Payhip store: ${student.payhip_link ?? "active"}
- AI sales bot: running 24/7
- Certificate: ${student.certificate_issued ? "issued ✅" : "pending"}

Answer their questions about growing their business, scaling sales, getting more traffic, etc. Be a supportive mentor.`,
      student.id
    );
    await sendMessage(chatId, reply);
  } else {
    await typeMessage(chatId, `You're an EEM26 graduate! 🎓 Your business is fully set up and running. Ask me anything about growing your sales! 💪`);
  }
}
