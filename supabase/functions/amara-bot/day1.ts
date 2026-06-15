import { sendMessage, sendChatAction, typeMessage } from "./telegram.ts";
import { advanceStep, updateStudent, incrementScreenshotAttempts, resetScreenshotAttempts, recordStepCompletion, computeNextUnlockAt, getRecentConversation } from "./db.ts";
import { geminiVision, geminiChat, geminiVisionGuide, buildVerificationPrompt } from "./gemini.ts";
import { notifyAdmin } from "./admin.ts";
import { createEscalation } from "./knowledge.ts";
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
    case 6:
      await handleStep6(student, chatId, text, photo);
      break;
    default:
      await sendMessage(chatId, "Oya let's continue! Send me that screenshot when you're ready 📸");
  }
}

// Step 1: Q&A phase — wait for "ready"
async function handleStep1(student: Student, chatId: number, text: string | null, photo: { bytes: Uint8Array; mimeType: string } | null): Promise<void> {
  if (photo) {
    // Student sent a screenshot during the Q&A phase — read it and guide them
    const guidance = await geminiVisionGuide(
      photo.bytes,
      photo.mimeType,
      "Student is on Day 1 of the EEM26 program. They are in the questions phase — they should ask any questions about the business, then say 'ready' to start their first task (creating a Selar account). They haven't been asked to screenshot anything yet.",
      text ?? undefined
    );
    await sendMessage(chatId, guidance);
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
  await typeMessage(chatId, `<b>Okay! First task from your Tech Stack 📦</b>\n\nYour <b>Selar account</b> — this is one of your main selling platforms where customers buy from you directly 🛒`);
  await typeMessage(chatId, `👉 Sign up as a <b>CREATOR</b> (not affiliate — this is important!):\n<a href="https://selar.com/register">selar.com/register</a>\n\n⚠️ CREATOR = your own storefront. Affiliate = someone else's. Make sure it says CREATOR!`);
  await typeMessage(chatId, `Once you're on the registration page, send me a screenshot so I can confirm you're in the right place 📸`);
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
      await typeMessage(chatId, `Ayyyy you're already on Selar!! ✅ You don do am! 🙌`);
      await new Promise((r) => setTimeout(r, 300));
      await sendStep4Prompt(chatId);
    } else {
      await advanceStep(student.id, 1, 3);
      await typeMessage(chatId, `You're on the right page! 🎉\n\nNow <b>complete the registration</b> — fill in your details and verify your email.\n\nOnce your Selar <b>dashboard</b> is active, snap a screenshot and send it over 📸`);
    }
  } else {
    await handleFailedScreenshot(student, chatId, result.reason, result.guidance || "Go to <a href=\"https://selar.com/register\">selar.com/register</a> and screenshot the Selar page 📸",
      photo, "Student needs to be on the Selar website (selar.com) — either the signup/registration page or their creator/seller dashboard. Guide them based on exactly what you can see on their screen.");
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
    await typeMessage(chatId, `Selar account — DONE! ✅ You don do am! 🙌`);
    await new Promise((r) => setTimeout(r, 300));
    await sendStep4Prompt(chatId);
  } else {
    await handleFailedScreenshot(student, chatId, result.reason,
      "Make sure your Selar account is fully active and you can see your seller dashboard, then screenshot it and send to me 📸",
      photo, "Student needs to show their Selar seller/creator dashboard (after completing registration). Guide them based on what you can see on their screen.");
  }
}

async function sendStep4Prompt(chatId: number): Promise<void> {
  await typeMessage(chatId, `<b>Payhip — your second money platform! 💰</b>\n\nWith Payhip you earn commissions every time someone buys through your link. Set it up once, it pays you forever 🔁 Already in your Tech Stack 📦`);
  await typeMessage(chatId, `👉 Use THIS exact link to create your account:\n<a href="https://payhip.com/auth/register/af650fe07ce1c3c">payhip.com/auth/register/af650fe07ce1c3c</a>`);
  await typeMessage(chatId, `You'll see a <b>"Join as an Affiliate"</b> form — fill in your name, email and create a password, then click <b>"Create account"</b>.\n\nOnce your dashboard is ready, drop a screenshot here 📸`);
}

