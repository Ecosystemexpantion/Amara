// JSON API behind the web version of Amara (the page itself is on GitHub Pages).
// Every request carries the student's private web key from their personal link.
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildSreFromWeb } from "../amara-bot/day1.ts";
import { handleDay3 } from "../amara-bot/day3.ts";
import { handleDay4 } from "../amara-bot/day4.ts";
import { deliverRunAnnouncement } from "../amara-bot/announce.ts";
import { buildGitHubAuthUrl } from "../amara-bot/github.ts";
import { saveConversation } from "../amara-bot/db.ts";
import { SRE_STEP, GATE_STEP, BOTFATHER_LINK, TECH_STACK_URL, suggestedBotNames } from "../amara-bot/day1-content.ts";
import type { Student, TelegramMessage } from "../amara-bot/types.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const BOT_TOKEN_RE = /\d{6,12}:[A-Za-z0-9_-]{30,}/;
const MAX_WEB_RUNS_PER_DAY = 10;
const MAX_UPLOADS_PER_DAY = 30;
const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

function background(p: Promise<unknown>): void {
  const safe = p.catch((e) => console.error("amara-web background error:", e));
  if (typeof EdgeRuntime !== "undefined") {
    (EdgeRuntime as unknown as { waitUntil: (p: Promise<unknown>) => void }).waitUntil(safe);
  }
}

async function studentByKey(key: string | null): Promise<Student | null> {
  if (!key || !/^[a-f0-9]{32}$/.test(key)) return null;
  const { data } = await supabase.from("amara_students").select("*").eq("web_key", key).maybeSingle();
  return (data as Student) ?? null;
}

// Where the student is, in words the page can show.
function phaseOf(s: Student): string {
  if (s.status === "COMPLETED" || s.current_day > 4) return "graduated";
  if (s.current_day === 0) return "onboarding";
  if (s.current_day === 1 && s.current_step === GATE_STEP) return "bot_live";
  if (s.current_day === 1) return "build_bot";
  if (s.current_day === 2) return s.day2_completed_at ? "pages_live" : "build_pages";
  if (s.current_day === 3 && !s.bot_token) return "build_bot";
  if (s.current_day === 3) return s.current_step === 0 ? "day3_done" : s.current_step === 1 ? "day3_start" : "day3_upload";
  if (s.current_day === 4) return s.current_step === 1 || s.current_step === 3 ? "day4_upload" : "day4";
  return `day${s.current_day}`;
}

// What the student should upload on the page for their current step.
function uploadFor(s: Student): { label: string; hint: string } | null {
  if (s.current_day === 3 && s.bot_token) {
    if (s.current_step === 2) return { label: "Selar screenshot", hint: "A screenshot of the Selar sign-up page or your Selar dashboard." };
    if (s.current_step === 3) return { label: "Selar dashboard", hint: "A screenshot of your Selar creator dashboard after signing up." };
    if (s.current_step === 4) return { label: "Payhip dashboard", hint: "A screenshot of your Payhip affiliate sign-up form or dashboard." };
  }
  if (s.current_day === 4 && s.current_step === 1) return { label: "Bot test", hint: "A screenshot of your bot replying to a message you sent it." };
  if (s.current_day === 4 && s.current_step === 3) return { label: "Signature", hint: "A clear photo of your handwritten signature on paper." };
  return null;
}

async function latestRun(studentId: string, runId?: string | null) {
  let q = supabase.from("sre_runs").select("id, kind, title, status, source, bot_username, events, created_at").eq("student_id", studentId);
  q = runId ? q.eq("id", runId) : q.order("created_at", { ascending: false }).limit(1);
  const { data } = await q;
  return data?.[0] ?? null;
}

async function countRuns(studentId: string, filter: { source?: string; kind?: string[] }): Promise<number> {
  let q = supabase
    .from("sre_runs")
    .select("id", { count: "exact", head: true })
    .eq("student_id", studentId)
    .gte("created_at", new Date(Date.now() - 24 * 3600_000).toISOString());
  if (filter.source) q = q.eq("source", filter.source);
  if (filter.kind) q = q.in("kind", filter.kind);
  const { count } = await q;
  return count ?? 0;
}

