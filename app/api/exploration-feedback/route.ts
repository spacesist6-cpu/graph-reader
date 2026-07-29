type Feedback = { strengths: string[]; improvements: string[]; nextQuestion: string; hint: string };
type StageFeedback = { stage: number; strengths: string[]; improvements: string[]; nextQuestion: string };
type AggregateInput = { stage: number; path: "A" | "B" | "C"; promptId: string; question: string; studentResponse: string; coefficientSnapshot: CoefficientSnapshot; coreConcept: string };
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

function parseStageFeedback(value: unknown): StageFeedback | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<StageFeedback>;
  if (!Number.isInteger(item.stage) || !Array.isArray(item.strengths) || !Array.isArray(item.improvements) || typeof item.nextQuestion !== "string") return null;
  const stage = item.stage as number;
  const strengths = item.strengths as unknown[];
  const improvements = item.improvements as unknown[];
  return { stage, strengths: strengths.filter((v): v is string => typeof v === "string"), improvements: improvements.filter((v): v is string => typeof v === "string"), nextQuestion: item.nextQuestion };
}

function parseAggregateFeedback(value: unknown): StageFeedback[] | null {
  if (!value || typeof value !== "object" || !Array.isArray((value as { feedback?: unknown }).feedback)) return null;
  const parsed = (value as { feedback: unknown[] }).feedback.map(parseStageFeedback).filter((item): item is StageFeedback => item !== null);
  return [1, 2, 3].every((stage) => parsed.some((item) => item.stage === stage)) ? parsed.sort((a, b) => a.stage - b.stage) : null;
}

function fallbackStageFeedback(stage: number): StageFeedback {
  const byStage: Record<number, StageFeedback> = {
    1: { stage: 1, strengths: ["a의 부호와 그래프의 방향, |a|와 폭의 관계를 관찰했습니다."], improvements: ["a가 양수이면 그래프는 아래로 볼록이고, 음수이면 위로 볼록이라는 점을 다시 확인해보세요."], nextQuestion: "|a|가 커지거나 작아지면 그래프의 폭은 어떻게 달라질까요?" },
    2: { stage: 2, strengths: ["a와 b의 변화가 그래프의 모양과 위치에 미치는 영향을 살펴보았습니다."], improvements: ["꼭짓점의 x좌표와 대칭축 x = -b/(2a)의 관계를 다시 연결해보세요."], nextQuestion: "b가 바뀌면 대칭축과 꼭짓점은 어떻게 이동할까요?" },
    3: { stage: 3, strengths: ["a, b, c를 그래프의 방향, 폭, 꼭짓점, 대칭축, y절편과 종합적으로 연결했습니다."], improvements: ["x=0을 대입해 c와 y절편의 관계를 다시 확인해보세요."], nextQuestion: "a, b, c를 바꾸기 전과 후의 그래프 특징을 어떻게 설명할 수 있을까요?" },
  };
  return byStage[stage] ?? byStage[1];
}

function parseCoefficientSnapshot(value: unknown): CoefficientSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<CoefficientSnapshot>;
  if (!Number.isFinite(item.a) || !Number.isFinite(item.b) || !Number.isFinite(item.c)) return null;
  return { a: item.a as number, b: item.b as number, c: item.c as number };
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

async function createGeminiAggregateFeedback(apiKey: string, explorations: AggregateInput[]): Promise<StageFeedback[] | null> {
  const prompt = `이차함수 탐구의 세 단계 서술형 답변을 한 번에 분석하세요. 학생이 이해한 내용을 칭찬하고, 단계별 보완점과 다시 생각해볼 질문을 작성하세요. a>0은 아래로 볼록, a<0은 위로 볼록이라는 용어를 사용하세요. 반드시 JSON만 반환하세요. 형식: {"feedback":[{"stage":1,"strengths":[""],"improvements":[""],"nextQuestion":""},{"stage":2,"strengths":[""],"improvements":[""],"nextQuestion":""},{"stage":3,"strengths":[""],"improvements":[""],"nextQuestion":""}]}. 입력: ${JSON.stringify(explorations)}`;
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json" } }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Gemini HTTP ${response.status}`);
  const data = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  return text ? parseAggregateFeedback(JSON.parse(text)) : null;
}

async function updateStoredStageFeedback(url: string, key: string, input: { sessionId: string; promptId: string; feedback: StageFeedback; status: string }) {
  const response = await fetch(`${url}/rest/v1/rpc/update_exploration_feedback`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ p_session_id: input.sessionId, p_prompt_id: input.promptId, p_ai_feedback: input.feedback, p_feedback_status: input.status }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(await response.text());
}

