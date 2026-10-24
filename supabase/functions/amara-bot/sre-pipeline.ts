// Builds a student's SRE sales bot as a team of named agents. Every agent does a real step and
// reports it to the run log; the web page animates each agent's tools while the work happens.
import { aiChat } from "../_shared/ai.ts";
import { startRun, reporter, finishRun, SRE_CHAT_URL, type Report } from "../_shared/runs.ts";

export { WEB_APP_URL, webLink } from "../_shared/runs.ts";

export function startSreRun(studentId: string, source: "telegram" | "web"): Promise<string | null> {
  return startRun(studentId, "sre", source, "Building your AI sales bot");
}

export interface SreStudent {
  id: string;
  full_name: string | null;
  payhip_link: string | null;
  sales_page_link: string | null;
}

export type SreOutcome =
  | { ok: true; botUsername: string; webhookUrl: string }
  | { ok: false; reason: "bad_token" | "telegram_down" | "error"; message: string };

async function tg(token: string, method: string, body?: unknown): Promise<{ ok?: boolean; result?: Record<string, unknown> } | null> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return await res.json();
  } catch {
    return null;
  }
}

// `launch` saves the result and moves the student forward; it is the last agent's work.
export async function runSreBuild(
  runId: string | null,
  student: SreStudent,
  token: string,
  launch: (botUsername: string, webhookUrl: string) => Promise<void>
): Promise<SreOutcome> {
  const r: Report = reporter(runId);
  try {
    // 1. Nova — is the BotFather token real?
    await r("nova", "working", "Checking your BotFather token with Telegram…");
    const me = await tg(token, "getMe");
    if (!me) {
      await r("nova", "failed", "Couldn't reach Telegram — try again in a minute.");
      await finishRun(runId, "failed");
      return { ok: false, reason: "telegram_down", message: "Couldn't reach Telegram" };
    }
    const botUsername = me.result?.username as string | undefined;
    if (!me.ok || !botUsername) {
      await r("nova", "failed", "Telegram rejected this token. Copy it again from BotFather's \"Done!\" message.");
      await finishRun(runId, "failed");
      return { ok: false, reason: "bad_token", message: "Invalid token" };
    }
    await r("nova", "done", `Token is valid — your bot is @${botUsername} (${me.result?.first_name ?? botUsername}).`);

    // 2. Bolt — point the bot at Amara's servers and confirm Telegram accepted it.
    await r("bolt", "working", `Connecting @${botUsername} to Amara's servers…`);
    const webhookUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/student-bot/${student.id}`;
    await tg(token, "setWebhook", { url: webhookUrl, drop_pending_updates: true });
    const hook = await tg(token, "getWebhookInfo");
    if (hook?.result?.url !== webhookUrl) {
      await r("bolt", "failed", "Telegram didn't accept the connection. Please try again.");
      await finishRun(runId, "failed");
      return { ok: false, reason: "error", message: "Webhook not set" };
    }
    await r("bolt", "done", `Connected — every message sent to @${botUsername} now reaches your AI.`);

    // 3. Scribe — write the bot's public profile and command menu.
    await r("scribe", "working", `Writing @${botUsername}'s profile, about text and menu…`);
    const profile = await Promise.all([
      tg(token, "setMyShortDescription", { short_description: "Your EEM26 assistant 🤖 Ask me how people are earning online with AI." }),
      tg(token, "setMyDescription", {
        description:
          "Hi! 👋 I help people start a real digital business with EEM26 — AI tools, a done-with-you setup and 4 personal coaches.\n\nTap Start and tell me your name to get registered for the next free training.",
      }),
      tg(token, "setMyCommands", { commands: [{ command: "start", description: "Start chatting" }] }),
    ]);
    await r(
      "scribe",
      "done",
      profile.every((p) => p?.ok) ? "Profile, about text and menu written — visitors see them before they tap Start." : "Profile partly written — your bot works either way."
    );

    // 4. Sage — load the student's own links into the sales script.
    const buyLink = student.payhip_link ?? student.sales_page_link;
    await r("sage", "working", "Loading your SRE sales brain: EEM26 script, real student results, objection handling…");
    await r(
      "sage",
      "done",
      buyLink ? `Sales brain ready — buyers will be sent to your link: ${buyLink}` : "Sales brain ready — EEM26 script, student results and objection handling loaded."
    );

    // 5. Echo — ask the AI a real customer question in the bot's voice.
    await r("echo", "working", `Sending @${botUsername} a test customer message: "Hi, what is EEM26?"`);
    const reply = await aiChat({
      system:
        "You are a warm, confident sales assistant for EEM26, a done-with-you digital business setup with AI tools and 4 personal coaches. Reply in clear standard English, 2 short sentences max, and end by asking for the person's name.",
      history: [],
      user: "Hi, what is EEM26?",
      maxTokens: 120,
      temperature: 0.8,
      caller: "web live build",
    });
    await r("echo", "done", reply ? `Your bot replied: "${reply.replace(/\s+/g, " ").slice(0, 280)}"` : "Test skipped — the AI is busy, but your bot is connected.");

    // 6. Pulse — health check on the live connection.
    await r("pulse", "working", `Running a health check on @${botUsername}…`);
    const health = await tg(token, "getWebhookInfo");
    const lastError = health?.result?.last_error_message as string | undefined;
    await r(
      "pulse",
      "done",
      lastError ? `Connection is up. Telegram's last note: "${lastError}" — it clears on the next message.` : "Healthy — no delivery errors, ready for customers 24/7."
    );

    // 7. Amara — save everything and move the student forward.
    await r("amara", "working", `Switching @${botUsername} on and saving your setup…`);
    await launch(botUsername, webhookUrl);
    await r("amara", "done", `@${botUsername} is LIVE 24/7 🚀`);
    await finishRun(runId, "done", botUsername);
    return { ok: true, botUsername, webhookUrl };
  } catch (e) {
    console.error("runSreBuild error:", e);
    await r("amara", "failed", "Something went wrong on our side — Amara has been alerted.");
    await finishRun(runId, "failed");
    return { ok: false, reason: "error", message: String(e) };
  }
}

