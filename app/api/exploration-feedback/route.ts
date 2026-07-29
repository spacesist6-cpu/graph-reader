type Feedback = { strengths: string[]; improvements: string[]; nextQuestion: string; hint: string };
type ErrorInfo = { message: string; code?: string; details?: string; hint?: string };
type CoefficientSnapshot = { a: number; b: number; c: number };

const fallback: Feedback = {
  strengths: ["작성한 탐구 내용을 확인했습니다."],
  improvements: ["그래프의 방향, 폭, 꼭짓점, y절편과 계수의 관계를 구체적으로 연결해 보세요."],
  nextQuestion: "계수를 바꾸었을 때 그래프의 방향, 폭, 꼭짓점, y절편은 어떻게 달라지나요?",
  hint: "최종 미션에서 a, b, c를 그래프의 특징과 함께 해석해 보세요.",
};

function parseFeedback(value: unknown): Feedback | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<Feedback>;
  if (!Array.isArray(item.strengths) || !Array.isArray(item.improvements) || typeof item.nextQuestion !== "string" || typeof item.hint !== "string") return null;
  return {
    strengths: item.strengths.filter((v): v is string => typeof v === "string"),
    improvements: item.improvements.filter((v): v is string => typeof v === "string"),
    nextQuestion: item.nextQuestion,
    hint: item.hint,
  };
}

async function createGeminiFeedback(apiKey: string, input: { path: string; studentResponse: string; coefficientSnapshot: CoefficientSnapshot }) {
  const prompt = `중학교 3학년 이차함수 탐구 답변에 짧고 친절한 피드백을 작성하세요. 반드시 JSON만 반환하세요. 형식: {"strengths":[""],"improvements":[""],"nextQuestion":"","hint":""}. 탐구 단계: ${input.path}. 조절한 계수: a=${input.coefficientSnapshot.a}, b=${input.coefficientSnapshot.b}, c=${input.coefficientSnapshot.c}. 학생 답변: ${input.studentResponse}`;
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json" } }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Gemini HTTP ${response.status}`);
  const data = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  return text ? parseFeedback(JSON.parse(text)) : null;
}

export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  // 이 서버 경로에는 publishable/anon key만 사용합니다. service_role key는 브라우저나 이 API에 넣지 않습니다.
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

  try {
    const body = await request.json() as {
      sessionId?: string;
      path?: "A" | "B" | "C";
      promptId?: string;
      studentResponse?: string;
      coefficientSnapshot?: CoefficientSnapshot | null;
      aiFeedback?: Feedback;
      feedbackStatus?: string;
    };
    const snapshot = body.coefficientSnapshot;
    if (!url || !key || !body.sessionId || !body.path || !body.promptId || !body.studentResponse || !snapshot || !Number.isFinite(snapshot.a) || !Number.isFinite(snapshot.b) || !Number.isFinite(snapshot.c)) {
      return Response.json({ ok: false, message: "탐구 결과를 저장하지 못했습니다.", error: { message: "필수 값 또는 coefficientSnapshot이 없습니다.", code: "INVALID_INPUT" } }, { status: 400 });
    }

    let feedback = fallback;
    let feedbackStatus = "fallback";
    const geminiKey = process.env.GEMINI_API_KEY?.trim();
    if (geminiKey) {
      try {
        feedback = await createGeminiFeedback(geminiKey, { path: body.path, studentResponse: body.studentResponse, coefficientSnapshot: snapshot }) ?? fallback;
        feedbackStatus = feedback === fallback ? "fallback" : "generated";
      } catch (error) {
        console.error("[exploration-feedback] Gemini failed", error);
      }
    }

    const supabaseResponse = await fetch(`${url}/rest/v1/rpc/record_exploration_result`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        p_session_id: body.sessionId,
        p_path: body.path,
        p_prompt_id: body.promptId,
        p_student_response: body.studentResponse,
        p_coefficient_snapshot: snapshot,
        p_ai_feedback: body.aiFeedback ?? feedback,
        p_feedback_status: body.feedbackStatus ?? feedbackStatus,
      }),
      cache: "no-store",
    });
    const supabaseText = await supabaseResponse.text();
    if (!supabaseResponse.ok) {
      let error: ErrorInfo = { message: supabaseText || supabaseResponse.statusText, code: String(supabaseResponse.status) };
      try { error = { ...error, ...(JSON.parse(supabaseText) as ErrorInfo) }; } catch { /* keep response text */ }
      console.error("[exploration-feedback] Supabase failed", error);
      return Response.json({ ok: false, message: "탐구 결과를 저장하지 못했습니다.", error }, { status: 502 });
    }
    return Response.json({ ok: true, message: "탐구 결과를 저장했습니다.", feedback });
  } catch (error) {
    const info = { message: error instanceof Error ? error.message : String(error) };
    console.error("[exploration-feedback] Request failed", info);
    return Response.json({ ok: false, message: "탐구 결과를 저장하지 못했습니다.", error: info }, { status: 502 });
  }
}
