// One-time 6-digit login codes for the web app: Amara sends them on Telegram, or the coach
// creates one with the admin command "code <ID>" and hands it over.
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

export const CODE_MINUTES = 15;

export async function sha256(text: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function issueLoginCode(studentId: string): Promise<string> {
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
  const { error } = await db.from("web_link_codes").upsert({
    student_id: studentId,
    code_hash: await sha256(`${studentId}:${code}`),
    attempts: 0,
    expires_at: new Date(Date.now() + CODE_MINUTES * 60_000).toISOString(),
  });
  if (error) throw new Error(`issueLoginCode: ${error.message}`);
  return code;
}
