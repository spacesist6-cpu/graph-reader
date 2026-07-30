import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";

export type SupabaseConnectionResult = {
  ok: boolean;
  message: string;
  error?: { message?: string; code?: string; details?: string; hint?: string };
};

export type LearningSessionStartResult = {
  ok: boolean;
  message: string;
  session?: { studentProfileId: string; sessionId: string; studentCode: string; startedAt: string };
  error?: { message?: string; code?: string; details?: string; hint?: string };
};

export type DiagnosisResponseSaveResult = {
  ok: boolean;
  message: string;
  response?: { id: string; sessionId: string; questionId: string; submittedAt: string };
  error?: { message?: string; code?: string; details?: string; hint?: string };
};

export type ExplorationFeedback = {
  strengths: string[];
  improvements: string[];
  nextQuestion: string;
  hint: string;
};

export type ExplorationStageFeedback = {
  stage: number;
  strengths: string[];
  improvements: string[];
  nextQuestion: string;
  hint?: string;
};

export type AggregateExplorationFeedback = {
  feedback: ExplorationStageFeedback[];
};

export type ExplorationFeedbackResult = {
  ok: boolean;
  message: string;
  feedback?: ExplorationFeedback;
  feedbackStatus?: "generated" | "fallback" | "failed";
  error?: { message?: string; code?: string; details?: string; hint?: string };
};

export type SavedExplorationResult = {
  id: string;
  sessionId: string;
  path: "A" | "B" | "C";
  promptId: string;
  responseText: string;
  coefficientSnapshot: { a: number; b: number; c: number };
  feedback: ExplorationFeedback | null;
  feedbackStatus: string | null;
  writtenAt: string;
};

export type ExplorationResultsLoadResult = {
  ok: boolean;
  message: string;
  results?: SavedExplorationResult[];
  error?: { message?: string; code?: string; details?: string; hint?: string };
};

export type LearningRecords = {
  diagnosis: Array<{ id: string; question_id: string; question_version: string | null; question_parameters: Record<string, unknown> | null; answer: string; is_correct: boolean; submitted_at: string; response_time_ms: number | null }>;
  checkpoints: Array<{ id: string; path: string; question_id: string; question_version: string; question_parameters: Record<string, unknown>; student_answer: string; is_correct: boolean; response_time_ms: number; attempt_number: number; submitted_at: string }>;
  explorations: Array<{ id: string; path: "A" | "B" | "C"; prompt_id: string; response_text: string; coefficient_snapshot: { a: number; b: number; c: number } | null; ai_feedback: Record<string, unknown> | null; feedback_status: string | null; feedback_created_at: string | null }>;
  finalAttempts: Array<{ id: string; question_id: string; question_formula: string; question_parameters: Record<string, unknown>; selected_choice_id: string; selected_formula: string; is_correct: boolean; attempt_number: number; feedback: string; submitted_at: string }>;
};

export type LearningRecordsLoadResult = { ok: boolean; message: string; records?: LearningRecords; error?: { message?: string } };

export async function loadLearningRecords(sessionId: string): Promise<LearningRecordsLoadResult> {
  try {
    const response = await fetch(`/api/learning-records?sessionId=${encodeURIComponent(sessionId)}`, { cache: "no-store" });
    return await response.json() as LearningRecordsLoadResult;
  } catch (error) {
    return { ok: false, message: "학습 기록을 불러오지 못했습니다.", error: { message: error instanceof Error ? error.message : String(error) } };
  }
}

export type AggregateExplorationFeedbackResult = {
  ok: boolean;
  message: string;
  feedback?: AggregateExplorationFeedback;
  feedbackStatus?: string;
  error?: { message?: string; code?: string; details?: string; hint?: string };
};

export type FinalChallengeAttemptResult = {
  ok: boolean;
  message: string;
  attemptId?: string;
  isCorrect?: boolean;
  attemptNumber?: number;
  completedAt?: string;
  feedback?: string;
  error?: { message?: string; code?: string; details?: string; hint?: string };
};

export type CheckpointAttemptResult = {
  ok: boolean;
  message: string;
  attemptId?: string;
  attemptNumber?: number;
  isCorrect?: boolean;
  error?: { message?: string; code?: string; details?: string; hint?: string };
};

export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey);
export const supabase: SupabaseClient | null = isSupabaseConfigured ? createClient(supabaseUrl, supabasePublishableKey) : null;

export async function checkSupabaseConnection(): Promise<SupabaseConnectionResult> {
  try {
    const response = await fetch("/api/supabase-health", { cache: "no-store" });
    const result = await response.json() as SupabaseConnectionResult;
    return result;
  } catch (error) {
    return { ok: false, message: "Supabase 연결 확인 요청에 실패했습니다.", error: { message: error instanceof Error ? error.message : String(error) } };
  }
}

