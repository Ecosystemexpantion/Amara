// Admin commands — only reachable when the message comes from ADMIN_CHAT_ID.
//
// Usage:
//   approved → approve Payhip affiliate accounts for students awaiting approval
//   Send any message containing a payhip link → Amara asks to confirm → tap Yes
//   list → Show all active students

import { sendMessage, sendWithKeyboard, answerCallbackQuery, typeMessage } from "./telegram.ts";
import { getPendingEscalation, answerEscalation, skipEscalation, pendingCount } from "./knowledge.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// ── Entry point (text messages) ───────────────────────────────────────────────

export async function handleAdminCommand(chatId: number, text: string): Promise<void> {
  const t = text.trim();

  // list
  if (/^list\b/i.test(t)) {
    await listStudents(chatId);
    return;
  }

  // approved — release students waiting for Payhip affiliate approval
  if (/^approved$/i.test(t)) {
    await approvePayhipStudents(chatId);
    return;
  }

  // Detect a payhip link anywhere in the message
  const payhipMatch = t.match(/https?:\/\/payhip\.com\/\S+/i);
  if (payhipMatch) {
    const payhipLink = payhipMatch[0].replace(/[.,;!?]+$/, ""); // strip trailing punctuation
    await sendWithKeyboard(
      chatId,
      `Create pages for this Payhip link?\n\n<code>${payhipLink}</code>`,
      [[
        { text: "✅ Yes, create pages", callback_data: `setup:${payhipLink}` },
        { text: "❌ Cancel",            callback_data: "setup_cancel" },
      ]]
    );
    return;
  }

  // ── Default: check if this is a reply to a pending escalation ───────────────
  const pending = await getPendingEscalation();
  if (pending) {
    if (/^skip$/i.test(t)) {
      await skipEscalation(pending.id);
      const remaining = await pendingCount();
      await sendMessage(chatId, `Skipped. ${remaining > 0 ? `${remaining} question(s) still waiting.` : "No more pending questions."}`);
      return;
    }
    // Any other text = the answer
    await answerEscalation(pending, t);
    const remaining = await pendingCount();
    const sentTo = pending.source === "student_bot"
      ? `customer via <b>${pending.bot_name ?? "student bot"}</b>`
      : `<b>${pending.student_name ?? "student"}</b>`;
    await sendMessage(
      chatId,
      `✅ Answer sent to ${sentTo} and saved to Amara's knowledge base 🧠\n\n` +
      (remaining > 0
        ? `📩 <b>${remaining} more question(s) waiting.</b> Next one:\n\n"${(await getPendingEscalation())?.question ?? ""}"\n\nJust reply with the answer.`
        : `No more pending questions.`)
    );
    return;
  }

  await sendHelp(chatId);
}

// ── Entry point (button taps / callback queries) ──────────────────────────────

export async function handleAdminCallback(
  chatId: number,
  callbackQueryId: string,
  data: string
): Promise<void> {
  await answerCallbackQuery(callbackQueryId);

  if (data === "setup_cancel") {
    await sendMessage(chatId, "Cancelled.");
    return;
  }

  if (data.startsWith("setup:")) {
    const payhipLink = data.slice("setup:".length);
    await sendGitHubAuthLink(chatId, payhipLink);
    return;
  }
}

// ── Send GitHub OAuth link to admin ──────────────────────────────────────────

async function sendGitHubAuthLink(adminChatId: number, payhipLink: string): Promise<void> {
  const clientId   = Deno.env.get("GITHUB_OAUTH_CLIENT_ID");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");

  if (!clientId) {
    await sendMessage(adminChatId, `❌ <b>GITHUB_OAUTH_CLIENT_ID</b> not set in Supabase secrets.`);
    return;
  }

  // State encodes: admin:[chat_id]:[payhip_link]
  // github-oauth function detects "admin:" prefix and handles separately
  const state       = `admin:${adminChatId}:${payhipLink}`;
  const callbackUrl = `${supabaseUrl}/functions/v1/github-oauth`;
  const oauthUrl    =
    `https://github.com/login/oauth/authorize` +
    `?client_id=${clientId}` +
    `&scope=repo` +
    `&state=${encodeURIComponent(state)}` +
    `&redirect_uri=${encodeURIComponent(callbackUrl)}`;

  await sendMessage(
    adminChatId,
    `Tap to authorize GitHub — I'll create the pages automatically:\n\n` +
    `<a href="${oauthUrl}">👉 Authorize GitHub</a>\n\n` +
    `You'll be back in Telegram within seconds ✅`
  );
}

// ── Approve Payhip students ───────────────────────────────────────────────────

async function approvePayhipStudents(adminChatId: number): Promise<void> {
  const { data: waiting } = await supabase
    .from("amara_students")
    .select("id, telegram_chat_id, full_name")
    .eq("status", "ACTIVE")
    .eq("current_day", 1)
    .eq("current_step", 5);

  if (!waiting || waiting.length === 0) {
    await sendMessage(adminChatId, "No students are currently waiting for Payhip approval.");
    return;
  }

  for (const s of waiting as { id: string; telegram_chat_id: string; full_name: string | null }[]) {
    const { count } = await supabase
      .from("amara_students")
      .update({ current_step: 6, updated_at: new Date().toISOString() })
      .eq("id", s.id)
      .eq("current_step", 5); // optimistic lock

    if ((count ?? 0) === 0) continue;

    await typeMessage(
      s.telegram_chat_id,
      `Great news! 🎉 Your Payhip affiliate account has been <b>approved!</b>\n\nNow go to your Payhip dashboard and find your <b>affiliate link</b> — it looks like <code>payhip.com/YourUsername</code> 🔗\n\nCopy it and paste it here!`
    );
  }

  const names = (waiting as { full_name: string | null }[]).map((s) => s.full_name ?? "unnamed").join(", ");
  await sendMessage(adminChatId, `✅ Approved and notified ${waiting.length} student(s): ${names}\n\nThey're now collecting their Payhip affiliate link!`);
}

// ── Help ──────────────────────────────────────────────────────────────────────

async function sendHelp(chatId: number): Promise<void> {
  await sendMessage(
    chatId,
    `<b>Admin commands:</b>\n\n` +
    `<code>approved</code> → Release students waiting for Payhip affiliate approval.\n\n` +
    `<b>Create pages:</b> Just send a message with a Payhip link — I'll ask to confirm, then send a GitHub authorization link.\n\n` +
    `<code>list</code> → Show all active students and their current day/step.`
  );
}

// ── List students ─────────────────────────────────────────────────────────────

async function listStudents(chatId: number): Promise<void> {
  const { data } = await supabase
    .from("amara_students")
    .select("full_name, current_day, current_step, status, sales_page_link")
    .eq("status", "ACTIVE")
    .order("created_at", { ascending: false })
    .limit(30);

  if (!data || data.length === 0) {
    await sendMessage(chatId, "No active students yet.");
    return;
  }

  const lines = (data as Record<string, string | number>[]).map((s) =>
    `• <b>${s.full_name ?? "unnamed"}</b> — Day ${s.current_day}, Step ${s.current_step}` +
    (s.sales_page_link ? ` ✅` : ` ❌`)
  );

  await sendMessage(chatId, `<b>Active students (${data.length}):</b>\n\n${lines.join("\n")}`);
}
