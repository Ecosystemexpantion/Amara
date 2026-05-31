import { sendMessage, sendChatAction, downloadFile } from "./telegram.ts";
import { saveConversation, getRecentConversation } from "./db.ts";
import { geminiAudio, geminiChat, geminiVideoTranscribe, geminiVisionGuide } from "./gemini.ts";
import { handleOnboarding } from "./onboarding.ts";
import { handleDay1 } from "./day1.ts";
import { handleDay2 } from "./day2.ts";
import { handleDay3 } from "./day3.ts";
import { handleDay4 } from "./day4.ts";
import type { Student, TelegramMessage } from "./types.ts";

export async function routeMessage(
  msg: TelegramMessage,
  student: Student,
  chatId: number
): Promise<void> {
  let textPayload: string | null = null;
  let photoPayload: { bytes: Uint8Array; mimeType: string } | null = null;

  try {
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
        await sendMessage(chatId, "I couldn't catch that voice note 😊 — just type it out for me and I'll respond!");
        return;
      }
    } else if (msg.photo && msg.photo.length > 0) {
      // Download the largest photo
      const largestPhoto = msg.photo[msg.photo.length - 1];
      photoPayload = await downloadFile(largestPhoto.file_id);
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
          await sendMessage(chatId, "Got your recording! 📱 For this step I need a screenshot — just take a screenshot and send it to me 📸");
          return;
        }
      } catch (e) {
        console.error("Video processing error:", e);
        await sendMessage(chatId, "Couldn't process that video 😊 — try sending a screenshot instead 📸");
        return;
      }
    } else if (msg.document || msg.sticker) {
      await sendMessage(chatId, "Send me a text message or photo — that's all I need right now 😊");
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

    // Check if student is waiting for next day to unlock
    if (student.current_step === 0 && student.current_day >= 1 && student.current_day <= 3) {
      await handleDayWait(student, chatId, cleanText, photoPayload);
      return;
    }

    // Route to day handler
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
      await sendMessage(chatId, "I dey here! Had a small hiccup — try again in a moment 😊");
    } catch (_) { /* ignore */ }
  }
}

// Student is between days — waiting for unlock
async function handleDayWait(
  student: Student,
  chatId: number,
  text: string | null,
  photo: { bytes: Uint8Array; mimeType: string } | null = null
): Promise<void> {
  const nextDay = student.current_day + 1;
  let unlockInfo = "tomorrow at 8AM Nigeria time";

  if (student.next_day_unlocks_at) {
    const unlockDate = new Date(student.next_day_unlocks_at);
    const nigeriaTime = new Date(unlockDate.getTime() + 60 * 60 * 1000);
    unlockInfo = `tomorrow at ${nigeriaTime.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} Nigeria time`;
  }

  if (photo) {
    const guidance = await geminiVisionGuide(
      photo.bytes,
      photo.mimeType,
      `Student has completed Day ${student.current_day} of the EEM26 program and is waiting for Day ${nextDay} to unlock at ${unlockInfo}. They may be reviewing something they set up or exploring. Guide them based on what you can see.`,
      text ?? undefined
    );
    await sendMessage(chatId, guidance);
    return;
  }

  if (text) {
    const history = await getRecentConversation(student.id, 6);
    const reply = await geminiChat(history, text,
      `The student has completed Day ${student.current_day} and is waiting for Day ${nextDay} to unlock at ${unlockInfo}.
They may have questions or just be chatting.
Answer warmly. If they have questions about the business or what's coming next, answer enthusiastically about what Day ${nextDay} involves.
Remind them their next day unlocks at ${unlockInfo} and tell them what exciting things are coming.`,
      student.id
    );
    await sendMessage(chatId, reply);
  } else {
    await sendMessage(
      chatId,
      `Hey! Your Day ${nextDay} unlocks ${unlockInfo}! ⏰\n\nI'll message you as soon as it's ready. Get some rest — Day ${nextDay} is going to be amazing! 🚀`
    );
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
      `Student is an EEM26 graduate — they completed the full 4-day program. Their setup: sales pages (${student.sales_page_link ?? "live"}), Payhip store (${student.payhip_link ?? "active"}), AI sales bot running 24/7. They may be showing you something about their business or asking for help with growth.`,
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
    await sendMessage(
      chatId,
      `You're an EEM26 graduate! 🎓 Your business is fully set up and running. Ask me anything about growing your sales! 💪`
    );
  }
}
