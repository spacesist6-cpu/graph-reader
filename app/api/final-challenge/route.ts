type ErrorInfo = { message: string; code?: string; details?: string; hint?: string };

const feedbackByErrorType: Record<string, string> = {
  direction: "a의 부호를 다시 확인해보세요.",
  width: "|a|의 크기가 그래프의 폭에 어떤 영향을 주는지 살펴보세요.",
  vertex: "꼭짓점 (1, -1)과 대칭축 x=1을 확인해보세요.",
  yIntercept: "x=0을 대입했을 때 y값이 얼마인지 확인해보세요.",
};

function parseResult(value: unknown): { attemptId: string; isCorrect: boolean; attemptNumber: number; completedAt?: string | null } | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") return null;
  const item = row as Partial<{ attempt_id: string; is_correct: boolean; attempt_number: number; completed_at: string | null }>;
  if (typeof item.attempt_id !== "string" || typeof item.is_correct !== "boolean" || !Number.isInteger(item.attempt_number)) return null;
  return { attemptId: item.attempt_id, isCorrect: item.is_correct, attemptNumber: item.attempt_number, completedAt: item.completed_at };
}

export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

  try {
    const body = await request.json() as {
      sessionId?: string;
      questionId?: string;
      questionFormula?: string;
      questionParameters?: Record<string, unknown>;
      selectedChoiceId?: string;
      selectedFormula?: string;
      isCorrect?: boolean;
      feedback?: string;
    };
    if (!url || !key || !body.sessionId || !body.questionId || !body.questionFormula || !body.questionParameters || !body.selectedChoiceId || !body.selectedFormula || typeof body.isCorrect !== "boolean" || !body.feedback) {
      return Response.json({ ok: false, message: "최종 미션 답안을 저장하지 못했습니다.", error: { message: "필수 답안 정보가 부족합니다.", code: "INVALID_INPUT" } }, { status: 400 });
    }

    const response = await fetch(`${url}/rest/v1/rpc/record_final_challenge_attempt`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        p_session_id: body.sessionId,
        p_question_id: body.questionId,
        p_question_formula: body.questionFormula,
        p_question_parameters: body.questionParameters,
        p_selected_choice_id: body.selectedChoiceId,
        p_selected_formula: body.selectedFormula,
        p_is_correct: body.isCorrect,
        p_feedback: body.feedback,
      }),
      cache: "no-store",
    });
    const responseText = await response.text();
    if (!response.ok) {
      let error: ErrorInfo = { message: responseText || response.statusText, code: String(response.status) };
      try { error = { ...error, ...(JSON.parse(responseText) as ErrorInfo) }; } catch { /* keep response text */ }
      return Response.json({ ok: false, message: "최종 미션 답안을 저장하지 못했습니다.", error }, { status: 502 });
    }

    const result = parseResult(JSON.parse(responseText));
    if (!result) return Response.json({ ok: false, message: "최종 미션 답안을 저장하지 못했습니다.", error: { message: "저장 결과 형식이 올바르지 않습니다." } }, { status: 502 });
    return Response.json({
      ok: true,
      message: result.isCorrect ? "정답을 저장했습니다." : "오답 시도를 저장했습니다.",
      attemptId: result.attemptId,
      isCorrect: result.isCorrect,
      attemptNumber: result.attemptNumber,
      completedAt: result.completedAt ?? undefined,
      feedback: body.feedback,
    });
  } catch (error) {
    const info = { message: error instanceof Error ? error.message : String(error) };
    console.error("[final-challenge] Save failed", info);
    return Response.json({ ok: false, message: "최종 미션 답안을 저장하지 못했습니다.", error: info }, { status: 502 });
  }
}

export { feedbackByErrorType };
