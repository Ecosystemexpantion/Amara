import { sendMessage, sendChatAction, typeMessage } from "./telegram.ts";
import { advanceStep, getRecentConversation, recordStepCompletion, incrementScreenshotAttempts, resetScreenshotAttempts } from "./db.ts";
import { geminiVision, geminiChat, geminiVisionGuide, buildVerificationPrompt } from "./gemini.ts";
import { buildGitHubAuthUrl } from "./github.ts";
import { notifyAdmin } from "./admin.ts";
import { createEscalation } from "./knowledge.ts";
import type { Student, TelegramMessage } from "./types.ts";

const TECH_STACK_URL = "https://ecosystemexpantion.github.io/Tech_stack/";

export async function handleDay2(
  _msg: TelegramMessage,
  student: Student,
  chatId: number,
  text: string | null,
  photo: { bytes: Uint8Array; mimeType: string } | null
): Promise<void> {
  await sendChatAction(chatId, "typing");

  switch (student.current_step) {
    case 1: await handleTechStackVerification(student, chatId, text, photo); break;
    case 2: await handleGitHubAccount(student, chatId, text, photo); break;
    case 3: await handleGitHubOAuth(student, chatId, text, photo); break;
    default: await resendOAuthLink(student, chatId);
  }
}

// Step 1: Verify Tech Stack download before continuing
async function handleTechStackVerification(
  student: Student,
  chatId: number,
  text: string | null,
  photo: { bytes: Uint8Array; mimeType: string } | null
): Promise<void> {
  const history = await getRecentConversation(student.id, 6);
  const alreadyAsked = history.some(m => m.message.includes("Tech Stack") && m.role === "assistant");

  if (!photo) {
    if (!alreadyAsked || !text) {
      await typeMessage(
        chatId,
        `<b>🚀 Day 2: Your Live Sales Pages!</b>\n\nToday I'm building your <b>TWO sales pages</b> and setting up your money-making tools — all from your <b>Tech Stack 📦</b>\n\nBut first — have you downloaded the Tech Stack yet? I need it to set up everything for you.\n\n👉 <a href="${TECH_STACK_URL}">Download your Tech Stack here</a>\n\nOnce you've downloaded it, send me a <b>screenshot of your proof of payment</b> (receipt or confirmation email) so I can verify and we continue immediately! 💰\n\nOur target is <b>₦500k in a week</b> — let's go! 🔥`
      );
      return;
    }

    const reply = await geminiChat(history, text,
      `Student is on Day 2 Step 1. They need to download the EEM26 Tech Stack from ${TECH_STACK_URL} and send proof of payment/download.

The proof can be:
- A bank/payment app receipt (OPay, Paystack, bank transfer) showing a successful transaction
- The confirmation email from EEM26 saying "Payment Confirmed! Your Access is Ready"
- Any screenshot showing they purchased/downloaded the Tech Stack

If they say they've already downloaded or paid, ask them to send a screenshot of the receipt or confirmation email.
If they ask what the Tech Stack is, explain it contains all the tools needed for their setup (sales pages, bot, templates).
If they seem reluctant or refuse, encourage them warmly — the Tech Stack is what makes the whole business work.
Keep it short and motivating. Mention the ₦500k target.`,
      student.id);
    await sendMessage(chatId, reply);
    return;
  }

  // Student sent a photo — verify it's proof of payment
  const prompt = buildVerificationPrompt(
    "Does this screenshot show proof of payment or a purchase confirmation? Accept ANY of these:\n" +
    "- A bank or payment app receipt (OPay, Paystack, Flutterwave, bank transfer) showing a successful transaction\n" +
    "- An email or page saying 'Payment Confirmed', 'Your Access is Ready', 'Order Successful', 'Transaction Successful' or similar\n" +
    "- A Selar order confirmation or purchase receipt\n" +
    "- Any document clearly showing a completed payment\n" +
    "verified=true if this clearly shows a successful payment/purchase. verified=false if it shows something unrelated."
  );
  const result = await geminiVision(photo.bytes, photo.mimeType, prompt);

  if (result.reason === "verification_unavailable") {
    // Can't verify — send student's email to admin for manual confirmation
    await notifyAdmin(
      `🔍 <b>TECH STACK VERIFICATION NEEDED</b>\n\n` +
      `Student: <b>${student.full_name}</b>\n` +
      `Email: <code>${student.email ?? "not provided"}</code>\n\n` +
      `Vision couldn't verify their payment proof. Please check if this email purchased the Tech Stack.\n\n` +
      `Reply <code>confirm ${student.full_name}</code> to unlock Day 2 for them.`
    );
    await typeMessage(chatId, `Thanks for sending that! 😊 I'm having a little trouble reading the screenshot — I've sent your details to Coach Victor to confirm. He'll verify it quickly and I'll continue your setup right away! 🙏`);
    return;
  }

  if (result.verified) {
    await recordStepCompletion(student.id, 2, 1, true, "Tech Stack payment verified");
    await advanceStep(student.id, 2, 2);
    await typeMessage(chatId, `Payment confirmed! ✅ Tech Stack verified — let's build your sales pages! 🔥`);
    await new Promise((r) => setTimeout(r, 300));
    await sendGitHubIntro(student, chatId);
  } else {
    const attempts = student.screenshot_attempts + 1;
    await incrementScreenshotAttempts(student.id, student.screenshot_attempts);

    if (attempts >= 3) {
      // Escalate to admin — don't waste more API calls
      await resetScreenshotAttempts(student.id);
      await notifyAdmin(
        `⚠️ <b>TECH STACK NOT VERIFIED</b>\n\n` +
        `Student: <b>${student.full_name}</b>\n` +
        `Email: <code>${student.email ?? "not provided"}</code>\n\n` +
        `${attempts} attempts — screenshots don't show valid payment proof.\n` +
        `Last screenshot showed: "${result.reason}"\n\n` +
        `Reply <code>confirm ${student.full_name}</code> to unlock, or ignore.`
      );
      await typeMessage(chatId, `I've sent your details to Coach Victor for verification 🙏 He'll check and I'll message you as soon as you're confirmed! 😊`);
      return;
    }

    const guidance = await geminiVisionGuide(photo.bytes, photo.mimeType,
      `Student needs to send proof of payment for the EEM26 Tech Stack (${TECH_STACK_URL}). What they sent doesn't look like a payment receipt or confirmation. Tell them exactly what you see, then ask them to send their bank receipt (OPay, Paystack, etc.) or the "Payment Confirmed" email from EEM26. Be warm and specific.`,
      text ?? undefined);
    await sendMessage(chatId, guidance);
  }
}

