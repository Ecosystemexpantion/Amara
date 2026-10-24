import { createClient } from "npm:@supabase/supabase-js@2";
import { NORMAL_TEMPLATE } from "./normal_template.ts";
import { PREMIUM_TEMPLATE } from "./premium_template.ts";
import { modifyForStudent, publishPage, syncStudentPages, recordPageSync } from "../_shared/pages.ts";
import { startRun, reporter, finishRun, WEB_APP_URL, holdAnnouncement, type Announcement } from "../_shared/runs.ts";
import { isWebChat, pushInbox } from "../_shared/web-inbox.ts";
import { sendAnnouncement } from "../amara-bot/announce.ts";

// ---------------------------------------------------------------------------
// Supabase client (service role — full access)
// ---------------------------------------------------------------------------
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Send a Telegram message to any chat ID (swallows errors). */
async function sendTg(chatId: string | number, text: string): Promise<void> {
  if (isWebChat(chatId)) {
    await pushInbox(chatId, { kind: "text", text });
    return;
  }
  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  }).catch(() => {});
}

function connectUrl(state: string): string {
  const params = new URLSearchParams({ client_id: Deno.env.get("GITHUB_OAUTH_CLIENT_ID") ?? "", scope: "repo", state });
  return `https://github.com/login/oauth/authorize?${params}`;
}

/** Compute tomorrow at 08:00 Nigeria time (UTC+1) expressed as UTC ISO string. */
function computeNextUnlockAt(): string {
  const now = new Date();
  const nigeriaOffsetMs = 60 * 60 * 1000; // UTC+1
  const nowNigeria = new Date(now.getTime() + nigeriaOffsetMs);
  const tomorrowNigeria = new Date(nowNigeria);
  tomorrowNigeria.setDate(tomorrowNigeria.getDate() + 1);
  tomorrowNigeria.setHours(8, 0, 0, 0);
  return new Date(tomorrowNigeria.getTime() - nigeriaOffsetMs).toISOString();
}

// ---------------------------------------------------------------------------
// GitHub API helpers
// ---------------------------------------------------------------------------
const GH_ACCEPT = "application/vnd.github+json";

function ghHeaders(token: string): HeadersInit {
  return {
    Accept: GH_ACCEPT,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": "Amara-Bot/1.0",
  };
}

// ---------------------------------------------------------------------------
// HTML responses
// ---------------------------------------------------------------------------

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

