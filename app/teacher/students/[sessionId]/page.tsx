"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "../../../../lib/supabase/client";
import type { TeacherData } from "../../../../lib/teacher/server";

const formatDate = (value: string | null) => value ? new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "-";
const formatMs = (value: number | null) => value ? `${(value / 1000).toFixed(1)}초` : "-";
const display = (value: unknown) => value === null || value === undefined || value === "" ? "-" : typeof value === "object" ? JSON.stringify(value) : String(value);

function quadraticFeatures(parameters: Record<string, unknown>) {
  const a = Number(parameters.a); const b = Number(parameters.b); const c = Number(parameters.c);
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c) || a === 0) return null;
  const x = -b / (2 * a); const y = c - (b * b) / (4 * a);
  return { direction: a > 0 ? "아래로 볼록" : "위로 볼록", width: Math.abs(a) > 1 ? "더 좁은 그래프" : Math.abs(a) < 1 ? "더 넓은 그래프" : "기준 그래프와 같은 폭", vertex: `(${x}, ${y})`, axis: `x = ${x}`, yIntercept: String(c) };
}

function correctAnswer(kind: "diagnosis" | "checkpoint" | "final", questionId: string, parameters: Record<string, unknown>) {
  const features = quadraticFeatures(parameters);
  if (kind === "diagnosis") {
    if (questionId === "direction") return features?.direction ?? "계수 a의 부호에 따라 계산";
    if (questionId === "width") return features?.width ?? "|a|의 크기에 따라 계산";
    if (questionId === "axis") return features?.axis ?? "x = -b/(2a)로 계산";
    if (questionId === "intercept") return features?.yIntercept ?? "c";
    if (questionId === "relationship") return features ? `${features.direction}, ${features.width}, 꼭짓점 ${features.vertex}, 대칭축 ${features.axis}, y절편 ${features.yIntercept}` : "a, b, c의 관계를 종합해 계산";
  }
  const templateId = String(parameters.templateId ?? "");
  if (kind === "checkpoint") {
    if (templateId === "a-direction") return "아래로 볼록";
    if (templateId === "a-width") return "더 좁게 보임";
    if (templateId === "ab-change") return "꼭짓점과 대칭축의 위치";
    if (templateId === "ab-axis") return `x = ${display(parameters.axis)}`;
    if (templateId === "abc-intercept") return `y절편 ${display(parameters.yIntercept ?? parameters.c)}`;
    if (templateId === "abc-summary") return features ? `${features.direction}, ${features.width}, 꼭짓점 ${features.vertex}, y절편 ${features.yIntercept}` : "종합 해석 보기";
  }
  return features ? `${features.direction}, ${features.width}, 꼭짓점 ${features.vertex}, 대칭축 ${features.axis}, y절편 ${features.yIntercept}` : "문제의 계수와 조건으로 계산";
}

function coefficientText(parameters: Record<string, unknown>) {
  const features = quadraticFeatures(parameters);
  const values = ["a", "b", "c"].filter((key) => parameters[key] !== undefined).map((key) => `${key}=${display(parameters[key])}`);
  return `${values.join(", ") || "-"}${features ? ` · ${features.direction}, 꼭짓점 ${features.vertex}, 대칭축 ${features.axis}, y절편 ${features.yIntercept}` : ""}`;
}

