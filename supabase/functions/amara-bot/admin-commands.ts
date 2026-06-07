// Admin commands — only reachable when the message comes from ADMIN_CHAT_ID.
// Current commands:
//   setup [student name] [payhip link]   → run full Day 2 GitHub setup for that student

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

  // setup [name] [payhip_url]
  // Name may contain spaces; payhip URL starts with http
  const setupMatch = t.match(/^setup\s+(.+?)\s+(https?:\/\/\S+)$/i);
  if (setupMatch) {
    await runSetup(chatId, setupMatch[1].trim(), setupMatch[2].trim());
    return;
  }

  // list — show all active students
  if (/^list\b/i.test(t)) {
    await listStudents(chatId);
    return;
  }

  await sendHelp(chatId);
}

// ── Help message ──────────────────────────────────────────────────────────────

async function sendHelp(chatId: number): Promise<void> {
  await sendMessage(
    chatId,
    `<b>Admin commands:</b>\n\n` +
    `<code>setup [student name] [payhip link]</code>\n` +
    `→ Instantly completes Day 2 for that student:\n` +
    `  creates their GitHub Pages, customises with their Payhip link,\n` +
    `  advances them to Day 3, and sends them their live links.\n\n` +
    `<code>list</code>\n` +
    `→ Show all active students and their current day/step.\n\n` +
    `<b>Required Supabase secrets:</b>\n` +
    `<code>ADMIN_GITHUB_TOKEN</code> — personal access token (repo scope)\n` +
    `<code>ADMIN_GITHUB_USERNAME</code> — GitHub username for that token`
  );
}

// ── List students ─────────────────────────────────────────────────────────────

async function listStudents(chatId: number): Promise<void> {
  const { data } = await supabase
    .from("amara_students")
    .select("full_name, current_day, current_step, status, payhip_link, sales_page_link")
    .eq("status", "ACTIVE")
    .order("created_at", { ascending: false })
    .limit(30);

  if (!data || data.length === 0) {
    await sendMessage(chatId, "No active students yet.");
    return;
  }

  const lines = (data as Record<string, string | number>[]).map((s) =>
    `• <b>${s.full_name ?? "unnamed"}</b> — Day ${s.current_day}, Step ${s.current_step}` +
    (s.sales_page_link ? ` ✅` : ` ❌ no page yet`)
  );

  await sendMessage(chatId, `<b>Active students (${data.length}):</b>\n\n${lines.join("\n")}`);
}

// ── Day 2 setup ───────────────────────────────────────────────────────────────

