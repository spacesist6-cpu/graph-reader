import { createClient } from "@supabase/supabase-js";

export async function GET(request: Request) {
  const sessionId = new URL(request.url).searchParams.get("sessionId")?.trim();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!sessionId) return Response.json({ ok: false, message: "학습 세션을 확인할 수 없습니다." }, { status: 400 });
  if (!url || !key) return Response.json({ ok: false, message: "Supabase 환경 변수가 설정되지 않았습니다." }, { status: 500 });

  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.rpc("get_learning_records", { p_session_id: sessionId });
  if (error) return Response.json({ ok: false, message: "학습 기록을 불러오지 못했습니다." }, { status: 502 });
  return Response.json({ ok: true, records: data ?? { diagnosis: [], checkpoints: [], explorations: [], finalAttempts: [] } }, { headers: { "cache-control": "no-store" } });
}