export default function TeacherStudentDetailPage() {
  const router = useRouter(); const { sessionId } = useParams<{ sessionId: string }>();
  const [data, setData] = useState<TeacherData | null>(null); const [error, setError] = useState<string | null>(null);
  useEffect(() => { (async () => { if (!supabase) { setError("Supabase 환경 변수가 설정되지 않았습니다."); return; } const { data: sessionData } = await supabase.auth.getSession(); const token = sessionData.session?.access_token; if (!token) { router.replace("/teacher/login"); return; } const response = await fetch(`/api/teacher/students/${encodeURIComponent(sessionId)}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }); const result = await response.json() as { ok: boolean; data?: TeacherData; message?: string }; if (response.status === 401) router.replace("/teacher/login"); else if (!result.ok) setError(result.message ?? "학생 정보를 불러오지 못했습니다."); else setData(result.data ?? null); })().catch(() => setError("학생 정보를 불러오지 못했습니다.")); }, [router, sessionId]);
  const session = data?.sessions[0];
  const wrongDiagnosis = data?.diagnoses.filter((item) => !item.is_correct) ?? [];
  const wrongCheckpoints = data?.checkpoints.filter((item) => !item.is_correct) ?? [];
  const wrongFinalAttempts = data?.finalAttempts.filter((item) => !item.is_correct) ?? [];
  const hasWrongAnswers = wrongDiagnosis.length + wrongCheckpoints.length + wrongFinalAttempts.length > 0;

  return <main className="teacher-page"><header className="teacher-header"><div><button className="teacher-back-button" onClick={() => router.push("/teacher/dashboard")}>← 현황판</button><span className="eyebrow">STUDENT DETAIL</span><h1>{session?.student_code ?? "학생 상세"}</h1>{session && <p className="teacher-subtitle">시작 {formatDate(session.started_at)} · {session.status === "completed" ? "완료" : "진행 중"}</p>}</div></header>{error && <div className="teacher-alert error">{error}</div>}{!data && !error && <div className="teacher-empty">학생 기록을 불러오는 중입니다...</div>}{data && session && <div className="teacher-detail-grid"><DetailSection title="오답 기록">{!hasWrongAnswers ? <p className="teacher-muted">확인된 오답이 없습니다.</p> : <div className="teacher-wrong-list"><WrongTable title="진단" headers={["학습 단계", "문항 번호", "학생 답변", "정답", "응답 시간", "재도전", "기존 피드백", "문제 조건"]} rows={wrongDiagnosis.map((item) => ["진단", item.question_id, item.answer, correctAnswer("diagnosis", item.question_id, item.question_parameters ?? {}), formatMs(item.response_time_ms), "1회", "저장된 피드백 없음", coefficientText(item.question_parameters ?? {})])} /><WrongTable title="단계별 확인문제" headers={["학습 단계", "문항 번호", "학생 답변", "정답", "응답 시간", "재도전", "기존 피드백", "문제 조건"]} rows={wrongCheckpoints.map((item) => [item.path, item.question_id, item.student_answer, correctAnswer("checkpoint", item.question_id, item.question_parameters), formatMs(item.response_time_ms), `${item.attempt_number}회`, "저장된 피드백 없음", coefficientText(item.question_parameters)])} /><WrongTable title="최종 미션" headers={["학습 단계", "문항 번호", "학생 답변", "정답", "응답 시간", "재도전", "기존 피드백", "문제 조건"]} rows={wrongFinalAttempts.map((item) => ["최종 미션", item.question_id, item.selected_formula, correctAnswer("final", item.question_id, item.question_parameters), "-", `${item.attempt_number}회`, item.feedback, `${item.question_formula} · ${coefficientText(item.question_parameters)}`])} /></div>}</DetailSection><DetailSection title="서술형 탐구 답안과 피드백">{data.explorations.length === 0 ? <p className="teacher-muted">아직 작성된 탐구 결과가 없습니다.</p> : <div className="teacher-exploration-list">{data.explorations.map((item) => <article className="teacher-record" key={item.id}><div className="teacher-record-title"><strong>{item.path} · {item.prompt_id}</strong><span>{item.feedback_status ?? "상태 없음"}</span></div><p><b>학생 답변</b><span className="teacher-long-text">{item.response_text}</span></p><p><b>계수 조절 기록</b>a={item.coefficient_snapshot?.a ?? "-"}, b={item.coefficient_snapshot?.b ?? "-"}, c={item.coefficient_snapshot?.c ?? "-"}</p><p><b>Gemini 또는 fallback 피드백</b><span className="teacher-long-text">{item.ai_feedback ? JSON.stringify(item.ai_feedback) : "피드백이 아직 생성되지 않았습니다."}</span></p><p><b>피드백 상태</b>{item.feedback_status ?? "-"}</p><p><b>피드백 생성 시각</b>{formatDate(item.feedback_created_at)}</p></article>)}</div>}</DetailSection></div>}</main>;
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) { return <section className="teacher-panel teacher-detail-section"><h2>{title}</h2>{children}</section>; }
function WrongTable({ title, headers, rows }: { title: string; headers: string[]; rows: Array<Array<React.ReactNode>> }) { if (rows.length === 0) return null; return <div className="teacher-wrong-section"><h3>{title}</h3><div className="teacher-table-wrap"><table className="teacher-table"><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div></div>; }
