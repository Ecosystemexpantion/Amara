// Admin commands — only reachable when the message comes from ADMIN_CHAT_ID.
//
// Commands:
//   setup [payhip link]   → Create GitHub Pages with that Payhip link, return URLs
//   list                  → Show all active students

import { sendMessage } from "./telegram.ts";
import { modifyTemplateForStudent } from "./html-modifier.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// ── Entry point ───────────────────────────────────────────────────────────────

export async function handleAdminCommand(chatId: number, text: string): Promise<void> {
  const t = text.trim();
  if (!t) { await sendHelp(chatId); return; }

  // setup [payhip_url]
  const setupMatch = t.match(/^setup\s+(https?:\/\/\S+)$/i);
  if (setupMatch) {
    await runSetup(chatId, setupMatch[1].trim());
    return;
  }

  // list
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
    `<code>setup [payhip link]</code>\n` +
    `→ Creates two GitHub Pages with that Payhip link embedded.\n` +
    `  Returns both live URLs instantly.\n\n` +
    `<code>list</code>\n` +
    `→ Show all active students and their current day/step.\n\n` +
    `<b>Required secrets:</b>\n` +
    `<code>ADMIN_GITHUB_TOKEN</code> — personal access token (repo scope)\n` +
    `<code>ADMIN_GITHUB_USERNAME</code> — your GitHub username`
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

// ── Setup: create GitHub Pages ────────────────────────────────────────────────

async function runSetup(adminChatId: number, payhipLink: string): Promise<void> {
  const ghToken = Deno.env.get("ADMIN_GITHUB_TOKEN");
  const ghUser  = Deno.env.get("ADMIN_GITHUB_USERNAME");

  if (!ghToken || !ghUser) {
    await sendMessage(
      adminChatId,
      `❌ <b>ADMIN_GITHUB_TOKEN</b> or <b>ADMIN_GITHUB_USERNAME</b> not set.\n\nGo to Supabase → Edge Functions → Secrets and add both.`
    );
    return;
  }

  await sendMessage(adminChatId, `Creating pages... ⏳`);

  // Load + customise HTML templates
  let normalHtml: string;
  let premiumHtml: string;
  try {
    const normalRaw  = await Deno.readTextFile(new URL("./index_normal.html",  import.meta.url));
    const premiumRaw = await Deno.readTextFile(new URL("./index_premium.html", import.meta.url));
    normalHtml  = modifyTemplateForStudent(normalRaw,  payhipLink);
    premiumHtml = modifyTemplateForStudent(premiumRaw, payhipLink);
  } catch (e) {
    await sendMessage(adminChatId, `❌ Failed to load templates: ${String(e).slice(0, 150)}`);
    return;
  }

  // Unique suffix from current timestamp
  const suffix      = Date.now().toString(36).slice(-6);
  const repoNormal  = `eem26page-${suffix}`;
  const repoPremium = `eem26premium-${suffix}`;

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

  await sendMessage(
    adminChatId,
    `✅ <b>Done! Pages live in ~2 minutes:</b>\n\n` +
    `📌 Normal:\n${normalUrl}\n\n` +
    `⭐ Premium:\n${premiumUrl}`
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
