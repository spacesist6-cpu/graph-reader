import { getTeacherContext, loadTeacherData } from "../../../../lib/teacher/server";

export async function GET(request: Request) {
  const context = await getTeacherContext(request);
  if (context instanceof Response) return context;
  try { return Response.json({ ok: true, data: await loadTeacherData(context.client) }); }
  catch (error) { return Response.json({ ok: false, message: "교사 현황판 데이터를 불러오지 못했습니다.", error: { message: error instanceof Error ? error.message : String(error) } }, { status: 502 }); }
}
