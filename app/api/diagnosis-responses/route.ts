type ErrorInfo = { message: string; code?: string; details?: string; hint?: string };

const failureMessage = "진단 응답을 저장하지 못했습니다. 잠시 후 다시 시도해주세요.";

export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!url || !publishableKey) {
    return Response.json({ ok: false, message: failureMessage, error: { message: "Supabase 환경 변수가 비어 있습니다." } }, { status: 503 });
  }

  try {
    const body = await request.json() as {
      sessionId?: string;
      questionId?: string;
      questionVersion?: string;
      questionParameters?: Record<string, number>;
      answer?: string;
      isCorrect?: boolean;
      shownAt?: string;
      submittedAt?: string;
      responseTimeMs?: number;
    };

    if (!body.sessionId || !body.questionId || !body.questionVersion || !body.questionParameters || !body.answer || typeof body.isCorrect !== "boolean" || !body.shownAt || !body.submittedAt || !Number.isFinite(body.responseTimeMs)) {
      return Response.json({ ok: false, message: failureMessage, error: { message: "진단 응답 필드가 부족합니다.", code: "INVALID_INPUT" } }, { status: 400 });
    }

    const response = await fetch(`${url}/rest/v1/rpc/record_diagnosis_response`, {
      method: "POST",
      headers: { apikey: publishableKey, Authorization: `Bearer ${publishableKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        p_session_id: body.sessionId,
        p_question_id: body.questionId,
        p_question_version: body.questionVersion,
        p_question_parameters: body.questionParameters,
        p_answer: body.answer,
        p_is_correct: body.isCorrect,
        p_shown_at: body.shownAt,
        p_submitted_at: body.submittedAt,
        p_response_time_ms: Math.max(0, Math.round(body.responseTimeMs ?? 0)),
      }),
      cache: "no-store",
    });
    const responseText = await response.text();

    if (!response.ok) {
      let errorInfo: ErrorInfo = { message: responseText || response.statusText, code: String(response.status) };
      try { errorInfo = { ...errorInfo, ...(JSON.parse(responseText) as ErrorInfo) }; } catch { /* keep response text */ }
      console.error("[diagnosis-responses] Supabase RPC failed", errorInfo);
      return Response.json({ ok: false, message: failureMessage, error: errorInfo }, { status: 502 });
    }

    const rows = JSON.parse(responseText) as Array<{ id: string; session_id: string; question_id: string; submitted_at: string }>;
    const saved = rows[0];
    if (!saved?.id) {
      const error = { message: "저장된 진단 응답 ID가 반환되지 않았습니다.", code: "EMPTY_RPC_RESULT" };
      console.error("[diagnosis-responses] Empty RPC result", error);
      return Response.json({ ok: false, message: failureMessage, error }, { status: 502 });
    }

    return Response.json({ ok: true, message: "진단 응답을 저장했습니다.", response: { id: saved.id, sessionId: saved.session_id, questionId: saved.question_id, submittedAt: saved.submitted_at } });
  } catch (error) {
    const errorInfo = { message: error instanceof Error ? error.message : String(error) };
    console.error("[diagnosis-responses] Request failed", errorInfo);
    return Response.json({ ok: false, message: failureMessage, error: errorInfo }, { status: 502 });
  }
}
