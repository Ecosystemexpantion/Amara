// Admin commands — only reachable when the message comes from ADMIN_CHAT_ID.
//
// Commands:
//   setup [chat_id] [payhip link]    → Day 2: create GitHub Pages for student
//   day3  [chat_id] [bot_token]      → Day 3: register student's Telegram bot
//   advance [chat_id] [day]          → Manually move student to any day
//   list                             → Show all active students
//
// [chat_id] is the student's Telegram numeric chat ID.
// Works for both registered Amara students and brand-new ones.

import { sendMessage } from "./telegram.ts";
import { modifyTemplateForStudent } from "./html-modifier.ts";
import { updateStudent, computeNextUnlockAt } from "./db.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import type { Student } from "./types.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);
const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;

// ── Entry point ───────────────────────────────────────────────────────────────

export async function handleAdminCommand(chatId: number, text: string): Promise<void> {
  const t = text.trim();
  if (!t) {
    await sendHelp(chatId);
    return;
  }

  // setup [chat_id] [payhip_url]
  const setupMatch = t.match(/^setup\s+(\d+)\s+(https?:\/\/\S+)$/i);
  if (setupMatch) {
    await runDay2Setup(chatId, setupMatch[1], setupMatch[2].trim());
    return;
  }

  // day3 [chat_id] [bot_token]
  const day3Match = t.match(/^day3\s+(\d+)\s+(\d{8,10}:[A-Za-z0-9_-]{35,})$/i);
  if (day3Match) {
    await runDay3Setup(chatId, day3Match[1], day3Match[2].trim());
    return;
  }

  // advance [chat_id] [day_number]
  const advanceMatch = t.match(/^advance\s+(\d+)\s+(\d)$/i);
  if (advanceMatch) {
    await runAdvance(chatId, advanceMatch[1], parseInt(advanceMatch[2]));
    return;
  }

  // list — show all active students
  if (/^list\b/i.test(t)) {
    await listStudents(chatId);
    return;
  }

  await sendHelp(chatId);
}

// ── Help ──────────────────────────────────────────────────────────────────────

async function sendHelp(chatId: number): Promise<void> {
  await sendMessage(
    chatId,
    `<b>Admin commands:</b>\n\n` +
    `<code>setup [chat_id] [payhip link]</code>\n` +
    `→ Day 2: creates GitHub Pages under your account,\n` +
    `  saves the links, messages the student.\n\n` +
    `<code>day3 [chat_id] [bot_token]</code>\n` +
    `→ Day 3: registers the student's Telegram bot\n` +
    `  and sets up the webhook automatically.\n\n` +
    `<code>advance [chat_id] [day]</code>\n` +
    `→ Move a student to any day (1–4).\n\n` +
    `<code>list</code>\n` +
    `→ Show all active students and their current day/step.\n\n` +
    `<b>How to get a student's chat_id:</b>\n` +
    `Ask them to forward any message to @userinfobot — it shows their ID.\n\n` +
    `<b>Required secrets:</b>\n` +
    `<code>ADMIN_GITHUB_TOKEN</code> — personal access token (repo scope)\n` +
    `<code>ADMIN_GITHUB_USERNAME</code> — your GitHub username`
  );
}

// ── List students ─────────────────────────────────────────────────────────────

async function listStudents(chatId: number): Promise<void> {
  const { data } = await supabase
    .from("amara_students")
    .select("full_name, telegram_chat_id, current_day, current_step, status, sales_page_link")
    .eq("status", "ACTIVE")
    .order("created_at", { ascending: false })
    .limit(30);

  if (!data || data.length === 0) {
    await sendMessage(chatId, "No active students yet.");
    return;
  }

  const lines = (data as Record<string, string | number>[]).map((s) =>
    `• <b>${s.full_name ?? "unnamed"}</b> [<code>${s.telegram_chat_id}</code>] — Day ${s.current_day}, Step ${s.current_step}` +
    (s.sales_page_link ? ` ✅` : ` ❌ no page yet`)
  );

  await sendMessage(chatId, `<b>Active students (${data.length}):</b>\n\n${lines.join("\n")}`);
}

