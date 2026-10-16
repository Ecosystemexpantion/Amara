// JSON API behind the web version of Amara (the page itself is on GitHub Pages).
// Every request carries the student's private web key from their personal link.
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildSreFromWeb } from "../amara-bot/day1.ts";
import { SRE_STEP, GATE_STEP, BOTFATHER_LINK, TECH_STACK_URL, suggestedBotNames } from "../amara-bot/day1-content.ts";
import type { Student } from "../amara-bot/types.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const BOT_TOKEN_RE = /\d{6,12}:[A-Za-z0-9_-]{30,}/;
const MAX_WEB_RUNS_PER_DAY = 10;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
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
  if (s.current_day === 3 && !s.bot_token) return "build_bot";
  return `day${s.current_day}`;
}

async function latestRun(studentId: string, runId?: string | null) {
  let q = supabase.from("sre_runs").select("id, status, source, bot_username, events, created_at").eq("student_id", studentId);
  q = runId ? q.eq("id", runId) : q.order("created_at", { ascending: false }).limit(1);
  const { data } = await q;
  return data?.[0] ?? null;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    if (req.method === "GET") {
      const url = new URL(req.url);
      const student = await studentByKey(url.searchParams.get("k"));
      if (!student) return json({ error: "This link isn't valid. Ask Amara on Telegram for your personal link." }, 404);

      const run = await latestRun(student.id, url.searchParams.get("run"));
      const names = suggestedBotNames(student.full_name, student.telegram_chat_id);
      return json({
        firstName: student.full_name?.split(" ")[0] ?? null,
        phase: phaseOf(student),
        day: student.current_day,
        botfather: { link: BOTFATHER_LINK, displayName: names.displayName, username: names.username },
        techStackUrl: TECH_STACK_URL,
        run,
      });
    }

    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const student = await studentByKey(body.k ?? null);
      if (!student) return json({ error: "This link isn't valid. Ask Amara on Telegram for your personal link." }, 404);

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

      const { count } = await supabase
        .from("sre_runs")
        .select("id", { count: "exact", head: true })
        .eq("student_id", student.id)
        .eq("source", "web")
        .gte("created_at", new Date(Date.now() - 24 * 3600_000).toISOString());
      if ((count ?? 0) >= MAX_WEB_RUNS_PER_DAY) {
        return json({ error: "Too many attempts today — paste your token to Amara on Telegram instead." }, 429);
      }

      const { runId, done } = await buildSreFromWeb(student, token);
      const finish = done.catch((e) => console.error("web SRE build error:", e));
      if (typeof EdgeRuntime !== "undefined") {
        (EdgeRuntime as unknown as { waitUntil: (p: Promise<unknown>) => void }).waitUntil(finish);
      }
      return json({ runId });
    }

    return json({ error: "Not found" }, 404);
  } catch (e) {
    console.error("amara-web error:", e);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});