async function runSetup(adminChatId: number, studentName: string, payhipLink: string): Promise<void> {
  // 1. Find student by name
  const { data: matches } = await supabase
    .from("amara_students")
    .select("*")
    .ilike("full_name", `%${studentName}%`)
    .eq("status", "ACTIVE")
    .limit(3);

  if (matches && matches.length > 1) {
    const names = (matches as Student[]).map((s) => `• ${s.full_name}`).join("\n");
    await sendMessage(adminChatId, `⚠️ Multiple students match "<b>${studentName}</b>":\n\n${names}\n\nBe more specific.`);
    return;
  }

  const student = (matches && matches.length === 1) ? matches[0] as Student : null;

  if (student) {
    await sendMessage(
      adminChatId,
      `Found: <b>${student.full_name}</b> (Day ${student.current_day}, Step ${student.current_step})\n\nSetting up GitHub Pages now... ⏳`
    );
  } else {
    await sendMessage(
      adminChatId,
      `⚠️ <b>${studentName}</b> isn't registered with Amara yet.\n\nBuilding their pages anyway — you'll need to share the links manually. ⏳`
    );
  }

  // 2. Verify GitHub credentials
  const ghToken = Deno.env.get("ADMIN_GITHUB_TOKEN");
  const ghUser  = Deno.env.get("ADMIN_GITHUB_USERNAME");

  if (!ghToken || !ghUser) {
    await sendMessage(
      adminChatId,
      `❌ <b>ADMIN_GITHUB_TOKEN</b> or <b>ADMIN_GITHUB_USERNAME</b> not set.\n\n` +
      `Go to Supabase → Edge Functions → Secrets and add both values.`
    );
    return;
  }

  // 3. Load + customise HTML templates
  let normalHtml: string;
  let premiumHtml: string;
  try {
    const normalRaw  = await Deno.readTextFile(new URL("./index_normal.html",  import.meta.url));
    const premiumRaw = await Deno.readTextFile(new URL("./index_premium.html", import.meta.url));
    normalHtml  = modifyTemplateForStudent(normalRaw,  payhipLink);
    premiumHtml = modifyTemplateForStudent(premiumRaw, payhipLink);
  } catch (e) {
    console.error("Template load error:", e);
    await sendMessage(adminChatId, `❌ Failed to load HTML templates: ${String(e).slice(0, 150)}`);
    return;
  }

  // 4. Unique repo names — use student UUID if registered, otherwise timestamp
  const suffix      = student ? student.id.slice(0, 6) : Date.now().toString(36).slice(-6);
  const repoNormal  = `eem26page-${suffix}`;
  const repoPremium = `eem26premium-${suffix}`;

  // 5. GitHub operations
  try {
    await createRepo(ghToken, repoNormal,  "EEM26 Sales Page");
    await createRepo(ghToken, repoPremium, "EEM26 Premium Sales Page");
    await uploadFile(ghToken, ghUser, repoNormal,  new TextEncoder().encode(normalHtml));
    await uploadFile(ghToken, ghUser, repoPremium, new TextEncoder().encode(premiumHtml));
    await enablePages(ghToken, ghUser, repoNormal);
    await enablePages(ghToken, ghUser, repoPremium);
  } catch (e) {
    console.error("GitHub error:", e);
    await sendMessage(adminChatId, `❌ GitHub error: <code>${String(e).slice(0, 300)}</code>`);
    return;
  }

  // 6. Compute live URLs
  const normalUrl  = `https://${ghUser}.github.io/${repoNormal}/`;
  const premiumUrl = `https://${ghUser}.github.io/${repoPremium}/`;

  // 7. Update student record (only if student is registered with Amara)
  if (student) {
    const now         = new Date().toISOString();
    const nextUnlocks = computeNextUnlockAt();
    const newDay      = student.current_day  > 2 ? student.current_day  : 2;
    const newStep     = student.current_day  > 2 ? student.current_step : 0;

    try {
      await updateStudent(student.id, {
        payhip_link:         payhipLink,
        github_repo_normal:  normalUrl,
        github_repo_premium: premiumUrl,
        sales_page_link:     normalUrl,
        day2_completed_at:   now,
        next_day_unlocks_at: newStep === 0 ? nextUnlocks : (student.next_day_unlocks_at ?? nextUnlocks),
        current_day:         newDay,
        current_step:        newStep,
      });
    } catch (e) {
      console.error("DB update error:", e);
      await sendMessage(adminChatId, `⚠️ GitHub done but DB update failed: <code>${String(e).slice(0, 200)}</code>`);
      return;
    }

    // 8. Message the student
    const firstName = (student.full_name ?? "").split(" ")[0];
    await sendMessage(
      student.telegram_chat_id,
      `🎉 <b>Your sales pages are LIVE, ${firstName}!</b>\n\n` +
      `Your two pages are ready — give GitHub 1-2 minutes to publish them fully:\n\n` +
      `📌 <b>Normal page:</b>\n${normalUrl}\n\n` +
      `⭐ <b>Premium page:</b>\n${premiumUrl}\n\n` +
      `Day 3 unlocks tomorrow at 8AM Nigeria time — I'll ping you then! 🚀`
    );

    // 9. Confirm to admin (registered student)
    await sendMessage(
      adminChatId,
      `✅ <b>Day 2 done for ${student.full_name}!</b>\n\n` +
      `📌 Normal: ${normalUrl}\n` +
      `⭐ Premium: ${premiumUrl}\n\n` +
      `Student notified. Day 3 unlocks at 8AM tomorrow.`
    );
  } else {
    // 9. Confirm to admin (unregistered student — share links manually)
    await sendMessage(
      adminChatId,
      `✅ <b>Pages created for ${studentName}!</b>\n\n` +
      `📌 Normal: ${normalUrl}\n` +
      `⭐ Premium: ${premiumUrl}\n\n` +
      `⚠️ This student isn't on Amara yet — share these links with them manually.\n` +
      `Once they message Amara and complete Day 1, their record will be created.`
    );
  }
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
  // 422 = repo already exists — treat as success
  if (!res.ok && res.status !== 422) {
    throw new Error(`createRepo(${name}) → ${res.status}: ${await res.text()}`);
  }
  await res.body?.cancel();
}

async function uploadFile(token: string, owner: string, repo: string, content: Uint8Array): Promise<void> {
  // Fetch existing SHA so we can update rather than fail
  let sha: string | undefined;
  const getRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/index.html`,
    { headers: ghHeaders(token) }
  );
  if (getRes.ok) sha = (await getRes.json()).sha;
  else await getRes.body?.cancel();

  const encoded = btoa(
    Array.from(content, (b) => String.fromCharCode(b)).join("")
  );
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
  // 409/422 = already enabled — treat as success
  if (!res.ok && res.status !== 409 && res.status !== 422) {
    throw new Error(`enablePages(${repo}) → ${res.status}: ${await res.text()}`);
  }
  await res.body?.cancel();
}
