import { sendMessage, sendChatAction } from "./telegram.ts";
import { advanceStep, updateStudent, incrementScreenshotAttempts, resetScreenshotAttempts, recordStepCompletion, computeNextUnlockAt, getRecentConversation } from "./db.ts";
import { geminiVision, geminiChat, buildVerificationPrompt } from "./gemini.ts";
import { notifyAdmin } from "./admin.ts";
import type { Student, TelegramMessage } from "./types.ts";

const READY_WORDS = /\b(ready|let'?s go|start|begin|ok|okay|yes|go|proceed|continue|oya|sure|done)\b/i;

export async function handleDay1(
  _msg: TelegramMessage,
  student: Student,
  chatId: number,
  text: string | null,
  photo: { bytes: Uint8Array; mimeType: string } | null
): Promise<void> {
  await sendChatAction(chatId, "typing");

  switch (student.current_step) {
    case 1:
      await handleStep1(student, chatId, text, photo);
      break;
    case 2:
      await handleStep2(student, chatId, text, photo);
      break;
    case 3:
      await handleStep3(student, chatId, text, photo);
      break;
    case 4:
      await handleStep4(student, chatId, text, photo);
      break;
    case 5:
      await handleStep5(student, chatId, text, photo);
      break;
    default:
      await sendMessage(chatId, "Oya let's continue! Send me that screenshot when you're ready 📸");
  }
}

// Step 1: Q&A phase — wait for "ready"
async function handleStep1(student: Student, chatId: number, text: string | null, photo: { bytes: Uint8Array; mimeType: string } | null): Promise<void> {
  if (photo) {
    await sendMessage(chatId, "No photos needed yet! First, any questions about the business? When you're ready just say <b>\"ready\"</b> 😊");
    return;
  }

  if (!text) return;

  if (READY_WORDS.test(text)) {
    await advanceStep(student.id, 1, 2);
    await sendStep2Prompt(chatId);
    return;
  }

  // Answer their question with Gemini
  const history = await getRecentConversation(student.id, 8);
  const answer = await geminiChat(
    history,
    text,
    "The student is on Day 1, Step 1. They may have questions about the EEM26 business model (AAM and SRE systems). Answer their question warmly, then remind them to say 'ready' when they want to start their first task.",
    student.id
  );
  await sendMessage(chatId, answer);
}

async function sendStep2Prompt(chatId: number): Promise<void> {
  await sendMessage(
    chatId,
    `<b>Okay! First task from your Tech Stack 📦</b>\n\nYou need to create your <b>Selar account</b>. Selar is one of the platforms where your customers will buy from you — think of it as your online storefront.\n\n👉 Click this link to create your account as a <b>CREATOR</b> (not affiliate — this is IMPORTANT!):\n<a href="https://selar.com/register">https://selar.com/register</a>\n\n⚠️ Make sure you sign up as a <b>CREATOR</b>, not as an affiliate. If you sign up wrong, your account won't work for selling.\n\nOnce you're on the registration page, send me a <b>screenshot</b> so I can confirm you're on the right page 📸`
  );
}

// Step 2: Selar screenshot — accept registration page OR existing dashboard
async function handleStep2(student: Student, chatId: number, text: string | null, photo: { bytes: Uint8Array; mimeType: string } | null): Promise<void> {
  if (!photo) {
    if (text) {
      const history = await getRecentConversation(student.id, 6);
      const reply = await geminiChat(history, text, "Student is on Day 1 Step 2 — they need a Selar creator account. If they say they already have one, tell them great and ask for a screenshot of their dashboard. Otherwise answer briefly and redirect to send a screenshot.", student.id);
      await sendMessage(chatId, reply);
    } else {
      await sendMessage(chatId, "Go to <a href=\"https://selar.com/register\">selar.com/register</a> and send me a screenshot 📸\n\n(If you already have a Selar account, just send me a screenshot of your dashboard)");
    }
    return;
  }

  const prompt = buildVerificationPrompt(
    "Does this screenshot show anything from Selar.com? This includes: the Selar registration/signup page, the Selar login page, OR the Selar creator/seller dashboard (with products, sales, customers). ANY of these count as valid.",
    ["page_type: write exactly 'dashboard' if they are logged in showing their creator account stats, write 'registration' if showing a signup or login form"]
  );
  const result = await geminiVision(photo.bytes, photo.mimeType, prompt);

  if (result.verified) {
    await recordStepCompletion(student.id, 1, 2, true);
    const isDashboard = /dashboard/i.test(result.extracted?.page_type ?? "") || /dashboard/i.test(result.reason ?? "");

    if (isDashboard) {
      await advanceStep(student.id, 1, 4, { selar_account_created: true });
      await sendMessage(chatId, `I can see you're already on Selar — amazing! ✅ You don do am! 🙌\n\nNow let's set up your second platform — <b>Payhip</b>. This is also from your Tech Stack 📦`);
      await new Promise((r) => setTimeout(r, 800));
      await sendStep4Prompt(chatId);
    } else {
      await advanceStep(student.id, 1, 3);
      await sendMessage(chatId, `You're on the right page! 🎉\n\nNow <b>complete the registration</b> — fill in your details and verify your email.\n\nOnce your account is active and you can see your Selar <b>dashboard</b>, send me a screenshot 📸`);
    }
  } else {
    await handleFailedScreenshot(student, chatId, result.reason, "Go to <a href=\"https://selar.com/register\">selar.com/register</a> and screenshot the Selar page 📸");
  }
}

// Step 3: Selar dashboard screenshot
async function handleStep3(student: Student, chatId: number, text: string | null, photo: { bytes: Uint8Array; mimeType: string } | null): Promise<void> {
  if (!photo) {
    if (text) {
      const history = await getRecentConversation(student.id, 6);
      const reply = await geminiChat(history, text, "Student is on Day 1 Step 3 — they need to complete Selar registration and send a screenshot of their Selar creator dashboard.", student.id);
      await sendMessage(chatId, reply);
    } else {
      await sendMessage(chatId, "Complete the Selar registration, then send me a screenshot of your Selar dashboard 📸");
    }
    return;
  }

  const prompt = buildVerificationPrompt(
    "Does this screenshot show a Selar seller or creator dashboard? Look for the Selar logo, navigation menu, seller stats, or a creator/seller account dashboard."
  );
  const result = await geminiVision(photo.bytes, photo.mimeType, prompt);

  if (result.verified) {
    await recordStepCompletion(student.id, 1, 3, true);
    await advanceStep(student.id, 1, 4, { selar_account_created: true });
    await sendMessage(chatId, `Selar account — DONE! ✅ You don do am! 🙌\n\nNow let's set up your second platform — <b>Payhip</b>. This is also from your Tech Stack 📦`);
    await new Promise((r) => setTimeout(r, 800));
    await sendStep4Prompt(chatId);
  } else {
    await handleFailedScreenshot(
      student,
      chatId,
      result.reason,
      "Make sure your Selar account is fully active and you can see your seller dashboard, then screenshot it and send to me 📸"
    );
  }
}

async function sendStep4Prompt(chatId: number): Promise<void> {
  await sendMessage(
    chatId,
    `<b>Payhip — your second money platform! 💰</b>\n\nPayhip is your second store where customers pay you. Having two platforms means more ways for money to reach you.\n\n👉 You MUST use THIS exact link to create your account — it gives you special setup bonuses:\n<a href="https://payhip.com/auth/register/af650fe07ce1c3c">https://payhip.com/auth/register/af650fe07ce1c3c</a>\n\nOnce you've registered, Payhip needs to approve your account (usually a few minutes). As soon as it's approved, send me a screenshot of your <b>Payhip dashboard</b> 📸\n\nAlso — once approved, copy your Payhip store link and send it to me. It looks like: <code>payhip.com/YourUsername</code>. You'll need it for tomorrow!`
  );
}

// Step 4: Payhip — collect payhip_link text AND dashboard screenshot
// Sub-step tracking: if payhip_link is not set yet, we're waiting for text + photo
async function handleStep4(student: Student, chatId: number, text: string | null, photo: { bytes: Uint8Array; mimeType: string } | null): Promise<void> {
  // If they send text that looks like a Payhip link, save it
  if (text && /payhip\.com\//i.test(text)) {
    const linkMatch = text.match(/payhip\.com\/[A-Za-z0-9_-]+/i);
    if (linkMatch) {
      const payhipLink = "https://" + linkMatch[0].replace(/^https?:\/\//i, "");
      await updateStudent(student.id, { payhip_link: payhipLink });
      await sendMessage(
        chatId,
        `Got your Payhip link! ✅ <code>${payhipLink}</code>\n\nNow send me a screenshot of your Payhip <b>dashboard</b> to confirm your account is active 📸`
      );
      return;
    }
  }

  if (!photo) {
    if (text) {
      const history = await getRecentConversation(student.id, 6);
      const reply = await geminiChat(history, text, `Student is on Day 1 Step 4 — they need to create a Payhip account using the special link (https://payhip.com/auth/register/af650fe07ce1c3c) and send their Payhip store link + a screenshot of their dashboard. ${student.payhip_link ? "They already sent their Payhip link: " + student.payhip_link + ". Now waiting for the dashboard screenshot." : "They haven't sent their Payhip link yet."}`, student.id);
      await sendMessage(chatId, reply);
    } else {
      if (!student.payhip_link) {
        await sendStep4Prompt(chatId);
      } else {
        await sendMessage(chatId, "Great! Now send me a screenshot of your Payhip dashboard 📸");
      }
    }
    return;
  }

  const prompt = buildVerificationPrompt(
    "Does this screenshot show a Payhip seller or creator dashboard? Look for the Payhip logo, seller account navigation, sales stats, or creator dashboard."
  );
  const result = await geminiVision(photo.bytes, photo.mimeType, prompt);

  if (result.verified) {
    const updates: Partial<Student> = { payhip_account_created: true };
    if (!student.payhip_link) {
      // Ask for the link before proceeding if not yet given
      await recordStepCompletion(student.id, 1, 4, true);
      await updateStudent(student.id, updates);
      await sendMessage(
        chatId,
        `Payhip dashboard verified! ✅\n\nOne last thing — what is your Payhip store link? It looks like: <code>payhip.com/YourUsername</code>\n\nSend it to me so I can save it for tomorrow's setup 🔗`
      );
      return;
    }
    await recordStepCompletion(student.id, 1, 4, true);
    await advanceStep(student.id, 1, 5, updates);
    await sendDay1Complete(student, chatId);
  } else {
    await handleFailedScreenshot(
      student,
      chatId,
      result.reason,
      "Make sure your Payhip account is approved and you're viewing your seller dashboard, then screenshot and send 📸"
    );
  }
}

// If we get here it means payhip_link was just sent as text after the photo was verified
// This is handled by step 4 text branch above — but step 5 catches the case where
// everything is done and we just need to finalize
async function handleStep5(student: Student, chatId: number, text: string | null, _photo: { bytes: Uint8Array; mimeType: string } | null): Promise<void> {
  // If we're in step 5 but payhip_link was just sent as text
  if (text && /payhip\.com\//i.test(text) && !student.payhip_link) {
    const linkMatch = text.match(/payhip\.com\/[A-Za-z0-9_-]+/i);
    if (linkMatch) {
      const payhipLink = "https://" + linkMatch[0].replace(/^https?:\/\//i, "");
      await advanceStep(student.id, 1, 5, { payhip_link: payhipLink });
      await sendDay1Complete({ ...student, payhip_link: payhipLink }, chatId);
      return;
    }
  }
  // Otherwise just trigger completion (already in step 5 = day 1 done)
  await sendDay1Complete(student, chatId);
}

async function sendDay1Complete(student: Student, chatId: number): Promise<void> {
  const nextUnlock = computeNextUnlockAt();
  await advanceStep(student.id, 1, 0, {
    day1_completed_at: new Date().toISOString(),
    next_day_unlocks_at: nextUnlock,
  });

  await sendMessage(
    chatId,
    `<b>YOU DID IT! 🎉🎉🎉</b>\n\n<b>Day 1 is COMPLETE! You don do am! 💪</b>\n\nHere's what you've accomplished today:\n✅ You understand your business model\n✅ Selar account — DONE\n✅ Payhip account — DONE\n\nTomorrow we build your <b>SALES PAGE</b> — your online shop that converts visitors into buyers automatically. It'll have YOUR link so every sale goes directly to you.\n\n<b>Your Day 2 unlocks tomorrow at 8AM Nigeria time.</b> I'll message you then! Get some rest — you've earned it 🌟`
  );

  await notifyAdmin(
    `✅ <b>DAY 1 COMPLETE</b>\n\nStudent: ${student.full_name}\nCountry: ${student.country}\nEmail: ${student.email}\nSelar: ✅\nPayhip: ✅\nPayhip link: ${student.payhip_link ?? "not yet provided"}`
  );
}

async function handleFailedScreenshot(
  student: Student,
  chatId: number,
  reason: string,
  retryMessage: string
): Promise<void> {
  const attempts = student.screenshot_attempts + 1;

  if (attempts >= 3) {
    await resetScreenshotAttempts(student.id);
    await notifyAdmin(
      `⚠️ <b>STUDENT STUCK</b>\n\nName: ${student.full_name}\nDay: ${student.current_day}, Step: ${student.current_step}\nAfter 3 attempts. Reason: ${reason}`
    );
    await sendMessage(
      chatId,
      `No wahala! Let me explain it a different way 😊\n\n${retryMessage}`
    );
  } else {
    await incrementScreenshotAttempts(student.id, student.screenshot_attempts);
    await sendMessage(
      chatId,
      `Hmm, that's not quite it — no worries! 😊\n\n${retryMessage}`
    );
  }
}