function decodeImage(b64: unknown, mime: unknown): { bytes: Uint8Array; mimeType: string } | null {
  if (typeof b64 !== "string" || typeof mime !== "string" || !/^image\/(jpeg|png|webp)$/.test(mime)) return null;
  try {
    const bin = atob(b64.replace(/^data:[^,]+,/, ""));
    if (bin.length === 0 || bin.length > MAX_UPLOAD_BYTES) return null;
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { bytes, mimeType: mime };
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    if (req.method === "GET") {
      const url = new URL(req.url);
      const student = await studentByKey(url.searchParams.get("k"));
      if (!student) return json({ error: "This link isn't valid. Ask Amara on Telegram for your personal link." }, 404);

      const phase = phaseOf(student);
      const run = await latestRun(student.id, url.searchParams.get("run"));
      const names = suggestedBotNames(student.full_name, student.telegram_chat_id);
      return json({
        firstName: student.full_name?.split(" ")[0] ?? null,
        phase,
        day: student.current_day,
        step: student.current_step,
        botfather: { link: BOTFATHER_LINK, displayName: names.displayName, username: names.username },
        techStackUrl: TECH_STACK_URL,
        githubConnectUrl: phase === "build_pages" ? buildGitHubAuthUrl(String(student.telegram_chat_id)) : null,
        pages: student.github_repo_normal ? { normal: student.github_repo_normal, premium: student.github_repo_premium } : null,
        upload: uploadFor(student),
        run,
      });
    }

    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const student = await studentByKey(body.k ?? null);
      if (!student) return json({ error: "This link isn't valid. Ask Amara on Telegram for your personal link." }, 404);
      const chatId = Number(student.telegram_chat_id);

      // The page finished playing a build: release the held Telegram message.
      if (body.action === "shown") {
        const { data: own } = await supabase.from("sre_runs").select("id").eq("id", String(body.run ?? "")).eq("student_id", student.id).maybeSingle();
        if (own) background(deliverRunAnnouncement(own.id));
        return json({ ok: true });
      }

      // Day 3 begins with "ready" — the student starts the Selar step from the page.
      if (body.action === "ready") {
        if (phaseOf(student) !== "day3_start") return json({ error: "Nothing to start right now." }, 409);
        await saveConversation(student.id, "user", "ready [web]", "text");
        background(handleDay3({} as TelegramMessage, student, chatId, "ready", null));
        return json({ ok: true });
      }

      // Day 3 / Day 4 screenshots uploaded on the page go through the same checks as Telegram.
      if (body.action === "upload") {
        if (!uploadFor(student)) return json({ error: "There's nothing to upload for your current step." }, 409);
        if ((await countRuns(student.id, { kind: ["check", "certificate"] })) >= MAX_UPLOADS_PER_DAY) {
          return json({ error: "Too many uploads today — send your screenshot to Amara on Telegram instead." }, 429);
        }
        const photo = decodeImage(body.image, body.mime);
        if (!photo) return json({ error: "That image couldn't be read. Please choose a JPG or PNG under 6 MB." }, 400);
        await saveConversation(student.id, "user", "[photo via web]", "photo");
        const handler = student.current_day === 3 ? handleDay3 : handleDay4;
        background(handler({} as TelegramMessage, student, chatId, null, photo));
        return json({ ok: true });
      }

      // Day 1: build the SRE bot from a BotFather token.
      if (phaseOf(student) !== "build_bot" || (student.current_day === 1 && student.current_step !== SRE_STEP)) {
        return json({ error: "Your bot is already set up — there's nothing to build right now." }, 409);
      }
      const token = String(body.token ?? "").match(BOT_TOKEN_RE)?.[0];
      if (!token) {
        return json({ error: "That doesn't look like a BotFather token. It looks like 1234567890:AAH… — copy it from BotFather's \"Done!\" message." }, 400);
      }

      const { data: running } = await supabase
        .from("sre_runs")
        .select("id")
        .eq("student_id", student.id)
        .eq("status", "running")
        .gte("created_at", new Date(Date.now() - 3 * 60_000).toISOString())
        .limit(1);
      if (running?.[0]) return json({ runId: running[0].id });

      if ((await countRuns(student.id, { source: "web", kind: ["sre"] })) >= MAX_WEB_RUNS_PER_DAY) {
        return json({ error: "Too many attempts today — paste your token to Amara on Telegram instead." }, 429);
      }

      const { runId, done } = await buildSreFromWeb(student, token);
      background(done);
      return json({ runId });
    }

    return json({ error: "Not found" }, 404);
  } catch (e) {
    console.error("amara-web error:", e);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});
