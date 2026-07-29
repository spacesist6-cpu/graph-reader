type ErrorInfo = { message: string; code?: string; details?: string; hint?: string };

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!url || !publishableKey) {
    return Response.json({ ok: false, message: "Supabase 환경 변수가 설정되지 않았습니다.", error: { message: "환경 변수가 비어 있습니다." } }, { status: 503 });
  }

  try {
    const response = await fetch(`${url}/rest/v1/app_health?select=id,status&id=eq.1`, {
      headers: { apikey: publishableKey, Authorization: `Bearer ${publishableKey}` },
      cache: "no-store",
    });
    const responseText = await response.text();

    if (!response.ok) {
      let errorInfo: ErrorInfo = { message: responseText || response.statusText, code: String(response.status) };
      try { errorInfo = { ...errorInfo, ...(JSON.parse(responseText) as ErrorInfo) }; } catch { /* keep text response */ }
      return Response.json({ ok: false, message: "Supabase 연결은 되었지만 app_health 테이블 확인에 실패했습니다.", error: errorInfo }, { status: 502 });
    }

    const rows = JSON.parse(responseText) as Array<{ id: number; status: string }>;
    if (rows.length !== 1 || rows[0]?.id !== 1 || rows[0]?.status !== "ok") {
      return Response.json({ ok: false, message: "app_health 테이블의 상태 값이 올바르지 않습니다.", error: { message: "Expected id=1 and status=ok." } }, { status: 502 });
    }

    return Response.json({ ok: true, message: "Supabase 연결과 app_health 테이블 확인이 완료되었습니다." });
  } catch (error) {
    return Response.json({ ok: false, message: "Supabase 연결 확인 중 예외가 발생했습니다.", error: { message: error instanceof Error ? error.message : String(error) } }, { status: 502 });
  }
}