// Step 2: Ask about GitHub account → guide creation if needed → then OAuth link
async function handleGitHubAccount(
  student: Student,
  chatId: number,
  text: string | null,
  photo: { bytes: Uint8Array; mimeType: string } | null
): Promise<void> {
  const oauthUrl = buildGitHubAuthUrl(String(chatId));
  const history = await getRecentConversation(student.id, 6);

  if (photo) {
    const guidance = await geminiVisionGuide(
      photo.bytes,
      photo.mimeType,
      `Student is on Day 2 of EEM26, creating or logging into a GitHub account so Amara can build their sales pages. Guide them based on what you see on screen.`,
      text ?? undefined
    );
    await sendMessage(chatId, guidance);
    return;
  }

  const isFirstTrigger = !text || /^(ready|yes|start|begin|ok|okay|go|sure|yep|yeah|let.?s go)$/i.test(text.trim());
  const alreadyAsked = history.some(m => m.message.toLowerCase().includes("github account"));

  if (isFirstTrigger && !alreadyAsked) {
    await sendGitHubIntro(student, chatId);
    return;
  }

  if (!text) return;

  const t = text.trim().toLowerCase();

  const hasAccount = /\b(yes|i have|have one|have it|already have|got one|i got|have github|have a github|i do|yes i do|yeah i have|yep i have|done|created|made one|have now|i created|just created|just made)\b/i.test(t);
  const noAccount = /\b(no|don.?t have|do not have|never|nope|not yet|need to create|i need|create one|new account|don.?t|dont)\b/i.test(t);

  if (hasAccount) {
    await typeMessage(
      chatId,
      `Perfect! Now tap the link below — log into your GitHub account and I'll create BOTH your sales pages automatically! 🤖\n\n<a href="${oauthUrl}">👉 Connect GitHub here</a>\n\n<i>📱 On mobile: scroll down to the bottom of that page to find the green <b>Authorize</b> button, then tap it.</i>`
    );
    await advanceStep(student.id, 2, 3);
    return;
  }

  if (noAccount) {
    await typeMessage(
      chatId,
      `No worries at all! Creating a GitHub account is free and takes about 2 minutes 😊\n\n👉 Go to: <a href="https://github.com/signup">github.com/signup</a>\n\nFill in:\n• <b>Username</b> — any name you like (e.g. your first name)\n• <b>Email address</b>\n• <b>Password</b>\n\nThen verify your email and finish signup. Send me a screenshot when you're on your GitHub dashboard and I'll take it from there! 📸`
    );
    return;
  }

  const reply = await geminiChat(
    history,
    text,
    `Student is on Day 2 of EEM26. Before connecting GitHub (OAuth), Amara asked whether they have a GitHub account. Help them — if they don't have one, guide them to github.com/signup (free, 2 minutes). If they do or just created one, tell them to tap this link to connect: ${oauthUrl} — on mobile they need to scroll down to tap the green Authorize button.`,
    student.id
  );
  await sendMessage(chatId, reply);
}