const SUCCESS_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>GitHub Connected!</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #0d1117;
      color: #e6edf3;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 16px;
      padding: 40px 32px;
      max-width: 420px;
      width: 100%;
      text-align: center;
    }
    .emoji { font-size: 56px; margin-bottom: 16px; }
    h1 { font-size: 24px; font-weight: 700; margin-bottom: 12px; color: #58a6ff; }
    p { font-size: 16px; line-height: 1.6; color: #8b949e; }
    .highlight { color: #3fb950; font-weight: 600; }
  </style>
</head>
<body>
  <div class="card">
    <div class="emoji">&#x2705;</div>
    <h1>GitHub Connected!</h1>
    <p>Your sales pages are being set up automatically.</p>
    <br />
    <p class="highlight">Go back to Telegram and continue there!</p>
  </div>
</body>
</html>`;

const DENIED_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Authorization Not Completed</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #0d1117;
      color: #e6edf3;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 16px;
      padding: 40px 32px;
      max-width: 420px;
      width: 100%;
      text-align: center;
    }
    .emoji { font-size: 56px; margin-bottom: 16px; }
    h1 { font-size: 22px; font-weight: 700; margin-bottom: 12px; color: #f85149; }
    p { font-size: 16px; line-height: 1.6; color: #8b949e; }
  </style>
</head>
<body>
  <div class="card">
    <div class="emoji">&#x26A0;&#xFE0F;</div>
    <h1>Authorization was not completed</h1>
    <p>Tap the link in Telegram again to retry.</p>
  </div>
</body>
</html>`;

const ERROR_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Authorization Failed</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #0d1117;
      color: #e6edf3;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 16px;
      padding: 40px 32px;
      max-width: 420px;
      width: 100%;
      text-align: center;
    }
    .emoji { font-size: 56px; margin-bottom: 16px; }
    h1 { font-size: 22px; font-weight: 700; margin-bottom: 12px; color: #f85149; }
    p { font-size: 16px; line-height: 1.6; color: #8b949e; }
  </style>
</head>
<body>
  <div class="card">
    <div class="emoji">&#x274C;</div>
    <h1>Authorization failed</h1>
    <p>Tap the link in Telegram again to retry.</p>
  </div>
</body>
</html>`;

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const params = url.searchParams;

  const code = params.get("code");
  // telegram_chat_id — prefixed "web." when the student connected from the web app.
  const rawState = params.get("state");
  const fromWeb = !!rawState?.startsWith("web.");
  const state = fromWeb ? rawState!.slice(4) : rawState;
  const oauthError = params.get("error");

  // Must have at minimum a state param for anything useful
  if (!state && !code && !oauthError) {
    return htmlResponse(ERROR_HTML, 200);
  }

  // User denied OAuth on GitHub side
  if (oauthError) {
    if (state) {
      await sendTg(
        state,
        "It looks like you cancelled the GitHub login. Tap the link again whenever you're ready — I'll be here! 😊"
      );
    }
    return htmlResponse(DENIED_HTML, 200);
  }

  // Missing code or state
  if (!code || !state) {
    return htmlResponse(ERROR_HTML, 200);
  }

  // -------------------------------------------------------------------------
  // Step 1: Exchange code for GitHub access token
  // -------------------------------------------------------------------------
  let githubToken: string;
  try {
    const tokenRes = await fetch(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: Deno.env.get("GITHUB_OAUTH_CLIENT_ID") ?? "",
          client_secret: Deno.env.get("GITHUB_OAUTH_CLIENT_SECRET") ?? "",
          code,
        }),
      }
    );
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      console.error("Token exchange failed:", tokenData);
      return htmlResponse(ERROR_HTML, 200);
    }
    githubToken = tokenData.access_token as string;
  } catch (err) {
    console.error("Token exchange error:", err);
    return htmlResponse(ERROR_HTML, 200);
  }

  // -------------------------------------------------------------------------
  // Step 2: Get GitHub username
  // -------------------------------------------------------------------------
  let githubUsername: string;
  try {
    const userRes = await fetch("https://api.github.com/user", {
      headers: ghHeaders(githubToken),
    });
    if (!userRes.ok) {
      const body = await userRes.text();
      console.error("GitHub /user failed:", userRes.status, body);
      return htmlResponse(ERROR_HTML, 200);
    }
    const userData = await userRes.json();
    githubUsername = userData.login as string;
  } catch (err) {
    console.error("GitHub user fetch error:", err);
    return htmlResponse(ERROR_HTML, 200);
  }

  // -------------------------------------------------------------------------
  // Admin path: state = "admin:[chat_id]:[payhip_url]"
  // Creates pages under the admin's GitHub account, no student DB lookup.
  // -------------------------------------------------------------------------
  if (state.startsWith("admin:")) {
    const adminMatch = state.match(/^admin:(\d+):(.+)$/);
    if (!adminMatch) return htmlResponse(ERROR_HTML, 200);

    const adminChatId = adminMatch[1];
    const payhipLink  = adminMatch[2];
    const suffix      = Date.now().toString(36).slice(-6);
    const repoNormal  = `eem26page-${suffix}`;
    const repoPremium = `eem26premium-${suffix}`;

    try {
      await publishPage(githubToken, githubUsername, repoNormal, "EEM26 Sales Page", modifyForStudent(NORMAL_TEMPLATE, payhipLink));
      await publishPage(githubToken, githubUsername, repoPremium, "EEM26 Premium Sales Page", modifyForStudent(PREMIUM_TEMPLATE, payhipLink));

      const normalUrl  = `https://${githubUsername}.github.io/${repoNormal}/`;
      const premiumUrl = `https://${githubUsername}.github.io/${repoPremium}/`;

      await sendTg(
        adminChatId,
        `✅ <b>Pages created!</b>\n\n` +
        `📌 Normal:\n${normalUrl}\n\n` +
        `⭐ Premium:\n${premiumUrl}\n\n` +
        `(Live in ~2 minutes as GitHub publishes them)`
      );
    } catch (err) {
      console.error("Admin setup error:", err);
      await sendTg(adminChatId, `❌ Error creating pages: <code>${String(err).slice(0, 200)}</code>`);
    }

    return htmlResponse(SUCCESS_HTML, 200);
  }

  // -------------------------------------------------------------------------
  // Step 3: Look up student in DB
  // -------------------------------------------------------------------------
  const { data: studentData, error: studentErr } = await supabase
    .from("amara_students")
    .select("*")
    .eq("telegram_chat_id", state)
    .single();

  if (studentErr || !studentData) {
    console.error("Student lookup failed:", studentErr);
    return htmlResponse(ERROR_HTML, 200);
  }

  const student = studentData;

  // Reconnecting after Day 2 repairs and re-publishes the pages instead of redoing the day.
  const isRepair = !!student.day2_completed_at;

  await supabase
    .from("amara_students")
    .update({ github_access_token: githubToken, github_username: githubUsername, updated_at: new Date().toISOString() })
    .eq("id", student.id);

  // From the web app the student goes back to watch the Day 2 agents; the build runs in the background.
  // Telegram students stay on Telegram: they get a success page and Amara's message when it's done.
  const back = fromWeb ? `${WEB_APP_URL}${student.password_hash ? "" : `?k=${student.web_key}`}#pages` : null;
  const runId = await startRun(student.id, "pages", fromWeb ? "web" : "telegram", isRepair ? "Repairing your sales pages" : "Building your two sales pages");
  const work = buildPages(student, githubToken, runId, isRepair, fromWeb).catch((e) => console.error("Page build error:", e));
  if (back && typeof EdgeRuntime !== "undefined") {
    (EdgeRuntime as unknown as { waitUntil: (p: Promise<unknown>) => void }).waitUntil(work);
    return Response.redirect(back, 302);
  }
  await work;
  return htmlResponse(SUCCESS_HTML, 200);
});

