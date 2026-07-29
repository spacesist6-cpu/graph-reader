import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

type TeacherContext = { client: SupabaseClient; user: User };

const unauthorized = (message = "교사 로그인이 필요합니다.") => Response.json({ ok: false, message }, { status: 401 });

export async function getTeacherContext(request: Request): Promise<TeacherContext | Response> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!url || !key || !token) return unauthorized();
  const client = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return unauthorized();
  if (data.user.app_metadata?.role !== "teacher") return unauthorized("교사 권한이 없습니다.");
  return { client, user: data.user };
}

export type TeacherSession = { id: string; student_id: string | null; student_code: string; started_at: string; status: string; completed_at: string | null };
export type TeacherDiagnosis = { id: string; session_id: string; question_id: string; question_order: number | null; question_version: string | null; question_parameters: Record<string, unknown> | null; answer: string; is_correct: boolean; shown_at: string | null; submitted_at: string; response_time_ms: number | null };
export type TeacherCheckpoint = { id: string; session_id: string; path: string; question_id: string; question_version: string; question_parameters: Record<string, unknown>; student_answer: string; is_correct: boolean; response_time_ms: number; attempt_number: number; submitted_at: string };
export type TeacherExploration = { id: string; session_id: string; path: string; prompt_id: string; response_text: string; coefficient_snapshot: { a?: number; b?: number; c?: number } | null; ai_feedback: Record<string, unknown> | null; feedback_status: string | null; feedback_created_at: string | null };
export type TeacherFinalAttempt = { id: string; session_id: string; question_id: string; question_formula: string; question_parameters: Record<string, unknown>; selected_choice_id: string; selected_formula: string; is_correct: boolean; attempt_number: number; feedback: string; submitted_at: string };
export type TeacherData = { sessions: TeacherSession[]; diagnoses: TeacherDiagnosis[]; checkpoints: TeacherCheckpoint[]; explorations: TeacherExploration[]; finalAttempts: TeacherFinalAttempt[] };

const query = async <T>(promise: PromiseLike<{ data: T | null; error: { message: string } | null }>) => {
  const result = await promise;
  if (result.error) throw new Error(result.error.message);
  return result.data ?? ([] as T);
};

export async function loadTeacherData(client: SupabaseClient, sessionId?: string): Promise<TeacherData> {
  const sessionsQuery = client.from("learning_sessions").select("id, student_id, student_code, started_at, status, completed_at").order("started_at", { ascending: false });
  const [sessions, diagnoses, checkpoints, explorations, finalAttempts] = await Promise.all([
    query<TeacherSession[]>(sessionId ? sessionsQuery.eq("id", sessionId) : sessionsQuery),
    query<TeacherDiagnosis[]>(client.from("diagnosis_responses").select("id, session_id, question_id, question_order, question_version, question_parameters, answer, is_correct, shown_at, submitted_at, response_time_ms").order("submitted_at", { ascending: true })),
    query<TeacherCheckpoint[]>(client.from("checkpoint_attempts").select("id, session_id, path, question_id, question_version, question_parameters, student_answer, is_correct, response_time_ms, attempt_number, submitted_at").order("submitted_at", { ascending: true })),
    query<TeacherExploration[]>(client.from("exploration_results").select("id, session_id, path, prompt_id, response_text, coefficient_snapshot, ai_feedback, feedback_status, feedback_created_at").order("feedback_created_at", { ascending: true })),
    query<TeacherFinalAttempt[]>(client.from("final_challenge_attempts").select("id, session_id, question_id, question_formula, question_parameters, selected_choice_id, selected_formula, is_correct, attempt_number, feedback, submitted_at").order("submitted_at", { ascending: true })),
  ]);
  return { sessions, diagnoses, checkpoints, explorations, finalAttempts };
}
