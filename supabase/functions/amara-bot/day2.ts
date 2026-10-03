import { sendMessage, sendChatAction, typeMessage } from "./telegram.ts";
import { advanceStep, getRecentConversation } from "./db.ts";
import { geminiChat, geminiVisionGuide } from "./gemini.ts";
import { buildGitHubAuthUrl } from "./github.ts";
import type { Student, TelegramMessage } from "./types.ts";

export async function handleDay2(
  _msg: TelegramMessage,
  student: Student,
  chatId: number,
  text: string | null,
  photo: { bytes: Uint8Array; mimeType: string } | null
): Promise<void> {
  await sendChatAction(chatId, "typing");

  // Step 1 (Tech Stack payment) now happens at the Day 1 lock — see day1.ts.
  switch (student.current_step) {
    case 2: await handleGitHubAccount(student, chatId, text, photo); break;
    case 3: await handleGitHubOAuth(student, chatId, text, photo); break;
    default: await resendOAuthLink(student, chatId);
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
      `Student is on Day 2 of EEM26. Amara asked if they have a GitHub account.

IMPORTANT — look at what's in the screenshot:

1. If they're on the GitHub HOME PAGE, DASHBOARD, or PROFILE (they're logged in):
   → They ALREADY have a GitHub account! Tell them: "You already have a GitHub account — that's all I needed to know! 🎉 Just type 'yes' or 'I have one' in the chat and I'll send you the connection link to build your sales pages automatically!"
   → Do NOT tell them to create a repository, tap plus icons, or do anything on GitHub. Amara handles everything automatically.

2. If they're on the GitHub SIGNUP page:
   → Guide them to fill in username, email, password, verify email, and finish creating their account. Once done, come back and tell Amara.

3. If they're on the GitHub LOGIN page:
   → Tell them to log in with their email and password. Once logged in, come back to Amara and type "I have one" or "yes".

4. If they're somewhere else on GitHub (settings, repos list, etc.):
   → They have an account! Tell them to come back to Amara's chat and type "yes" or "I have a GitHub account".

NEVER tell the student to create a repository, tap plus icons, or navigate GitHub menus. Amara creates everything automatically once they connect their account.

Be warm, short (2-3 sentences), and specific about what you see on their screen.`,
      text ?? undefined
    );
    await sendMessage(chatId, guidance);
    return;
  }

  const isFirstTrigger = !text || /^(ready|yes|start|begin|ok|okay|go|sure|yep|yeah|let.?s go)$/i.test(text.trim());
  const alreadyAsked = history.some(m => m.message.toLowerCase().includes("github account"));

  if (isFirstTrigger && !alreadyAsked) {
    await sendGitHubIntro(chatId);
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
    `Student is on Day 2 of EEM26. Amara asked whether they have a GitHub account.

If they DON'T have one: guide them to github.com/signup (free, 2 minutes) — fill in username, email, password, verify email.
If they DO have one or just created one: tell them to tap this link to connect: ${oauthUrl} — on mobile they need to scroll down to tap the green Authorize button.

IMPORTANT: Do NOT tell the student to create repositories, tap plus icons, or navigate GitHub menus. Amara creates EVERYTHING automatically once they connect. The student only needs to: 1) have a GitHub account, 2) tap the OAuth link, 3) tap the green Authorize button.`,
    student.id
  );
  await sendMessage(chatId, reply);
}

export async function sendGitHubIntro(chatId: number | string): Promise<void> {
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
