import { sendMessage, sendChatAction } from "./telegram.ts";
import { updateStudent, advanceStep, getRecentConversation } from "./db.ts";
import { geminiChat } from "./gemini.ts";
import { notifyAdmin } from "./admin.ts";
import type { Student, TelegramMessage } from "./types.ts";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[\+\d\s\-\(\)]{7,25}$/;

// Extract a real name from natural language like "My name is Victor" → "Victor"
function extractName(text: string): string | null {
  const greetings = /^(hello|hi|hey|good morning|good evening|good afternoon|ok|okay|yes|no|sure|start|begin|help|test|ping|hm+|lol|😊|👋)$/i;
  if (greetings.test(text.trim())) return null;

  const patterns = [
    /(?:my name is|i'?m called|call me|i am|i'm|name is|they call me)\s+([A-Za-z][A-Za-z\s]{1,50})/i,
    /^([A-Za-z][A-Za-z\s]{1,50})$/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const name = match[1].trim();
      if (name.split(" ").length <= 5 && !greetings.test(name)) {
        return name;
      }
    }
  }
  return null;
}

export async function handleOnboarding(
  _msg: TelegramMessage,
  student: Student,
  chatId: number,
  text: string | null
): Promise<void> {
  await sendChatAction(chatId, "typing");

  if (student.current_step !== 1 && (!text || text.trim().length < 1)) {
    await sendMessage(chatId, "Send me a text message — no photos needed right now 😊");
    return;
  }

  const t = text?.trim() ?? "";

  switch (student.current_step) {
    case 1: {
      const history = await getRecentConversation(student.id, 5);
      const introAlreadySent = history.length > 1;

      if (!introAlreadySent) {
        await sendMessage(
          chatId,
          `Hey! I'm <b>Amara</b>, your personal EEM26 setup coach 🎉\n\nI'll be with you every single step for the next 4 days until your business is fully running. This is going to be an amazing journey!\n\nFirst things first — what's your <b>full name</b>? (Your real name, as it will appear on your certificate 🎓)`
        );
        return;
      }

      const extractedName = extractName(t);

      if (extractedName) {
        await updateStudent(student.id, { full_name: extractedName, current_step: 2 });
        await sendMessage(
          chatId,
          `Beautiful name, <b>${extractedName}</b>! Welcome 👑\n\nNow, what's your <b>email address</b>? I'll use it for your program records.`
        );
      } else {
        const reply = await geminiChat(
          history,
          t,
          "You just introduced yourself as Amara the EEM26 coach and asked the student for their full name. They replied with something that doesn't look like a name. Understand what they said, respond naturally and warmly, then ask again for their full name (exactly as it will appear on their certificate)."
        );
        await sendMessage(chatId, reply);
      }
      break;
    }

    case 2: {
      if (EMAIL_RE.test(t)) {
        await updateStudent(student.id, { email: t, current_step: 3 });
        await sendMessage(
          chatId,
          `Got it! ✅\n\nNow your <b>phone number</b> please? Include your country code — e.g. <code>+2348012345678</code>`
        );
      } else {
        const history = await getRecentConversation(student.id, 5);
        const reply = await geminiChat(
          history,
          t,
          `You are Amara collecting onboarding details. You already have the student's name: ${student.full_name}. You asked for their email address. They sent something that isn't a valid email. Understand what they said, respond naturally, and redirect them to share their email address. Be warm and helpful, not robotic.`
        );
        await sendMessage(chatId, reply);
      }
      break;
    }

    case 3: {
      if (PHONE_RE.test(t)) {
        await updateStudent(student.id, { phone: t, current_step: 4 });
        await sendMessage(chatId, `Perfect! ✅ Last one — which <b>country</b> are you from? 🌍`);
      } else {
        const history = await getRecentConversation(student.id, 5);
        const reply = await geminiChat(
          history,
          t,
          `You are Amara collecting onboarding details for ${student.full_name}. You asked for their phone number with country code (e.g. +2348012345678). They sent something that doesn't look like a phone number. Understand what they said and naturally redirect them to provide their phone number. Be warm, not robotic.`
        );
        await sendMessage(chatId, reply);
      }
      break;
    }

    case 4: {
      if (!t) {
        await sendMessage(chatId, "Which country are you from? 🌍");
        return;
      }
      await updateStudent(student.id, { country: t });
      const updatedStudent = { ...student, country: t };

      await notifyAdmin(
        `🆕 <b>NEW STUDENT REGISTERED</b>\n\nName: ${updatedStudent.full_name}\nEmail: ${updatedStudent.email}\nPhone: ${updatedStudent.phone}\nCountry: ${t}`
      );

      await advanceStep(student.id, 1, 1, {});

      await sendMessage(
        chatId,
        `<b>Perfect! Everything is set. Welcome to EEM26, ${updatedStudent.full_name ?? ""}! 🎉</b>\n\nYour 4-day setup program starts RIGHT NOW. Let's go! 👇`
      );

      await new Promise((r) => setTimeout(r, 800));
      await sendDay1Welcome(chatId);
      break;
    }

    default: {
      await updateStudent(student.id, { current_step: 1 });
      await sendMessage(chatId, "Hey! What's your full name to get started? 😊");
    }
  }
}

async function sendDay1Welcome(chatId: number): Promise<void> {
  await sendMessage(
    chatId,
    `<b>Welcome to Day 1! 🚀</b>\n\nToday is all about understanding your business — so you know exactly what you're building and WHY it works.\n\nThe EEM26 business model runs on 2 powerful systems:\n\n✅ <b>AAM (Automate and Attract Method)</b> — brings buyers to your DM automatically, no ads needed\n✅ <b>SRE (Smart Reply Engine)</b> — AI that handles your replies and closes sales even when you're sleeping\n\nYou're going to set ALL of this up over 4 days. By Day 4, you'll be earning. Let's go! 💪`
  );

  await new Promise((r) => setTimeout(r, 1000));

  await sendMessage(
    chatId,
    `Before we move to your first task — do you have any questions about how the business works?\n\nAsk me ANYTHING and I'll explain it. When you're ready to start your first task, just say <b>"ready"</b> 👊`
  );
}
