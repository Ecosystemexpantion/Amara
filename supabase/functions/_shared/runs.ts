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

// The web page plays each agent's tool animation (~16s per agent); Telegram waits this long
// before announcing a result the student is watching on the web, so both finish together.
export const WEB_SHOW_MS: Record<RunKind, number> = { sre: 110_000, pages: 110_000, check: 0, certificate: 0 };

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

export function sleepUntil(startedAt: number, totalMs: number): Promise<void> {
  const left = totalMs - (Date.now() - startedAt);
  return left > 0 ? new Promise((r) => setTimeout(r, left)) : Promise.resolve();
}
