import { getTeacherContext, loadTeacherData } from "../../../../../lib/teacher/server";

export async function GET(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const context = await getTeacherContext(request);
  if (context instanceof Response) return context;
  const { sessionId } = await params;
  if (!sessionId) return Response.json({ ok: false, message: "학습 세션을 찾을 수 없습니다." }, { status: 400 });
  try {
    const data = await loadTeacherData(context.client, sessionId);
    return data.sessions.length ? Response.json({ ok: true, data }) : Response.json({ ok: false, message: "학습 세션을 찾을 수 없습니다." }, { status: 404 });
  } catch (error) { return Response.json({ ok: false, message: "학생 상세 데이터를 불러오지 못했습니다.", error: { message: error instanceof Error ? error.message : String(error) } }, { status: 502 }); }
}