// ── Shared: resolve or create student by chat ID ──────────────────────────────

async function resolveStudent(studentChatId: string): Promise<Student> {
  const { data: existing } = await supabase
    .from("amara_students")
    .select("*")
    .eq("telegram_chat_id", studentChatId)
    .single();

  if (existing) return existing as Student;

  // Not registered yet — fetch their name from Telegram, then create a record
  const name = await fetchTelegramName(studentChatId);

  const { data: created, error } = await supabase
    .from("amara_students")
    .insert({
      telegram_chat_id: studentChatId,
      full_name: name,
      status: "ACTIVE",
      current_day: 1,
      current_step: 0,
    })
    .select("*")
    .single();

  if (error || !created) throw new Error(`Could not create student record: ${error?.message}`);
  return created as Student;
}

async function fetchTelegramName(chatId: string): Promise<string> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getChat?chat_id=${chatId}`);
    const json = await res.json();
    if (json.ok) {
      const c = json.result;
      return [c.first_name, c.last_name].filter(Boolean).join(" ") || c.username || "Student";
    }
  } catch (_) { /* ignore */ }
  return "Student";
}

// ── Day 2: GitHub Pages setup ─────────────────────────────────────────────────

async function runDay2Setup(adminChatId: number, studentChatId: string, payhipLink: string): Promise<void> {
  await sendMessage(adminChatId, `Looking up student [<code>${studentChatId}</code>]... ⏳`);

  let student: Student;
  try {
    student = await resolveStudent(studentChatId);
  } catch (e) {
    await sendMessage(adminChatId, `❌ Could not resolve student: ${String(e).slice(0, 200)}`);
    return;
  }

  const isNew = !student.sales_page_link;
  await sendMessage(
    adminChatId,
    `${isNew ? "🆕 New student" : "Found"}: <b>${student.full_name}</b> (Day ${student.current_day}, Step ${student.current_step})\n\nSetting up GitHub Pages now... ⏳`
  );

  // GitHub credentials
  const ghToken = Deno.env.get("ADMIN_GITHUB_TOKEN");
  const ghUser  = Deno.env.get("ADMIN_GITHUB_USERNAME");
  if (!ghToken || !ghUser) {
    await sendMessage(adminChatId, `❌ <b>ADMIN_GITHUB_TOKEN</b> or <b>ADMIN_GITHUB_USERNAME</b> not set in Supabase secrets.`);
    return;
  }

  // Load + customise HTML templates
  let normalHtml: string;
  let premiumHtml: string;
  try {
    const normalRaw  = await Deno.readTextFile(new URL("./index_normal.html",  import.meta.url));
    const premiumRaw = await Deno.readTextFile(new URL("./index_premium.html", import.meta.url));
    normalHtml  = modifyTemplateForStudent(normalRaw,  payhipLink);
    premiumHtml = modifyTemplateForStudent(premiumRaw, payhipLink);
  } catch (e) {
    await sendMessage(adminChatId, `❌ Failed to load HTML templates: ${String(e).slice(0, 150)}`);
    return;
  }

  // Unique repo names per student
  const suffix      = student.id.slice(0, 6);
  const repoNormal  = `eem26page-${suffix}`;
  const repoPremium = `eem26premium-${suffix}`;

  // GitHub operations
  try {
    await createRepo(ghToken, repoNormal,  "EEM26 Sales Page");
    await createRepo(ghToken, repoPremium, "EEM26 Premium Sales Page");
    await uploadFile(ghToken, ghUser, repoNormal,  new TextEncoder().encode(normalHtml));
    await uploadFile(ghToken, ghUser, repoPremium, new TextEncoder().encode(premiumHtml));
    await enablePages(ghToken, ghUser, repoNormal);
    await enablePages(ghToken, ghUser, repoPremium);
  } catch (e) {
    await sendMessage(adminChatId, `❌ GitHub error: <code>${String(e).slice(0, 300)}</code>`);
    return;
  }

  const normalUrl  = `https://${ghUser}.github.io/${repoNormal}/`;
  const premiumUrl = `https://${ghUser}.github.io/${repoPremium}/`;
  const now        = new Date().toISOString();
  const newDay     = student.current_day > 2 ? student.current_day  : 2;
  const newStep    = student.current_day > 2 ? student.current_step : 0;

  try {
    await updateStudent(student.id, {
      payhip_link:         payhipLink,
      github_repo_normal:  normalUrl,
      github_repo_premium: premiumUrl,
      sales_page_link:     normalUrl,
      day2_completed_at:   now,
      next_day_unlocks_at: newStep === 0 ? computeNextUnlockAt() : (student.next_day_unlocks_at ?? computeNextUnlockAt()),
      current_day:         newDay,
      current_step:        newStep,
    });
  } catch (e) {
    await sendMessage(adminChatId, `⚠️ GitHub done but DB update failed: <code>${String(e).slice(0, 200)}</code>`);
    return;
  }

  // Message the student
  const firstName = (student.full_name ?? "Student").split(" ")[0];
  await sendMessage(
    studentChatId,
    `🎉 <b>Your sales pages are LIVE, ${firstName}!</b>\n\n` +
    `Give GitHub 1-2 minutes to publish them fully:\n\n` +
    `📌 <b>Normal page:</b>\n${normalUrl}\n\n` +
    `⭐ <b>Premium page:</b>\n${premiumUrl}\n\n` +
    `Day 3 unlocks tomorrow at 8AM Nigeria time — I'll ping you then! 🚀`
  );

  await sendMessage(
    adminChatId,
    `✅ <b>Day 2 done for ${student.full_name}!</b>\n\n` +
    `📌 Normal: ${normalUrl}\n` +
    `⭐ Premium: ${premiumUrl}\n\n` +
    `Student notified. Day 3 unlocks at 8AM tomorrow.`
  );
}

