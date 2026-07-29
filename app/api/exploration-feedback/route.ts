import { GoogleGenAI } from "@google/genai";

type Feedback = { strengths: string[]; improvements: string[]; nextQuestion: string; hint: string };
type StageFeedback = Feedback & { stage: number };
type CoefficientSnapshot = { a: number; b: number; c: number };
type AggregateInput = { stage: number; promptId: string; studentResponse: string; coefficientSnapshot: CoefficientSnapshot };
type ErrorInfo = { message: string; code?: string; details?: string; hint?: string };

const fallbackMessage = "작성한 내용을 확인했습니다. a, b, c가 그래프의 방향, 폭, 꼭짓점, 대칭축, y절편에 어떤 영향을 주는지 다시 살펴보세요.";
const fallbackFeedback: Feedback = {
  strengths: [fallbackMessage],
  improvements: [fallbackMessage],
  nextQuestion: "a, b, c를 하나씩 바꾸면 그래프의 방향, 폭, 꼭짓점, 대칭축, y절편 중 무엇이 달라질까요?",
  hint: "최종 미션 전에 a, b, c와 그래프의 방향, 폭, 꼭짓점, 대칭축, y절편을 연결해보세요.",
};
const coreConcepts: Record<number, string> = {
  1: "a의 부호와 절댓값이 그래프의 볼록한 방향과 폭에 미치는 영향",
  2: "a와 b가 꼭짓점과 대칭축의 위치에 미치는 영향",
  3: "a, b, c와 방향, 폭, 꼭짓점, 대칭축, y절편의 종합 관계",
};

const feedbackSchema = {
  type: "object",
  properties: {
    strengths: { type: "array", items: { type: "string" } },
    improvements: { type: "array", items: { type: "string" } },
    nextQuestion: { type: "string" },
    hint: { type: "string" },
  },
  required: ["strengths", "improvements", "nextQuestion", "hint"],
  additionalProperties: false,
};

function parseFeedback(value: unknown): Feedback | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<Feedback>;
  if (!Array.isArray(item.strengths) || !Array.isArray(item.improvements) || typeof item.nextQuestion !== "string" || typeof item.hint !== "string") return null;
  const strengths = item.strengths.filter((value): value is string => typeof value === "string").slice(0, 5);
  const improvements = item.improvements.filter((value): value is string => typeof value === "string").slice(0, 5);
  if (!strengths.length || !improvements.length) return null;
  return { strengths, improvements, nextQuestion: item.nextQuestion, hint: item.hint };
}

function parseCoefficientSnapshot(value: unknown): CoefficientSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<CoefficientSnapshot>;
  if (!Number.isFinite(item.a) || !Number.isFinite(item.b) || !Number.isFinite(item.c)) return null;
  return { a: item.a as number, b: item.b as number, c: item.c as number };
}

function stageFromPath(path: "A" | "B" | "C") { return path === "A" ? 1 : path === "B" ? 2 : 3; }

async function createGeminiFeedback(input: { stage: number; studentResponse: string; coefficientSnapshot: CoefficientSnapshot }) {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return { feedback: fallbackFeedback, status: "fallback" as const };

  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: "gemini-2.0-flash",
    contents: `중학교 이차함수 탐구의 ${input.stage}단계 서술형 답변을 교육적으로 피드백하세요. 학생 코드, 이름, 세션 식별자는 분석하지 않습니다. 아래 정보만 사용하세요.

탐구 단계: ${input.stage}
학생 답변: ${input.studentResponse}
계수: a=${input.coefficientSnapshot.a}, b=${input.coefficientSnapshot.b}, c=${input.coefficientSnapshot.c}
핵심 개념: ${coreConcepts[input.stage] ?? coreConcepts[1]}

학생이 이해한 점을 구체적으로 짚고, 부족한 점은 비난 없이 안내하세요. a가 양수이면 아래로 볼록, a가 음수이면 위로 볼록이라는 표현을 사용하세요. JSON만 반환하세요.`,
    config: {
      temperature: 0.2,
      maxOutputTokens: 500,
      responseMimeType: "application/json",
      responseJsonSchema: feedbackSchema,
    },
  });
  const parsed = response.text ? parseFeedback(JSON.parse(response.text)) : null;
  if (!parsed) throw new Error("Gemini 응답 형식이 올바르지 않습니다.");
  return { feedback: parsed, status: "generated" as const };
}

async function updateStoredStageFeedback(url: string, key: string, input: { sessionId: string; promptId: string; feedback: Feedback; status: "generated" | "fallback" | "failed" }) {
  const response = await fetch(`${url}/rest/v1/rpc/update_exploration_feedback`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ p_session_id: input.sessionId, p_prompt_id: input.promptId, p_ai_feedback: input.feedback, p_feedback_status: input.status }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(await response.text());
}

async function recordExplorationResult(url: string, key: string, input: { sessionId: string; path: "A" | "B" | "C"; promptId: string; studentResponse: string; coefficientSnapshot: CoefficientSnapshot }) {
  const response = await fetch(`${url}/rest/v1/rpc/record_exploration_result`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      p_session_id: input.sessionId,
      p_path: input.path,
      p_prompt_id: input.promptId,
      p_student_response: input.studentResponse,
      p_coefficient_snapshot: input.coefficientSnapshot,
      p_ai_feedback: null,
      p_feedback_status: "fallback",
    }),
    cache: "no-store",
  });
  const text = await response.text();
  if (!response.ok) throw new Error(text || response.statusText);
}

