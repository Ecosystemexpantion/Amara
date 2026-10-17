// Live log of agent work for the web version of Amara. Every write is best-effort:
// a logging failure must never break the real step it describes.
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

export const WEB_APP_URL = "https://ecosystemexpantion.github.io/amara-live/";

export function webLink(webKey: string | null | undefined): string | null {
  return webKey ? `${WEB_APP_URL}?k=${webKey}` : null;
}

export type RunKind = "sre" | "pages" | "check" | "certificate";
export type AgentState = "working" | "done" | "failed";
export type Report = (agent: string, state: AgentState, text: string) => Promise<void>;

// A build the student is watching on the web holds its Telegram "done" message until the page's
// animation ends (the page reports "shown") — or until the cron's fallback, a few minutes later.
export type Announcement =
  | { type: "sre_live"; day: 1 | 3; botUsername: string }
  | { type: "pages_live"; isRepair: boolean; normalUrl: string; premiumUrl: string };

export async function startRun(studentId: string, kind: RunKind, source: "telegram" | "web", title?: string): Promise<string | null> {
  try {
    const { data, error } = await db
      .from("sre_runs")
      .insert({ student_id: studentId, kind, source, title: title ?? null })
      .select("id")
      .single();
    if (error) throw error;
    return data.id as string;
  } catch (e) {
    console.error("startRun failed:", e);
    return null;
  }
}

export function reporter(runId: string | null): Report {
  return async (agent, state, text) => {
    if (!runId) return;
    try {
      const { data } = await db.from("sre_runs").select("events").eq("id", runId).single();
      const events = [...((data?.events as unknown[]) ?? []), { agent, state, text, at: new Date().toISOString() }];
      await db.from("sre_runs").update({ events, updated_at: new Date().toISOString() }).eq("id", runId);
    } catch (e) {
      console.error("run event failed:", e);
    }
  };
}

export async function finishRun(runId: string | null, status: "done" | "failed", botUsername?: string): Promise<void> {
  if (!runId) return;
  try {
    await db
      .from("sre_runs")
      .update({ status, ...(botUsername ? { bot_username: botUsername } : {}), updated_at: new Date().toISOString() })
      .eq("id", runId);
  } catch (e) {
    console.error("finishRun failed:", e);
  }
}

export async function holdAnnouncement(runId: string | null, announce: Announcement): Promise<void> {
  if (!runId) return;
  const { error } = await db.from("sre_runs").update({ announce, updated_at: new Date().toISOString() }).eq("id", runId);
  if (error) console.error("holdAnnouncement failed:", error.message);
}

// Exactly one caller wins the claim, so the message is never sent twice.
export async function claimAnnouncement(runId: string): Promise<{ studentId: string; announce: Announcement } | null> {
  const { data } = await db
    .from("sre_runs")
    .update({ announced_at: new Date().toISOString() })
    .eq("id", runId)
    .is("announced_at", null)
    .not("announce", "is", null)
    .select("student_id, announce");
  const row = data?.[0];
  return row ? { studentId: row.student_id as string, announce: row.announce as Announcement } : null;
}
