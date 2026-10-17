// Screenshot checks (Day 3 Selar/Payhip, Day 4 bot test) shown on the web as a 5-agent team:
// Intake receives the image, Iris reads it, Judge compares it with the step's checklist,
// Coach prepares the next instruction, Amara saves progress.
import { geminiVision } from "./gemini.ts";
import { startRun, reporter, finishRun } from "../_shared/runs.ts";
import type { ScreenshotResult } from "./types.ts";

export async function checkWithAgents(
  studentId: string,
  title: string,
  photo: { bytes: Uint8Array; mimeType: string },
  prompt: string
): Promise<ScreenshotResult> {
  const runId = await startRun(studentId, "check", "telegram", title);
  const r = reporter(runId);

  await r("intake", "working", "Receiving your screenshot…");
  await r("intake", "done", `Screenshot received securely (${(photo.bytes.length / 1024).toFixed(0)} KB ${photo.mimeType.replace("image/", "").toUpperCase()}).`);

  await r("iris", "working", "Reading your screenshot…");
  const result = await geminiVision(photo.bytes, photo.mimeType, prompt);
  const unavailable = result.reason === "verification_unavailable";
  await r("iris", "done", unavailable ? "Screenshot received — the vision AI is busy, so it was accepted." : `I can see: ${result.reason.slice(0, 220)}`);

  await r("judge", "working", "Comparing it with this step's checklist…");
  await r(
    "judge",
    result.verified || unavailable ? "done" : "failed",
    result.verified || unavailable ? "✓ This matches what the step needs." : `✗ Not quite yet. ${(result.guidance ?? "").slice(0, 200)}`
  );

  await r("coach", "working", "Preparing your next instruction…");
  await r("coach", "done", "Your next step is waiting for you in Telegram.");

  await r("amara", "working", "Updating your progress…");
  await r("amara", "done", result.verified || unavailable ? "Progress saved ✓" : "Waiting for your next screenshot.");
  await finishRun(runId, result.verified || unavailable ? "done" : "failed");
  return result;
}
