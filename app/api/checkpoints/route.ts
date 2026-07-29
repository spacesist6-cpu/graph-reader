type ErrorInfo = { message: string; code?: string; details?: string; hint?: string };

export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

  try {
    const body = await request.json() as {
      sessionId?: string;
      path?: "A" | "B" | "C";
      questionId?: string;
      questionVersion?: string;
      questionParameters?: Record<string, unknown>;
      studentAnswer?: string;
      isCorrect?: boolean;
      responseTimeMs?: number;
    };
    if (!url || !key || !body.sessionId || !body.path || !body.questionId || !body.questionVersion || !body.questionParameters || !body.studentAnswer || typeof body.isCorrect !== "boolean" || !Number.isFinite(body.responseTimeMs) || body.responseTimeMs < 0) {
      return Response.json({ ok: false, message: "확인문제 답안을 저장하지 못했습니다.", error: { message: "필수 확인문제 정보가 부족합니다.", code: "INVALID_INPUT" } }, { status: 400 });
    }

    const response = await fetch(`${url}/rest/v1/rpc/record_checkpoint_attempt`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        p_session_id: body.sessionId,
        p_path: body.path,
        p_question_id: body.questionId,
        p_question_version: body.questionVersion,
        p_question_parameters: body.questionParameters,
        p_student_answer: body.studentAnswer,
        p_is_correct: body.isCorrect,
        p_response_time_ms: Math.round(body.responseTimeMs),
      }),
      cache: "no-store",
    });
    const responseText = await response.text();
    if (!response.ok) {
      let error: ErrorInfo = { message: responseText || response.statusText, code: String(response.status) };
      try { error = { ...error, ...(JSON.parse(responseText) as ErrorInfo) }; } catch { /* keep response text */ }
      return Response.json({ ok: false, message: "확인문제 답안을 저장하지 못했습니다.", error }, { status: 502 });
    }

    const parsed = JSON.parse(responseText) as unknown;
    const row = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!row || typeof row.attempt_id !== "string" || !Number.isInteger(row.attempt_number) || typeof row.is_correct !== "boolean") {
      return Response.json({ ok: false, message: "확인문제 답안을 저장하지 못했습니다.", error: { message: "저장 결과 형식이 올바르지 않습니다." } }, { status: 502 });
    }
    return Response.json({ ok: true, message: "확인문제 답안을 저장했습니다.", attemptId: row.attempt_id, attemptNumber: row.attempt_number, isCorrect: row.is_correct });
  } catch (error) {
    const info = { message: error instanceof Error ? error.message : String(error) };
    console.error("[checkpoints] Save failed", info);
    return Response.json({ ok: false, message: "확인문제 답안을 저장하지 못했습니다.", error: info }, { status: 502 });
  }
}
