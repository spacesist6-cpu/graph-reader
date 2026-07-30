import { createClient } from "@supabase/supabase-js";

export async function GET(request: Request) {
  const sessionId = new URL(request.url).searchParams.get("sessionId")?.trim();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!sessionId) return Response.json({ ok: false, message: "학습 세션을 확인할 수 없습니다." }, { status: 400 });
  if (!url || !key) return Response.json({ ok: false, message: "Supabase 환경 변수가 설정되지 않았습니다." }, { status: 500 });

  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const [diagnosis, checkpoints, explorations, finalAttempts] = await Promise.all([
    client.from("diagnosis_responses").select("id, question_id, question_version, question_parameters, answer, is_correct, submitted_at, response_time_ms").eq("session_id", sessionId).order("submitted_at", { ascending: true }),
    client.from("checkpoint_attempts").select("id, path, question_id, question_version, question_parameters, student_answer, is_correct, response_time_ms, attempt_number, submitted_at").eq("session_id", sessionId).order("submitted_at", { ascending: true }),
    client.from("exploration_results").select("id, path, prompt_id, response_text, coefficient_snapshot, ai_feedback, feedback_status, feedback_created_at").eq("session_id", sessionId).order("feedback_created_at", { ascending: true }),
    client.from("final_challenge_attempts").select("id, question_id, question_formula, question_parameters, selected_choice_id, selected_formula, is_correct, attempt_number, feedback, submitted_at").eq("session_id", sessionId).order("submitted_at", { ascending: true }),
  ]);
  const failed = [diagnosis, checkpoints, explorations, finalAttempts].find((result) => result.error);
  if (failed?.error) return Response.json({ ok: false, message: "학습 기록을 불러오지 못했습니다." }, { status: 502 });
  return Response.json({ ok: true, records: { diagnosis: diagnosis.data ?? [], checkpoints: checkpoints.data ?? [], explorations: explorations.data ?? [], finalAttempts: finalAttempts.data ?? [] } }, { headers: { "cache-control": "no-store" } });
}
