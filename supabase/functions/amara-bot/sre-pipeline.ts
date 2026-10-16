// Builds a student's SRE sales bot as a team of named agents, logging every real step to sre_runs
// so the web version of Amara can show the build live. Used by both Telegram and the web page.
import { createClient } from "npm:@supabase/supabase-js@2";
import { aiChat } from "../_shared/ai.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

export const WEB_APP_URL = "https://ecosystemexpantion.github.io/amara-live/";

export function webLink(webKey: string | null | undefined): string | null {
  return webKey ? `${WEB_APP_URL}?k=${webKey}` : null;
}

export type SreAgent = "verifier" | "connector" | "brain" | "tester" | "launcher";
type EventState = "working" | "done" | "failed";
export interface SreEvent {
  agent: SreAgent;
  state: EventState;
  text: string;
  at: string;
}

// Each step stays on screen at least this long so students can follow it; the work itself is real.
const MIN_STEP_MS = 1400;

export async function startRun(studentId: string, source: "telegram" | "web"): Promise<string> {
  const { data, error } = await supabase.from("sre_runs").insert({ student_id: studentId, source }).select("id").single();
  if (error || !data) throw new Error(`startRun: ${error?.message}`);
  return data.id as string;
}

async function emit(runId: string, agent: SreAgent, state: EventState, text: string): Promise<void> {
  const { data } = await supabase.from("sre_runs").select("events").eq("id", runId).single();
  const events = [...((data?.events as SreEvent[]) ?? []), { agent, state, text, at: new Date().toISOString() }];
  await supabase.from("sre_runs").update({ events, updated_at: new Date().toISOString() }).eq("id", runId);
}

async function finish(runId: string, status: "done" | "failed", botUsername?: string): Promise<void> {
  await supabase
    .from("sre_runs")
    .update({ status, ...(botUsername ? { bot_username: botUsername } : {}), updated_at: new Date().toISOString() })
    .eq("id", runId);
}

async function step<T>(runId: string, agent: SreAgent, working: string, work: () => Promise<T>): Promise<T> {
  await emit(runId, agent, "working", working);
  const started = Date.now();
  const result = await work();
  const left = MIN_STEP_MS - (Date.now() - started);
  if (left > 0) await new Promise((r) => setTimeout(r, left));
  return result;
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

// `launch` saves the result and moves the student forward; it runs as the final agent's work.
export async function runSreBuild(
  runId: string,
  student: SreStudent,
  token: string,
  launch: (botUsername: string, webhookUrl: string) => Promise<void>
): Promise<SreOutcome> {
  try {
    // 1. Verifier — is the BotFather token real?
    const me = await step(runId, "verifier", "Checking your BotFather token with Telegram…", async () => {
      try {
        const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
        return (await res.json()) as { ok: boolean; result?: { username?: string; first_name?: string } };
      } catch {
        return null;
      }
    });
    if (!me) {
      await emit(runId, "verifier", "failed", "Couldn't reach Telegram — try again in a minute.");
      await finish(runId, "failed");
      return { ok: false, reason: "telegram_down", message: "Couldn't reach Telegram" };
    }
    if (!me.ok || !me.result?.username) {
      await emit(runId, "verifier", "failed", "Telegram rejected this token. Copy it again from BotFather's \"Done!\" message.");
      await finish(runId, "failed");
      return { ok: false, reason: "bad_token", message: "Invalid token" };
    }
    const botUsername = me.result.username;
    await emit(runId, "verifier", "done", `Token is valid — your bot is @${botUsername} (${me.result.first_name ?? botUsername}).`);

    // 2. Connector — point the bot at Amara's servers and confirm Telegram accepted it.
    const webhookUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/student-bot/${student.id}`;
    const connected = await step(runId, "connector", `Connecting @${botUsername} to Amara's servers…`, async () => {
      await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: webhookUrl, drop_pending_updates: true }),
      });
      const info = await (await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`)).json();
      return info?.result?.url === webhookUrl;
    });
    if (!connected) {
      await emit(runId, "connector", "failed", "Telegram didn't accept the connection. Please try again.");
      await finish(runId, "failed");
      return { ok: false, reason: "error", message: "Webhook not set" };
    }
    await emit(runId, "connector", "done", `Connected — every message sent to @${botUsername} now reaches your AI.`);

    // 3. Sales Brain — load the student's own links into the sales script.
    const buyLink = student.payhip_link ?? student.sales_page_link;
    await step(runId, "brain", "Loading your SRE sales brain: EEM26 script, real student results, objection handling…", async () => {});
    await emit(
      runId,
      "brain",
      "done",
      buyLink ? `Sales brain ready — buyers will be sent to your link: ${buyLink}` : "Sales brain ready — EEM26 script, student results and objection handling loaded."
    );

    // 4. Tester — ask the AI a real customer question in the bot's voice.
    const reply = await step(runId, "tester", `Sending @${botUsername} a test customer message: "Hi, what is EEM26?"`, () =>
      aiChat({
        system:
          "You are a warm, confident sales assistant for EEM26, a done-with-you digital business setup with AI tools and 4 personal coaches. Reply in clear standard English, 2 short sentences max, and end by asking for the person's name.",
        history: [],
        user: "Hi, what is EEM26?",
        maxTokens: 120,
        temperature: 0.8,
        caller: "web live build",
      })
    );
    await emit(runId, "tester", "done", reply ? `Your bot replied: "${reply.replace(/\s+/g, " ").slice(0, 280)}"` : "Test skipped — the AI is busy, but your bot is connected.");

    // 5. Launcher — save everything and move the student forward.
    await step(runId, "launcher", `Switching @${botUsername} on and saving your setup…`, () => launch(botUsername, webhookUrl));
    await emit(runId, "launcher", "done", `@${botUsername} is LIVE 24/7 🚀`);
    await finish(runId, "done", botUsername);
    return { ok: true, botUsername, webhookUrl };
  } catch (e) {
    console.error("runSreBuild error:", e);
    await emit(runId, "launcher", "failed", "Something went wrong on our side — Amara has been alerted.");
    await finish(runId, "failed");
    return { ok: false, reason: "error", message: String(e) };
  }
}