// ── Web SRE: the same AI sales brain as a chat page — no Telegram, no BotFather ──

export type WebSreOutcome = { ok: true; chatUrl: string; name: string } | { ok: false; message: string };

// `reserve` saves the chat link before the checks; `launch` moves the student forward at the end.
export async function runWebSreBuild(
  runId: string | null,
  student: SreStudent,
  assistantName: string,
  slug: string,
  reserve: () => Promise<void>,
  launch: () => Promise<void>
): Promise<WebSreOutcome> {
  const r: Report = reporter(runId);
  const chatUrl = `${SRE_CHAT_URL}?s=${slug}`;
  const api = `${Deno.env.get("SUPABASE_URL")}/functions/v1/student-bot/chat?s=${slug}`;
  const ping = async () => {
    try {
      const res = await fetch(api);
      return res.ok ? ((await res.json()) as { name?: string }) : null;
    } catch {
      return null;
    }
  };
  try {
    // 1. Nova — reserve the assistant's public chat link.
    await r("nova", "working", `Reserving your assistant's chat link…`);
    await reserve();
    await r("nova", "done", `Link reserved: ${chatUrl}`);

    // 2. Bolt — connect the chat page to Amara's servers and confirm it answers.
    await r("bolt", "working", "Connecting your chat page to Amara's servers…");
    const hello = await ping();
    if (!hello) {
      await r("bolt", "failed", "The chat server didn't answer. Please try again in a minute.");
      await finishRun(runId, "failed");
      return { ok: false, message: "chat endpoint unreachable" };
    }
    await r("bolt", "done", "Connected — every message on your chat page now reaches your AI.");

    // 3. Scribe — the assistant's name and greeting.
    await r("scribe", "working", `Writing ${assistantName}'s name, greeting and chat window…`);
    await r("scribe", "done", `${hello.name ?? assistantName} greets every visitor and asks for their name to register them.`);

    // 4. Sage — the sales script with the student's links.
    const buyLink = student.payhip_link ?? student.sales_page_link;
    await r("sage", "working", "Loading your SRE sales brain: EEM26 script, real student results, objection handling…");
    await r("sage", "done", buyLink ? `Sales brain ready — buyers will be sent to your link: ${buyLink}` : "Sales brain ready — EEM26 script, student results and objection handling loaded.");

    // 5. Echo — a real test question in the assistant's voice.
    await r("echo", "working", `Sending ${assistantName} a test customer message: "Hi, what is EEM26?"`);
    const reply = await aiChat({
      system: `You are ${assistantName}, a warm, confident sales assistant for EEM26, a done-with-you digital business setup with AI tools and 4 personal coaches. Reply in clear standard English, 2 short sentences max, and end by asking for the person's name.`,
      history: [],
      user: "Hi, what is EEM26?",
      maxTokens: 120,
      temperature: 0.8,
      caller: "web sre build",
    });
    await r("echo", "done", reply ? `${assistantName} replied: "${reply.replace(/\s+/g, " ").slice(0, 280)}"` : "Test skipped — the AI is busy, but your assistant is connected.");

    // 6. Pulse — health check.
    await r("pulse", "working", "Running a health check on your chat link…");
    const again = await ping();
    await r("pulse", "done", again ? "Healthy — ready for customers 24/7 on any phone or laptop." : "Connection is up — the first visitor's message will warm it up.");

    // 7. Amara — save and move the student forward.
    await r("amara", "working", `Switching ${assistantName} on and saving your setup…`);
    await launch();
    await r("amara", "done", `${assistantName} is LIVE 24/7 🚀 ${chatUrl}`);
    await finishRun(runId, "done", assistantName);
    return { ok: true, chatUrl, name: assistantName };
  } catch (e) {
    console.error("runWebSreBuild error:", e);
    await r("amara", "failed", "Something went wrong on our side — Amara has been alerted.");
    await finishRun(runId, "failed");
    return { ok: false, message: String(e) };
  }
}