// deno-lint-ignore no-explicit-any
async function buildPages(student: any, githubToken: string, runId: string | null, isRepair: boolean, watched: boolean): Promise<void> {
  const state = String(student.telegram_chat_id);
  const report = reporter(runId);
  const result = await syncStudentPages(githubToken, student.payhip_link, report);
  await recordPageSync(supabase, student.id, result);
  const adminChatId = Deno.env.get("ADMIN_CHAT_ID") ?? "5870771695";

  if (result.status !== "ok") {
    await finishRun(runId, "failed");
    console.error("Page setup failed:", result.detail);
    await sendTg(adminChatId, `⚠️ <b>Sales page setup failed</b> for <b>${student.full_name ?? "unknown"}</b> (🆔 <code>${state}</code>)\n\n<code>${result.detail.replace(/</g, "&lt;").slice(0, 400)}</code>`);
    const again = isWebChat(state) ? "on this page" : `here 👉 <a href="${connectUrl(state)}">Connect GitHub</a>`;
    await sendTg(
      state,
      result.status === "email_unverified"
        ? `Almost there! 📧 GitHub needs you to <b>verify your email</b> before your pages can go live.\n\nOpen the email GitHub sent you, tap <b>Verify</b>, then tap <b>Connect GitHub</b> again ${again} 🙏`
        : result.status === "token_revoked"
        ? `GitHub disconnected before your pages were done. Tap <b>Connect GitHub</b> again ${again} and your agents will pick up where they left off 🙏`
        : "⏳ GitHub is taking a little longer to publish your pages. I'll finish them automatically and message you here the moment they're live — nothing for you to do 🙏"
    );
    return;
  }

  await report("amara", "working", "Saving your pages and updating your progress…");
  const now = new Date().toISOString();
  await supabase
    .from("amara_students")
    .update({
      github_username: result.username,
      github_repo_normal: result.normalUrl,
      github_repo_premium: result.premiumUrl,
      sales_page_link: result.normalUrl,
      updated_at: now,
      ...(isRepair
        ? {}
        : {
            day2_completed_at: now,
            next_day_unlocks_at: computeNextUnlockAt(),
            current_day: student.current_day > 2 ? student.current_day : 2,
            current_step: student.current_day > 2 ? student.current_step : 0,
          }),
    })
    .eq("id", student.id);
  await report("amara", "done", isRepair ? "Your sales pages are repaired and live 🚀" : `Both sales pages are LIVE 🚀 ${result.normalUrl}`);
  await finishRun(runId, "done");

  const announce: Announcement = { type: "pages_live", isRepair, normalUrl: result.normalUrl!, premiumUrl: result.premiumUrl! };
  if (watched) await holdAnnouncement(runId, announce);
  else await sendAnnouncement({ ...student, github_repo_normal: result.normalUrl }, announce);
  await sendTg(
    adminChatId,
    `🔔 ${isRepair ? "Sales pages repaired" : "GitHub setup complete"} for <b>${student.full_name ?? "unknown"}</b> (@${result.username})\n\nNormal: ${result.normalUrl}\nPremium: ${result.premiumUrl}`
  );
}

