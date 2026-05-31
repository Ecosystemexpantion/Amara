import { sendMessage, sendChatAction } from "./telegram.ts";
import { updateStudent, advanceStep, getRecentConversation } from "./db.ts";
import { notifyAdmin } from "./admin.ts";
import type { Student, TelegramMessage } from "./types.ts";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[\+\d\s\-\(\)]{7,25}$/;

export async function handleOnboarding(
  _msg: TelegramMessage,
  student: Student,
  chatId: number,
  text: string | null
): Promise<void> {
  await sendChatAction(chatId, "typing");

  if (student.current_step !== 1 && (!text || text.trim().length < 1)) {
    await sendMessage(chatId, "Send me a text message — no photos or files needed right now 😊");
    return;
  }

  const t = text?.trim() ?? "";

  switch (student.current_step) {
    case 1: {
      // Use conversation history to detect if intro was already sent
      const history = await getRecentConversation(student.id, 3);
      const introAlreadySent = history.some((h) => h.role === "assistant");

      if (!introAlreadySent) {
        // First ever message — send intro
        await sendMessage(
          chatId,
          `Hey! I'm <b>Amara</b>, your personal EEM26 setup coach 🎉\n\nI'll be with you every single step for the next 4 days until your business is fully running. This is going to be an amazing journey!\n\nFirst things first — what's your <b>full name</b>? (Your real name, as it will appear on your certificate 🎓)`
        );
        return;
      }

      // They replied after intro — save as name
      if (!t || t.length < 2) {
        await sendMessage(chatId, "What's your full name? 😊 (Just type it for me)");
        return;
      }

      await updateStudent(student.id, { full_name: t, current_step: 2 });
      await sendMessage(
        chatId,
        `Beautiful name, <b>${t}</b>! Welcome 👑\n\nNow, what's your <b>email address</b>? I'll use it for your program records.`
      );
      break;
    }

    case 2: {
      if (!EMAIL_RE.test(t)) {
        await sendMessage(
          chatId,
          `Hmm, that doesn't look like a valid email 🤔\nTry again — something like: <code>yourname@gmail.com</code>`
        );
        return;
      }
      await updateStudent(student.id, { email: t, current_step: 3 });
      await sendMessage(
        chatId,
        `Got it! ✅\n\nNow your <b>phone number</b> please? Include your country code — e.g. <code>+2348012345678</code>`
      );
      break;
    }

    case 3: {
      if (!PHONE_RE.test(t)) {
        await sendMessage(
          chatId,
          `That doesn't look like a phone number 🤔\nSend it with your country code, like: <code>+2348012345678</code>`
        );
        return;
      }
      await updateStudent(student.id, { phone: t, current_step: 4 });
      await sendMessage(chatId, `Perfect! ✅ Last one — which <b>country</b> are you from? 🌍`);
      break;
    }

    case 4: {
      if (!t) {
        await sendMessage(chatId, "Which country are you from? 🌍");
        return;
      }
      // Save country and advance to Day 1
      await updateStudent(student.id, { country: t });

      // Get the saved student data for admin notification
      const updatedStudent = { ...student, country: t };

      // Notify admin of new student registration
      await notifyAdmin(
        `🆕 <b>NEW STUDENT REGISTERED</b>\n\nName: ${updatedStudent.full_name}\nEmail: ${updatedStudent.email}\nPhone: ${updatedStudent.phone}\nCountry: ${t}`
      );

      // Transition to Day 1
      await advanceStep(student.id, 1, 1, {});

      await sendMessage(
        chatId,
        `<b>Perfect! Everything is set. Welcome to EEM26, ${updatedStudent.full_name ?? ""}! 🎉</b>\n\nYour 4-day setup program starts RIGHT NOW. Let's go! 👇`
      );

      await new Promise((r) => setTimeout(r, 800));

      // Start Day 1 immediately
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
