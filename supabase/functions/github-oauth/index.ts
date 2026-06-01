import { createClient } from "npm:@supabase/supabase-js@2";
import { NORMAL_TEMPLATE } from "./templates/normal_template.ts";
import { PREMIUM_TEMPLATE } from "./templates/premium_template.ts";

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

/**
 * Base64-encode a Uint8Array in chunks to avoid call-stack overflow on large
 * files (btoa works on strings, not Uint8Arrays directly).
 */
function uint8ToBase64(bytes: Uint8Array): string {
  const CHUNK = 8192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Strip Paystack/payment infrastructure and re-point every buy-trigger link
 * to the student's personal Payhip link.
 */
function modifyForStudent(html: string, payhipLink: string): string {
  let h = html;

  // Remove Paystack CDN script tag
  h = h.replace(/<script[^>]*paystack[^>]*><\/script>/gi, "");

  // Remove EmailJS CDN script tag
  h = h.replace(/<script[^>]*emailjs[^>]*><\/script>/gi, "");

  // Remove pay-modal div (greedy match for the whole block)
  h = h.replace(
    /<div[^>]+id=["']pay-modal["'][^>]*>[\s\S]*?<\/div>\s*(?=<\/div>|<section|<footer|$)/i,
    ""
  );

  // Replace all buy-trigger anchor hrefs with payhipLink (class before href)
  h = h.replace(
    /(<a\b[^>]*class="[^"]*buy-trigger[^"]*"[^>]*)href="[^"]*"/gi,
    `$1href="${payhipLink}" target="_blank"`
  );

  // Also handle href before class
  h = h.replace(
    /(<a\b[^>]*href="[^"]*"[^>]*class="[^"]*buy-trigger[^"]*"[^>]*)/gi,
    (m) => m.replace(/href="[^"]*"/, `href="${payhipLink}" target="_blank"`)
  );

  // Remove initiatePaystack JS function
  h = h.replace(/function\s+initiatePaystack\s*\([^)]*\)\s*\{[\s\S]*?\n\}/g, "");

  // Remove openPayModal JS function
  h = h.replace(/function\s+openPayModal\s*\([^)]*\)\s*\{[\s\S]*?\n\}/g, "");

  // Remove buy-trigger querySelectorAll event listener block
  h = h.replace(
    /document\.querySelectorAll\(['"].buy-trigger['"]\)[\s\S]*?}\);?/g,
    ""
  );

  return h;
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

/** Create a repo. Returns true if created (or 422 — already exists). */
async function createRepo(
  token: string,
  name: string,
  description: string
): Promise<void> {
  const res = await fetch("https://api.github.com/user/repos", {
    method: "POST",
    headers: ghHeaders(token),
    body: JSON.stringify({
      name,
      description,
      private: false,
      auto_init: true,
    }),
  });
  if (!res.ok && res.status !== 422) {
    const body = await res.text();
    throw new Error(`createRepo(${name}) failed ${res.status}: ${body}`);
  }
  await res.body?.cancel(); // drain
}

/** Upload (or update) a file in a repo. */
async function uploadFile(
  token: string,
  owner: string,
  repo: string,
  path: string,
  content: Uint8Array,
  commitMessage: string
): Promise<void> {
  const encoded = uint8ToBase64(content);

  // Check if file already exists so we can supply its SHA for an update
  let sha: string | undefined;
  const getRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
    { headers: ghHeaders(token) }
  );
  if (getRes.ok) {
    const existing = await getRes.json();
    sha = existing.sha;
  } else {
    await getRes.body?.cancel();
  }

  const putBody: Record<string, string> = {
    message: commitMessage,
    content: encoded,
  };
  if (sha) putBody.sha = sha;

  const putRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
    {
      method: "PUT",
      headers: ghHeaders(token),
      body: JSON.stringify(putBody),
    }
  );
  if (!putRes.ok) {
    const body = await putRes.text();
    throw new Error(`uploadFile(${repo}/${path}) failed ${putRes.status}: ${body}`);
  }
  await putRes.body?.cancel();
}