// ── Day 3: Telegram bot setup ─────────────────────────────────────────────────

async function runDay3Setup(adminChatId: number, studentChatId: string, botToken: string): Promise<void> {
  await sendMessage(adminChatId, `Looking up student [<code>${studentChatId}</code>]... ⏳`);

  let student: Student;
  try {
    student = await resolveStudent(studentChatId);
  } catch (e) {
    await sendMessage(adminChatId, `❌ Could not resolve student: ${String(e).slice(0, 200)}`);
    return;
  }

  await sendMessage(adminChatId, `Found: <b>${student.full_name}</b>\n\nVerifying bot token and setting up webhook... ⏳`);

  // Verify token via getMe
  const getMeRes = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
  const botInfo = await getMeRes.json();
  if (!botInfo.ok) {
    await sendMessage(adminChatId, `❌ Invalid bot token — getMe failed: <code>${JSON.stringify(botInfo).slice(0, 150)}</code>`);
    return;
  }
  const botUsername = botInfo.result.username;

  // Set webhook to student-bot function
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const webhookUrl  = `${supabaseUrl}/functions/v1/student-bot/${student.id}`;
  const hookRes = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: webhookUrl }),
  });
  const hookJson = await hookRes.json();
  if (!hookJson.ok) {
    await sendMessage(adminChatId, `⚠️ Webhook set failed: <code>${JSON.stringify(hookJson).slice(0, 200)}</code>`);
  }

  // Update DB
  const newDay  = student.current_day > 3 ? student.current_day  : 3;
  const newStep = student.current_day > 3 ? student.current_step : 0;
  try {
    await updateStudent(student.id, {
      bot_token:           botToken,
      day3_completed_at:   new Date().toISOString(),
      next_day_unlocks_at: newStep === 0 ? computeNextUnlockAt() : (student.next_day_unlocks_at ?? computeNextUnlockAt()),
      current_day:         newDay,
      current_step:        newStep,
    });
  } catch (e) {
    await sendMessage(adminChatId, `⚠️ Webhook set but DB update failed: <code>${String(e).slice(0, 200)}</code>`);
    return;
  }

  const firstName = (student.full_name ?? "Student").split(" ")[0];
  await sendMessage(
    studentChatId,
    `<b>YOUR BOT IS LIVE! 🤖🔥</b>\n\n` +
    `@${botUsername} is now running 24/7 — I set everything up automatically!\n\n` +
    `Rest up — <b>Day 4 unlocks tomorrow at 8AM Nigeria time</b> 🎓`
  );

  await sendMessage(
    adminChatId,
    `✅ <b>Day 3 done for ${student.full_name}!</b>\n\n` +
    `🤖 Bot: @${botUsername}\n` +
    `🔗 Webhook: ${webhookUrl}\n\n` +
    `Student notified. Day 4 unlocks at 8AM tomorrow.`
  );
}