export async function GET(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  const sessionId = new URL(request.url).searchParams.get("sessionId")?.trim();

  if (!url || !key || !sessionId) {
    return Response.json({ ok: false, message: "탐구 결과를 불러올 세션 정보가 없습니다.", error: { message: "sessionId가 필요합니다.", code: "INVALID_INPUT" } }, { status: 400 });
  }

  try {
    const response = await fetch(`${url}/rest/v1/rpc/get_exploration_results`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ p_session_id: sessionId }),
      cache: "no-store",
    });
    const responseText = await response.text();
    if (!response.ok) {
      let error: ErrorInfo = { message: responseText || response.statusText, code: String(response.status) };
      try { error = { ...error, ...(JSON.parse(responseText) as ErrorInfo) }; } catch { /* keep response text */ }
      return Response.json({ ok: false, message: "탐구 결과를 불러오지 못했습니다.", error }, { status: 502 });
    }

    const rows = JSON.parse(responseText) as Array<{
      id: string;
      session_id: string;
      path: "A" | "B" | "C";
      prompt_id: string;
      response_text: string;
      coefficient_snapshot: unknown;
      ai_feedback: unknown;
      feedback_status: string | null;
      feedback_created_at: string | null;
    }>;
    const results = rows.flatMap((row) => {
      const coefficientSnapshot = parseCoefficientSnapshot(row.coefficient_snapshot);
      if (!row.id || !row.session_id || !row.path || !row.prompt_id || typeof row.response_text !== "string" || !coefficientSnapshot) return [];
      return [{
        id: row.id,
        sessionId: row.session_id,
        path: row.path,
        promptId: row.prompt_id,
        responseText: row.response_text,
        coefficientSnapshot,
        feedback: parseFeedback(row.ai_feedback) ?? (() => { const stage = parseStageFeedback(row.ai_feedback); return stage ? { strengths: stage.strengths, improvements: stage.improvements, nextQuestion: stage.nextQuestion, hint: "최종 미션 전에 핵심 개념을 다시 확인해보세요." } : null; })(),
        feedbackStatus: row.feedback_status,
        writtenAt: row.feedback_created_at ?? "",
      }];
    });
    return Response.json({ ok: true, message: results.length ? "탐구 결과를 불러왔습니다." : "아직 저장된 탐구 결과가 없습니다.", results });
  } catch (error) {
    const info = { message: error instanceof Error ? error.message : String(error) };
    console.error("[exploration-feedback] Load failed", info);
    return Response.json({ ok: false, message: "탐구 결과를 불러오지 못했습니다.", error: info }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  // 이 서버 경로에는 publishable/anon key만 사용합니다. service_role key는 브라우저나 이 API에 넣지 않습니다.
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

  try {
    const body = await request.json() as {
      mode?: "aggregate";
      sessionId?: string;
      path?: "A" | "B" | "C";
      promptId?: string;
      studentResponse?: string;
      coefficientSnapshot?: CoefficientSnapshot | null;
      aiFeedback?: Feedback;
      feedbackStatus?: string;
      explorations?: AggregateInput[];
    };
    if (body.mode === "aggregate") {
      if (!url || !key || !body.sessionId || !body.explorations || body.explorations.length !== 3) return Response.json({ ok: false, message: "세 단계 탐구 결과가 필요합니다.", error: { code: "INVALID_INPUT" } }, { status: 400 });
      let stageFeedback: StageFeedback[] = [1, 2, 3].map(fallbackStageFeedback);
      let feedbackStatus = "fallback";
      const geminiKey = process.env.GEMINI_API_KEY?.trim();
      if (geminiKey) {
        try {
          stageFeedback = await createGeminiAggregateFeedback(geminiKey, body.explorations) ?? stageFeedback;
          feedbackStatus = stageFeedback.some((item, index) => JSON.stringify(item) !== JSON.stringify(fallbackStageFeedback(index + 1))) ? "generated" : "fallback";
        } catch (error) { console.error("[exploration-feedback] Aggregate Gemini failed", error); }
      }
      try {
        for (const item of body.explorations) {
          const feedback = stageFeedback.find((value) => value.stage === item.stage) ?? fallbackStageFeedback(item.stage);
          await updateStoredStageFeedback(url, key, { sessionId: body.sessionId, promptId: item.promptId, feedback, status: feedbackStatus });
        }
      } catch (error) {
        console.error("[exploration-feedback] Aggregate save failed", error);
        return Response.json({ ok: false, message: "종합 피드백 저장에 실패했습니다.", error: { message: error instanceof Error ? error.message : String(error) } }, { status: 502 });
      }
      return Response.json({ ok: true, message: "탐구 결과 종합 피드백을 준비했습니다.", feedback: { feedback: stageFeedback }, feedbackStatus });
    }
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