/** Enable GitHub Pages on the main branch. Swallows 409/422 (already enabled). */
async function enablePages(token: string, owner: string, repo: string): Promise<void> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pages`,
    {
      method: "POST",
      headers: ghHeaders(token),
      body: JSON.stringify({ source: { branch: "main", path: "/" } }),
    }
  );
  // 409 = already enabled, 422 = validation error (often "already configured")
  if (!res.ok && res.status !== 409 && res.status !== 422) {
    const body = await res.text();
    throw new Error(`enablePages(${repo}) failed ${res.status}: ${body}`);
  }
  await res.body?.cancel();
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
  const state = params.get("state"); // telegram_chat_id
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

  // -------------------------------------------------------------------------
  // Step 4: Save token + username immediately (so we have it even if next
  //          steps fail)
  // -------------------------------------------------------------------------
  const { error: saveTokenErr } = await supabase
    .from("amara_students")
    .update({
      github_access_token: githubToken,
      github_username: githubUsername,
      updated_at: new Date().toISOString(),
    })
    .eq("id", student.id);

  if (saveTokenErr) {
    console.error("Failed to save GitHub token:", saveTokenErr);
    return htmlResponse(ERROR_HTML, 200);
  }

  // From here on, any failure gets a friendly retry message
  const payhipLink: string = student.payhip_link ?? "https://payhip.com";

  try {
    // -----------------------------------------------------------------------
    // Step 5: Load HTML templates (compiled into the bundle as TS imports)
    // -----------------------------------------------------------------------
    const normalHtmlRaw = NORMAL_TEMPLATE;
    const premiumHtmlRaw = PREMIUM_TEMPLATE;

    // -----------------------------------------------------------------------
    // Step 6: Apply modifier
    // -----------------------------------------------------------------------
    const normalHtml = modifyForStudent(normalHtmlRaw, payhipLink);
    const premiumHtml = modifyForStudent(premiumHtmlRaw, payhipLink);

    const normalBytes = new TextEncoder().encode(normalHtml);
    const premiumBytes = new TextEncoder().encode(premiumHtml);

    // -----------------------------------------------------------------------
    // Step 7: Create repos (422 = already exists → continue)
    // -----------------------------------------------------------------------
    await Promise.all([
      createRepo(githubToken, "EEM26page", "EEM26 Sales Page"),
      createRepo(githubToken, "EEM26premium", "EEM26 Premium Sales Page"),
    ]);

    // -----------------------------------------------------------------------
    // Step 8: Upload index.html to each repo
    // -----------------------------------------------------------------------
    await Promise.all([
      uploadFile(
        githubToken,
        githubUsername,
        "EEM26page",
        "index.html",
        normalBytes,
        "Add sales page"
      ),
      uploadFile(
        githubToken,
        githubUsername,
        "EEM26premium",
        "index.html",
        premiumBytes,
        "Add premium sales page"
      ),
    ]);

    // -----------------------------------------------------------------------
    // Step 9: Enable GitHub Pages on both repos
    // -----------------------------------------------------------------------
    await Promise.all([
      enablePages(githubToken, githubUsername, "EEM26page"),
      enablePages(githubToken, githubUsername, "EEM26premium"),
    ]);

    // -----------------------------------------------------------------------
    // Step 10: Compute live URLs
    // -----------------------------------------------------------------------
    const normalPageUrl = `https://${githubUsername}.github.io/EEM26page/`;
    const premiumPageUrl = `https://${githubUsername}.github.io/EEM26premium/`;

    // -----------------------------------------------------------------------
    // Step 11: Update DB — repos, completion timestamps, day progression
    // -----------------------------------------------------------------------
    const nextUnlocksAt = computeNextUnlockAt();
    const now = new Date().toISOString();

    // Don't roll back if student is already past Day 2
    const newDay = student.current_day > 2 ? student.current_day : 2;
    const newStep = student.current_day > 2 ? student.current_step : 0;

    await supabase
      .from("amara_students")
      .update({
        github_repo_normal: normalPageUrl,
        github_repo_premium: premiumPageUrl,
        sales_page_link: normalPageUrl,
        day2_completed_at: now,
        next_day_unlocks_at: nextUnlocksAt,
        current_day: newDay,
        current_step: newStep,
        updated_at: now,
      })
      .eq("id", student.id);

    // -----------------------------------------------------------------------
    // Step 12: Notify student via Telegram
    // -----------------------------------------------------------------------
    const studentName = student.full_name ? student.full_name.split(" ")[0] : "there";
    await sendTg(
      state,
      `🎉 <b>GitHub connected, ${studentName}!</b>\n\n` +
        `Your two sales pages are live (it may take a minute for GitHub to fully publish them):\n\n` +
        `📌 <b>Normal page:</b>\n${normalPageUrl}\n\n` +
        `⭐ <b>Premium page:</b>\n${premiumPageUrl}\n\n` +
        `Come back to Telegram to continue to Day 3!`
    );

    // -----------------------------------------------------------------------
    // Step 13: Notify admin
    // -----------------------------------------------------------------------
    const adminChatId = Deno.env.get("ADMIN_CHAT_ID") ?? "5870771695";
    await sendTg(
      adminChatId,
      `🔔 GitHub setup complete for <b>${student.full_name ?? "unknown"}</b> (@${githubUsername})\n\n` +
        `Normal: ${normalPageUrl}\nPremium: ${premiumPageUrl}`
    );

    // -----------------------------------------------------------------------
    // Step 14: Return success page
    // -----------------------------------------------------------------------
    return htmlResponse(SUCCESS_HTML, 200);
  } catch (err) {
    console.error("Setup error after token save:", err);

    const errMsg = String(err);

    // Notify admin with the actual error so it can be diagnosed
    const adminChatId = Deno.env.get("ADMIN_CHAT_ID") ?? "5870771695";
    await sendTg(
      adminChatId,
      `⚠️ <b>github-oauth setup error</b>\n\nStudent chat: ${state}\n\nError: <code>${errMsg}</code>`
    );

    // Tell student to tap again
    await sendTg(
      state,
      "Small hiccup setting up your pages — tap the link again and it should go through! 😅"
    );

    return htmlResponse(
      `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Almost there!</title>
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
    h1 { font-size: 22px; font-weight: 700; margin-bottom: 12px; color: #d29922; }
    p { font-size: 16px; line-height: 1.6; color: #8b949e; }
  </style>
</head>
<body>
  <div class="card">
    <div class="emoji">&#x1F504;</div>
    <h1>Almost there!</h1>
    <p>There was a small hiccup. Tap the link in Telegram again to retry.</p>
  </div>
</body>
</html>`,
      200
    );
  }
});
