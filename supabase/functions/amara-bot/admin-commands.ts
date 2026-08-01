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

  // skip stage2 — skip Payhip for all stuck Day 1 students, unlock Day 2 immediately
  if (/^skip\s+stage\s*2$/i.test(t)) {
    await skipStage2ForStuckStudents(chatId);
    return;
  }

  // announce saturday — blast "training is TODAY" to graduates + Day 4 students.
  // Optional time (Nigeria, PM assumed): "announce saturday 9:30"
  const announceMatch = t.match(/^announce\s+saturday(?:\s+(\d{1,2})[:.](\d{2}))?$/i);
  if (announceMatch) {
    const hour = announceMatch[1] ? parseInt(announceMatch[1], 10) : 8;
    const min = announceMatch[2] ? parseInt(announceMatch[2], 10) : 30;
    await announceSaturday(chatId, hour, min);
    return;
  }

  // skip [name] to day 3 — jump a specific student to SRE setup
  const skipToDay3Match = t.match(/^skip\s+(.+?)\s+to\s+(?:day\s*3|sre)/i);
  if (skipToDay3Match) {
    await skipStudentToDay3(chatId, skipToDay3Match[1].trim());
    return;
  }

  // confirm [name] — manually confirm Tech Stack purchase, unlock Day 2 GitHub step
  const confirmMatch = t.match(/^confirm\s+(.+)/i);
  if (confirmMatch) {
    await confirmTechStack(chatId, confirmMatch[1].trim());
    return;
  }

  // fix stuck [payhip-link] — apologize, send link to stuck students, complete Day 1
  const fixStuckMatch = t.match(/^fix\s+stuck\s+(https?:\/\/payhip\.com\/\S+)/i);
  if (fixStuckMatch) {
    const link = fixStuckMatch[1].replace(/[.,;!?]+$/, "");
    await fixStuckStudents(chatId, link);
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

// ── Fix stuck students — send payhip link + apologize + advance to Day 2 ────

async function fixStuckStudents(adminChatId: number, payhipLink: string): Promise<void> {
  const { data: stuck } = await supabase
    .from("amara_students")
    .select("id, telegram_chat_id, full_name, current_step")
    .eq("status", "ACTIVE")
    .eq("current_day", 1)
    .in("current_step", [4, 5]);

  if (!stuck || stuck.length === 0) {
    await sendMessage(adminChatId, "No students are currently stuck on stage 2 (Payhip steps).");
    return;
  }

  const now = new Date().toISOString();
  let count = 0;

  for (const s of stuck as { id: string; telegram_chat_id: string; full_name: string | null; current_step: number }[]) {
    await supabase
      .from("amara_students")
      .update({
        payhip_link: payhipLink,
        payhip_account_created: true,
        current_day: 2,
        current_step: 1,
        day1_completed_at: now,
        next_day_unlocks_at: null,
        updated_at: now,
      })
      .eq("id", s.id)
      .eq("current_day", 1);

    const firstName = s.full_name?.split(" ")[0] ?? "";
    await typeMessage(
      s.telegram_chat_id,
      `Hey ${firstName}! 😊 So sorry for keeping you waiting — Payhip was having some issues on their end.\n\nGood news — everything is sorted now! Here's your affiliate link:\n\n<code>${payhipLink}</code>\n\nYour <b>Day 2 is now UNLOCKED!</b> 🚀 Reply <b>"ready"</b> to continue! 💪`
    );
    count++;
  }

  const names = (stuck as { full_name: string | null }[]).map((s) => s.full_name ?? "unnamed").join(", ");
  await sendMessage(
    adminChatId,
    `✅ Sent apology + Payhip link to ${count} student(s) and unlocked Day 2:\n\n${names}`
  );
}

// ── Skip stage 2 for stuck students ──────────────────────────────────────────

async function skipStage2ForStuckStudents(adminChatId: number): Promise<void> {
  // Find all active students stuck anywhere in Day 1 step 4 or 5 (Payhip steps)
  const { data: stuck } = await supabase
    .from("amara_students")
    .select("id, telegram_chat_id, full_name, current_step")
    .eq("status", "ACTIVE")
    .eq("current_day", 1)
    .in("current_step", [4, 5]);

  if (!stuck || stuck.length === 0) {
    await sendMessage(adminChatId, "No students are currently stuck on stage 2 (Payhip steps).");
    return;
  }

  const now = new Date().toISOString();
  let count = 0;

  for (const s of stuck as { id: string; telegram_chat_id: string; full_name: string | null; current_step: number }[]) {
    // Mark Day 1 complete and unlock Day 2 immediately (step 1 = ready to start)
    await supabase
      .from("amara_students")
      .update({
        current_day: 2,
        current_step: 1,
        day1_completed_at: now,
        next_day_unlocks_at: null,
        updated_at: now,
      })
      .eq("id", s.id)
      .eq("current_day", 1);

    await typeMessage(
      s.telegram_chat_id,
      `Great news! 🎉 Coach Victor has personally promised to complete your <b>Payhip affiliate setup</b> for you during the <b>Final Stage Setup session on Saturday at 8:30 PM Nigeria time</b>! 🏆\n\n👉 <a href="https://t.me/+kU414VXm1N0zYjQ8">Join the group here</a> so you don't miss it — Coach Victor will handle your Payhip link there!\n\nIn the meantime, your <b>Day 2 is now UNLOCKED!</b> 🚀 Let's keep moving — reply <b>"ready"</b> to continue! 💪`
    );
    count++;
  }

  const names = (stuck as { full_name: string | null }[]).map((s) => s.full_name ?? "unnamed").join(", ");
  await sendMessage(
    adminChatId,
    `✅ Skipped stage 2 and unlocked Day 2 for ${count} student(s):\n\n${names}\n\nThey've been told Coach Victor will handle their Payhip setup on Saturday.`
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
    const now = new Date().toISOString();
    const { count } = await supabase
      .from("amara_students")
      .update({
        current_day: 2,
        current_step: 1,
        day1_completed_at: now,
        next_day_unlocks_at: null,
        updated_at: now,
      })
      .eq("id", s.id)
      .eq("current_step", 5);

    if ((count ?? 0) === 0) continue;

    await typeMessage(
      s.telegram_chat_id,
      `Great news! 🎉 Your Payhip affiliate account has been <b>approved!</b> ✅\n\nYour <b>Day 2 is now UNLOCKED!</b> 🚀 Let's keep moving — reply <b>"ready"</b> to continue! 💪`
    );
  }

  const names = (waiting as { full_name: string | null }[]).map((s) => s.full_name ?? "unnamed").join(", ");
  await sendMessage(adminChatId, `✅ Approved ${waiting.length} student(s) and unlocked Day 2: ${names}`);
}

// ── Help ──────────────────────────────────────────────────────────────────────

async function sendHelp(chatId: number): Promise<void> {
  await sendMessage(
    chatId,
    `<b>Admin commands:</b>\n\n` +
    `<code>approved</code> → Release students waiting for Payhip affiliate approval.\n\n` +
    `<code>skip stage2</code> → Skip Payhip for ALL students stuck on Day 1 Steps 4–5, tell them Coach Victor will handle it on Saturday, and unlock Day 2 immediately.\n\n` +
    `<code>fix stuck [payhip-link]</code> → Apologize to stuck students, send them the Payhip link, save it, and unlock Day 2.\nExample: <code>fix stuck https://payhip.com/b/xeqSM/af69dc0c939dc7a</code>\n\n` +
    `<code>confirm [name]</code> → Manually confirm a student's Tech Stack purchase and unlock their Day 2 setup.\nExample: <code>confirm Funke Adams</code>\n\n` +
    `<code>skip [name] to day 3</code> → Skip a specific student to Day 3 (SRE bot setup).\nExample: <code>skip Funke Adams to day 3</code>\n\n` +
    `<code>announce saturday</code> → Blast "training is TONIGHT at 8:30 PM" to all graduates + Day 4 students.\nCustom time: <code>announce saturday 9:30</code> (PM Nigeria time)\n\n` +
    `<b>Create pages:</b> Just send a message with a Payhip link — I'll ask to confirm, then send a GitHub authorization link.\n\n` +
    `<code>list</code> → Show all active students and their current day/step.`
  );
}

// ── Confirm Tech Stack purchase — unlock Day 2 GitHub step ──────────────────

async function confirmTechStack(adminChatId: number, name: string): Promise<void> {
  const { data: matches } = await supabase
    .from("amara_students")
    .select("id, telegram_chat_id, full_name, current_day, current_step, status")
    .eq("status", "ACTIVE")
    .ilike("full_name", `%${name}%`);

  if (!matches || matches.length === 0) {
    await sendMessage(adminChatId, `❌ No active student found matching "<b>${name}</b>".`);
    return;
  }

  if (matches.length > 1) {
    const list = (matches as { full_name: string | null; current_day: number; current_step: number }[])
      .map(s => `• ${s.full_name ?? "unnamed"} (Day ${s.current_day}, Step ${s.current_step})`)
      .join("\n");
    await sendMessage(adminChatId, `Multiple students match "<b>${name}</b>":\n\n${list}\n\nPlease use a more specific name.`);
    return;
  }

  const student = matches[0] as { id: string; telegram_chat_id: string; full_name: string | null; current_day: number; current_step: number };

  if (student.current_day !== 2 || student.current_step !== 1) {
    await sendMessage(adminChatId, `<b>${student.full_name}</b> is on Day ${student.current_day} Step ${student.current_step} — not waiting for Tech Stack confirmation.`);
    return;
  }

  await supabase
    .from("amara_students")
    .update({
      current_step: 2,
      screenshot_attempts: 0,
      updated_at: new Date().toISOString(),
    })
    .eq("id", student.id);

  await typeMessage(
    student.telegram_chat_id,
    `Your Tech Stack purchase has been confirmed! ✅ Let's build your sales pages now! 🔥\n\nTo create your pages I need to connect to a <b>GitHub account</b>.\n\nDo you already have a GitHub account, or do I need to help you create one first? 🙋`
  );

  await sendMessage(adminChatId, `✅ Confirmed <b>${student.full_name}</b> — they've been moved to GitHub setup.`);
}

// ── Skip a specific student to Day 3 (SRE setup) ───────────────────────────

async function skipStudentToDay3(adminChatId: number, name: string): Promise<void> {
  const { data: matches } = await supabase
    .from("amara_students")
    .select("id, telegram_chat_id, full_name, current_day, current_step, status")
    .eq("status", "ACTIVE")
    .ilike("full_name", `%${name}%`);

  if (!matches || matches.length === 0) {
    await sendMessage(adminChatId, `❌ No active student found matching "<b>${name}</b>".`);
    return;
  }

  if (matches.length > 1) {
    const list = (matches as { full_name: string | null; current_day: number; current_step: number }[])
      .map(s => `• ${s.full_name ?? "unnamed"} (Day ${s.current_day}, Step ${s.current_step})`)
      .join("\n");
    await sendMessage(adminChatId, `Multiple students match "<b>${name}</b>":\n\n${list}\n\nPlease use a more specific name.`);
    return;
  }

  const student = matches[0] as { id: string; telegram_chat_id: string; full_name: string | null; current_day: number; current_step: number };

  if (student.current_day >= 3) {
    await sendMessage(adminChatId, `<b>${student.full_name}</b> is already on Day ${student.current_day} Step ${student.current_step} — no skip needed.`);
    return;
  }

  const now = new Date().toISOString();
  await supabase
    .from("amara_students")
    .update({
      current_day: 3,
      current_step: 1,
      day1_completed_at: student.current_day < 1 ? now : undefined,
      day2_completed_at: student.current_day < 2 ? now : undefined,
      next_day_unlocks_at: null,
      updated_at: now,
    })
    .eq("id", student.id);

  const firstName = student.full_name?.split(" ")[0] ?? "";
  await typeMessage(
    student.telegram_chat_id,
    `Hey ${firstName}! 🔥 Great news — let's jump straight to <b>Day 3: Your AI Sales Bot (SRE)!</b> 🤖\n\nToday you get your own AI bot that sells for you 24/7. Here's what to do:\n\n1️⃣ Open Telegram and search for <b>@BotFather</b>\n2️⃣ Send <b>/newbot</b>\n3️⃣ Choose a display name (like "${firstName} EEM26 Assistant")\n4️⃣ Choose a username (must end in "bot", like "${firstName.toLowerCase()}eem26bot")\n5️⃣ Copy the <b>token</b> BotFather gives you and paste it right here\n\nI'll handle everything else automatically — no coding needed! 💪`
  );

  await sendMessage(
    adminChatId,
    `✅ Skipped <b>${student.full_name}</b> to Day 3 Step 1 (SRE setup). They've been messaged with BotFather instructions.`
  );
}

// ── Announce Saturday training ───────────────────────────────────────────────

async function announceSaturday(adminChatId: number, pmHour = 8, minute = 30): Promise<void> {
  const timeLabel = `${pmHour}:${String(minute).padStart(2, "0")} PM`;

  // 1. ALL COMPLETED graduates — no matter when they finished. The admin
  // controls when to blast, so every graduate hears about the session.
  const { data: graduates } = await supabase
    .from("amara_students")
    .select("telegram_chat_id")
    .eq("status", "COMPLETED");

  const eligibleGrads: { telegram_chat_id: string }[] = graduates ?? [];

  // 2. Day 4 active students
  const { data: day4Students } = await supabase
    .from("amara_students")
    .select("telegram_chat_id")
    .eq("status", "ACTIVE")
    .eq("current_day", 4);

  const allChatIds = new Set<string>();
  for (const s of eligibleGrads) allChatIds.add(String(s.telegram_chat_id));
  for (const s of day4Students ?? []) allChatIds.add(String(s.telegram_chat_id));

  if (allChatIds.size === 0) {
    await sendMessage(adminChatId, "No eligible students to announce to right now.");
    return;
  }

  const announcement =
    `🚨 <b>TODAY is the day!</b>\n\n` +
    `Coach Victor's <b>Final Stage Setup session</b> is <b>TONIGHT at ${timeLabel} Nigeria time!</b> 🎯\n\n` +
    `👉 <a href="https://t.me/+kU414VXm1N0zYjQ8">Join the group here</a>\n\n` +
    `Be there — this is where your business goes live! 🔥`;

  let sent = 0;
  for (const chatId of allChatIds) {
    try {
      await sendMessage(Number(chatId), announcement);
      sent++;
    } catch (e) {
      console.error(`Failed to send Saturday announcement to ${chatId}:`, e);
    }
  }

  await sendMessage(adminChatId, `✅ Saturday announcement sent to <b>${sent}</b> student(s).`);
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
