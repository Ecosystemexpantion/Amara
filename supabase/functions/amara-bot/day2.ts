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

  switch (student.current_step) {
    case 1: await handleStep1(student, chatId, text); break;
    case 2: await handleStep2(student, chatId, text, photo); break;
    default: await resendOAuthLink(student, chatId);
  }
}

// Step 1: Student says "ready" (or asks questions) → send GitHub OAuth link
async function handleStep1(student: Student, chatId: number, text: string | null): Promise<void> {
  const isReady = !text || /\b(ready|yes|start|begin|ok|okay|go|let.?s go|continue|sure|yep|yeah)\b/i.test(text);

  if (!isReady && text) {
    // Answer any questions before sending the link
    const history = await getRecentConversation(student.id, 6);
    const reply = await geminiChat(
      history,
      text,
      `Student is about to start Day 2 of EEM26. Today they will connect their GitHub account and Amara will automatically create their two live sales pages (EEM26page and EEM26premium) on GitHub Pages — the student doesn't have to touch any code or upload any files manually. Answer their question, then tell them to say "ready" when they want to start.`,
      student.id
    );
    await sendMessage(chatId, reply);
    return;
  }

  const oauthUrl = buildGitHubAuthUrl(String(chatId));

  await typeMessage(
    chatId,
    `<b>Day 2: Your Live Sales Pages! 🌐</b>\n\nToday I'm building your TWO sales pages — a normal version and a premium version. These are YOUR shop links from your Tech Stack 📦\n\nOnce done, you'll have live links to share anywhere and start making money 💰`
  );
  await typeMessage(
    chatId,
    `To do this, I need to connect to your GitHub account once. GitHub is where your pages will be hosted (it's free).\n\n<b>Tap the link below to connect GitHub to me — I'll set up EVERYTHING automatically after that! 🤖</b>\n\n<a href="${oauthUrl}">👉 Connect GitHub here</a>\n\n(If you don't have a GitHub account, the link will let you create one first)`
  );

  await advanceStep(student.id, 2, 2);
}

// Step 2: Waiting for the OAuth callback (github-oauth function will advance to step 0)
async function handleStep2(
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

  // Student sent a screenshot — look at it and give specific guidance
  if (photo) {
    const guidance = await geminiVisionGuide(
      photo.bytes,
      photo.mimeType,
      `Student is doing Day 2 of EEM26. They tapped a GitHub OAuth link and are trying to connect their GitHub account so Amara can automatically create their two sales pages.

      What they need to do: On the GitHub authorization page, they should tap the green "Authorize [app name]" button. That's the ONLY thing they need to do — just tap that green button and Amara handles everything else automatically.

      If the screenshot shows the GitHub "Authorize" page: tell them they're in exactly the right place, just tap that big green "Authorize" button and Amara will take it from there — they don't need to do anything else!

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
      `Student is on Day 2 of EEM26. They tapped the GitHub OAuth link and should be on the authorization page. They just need to tap the green "Authorize" button — Amara handles EVERYTHING else automatically (creates repos, uploads files, enables Pages). Answer their question warmly and briefly, then guide them to tap Authorize. OAuth link if they lost it: ${oauthUrl}`,
      student.id
    );
    await sendMessage(chatId, reply);
    return;
  }

  // No text, no photo — just resend the link
  await typeMessage(chatId, `Still waiting for your GitHub connection 🔗\n\nTap the link below, then tap the green <b>Authorize</b> button — I'll create your sales pages automatically after that! 🚀\n\n<a href="${oauthUrl}">👉 Connect GitHub here</a>`);
}

async function resendOAuthLink(student: Student, chatId: number): Promise<void> {
  const oauthUrl = buildGitHubAuthUrl(String(chatId));
  await typeMessage(chatId, `Tap the link below to connect your GitHub account and I'll set up your sales pages automatically:\n\n<a href="${oauthUrl}">👉 Connect GitHub here</a>`);
}