async function sendGitHubIntro(student: Student, chatId: number): Promise<void> {
  await typeMessage(
    chatId,
    `Now let's build your <b>TWO sales pages</b> — a normal version and a premium version — fully automated from your Tech Stack 📦\n\nOnce they're live, you'll have real shop links to share and start making sales 💰`
  );
  await typeMessage(
    chatId,
    `To create your pages I need to connect to a <b>GitHub account</b>.\n\nDo you already have a GitHub account, or do I need to help you create one first? 🙋`
  );
}

// Step 3: Waiting for the OAuth callback (github-oauth function will advance to step 0)
async function handleGitHubOAuth(
  student: Student,
  chatId: number,
  text: string | null,
  photo: { bytes: Uint8Array; mimeType: string } | null
): Promise<void> {
  if (student.github_access_token) {
    await typeMessage(chatId, `Your GitHub is already connected! 🎉 Your sales pages are being set up — I'll have both live links for you in a moment!`);
    return;
  }

  const oauthUrl = buildGitHubAuthUrl(String(chatId));

  if (photo) {
    const guidance = await geminiVisionGuide(
      photo.bytes,
      photo.mimeType,
      `Student is doing Day 2 of EEM26. They tapped a GitHub OAuth link and are trying to connect their GitHub account so Amara can automatically create their two sales pages.

      What they need to do: On the GitHub authorization page, they should tap the green "Authorize [app name]" button. That's the ONLY thing they need to do — just tap that green button and Amara handles everything else automatically.

      If the screenshot shows the GitHub "Authorize" page: tell them they're in exactly the right place — they need to SCROLL DOWN to the bottom of the page to find the big green "Authorize" button, then tap it. Amara handles everything after that automatically!

      If it shows a GitHub login page: tell them to log in first, then they'll see the Authorize button.

      If it shows something else: guide them warmly toward finding the green Authorize button.

      Be warm and specific — like a friend looking at their screen. Keep it short (2-3 sentences max).`,
      text ?? undefined
    );
    await sendMessage(chatId, guidance);
    return;
  }

  if (text && /\b(done|connected|authorized|finished|complete|tapped|clicked)\b/i.test(text)) {
    await typeMessage(chatId, `Checking now... ⏳ If you tapped the Authorize button, I should get the confirmation in just a few seconds! Give it a moment 😊`);
    return;
  }

  if (text) {
    const history = await getRecentConversation(student.id, 4);
    const reply = await geminiChat(
      history,
      text,
      `Student is on Day 2 of EEM26. They tapped the GitHub OAuth link and should be on the authorization page. They just need to tap the green "Authorize" button — Amara handles EVERYTHING else automatically (creates repos, uploads files, enables Pages).

IMPORTANT: On mobile phones, the green Authorize button is often at the BOTTOM of the page — the student may need to scroll down to see it. If they say they can't find the button, tell them to scroll down.

Answer their question warmly and briefly, then guide them to scroll down and tap Authorize. OAuth link if they lost it: ${oauthUrl}`,
      student.id
    );
    const geminiFailedFallback = reply.includes("Try again in a moment") || reply.includes("small hiccup") || reply.includes("Had a small hiccup");
    if (geminiFailedFallback) {
      await typeMessage(
        chatId,
        `The green <b>Authorize</b> button is at the <b>bottom</b> of the GitHub page — scroll down to find it! 👇\n\nIf you've lost the page, tap here again:\n<a href="${oauthUrl}">👉 Connect GitHub</a>`
      );
    } else {
      await sendMessage(chatId, reply);
    }
    return;
  }

  await typeMessage(chatId, `Still waiting for your GitHub connection 🔗\n\nTap the link below, log in if needed, then <b>scroll down</b> to find the green <b>Authorize</b> button and tap it — I'll create your sales pages automatically after that! 🚀\n\n<a href="${oauthUrl}">👉 Connect GitHub here</a>`);
}

async function resendOAuthLink(student: Student, chatId: number): Promise<void> {
  const oauthUrl = buildGitHubAuthUrl(String(chatId));
  await typeMessage(chatId, `Tap the link below to connect your GitHub account and I'll set up your sales pages automatically:\n\n<a href="${oauthUrl}">👉 Connect GitHub here</a>`);
}