// Step 4: Verify Payhip dashboard — then notify admin and wait for approval
async function handleStep4(student: Student, chatId: number, text: string | null, photo: { bytes: Uint8Array; mimeType: string } | null): Promise<void> {
  if (!photo) {
    if (text) {
      const history = await getRecentConversation(student.id, 6);
      const reply = await geminiChat(history, text,
        `Student is on Day 1 Step 4 — they need to create a Payhip affiliate account using the link https://payhip.com/auth/register/af650fe07ce1c3c. They will see a "Join as an Affiliate" form. After signing up, ask them to send a screenshot of their Payhip dashboard.`,
        student.id);
      await sendMessage(chatId, reply);
    } else {
      await sendStep4Prompt(chatId);
    }
    return;
  }

  const prompt = buildVerificationPrompt(
    "Does this screenshot show Payhip? Study it carefully:\n" +
    "- 'Join as an Affiliate' signup form (fields for First Name, Last Name, Email, Password with a 'Create account' button) → verified=true, student is on the CORRECT signup page\n" +
    "- Payhip affiliate dashboard (logged in, showing affiliate links, commissions, clicks or earnings) → verified=true, account is set up\n" +
    "- Any other page (wrong website, unrelated page) → verified=false\n" +
    "For guidance: tell the student exactly what page they are on and what to do next.",
    ["page_type: write 'form' if showing the affiliate signup form, write 'dashboard' if showing a logged-in affiliate dashboard"]
  );
  const result = await geminiVision(photo.bytes, photo.mimeType, prompt);

  if (result.verified) {
    const pageType = result.extracted?.page_type ?? "";
    const isForm = /form/i.test(pageType) || /sign.?up|register|join|create.{0,10}account/i.test(result.reason ?? "");

    if (isForm) {
      await typeMessage(chatId, `You're on the right page! 🎉\n\nFill in the form:\n📝 Enter your <b>First Name</b>, <b>Last Name</b>, <b>Email</b> and create a <b>Password</b>\n✅ Click <b>"Create account"</b>`);
      await typeMessage(chatId, `Once your account is ready, send me a screenshot of your <b>Payhip dashboard</b> 📸`);
      return;
    }

    // Dashboard confirmed — notify admin to approve and put student in waiting state
    await recordStepCompletion(student.id, 1, 4, true);
    await advanceStep(student.id, 1, 5, { payhip_account_created: true });
    await typeMessage(
      chatId,
      `Your Payhip account is set up! ✅ You don do am! 🙌\n\nI've notified your coach to approve your affiliate request — hold on a moment while I get that sorted for you 🙏`
    );
    await notifyAdmin(
      `📋 <b>PAYHIP APPROVAL NEEDED</b>\n\nStudent: <b>${student.full_name}</b> just created their Payhip affiliate account!\n\nPlease go to Payhip and <b>approve their affiliate request</b> so they can get their link.\n\nReply <code>approved</code> when done 👇`
    );
  } else {
    await handleFailedScreenshot(student, chatId, result.reason,
      result.guidance || "Use this link to sign up: <a href=\"https://payhip.com/auth/register/af650fe07ce1c3c\">https://payhip.com/auth/register/af650fe07ce1c3c</a> — you should see a 'Join as an Affiliate' form to fill in 📸",
      photo, "Student is signing up for Payhip as an affiliate using the link payhip.com/auth/register/af650fe07ce1c3c. They should see either the 'Join as an Affiliate' form OR their affiliate dashboard after signup. Guide them based on exactly what you see on their screen.");
  }
}