export async function startLearningSession(studentCode: string): Promise<LearningSessionStartResult> {
  try {
    const response = await fetch("/api/learning-sessions/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ studentCode }),
      cache: "no-store",
    });
    return await response.json() as LearningSessionStartResult;
  } catch (error) {
    return { ok: false, message: "학습 기록을 시작하지 못했습니다. 잠시 후 다시 시도해주세요.", error: { message: error instanceof Error ? error.message : String(error) } };
  }
}

export async function saveDiagnosisResponse(input: {
  sessionId: string;
  questionId: string;
  questionVersion: string;
  questionParameters: Record<string, number>;
  answer: string;
  isCorrect: boolean;
  shownAt: string;
  submittedAt: string;
  responseTimeMs: number;
}): Promise<DiagnosisResponseSaveResult> {
  try {
    const response = await fetch("/api/diagnosis-responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      cache: "no-store",
    });
    return await response.json() as DiagnosisResponseSaveResult;
  } catch (error) {
    return {
      ok: false,
      message: "진단 응답을 저장하지 못했습니다.",
      error: { message: error instanceof Error ? error.message : String(error) },
    };
  }
}

export async function loadExplorationResults(sessionId: string): Promise<ExplorationResultsLoadResult> {
  try {
    const response = await fetch(`/api/exploration-feedback?sessionId=${encodeURIComponent(sessionId)}`, { cache: "no-store" });
    return await response.json() as ExplorationResultsLoadResult;
  } catch (error) {
    return { ok: false, message: "탐구 결과를 불러오지 못했습니다.", error: { message: error instanceof Error ? error.message : String(error) } };
  }
}

export async function saveFinalChallengeAttempt(input: {
  sessionId: string;
  questionId: string;
  questionFormula: string;
  questionParameters: Record<string, unknown>;
  selectedChoiceId: string;
  selectedFormula: string;
  isCorrect: boolean;
  feedback: string;
}): Promise<FinalChallengeAttemptResult> {
  try {
    const response = await fetch("/api/final-challenge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      cache: "no-store",
    });
    return await response.json() as FinalChallengeAttemptResult;
  } catch (error) {
    return {
      ok: false,
      message: "최종 미션 답안을 저장하지 못했습니다.",
      error: { message: error instanceof Error ? error.message : String(error) },
    };
  }
}

export async function saveCheckpointAttempt(input: {
  sessionId: string;
  path: "A" | "B" | "C";
  questionId: string;
  questionVersion: string;
  questionParameters: Record<string, unknown>;
  studentAnswer: string;
  isCorrect: boolean;
  responseTimeMs: number;
}): Promise<CheckpointAttemptResult> {
  try {
    const response = await fetch("/api/checkpoints", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      cache: "no-store",
    });
    return await response.json() as CheckpointAttemptResult;
  } catch (error) {
    return {
      ok: false,
      message: "확인문제 답안을 저장하지 못했습니다.",
      error: { message: error instanceof Error ? error.message : String(error) },
    };
  }
}

export async function saveExplorationFeedback(input: {
  sessionId: string;
  path: "A" | "B" | "C";
  promptId: string;
  studentResponse: string;
  coefficientSnapshot: { a: number; b: number; c: number };
  aiFeedback?: ExplorationFeedback;
  feedbackStatus?: string;
}): Promise<ExplorationFeedbackResult> {
  try {
    const response = await fetch("/api/exploration-feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      cache: "no-store",
    });
    return await response.json() as ExplorationFeedbackResult;
  } catch (error) {
    return { ok: false, message: "탐구 결과를 저장하지 못했습니다.", error: { message: error instanceof Error ? error.message : String(error) } };
  }
}

export async function aggregateExplorationFeedback(input: {
  sessionId: string;
  explorations: Array<{
    stage: number;
    path: "A" | "B" | "C";
    promptId: string;
    question: string;
    studentResponse: string;
    coefficientSnapshot: { a: number; b: number; c: number };
    coreConcept: string;
  }>;
}): Promise<AggregateExplorationFeedbackResult> {
  try {
    const response = await fetch("/api/exploration-feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "aggregate", ...input }),
      cache: "no-store",
    });
    return await response.json() as AggregateExplorationFeedbackResult;
  } catch (error) {
    return { ok: false, message: "탐구 결과 종합 피드백을 불러오지 못했습니다.", error: { message: error instanceof Error ? error.message : String(error) } };
  }
}
