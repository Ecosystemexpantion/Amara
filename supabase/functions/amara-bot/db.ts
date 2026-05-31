import { createClient } from "npm:@supabase/supabase-js@2";
import type { Student, ConversationMessage } from "./types.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

export async function getStudentByChatId(chatId: string): Promise<Student | null> {
  const { data, error } = await supabase
    .from("amara_students")
    .select("*")
    .eq("telegram_chat_id", chatId)
    .single();
  if (error && error.code !== "PGRST116") console.error("getStudent error:", error);
  return data ?? null;
}

export async function createStudent(chatId: string): Promise<Student> {
  const { data, error } = await supabase
    .from("amara_students")
    .insert({ telegram_chat_id: chatId, current_day: 0, current_step: 1, status: "ACTIVE" })
    .select()
    .single();
  if (error) throw new Error(`createStudent: ${error.message}`);
  return data;
}

export async function updateStudent(studentId: string, updates: Partial<Student>): Promise<Student> {
  const { data, error } = await supabase
    .from("amara_students")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", studentId)
    .select()
    .single();
  if (error) throw new Error(`updateStudent: ${error.message}`);
  return data;
}

export async function advanceStep(
  studentId: string,
  newDay: number,
  newStep: number,
  extra?: Partial<Student>
): Promise<Student> {
  return updateStudent(studentId, {
    ...extra,
    current_day: newDay,
    current_step: newStep,
    screenshot_attempts: 0,
  });
}

export async function incrementScreenshotAttempts(studentId: string, current: number): Promise<void> {
  await supabase
    .from("amara_students")
    .update({ screenshot_attempts: current + 1, updated_at: new Date().toISOString() })
    .eq("id", studentId);
}

export async function resetScreenshotAttempts(studentId: string): Promise<void> {
  await supabase
    .from("amara_students")
    .update({ screenshot_attempts: 0, updated_at: new Date().toISOString() })
    .eq("id", studentId);
}

export async function getRecentConversation(
  studentId: string,
  limit = 10
): Promise<ConversationMessage[]> {
  const { data } = await supabase
    .from("amara_conversations")
    .select("role, message")
    .eq("student_id", studentId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (!data) return [];
  return (data as ConversationMessage[]).reverse();
}

export async function saveConversation(
  studentId: string,
  role: "user" | "assistant",
  message: string,
  messageType = "text"
): Promise<void> {
  await supabase.from("amara_conversations").insert({
    student_id: studentId,
    role,
    message,
    message_type: messageType,
  });
}

export async function recordStepCompletion(
  studentId: string,
  day: number,
  step: number,
  screenshotVerified: boolean,
  notes?: string
): Promise<void> {
  await supabase.from("amara_step_completions").insert({
    student_id: studentId,
    day,
    step,
    screenshot_verified: screenshotVerified,
    notes,
  });
}

export async function getStudentsDueForUnlock(): Promise<Student[]> {
  const { data, error } = await supabase
    .from("amara_students")
    .select("*")
    .eq("status", "ACTIVE")
    .eq("current_step", 0)
    .lte("next_day_unlocks_at", new Date().toISOString())
    .gte("current_day", 1)
    .lte("current_day", 3)
    .not("next_day_unlocks_at", "is", null);
  if (error) console.error("getStudentsDueForUnlock:", error);
  return data ?? [];
}

export function computeNextUnlockAt(): string {
  const now = new Date();
  // Convert to Nigeria time (UTC+1), find next day at 8AM, convert back to UTC
  const nigeriaOffsetMs = 60 * 60 * 1000;
  const nowNigeria = new Date(now.getTime() + nigeriaOffsetMs);
  const tomorrowNigeria = new Date(nowNigeria);
  tomorrowNigeria.setDate(tomorrowNigeria.getDate() + 1);
  tomorrowNigeria.setHours(8, 0, 0, 0);
  return new Date(tomorrowNigeria.getTime() - nigeriaOffsetMs).toISOString();
}