// ── Advance: manually move student to a day ───────────────────────────────────

async function runAdvance(adminChatId: number, studentChatId: string, day: number): Promise<void> {
  if (day < 1 || day > 4) {
    await sendMessage(adminChatId, `❌ Day must be between 1 and 4.`);
    return;
  }

  let student: Student;
  try {
    student = await resolveStudent(studentChatId);
  } catch (e) {
    await sendMessage(adminChatId, `❌ Could not resolve student: ${String(e).slice(0, 200)}`);
    return;
  }

  try {
    await updateStudent(student.id, {
      current_day:  day,
      current_step: 1,
    });
  } catch (e) {
    await sendMessage(adminChatId, `❌ DB update failed: ${String(e).slice(0, 200)}`);
    return;
  }

  await sendMessage(
    adminChatId,
    `✅ <b>${student.full_name}</b> advanced to Day ${day}, Step 1.`
  );
}

// ── GitHub API helpers ────────────────────────────────────────────────────────

function ghHeaders(token: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": "Amara-EEM26/1.0",
  };
}

async function createRepo(token: string, name: string, description: string): Promise<void> {
  const res = await fetch("https://api.github.com/user/repos", {
    method: "POST",
    headers: ghHeaders(token),
    body: JSON.stringify({ name, description, private: false, auto_init: true }),
  });
  if (!res.ok && res.status !== 422) {
    throw new Error(`createRepo(${name}) → ${res.status}: ${await res.text()}`);
  }
  await res.body?.cancel();
}

async function uploadFile(token: string, owner: string, repo: string, content: Uint8Array): Promise<void> {
  let sha: string | undefined;
  const getRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/index.html`,
    { headers: ghHeaders(token) }
  );
  if (getRes.ok) sha = (await getRes.json()).sha;
  else await getRes.body?.cancel();

  const encoded = btoa(Array.from(content, (b) => String.fromCharCode(b)).join(""));
  const body: Record<string, string> = { message: "Add EEM26 sales page", content: encoded };
  if (sha) body.sha = sha;

  const putRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/index.html`,
    { method: "PUT", headers: ghHeaders(token), body: JSON.stringify(body) }
  );
  if (!putRes.ok) throw new Error(`uploadFile(${repo}) → ${putRes.status}: ${await putRes.text()}`);
  await putRes.body?.cancel();
}

async function enablePages(token: string, owner: string, repo: string): Promise<void> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pages`,
    {
      method: "POST",
      headers: ghHeaders(token),
      body: JSON.stringify({ source: { branch: "main", path: "/" } }),
    }
  );
  if (!res.ok && res.status !== 409 && res.status !== 422) {
    throw new Error(`enablePages(${repo}) → ${res.status}: ${await res.text()}`);
  }
  await res.body?.cancel();
}