// Step 5: Waiting for admin to approve Payhip affiliate request.
// If the student already has their link (approved externally), accept it right here.
async function handleStep5(student: Student, chatId: number, text: string | null, photo: { bytes: Uint8Array; mimeType: string } | null): Promise<void> {
  // Student pastes their payhip link → they're already approved externally, complete Day 1
  if (text && /payhip\.com\//i.test(text)) {
    const linkMatch = text.match(/payhip\.com\/[A-Za-z0-9_\/-]+/i);
    if (linkMatch) {
      const payhipLink = "https://" + linkMatch[0].replace(/^https?:\/\//i, "").replace(/\/+$/, "");
      await updateStudent(student.id, { payhip_link: payhipLink });
      await typeMessage(chatId, `Got it! 🎉 Your affiliate link is saved and you're all set!`);
      await sendDay1Complete({ ...student, payhip_link: payhipLink }, chatId);
      return;
    }
  }

  // Photo — check if affiliate link is visible in the screenshot; if so, extract and proceed
  if (photo) {
    const prompt = buildVerificationPrompt(
      "Does this screenshot show a Payhip page where an affiliate link URL is clearly visible? The URL looks like 'payhip.com/b/XXXX' or 'https://payhip.com/b/XXXX/...'.",
      ["affiliate_link: paste the exact payhip URL you can see (e.g. https://payhip.com/b/xeqSM), or write 'none' if no link is clearly visible"]
    );
    const result = await geminiVision(photo.bytes, photo.mimeType, prompt);

    if (result.verified && result.extracted?.affiliate_link && result.extracted.affiliate_link !== "none") {
      const raw = result.extracted.affiliate_link;
      const linkMatch = raw.match(/payhip\.com\/[A-Za-z0-9_\/-]+/i);
      if (linkMatch) {
        const payhipLink = "https://" + linkMatch[0].replace(/^https?:\/\//i, "").replace(/\/+$/, "");
        await updateStudent(student.id, { payhip_link: payhipLink });
        await typeMessage(chatId, `I can see your affiliate link right there! ✅ You're already approved — let's wrap up Day 1! 🎉`);
        await sendDay1Complete({ ...student, payhip_link: payhipLink }, chatId);
        return;
      }
    }

    const guidance = await geminiVisionGuide(
      photo.bytes,
      photo.mimeType,
      `Student on Day 1 of EEM26 is waiting for Payhip affiliate approval. If their screenshot shows an affiliate link (payhip.com/...), tell them to copy it and paste it in the chat. Otherwise respond warmly and ask them to hang on.`,
      text ?? undefined
    );
    await sendMessage(chatId, guidance);
    return;
  }

  if (!text) {
    await typeMessage(chatId, `Still waiting for your Payhip affiliate approval 🙏 If you already see a link in your Payhip dashboard, just paste it here and we'll move on! Otherwise hang tight — your coach will confirm shortly 😊`);
    return;
  }

  const history = await getRecentConversation(student.id, 4);
  const reply = await geminiChat(
    history,
    text,
    `Student on Day 1 of EEM26 is waiting for Payhip affiliate approval. If they say they're already approved or have their link, ask them to paste the link (payhip.com/...) or send a screenshot showing the link. If they're just waiting, reassure them warmly.`,
    student.id
  );
  await sendMessage(chatId, reply);
}

// Step 6: Collect affiliate link after admin approval
async function handleStep6(student: Student, chatId: number, text: string | null, photo: { bytes: Uint8Array; mimeType: string } | null): Promise<void> {
  if (photo) {
    const guidance = await geminiVisionGuide(
      photo.bytes,
      photo.mimeType,
      `Student on Day 1 of EEM26 has their Payhip affiliate account approved! They need to find their affiliate/store link (looks like payhip.com/TheirUsername) in the Payhip dashboard and send it. Guide them based on what you see on screen.`,
      text ?? undefined
    );
    await sendMessage(chatId, guidance);
    return;
  }

  if (text && /payhip\.com\//i.test(text)) {
    const linkMatch = text.match(/payhip\.com\/[A-Za-z0-9_\/-]+/i);
    if (linkMatch) {
      const payhipLink = "https://" + linkMatch[0].replace(/^https?:\/\//i, "").replace(/\/+$/, "");
      await updateStudent(student.id, { payhip_link: payhipLink });
      await sendDay1Complete({ ...student, payhip_link: payhipLink }, chatId);
      return;
    }
  }

  if (text) {
    const history = await getRecentConversation(student.id, 6);
    const reply = await geminiChat(
      history,
      text,
      `Student on Day 1 of EEM26 has their Payhip affiliate account approved! They need to find their Payhip affiliate/store link (looks like payhip.com/YourUsername or payhip.com/b/XXXX) in their dashboard and paste it here. Help them find it.`,
      student.id
    );
    await sendMessage(chatId, reply);
    return;
  }

  await typeMessage(chatId, `Find your <b>Payhip affiliate link</b> in your dashboard — it looks like <code>payhip.com/YourUsername</code> 🔗\n\nCopy it and paste it here! 👇`);
}

async function sendDay1Complete(student: Student, chatId: number): Promise<void> {
  const nextUnlock = computeNextUnlockAt();
  await advanceStep(student.id, 1, 0, {
    day1_completed_at: new Date().toISOString(),
    next_day_unlocks_at: nextUnlock,
  });

  await typeMessage(chatId, `<b>YOU DID IT!! 🎉🎉🎉</b>\n\nDay 1 is COMPLETE! You don do am!! 💪\n\n✅ Business model — understood\n✅ Selar account — DONE\n✅ Payhip account — DONE`);
  await typeMessage(chatId, `Tomorrow we build your <b>SALES PAGE</b> — your online shop that converts visitors into buyers automatically, with YOUR link so every sale goes straight to you 💰\n\n<b>Day 2 unlocks tomorrow at 8AM Nigeria time.</b> I'll message you then! Get some rest — you earned it 🌟`);

  await notifyAdmin(
    `✅ <b>DAY 1 COMPLETE</b>\n\nStudent: ${student.full_name}\nCountry: ${student.country}\nEmail: ${student.email}\nSelar: ✅\nPayhip: ✅\nPayhip link: ${student.payhip_link ?? "not yet provided"}`
  );
}

async function handleFailedScreenshot(
  student: Student,
  chatId: number,
  reason: string,
  retryMessage: string,
  photo?: { bytes: Uint8Array; mimeType: string } | null,
  stepContext?: string
): Promise<void> {
  if (reason === "verification_unavailable") {
    // Vision API failed — escalate so admin can reply with guidance that goes back to student
    await createEscalation(
      student.id,
      String(chatId),
      student.full_name,
      `Vision check failed for Day ${student.current_day} Step ${student.current_step}. Student sent a screenshot but Amara couldn't read it (API issue). They need to: ${retryMessage}. What should I tell them?`
    );
    await typeMessage(chatId, `I'm checking on this for you 🙏 Just a moment!`);
    return;
  }
  const attempts = student.screenshot_attempts + 1;
  await incrementScreenshotAttempts(student.id, student.screenshot_attempts);

  // After 4 failed attempts, escalate to admin with full context so they can reply directly
  if (attempts >= 4) {
    await resetScreenshotAttempts(student.id);
    const recentHistory = await getRecentConversation(student.id, 6);
    const recentText = recentHistory
      .slice(-6)
      .map((m) => `${m.role === "user" ? "Student" : "Amara"}: ${m.message}`)
      .join("\n\n");

    await createEscalation(
      student.id,
      String(chatId),
      student.full_name,
      `Student stuck on Day ${student.current_day} Step ${student.current_step} after ${attempts} attempts.\n\nLast screenshot showed: "${reason}"\n\nRecent conversation:\n${recentText}`
    );

    await typeMessage(chatId, `I've passed this straight to Coach Victor 🙏 He'll check your situation and I'll bring his answer right back to you — just hold on! 😊`);
    return;
  }

  if (photo && stepContext) {
    const guidance = await geminiVisionGuide(photo.bytes, photo.mimeType, stepContext);
    await sendMessage(chatId, guidance);
  } else {
    const history = await getRecentConversation(student.id, 3);
    const reply = await geminiChat(
      history,
      `[screenshot analysis]`,
      `Student sent a screenshot that wasn't correct. Here is what the screenshot actually shows: "${reason}". Here is what they need to do: "${retryMessage}".
In Amara's warm, friendly style: tell the student EXACTLY what you can see in their screenshot (be specific about what page/screen it is), then give them PRECISE step-by-step instructions on what to click or do next to get to the right place. Don't be generic — be like a friend looking at their phone screen and guiding them.`,
      student.id
    );
    await sendMessage(chatId, reply);
  }
}