export async function GET(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  const sessionId = new URL(request.url).searchParams.get("sessionId")?.trim();
  if (!url || !key || !sessionId) return Response.json({ ok: false, message: "탐구 결과를 불러오려면 세션 정보가 필요합니다.", error: { message: "sessionId가 필요합니다.", code: "INVALID_INPUT" } }, { status: 400 });

  try {
    const response = await fetch(`${url}/rest/v1/rpc/get_exploration_results`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ p_session_id: sessionId }),
      cache: "no-store",
    });
    const responseText = await response.text();
    if (!response.ok) return Response.json({ ok: false, message: "탐구 결과를 불러오지 못했습니다.", error: { message: responseText || response.statusText, code: String(response.status) } }, { status: 502 });
    const rows = JSON.parse(responseText) as Array<{ id: string; session_id: string; path: "A" | "B" | "C"; prompt_id: string; response_text: string; coefficient_snapshot: unknown; ai_feedback: unknown; feedback_status: string | null; feedback_created_at: string | null }>;
    const results = rows.flatMap((row) => {
      const coefficientSnapshot = parseCoefficientSnapshot(row.coefficient_snapshot);
      const feedback = parseFeedback(row.ai_feedback);
      if (!row.id || !row.session_id || !row.path || !row.prompt_id || typeof row.response_text !== "string" || !coefficientSnapshot) return [];
      return [{ id: row.id, sessionId: row.session_id, path: row.path, promptId: row.prompt_id, responseText: row.response_text, coefficientSnapshot, feedback, feedbackStatus: row.feedback_status, writtenAt: row.feedback_created_at ?? "" }];
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
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  try {
    const body = await request.json() as { mode?: "aggregate"; sessionId?: string; path?: "A" | "B" | "C"; promptId?: string; studentResponse?: string; coefficientSnapshot?: CoefficientSnapshot | null; explorations?: AggregateInput[] };
    if (body.mode === "aggregate") {
      if (!url || !key || !body.sessionId || !body.explorations || body.explorations.length !== 3) return Response.json({ ok: false, message: "세 단계 탐구 결과가 필요합니다.", error: { code: "INVALID_INPUT" } }, { status: 400 });
      const stageFeedback = await Promise.all(body.explorations.map(async (item): Promise<StageFeedback> => {
        let feedback = fallbackFeedback;
        let status: "generated" | "fallback" | "failed" = "fallback";
        try {
          const generated = await createGeminiFeedback({ stage: item.stage, studentResponse: item.studentResponse, coefficientSnapshot: item.coefficientSnapshot });
          feedback = generated.feedback;
          status = generated.status;
        } catch (error) {
          status = "failed";
          console.error("[exploration-feedback] Aggregate Gemini failed", error);
        }
        try {
          await updateStoredStageFeedback(url, key, { sessionId: body.sessionId!, promptId: item.promptId, feedback, status });
        } catch (error) {
          console.error("[exploration-feedback] Aggregate feedback update failed", error);
        }
        return { stage: item.stage, ...feedback };
      }));
      return Response.json({ ok: true, message: "탐구 결과 종합 피드백을 준비했습니다.", feedback: { feedback: stageFeedback }, feedbackStatus: stageFeedback.every((item) => item.strengths[0] === fallbackMessage) ? "fallback" : "generated" });
    }
    const snapshot = parseCoefficientSnapshot(body.coefficientSnapshot);
    if (!url || !key || !body.sessionId || !body.path || !body.promptId || !body.studentResponse?.trim() || !snapshot) return Response.json({ ok: false, message: "탐구 결과 저장에 필요한 값이 없습니다.", error: { code: "INVALID_INPUT" } }, { status: 400 });

    const stage = stageFromPath(body.path);
    let feedback = fallbackFeedback;
    let feedbackStatus: "generated" | "fallback" | "failed" = "fallback";
    try {
      const generated = await createGeminiFeedback({ stage, studentResponse: body.studentResponse.trim(), coefficientSnapshot: snapshot });
      feedback = generated.feedback;
      feedbackStatus = generated.status;
    } catch (error) {
      feedbackStatus = "failed";
      console.error("[exploration-feedback] Gemini failed", error);
    }

    await recordExplorationResult(url, key, { sessionId: body.sessionId, path: body.path, promptId: body.promptId, studentResponse: body.studentResponse.trim(), coefficientSnapshot: snapshot });
    try {
      await updateStoredStageFeedback(url, key, { sessionId: body.sessionId, promptId: body.promptId, feedback, status: feedbackStatus });
    } catch (error) {
      console.error("[exploration-feedback] Feedback update failed", error);
      return Response.json({ ok: false, message: "탐구 결과는 저장했지만 피드백 저장에 실패했습니다.", feedback, feedbackStatus, error: { message: error instanceof Error ? error.message : String(error) } }, { status: 502 });
    }
    return Response.json({ ok: true, message: "탐구 결과와 피드백을 저장했습니다.", feedback, feedbackStatus });
  } catch (error) {
    const info: ErrorInfo = { message: error instanceof Error ? error.message : String(error) };
    console.error("[exploration-feedback] Request failed", info);
    return Response.json({ ok: false, message: "탐구 결과를 저장하지 못했습니다.", error: info }, { status: 502 });
  }
}
