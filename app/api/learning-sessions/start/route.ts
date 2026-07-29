type ErrorInfo = { message: string; code?: string; details?: string; hint?: string };

export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!url || !publishableKey) {
    return Response.json({ ok: false, message: "학습 기록을 시작하지 못했습니다. 잠시 후 다시 시도해주세요.", error: { message: "Supabase 환경 변수가 비어 있습니다." } }, { status: 503 });
  }

  try {
    const body = await request.json() as { studentCode?: string };
    const response = await fetch(`${url}/rest/v1/rpc/start_learning_session`, {
      method: "POST",
      headers: { apikey: publishableKey, Authorization: `Bearer ${publishableKey}`, "content-type": "application/json" },
      body: JSON.stringify({ p_student_code: body.studentCode ?? "" }),
      cache: "no-store",
    });
    const responseText = await response.text();

    if (!response.ok) {
      let errorInfo: ErrorInfo = { message: responseText || response.statusText, code: String(response.status) };
      try { errorInfo = { ...errorInfo, ...(JSON.parse(responseText) as ErrorInfo) }; } catch { /* keep text response */ }
      return Response.json({ ok: false, message: "학습 기록을 시작하지 못했습니다. 잠시 후 다시 시도해주세요.", error: errorInfo }, { status: 502 });
    }

    const rows = JSON.parse(responseText) as Array<{ student_profile_id: string; session_id: string; student_code: string; started_at: string }>;
    const session = rows[0];
    if (!session?.session_id) {
      return Response.json({ ok: false, message: "학습 기록을 시작하지 못했습니다. 잠시 후 다시 시도해주세요.", error: { message: "세션 ID가 반환되지 않았습니다." } }, { status: 502 });
    }

    return Response.json({ ok: true, message: "학습 세션이 시작되었습니다.", session: { studentProfileId: session.student_profile_id, sessionId: session.session_id, studentCode: session.student_code, startedAt: session.started_at } });
  } catch (error) {
    return Response.json({ ok: false, message: "학습 기록을 시작하지 못했습니다. 잠시 후 다시 시도해주세요.", error: { message: error instanceof Error ? error.message : String(error) } }, { status: 502 });
  }
}
