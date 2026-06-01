import { sendMessage, sendChatAction, typeMessage } from "./telegram.ts";
import { advanceStep, getRecentConversation } from "./db.ts";
import { geminiChat } from "./gemini.ts";
import { buildGitHubAuthUrl } from "./github.ts";
import type { Student, TelegramMessage } from "./types.ts";

export async function handleDay2(
  _msg: TelegramMessage,
  student: Student,
  chatId: number,
  text: string | null,
  _photo: { bytes: Uint8Array; mimeType: string } | null
): Promise<void> {
  await sendChatAction(chatId, "typing");

  switch (student.current_step) {
    case 1: await handleStep1(student, chatId, text); break;
    case 2: await handleStep2(student, chatId, text); break;
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
// If student messages here, remind them and resend the link
async function handleStep2(student: Student, chatId: number, text: string | null): Promise<void> {
  // If github_access_token is already set, the callback completed but step wasn't advanced
  // (shouldn't happen, but guard it)
  if (student.github_access_token) {
    await typeMessage(chatId, `Your GitHub is already connected! 🎉 Your sales pages are being set up — check back in a moment and I'll have both live links for you!`);
    return;
  }

  const oauthUrl = buildGitHubAuthUrl(String(chatId));

  if (text && /\b(done|connected|authorized|finished|complete)\b/i.test(text)) {
    await typeMessage(chatId, `Almost there! If you completed the authorization, GitHub is sending me the confirmation now — just give it a few seconds! ⏳\n\nIf you're still seeing a GitHub page, tap Authorize to complete it 👆`);
    return;
  }

  if (text) {
    const history = await getRecentConversation(student.id, 4);
    const reply = await geminiChat(
      history,
      text,
      `Student is waiting to connect their GitHub account via the OAuth link. They haven't connected yet. Answer their question briefly, then remind them to tap the authorization link. Link: ${oauthUrl}`,
      student.id
    );
    await sendMessage(chatId, reply);
  }

  // Always re-send the link so it's easy to find
  await typeMessage(chatId, `Still waiting for your GitHub connection 🔗\n\nTap the link below to authorize:\n<a href="${oauthUrl}">👉 Connect GitHub here</a>\n\nOnce you tap and authorize, I'll automatically create your sales pages! 🚀`);
}

async function resendOAuthLink(student: Student, chatId: number): Promise<void> {
  const oauthUrl = buildGitHubAuthUrl(String(chatId));
  await typeMessage(chatId, `Tap the link below to connect your GitHub account and I'll set up your sales pages automatically:\n\n<a href="${oauthUrl}">👉 Connect GitHub here</a>`);
}
