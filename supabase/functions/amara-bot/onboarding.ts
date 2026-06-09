import { sendMessage, sendChatAction, typeMessage } from "./telegram.ts";
import { updateStudent, advanceStep, getRecentConversation } from "./db.ts";
import { geminiChat } from "./gemini.ts";
import { notifyAdmin } from "./admin.ts";
import type { Student, TelegramMessage } from "./types.ts";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[\+\d\s\-\(\)]{7,25}$/;

function extractName(text: string): string | null {
  const greetings =
    /^(hello+|hi+|hey+|heyy+|hii+|yoo+|oya|good[\s-]*(morning|evening|afternoon|day|night)|gud[\s-]*(morning|evening|afternoon|day|night)|morning|evening|afternoon|ok+|okay|yes+|no+|sure|start|begin|help|test|ping|hm+|lol|😊|👋|how\s+are\s+(you|u)|whatsup|wassup|what\s*sup|am\s+ready|i\s+am\s+ready|i'm\s+ready|ready|just\s+checking|checking\s+in|what\s+is\s+this|what'?s\s+this|hello\s+dear|hi\s+there|hey\s+there|good\s+one)$/i;
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

function extractDeviceType(text: string): 'phone' | 'laptop' | null {
  const t = text.toLowerCase();
  if (/\b(phone|mobile|android|iphone|smartphone|handset|tab|tablet)\b/.test(t)) return 'phone';
  if (/\b(laptop|computer|pc|desktop|mac|macbook|windows|linux|chromebook)\b/.test(t)) return 'laptop';
  // Single-word shorthand
  if (/^(phone|mobile|lap|laptop|pc|computer|mac)$/.test(t.trim())) return t.trim() === 'phone' || t.trim() === 'mobile' ? 'phone' : 'laptop';
  return null;
}

function extractTechLevel(text: string): 'technical' | 'non_technical' | null {
  const t = text.toLowerCase();
  if (/\b(yes|technical|i know|comfortable|experience|dev|developer|it|software|engineer|know tech)\b/.test(t)) return 'technical';
  if (/\b(no|not technical|non.technical|beginner|newbie|novice|don.t know|no experience|not comfortable|basic|never)\b/.test(t)) return 'non_technical';
  // Short answers
  if (/^(yes|yep|yeah|yea|sure|technical|i do|i know)$/.test(t.trim())) return 'technical';
  if (/^(no|nope|nah|not really|not at all|non|no tech)$/.test(t.trim())) return 'non_technical';
  return null;
}

export async function handleOnboarding(
  _msg: TelegramMessage,
  student: Student,
  chatId: number,
  text: string | null
): Promise<void> {
  await sendChatAction(chatId, "typing");

  // Steps 1-4 require text; Steps 5-6 accept any text
  if (student.current_step < 5 && student.current_step !== 1 && (!text || text.trim().length < 1)) {
    await typeMessage(chatId, "Send me a text message — no photos needed right now 😊");
    return;
  }

  const t = text?.trim() ?? "";

  switch (student.current_step) {
    case 1: {
      const history = await getRecentConversation(student.id, 5);
      const introAlreadySent = history.length > 1;

      if (!introAlreadySent) {
        await typeMessage(chatId, `Hey!! I'm <b>Amara</b>, your personal EEM26 setup coach 🎉\n\nI'll be right here with you every single step for the next 4 days until your business is fully running.`);
        await typeMessage(chatId, `First things first — what's your <b>full name</b>? (Your real name, exactly as it will appear on your certificate 🎓)`);
        return;
      }

      const extractedName = extractName(t);

      if (extractedName) {
        await updateStudent(student.id, { full_name: extractedName, current_step: 2 });
        await typeMessage(chatId, `Beautiful name, <b>${extractedName}</b>! Welcome 👑\n\nNow, what's your <b>email address</b>? I'll use it for your program records.`);
      } else {
        const reply = await geminiChat(
          history, t,
          "You just introduced yourself as Amara the EEM26 coach and asked the student for their full name. They replied with something that doesn't look like a name. Respond in clear, warm English only — no Pidgin here. Acknowledge what they said naturally, then ask again for their full name exactly as it will appear on their certificate.",
          student.id
        );
        await sendMessage(chatId, reply);
      }
      break;
    }

    case 2: {
      if (EMAIL_RE.test(t)) {
        await updateStudent(student.id, { email: t, current_step: 3 });
        await typeMessage(chatId, `Got it! ✅\n\nNow your <b>phone number</b> please? Include your country code — e.g. <code>+2348012345678</code>`);
      } else {
        const history = await getRecentConversation(student.id, 5);
        const reply = await geminiChat(history, t,
          `You are Amara collecting onboarding details. You already have the student's name: ${student.full_name}. You asked for their email address. They sent something that isn't a valid email. Understand what they said, respond naturally, and redirect them to share their email address. Be warm and helpful, not robotic.`,
          student.id
        );
        await sendMessage(chatId, reply);
      }
      break;
    }

    case 3: {
      if (PHONE_RE.test(t)) {
        await updateStudent(student.id, { phone: t, current_step: 4 });
        await typeMessage(chatId, `Perfect! ✅ Last one — which <b>country</b> are you from? 🌍`);
      } else {
        const history = await getRecentConversation(student.id, 5);
        const reply = await geminiChat(history, t,
          `You are Amara collecting onboarding details for ${student.full_name}. You asked for their phone number with country code (e.g. +2348012345678). They sent something that doesn't look like a phone number. Understand what they said and naturally redirect them to provide their phone number. Be warm, not robotic.`,
          student.id
        );
        await sendMessage(chatId, reply);
      }
      break;
    }

    case 4: {
      if (!t) {
        await typeMessage(chatId, "Which country are you from? 🌍");
        return;
      }
      await updateStudent(student.id, { country: t });

      await notifyAdmin(
        `🆕 <b>NEW STUDENT REGISTERED</b>\n\nName: ${student.full_name}\nEmail: ${student.email}\nPhone: ${student.phone}\nCountry: ${t}`
      );

      // Stay on day 0, move to step 5 (online commitment + device question)
      await advanceStep(student.id, 0, 5, {});

      await typeMessage(chatId, `<b>Welcome to EEM26, ${student.full_name ?? ""}! 🎉</b>\n\nBefore we start — one important thing.`);
      await new Promise((r) => setTimeout(r, 300));
      await typeMessage(chatId, `⚠️ <b>This 4-day setup requires YOU to be online each day.</b>\n\nEverything is done right here on Telegram — only you have access to your phone. I can only guide you if you're here with me, following each step as I give it.\n\n✅ Stay online each day when Day 2, 3 and 4 unlock\n✅ Have your device charged and connected\n✅ Follow my steps one by one — don't skip ahead`);
      await new Promise((r) => setTimeout(r, 400));
      await typeMessage(chatId, `Quick question — are you doing this setup on a <b>📱 phone</b> or a <b>💻 laptop/computer</b>?`);
      break;
    }

    case 5: {
      // Collect device type
      if (!t) {
        await typeMessage(chatId, "Are you on a 📱 phone or a 💻 laptop/computer?");
        return;
      }

      const device = extractDeviceType(t);

      if (device) {
        await updateStudent(student.id, { device_type: device, current_step: 6 });
        const deviceLabel = device === 'phone' ? 'phone 📱' : 'laptop/computer 💻';
        await typeMessage(chatId, `Got it — ${deviceLabel}! I'll make sure all my instructions are written exactly for your setup 👌`);
        await typeMessage(chatId, `One more quick question — how comfortable are you with technology?\n\n👨‍💻 <b>Technical</b> — I've created accounts, uploaded files, used apps\n🌱 <b>Non-technical</b> — I'm a beginner, explain every step clearly\n\nWhich one are you?`);
      } else {
        const history = await getRecentConversation(student.id, 4);
        const reply = await geminiChat(history, t,
          `You are Amara doing onboarding for ${student.full_name}. You asked whether they're using a phone or a laptop/computer for the EEM26 4-day business setup. Their answer wasn't clear. Respond naturally and ask again — are they on a phone or laptop?`,
          student.id
        );
        await sendMessage(chatId, reply);
      }
      break;
    }

    case 6: {
      // Collect tech level
      if (!t) {
        await typeMessage(chatId, "Are you comfortable with tech, or would you like me to explain every step? 😊");
        return;
      }

      const techLevel = extractTechLevel(t);

      if (techLevel) {
        await updateStudent(student.id, { tech_level: techLevel });
        // Now advance to Day 1
        await advanceStep(student.id, 1, 1, {});

        if (techLevel === 'non_technical') {
          await typeMessage(chatId, `No problem at all! 🌱 That's exactly why I'm here — I'll explain every single click and you won't miss a step. You're in safe hands! 💪`);
        } else {
          await typeMessage(chatId, `Perfect — I'll keep instructions clear and efficient. You've got this! 💪`);
        }

        await new Promise((r) => setTimeout(r, 300));
        await sendDay1Welcome(chatId, student.device_type ?? 'unknown', techLevel);
      } else {
        const history = await getRecentConversation(student.id, 4);
        const reply = await geminiChat(history, t,
          `You are Amara doing onboarding for ${student.full_name}. You asked whether they're technical or non-technical (beginner). Their answer wasn't clear. Respond naturally and ask again — are they comfortable with tech, or are they a beginner who needs every step explained?`,
          student.id
        );
        await sendMessage(chatId, reply);
      }
      break;
    }

    default: {
      await updateStudent(student.id, { current_step: 1 });
      await typeMessage(chatId, "Hey! What's your full name to get started? 😊");
    }
  }
}

async function sendDay1Welcome(chatId: number, deviceType: string, techLevel: string): Promise<void> {
  await typeMessage(chatId, `<b>Welcome to Day 1! 🚀</b>\n\nToday is all about understanding your business — so you know EXACTLY what you're building and why it works.`);

  await typeMessage(chatId, `The EEM26 model runs on 2 powerful systems:\n\n✅ <b>AAM (Automate and Attract Method)</b> — brings buyers to your DM automatically, no ads needed\n✅ <b>SRE (Smart Reply Engine)</b> — AI that closes sales even while you sleep`);

  const deviceNote = deviceType === 'phone'
    ? `\n\n📱 <b>Phone users:</b> I'll always tell you exactly where to tap and how to save files from Telegram when needed.`
    : deviceType === 'laptop'
    ? `\n\n💻 <b>Laptop users:</b> I'll give you drag-and-drop and click instructions throughout.`
    : "";

  await typeMessage(chatId, `You're setting ALL of this up over 4 days. By Day 4 you'll be earning 💪${deviceNote}\n\nAny questions about how the business works? Ask me anything! When you're ready to start your first task just say <b>"ready"</b> 👊`);
}
