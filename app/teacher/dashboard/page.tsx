"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase/client";
import type { TeacherData, TeacherSession } from "../../../lib/teacher/server";
import "./dashboard.css";

type StudentRow = {
  session: TeacherSession;
  path: string;
  misconception: string;
  averageResponse: number;
  progress: number;
  status: "진행 중" | "재도전" | "피드백 필요" | "완료";
  feedbackNeeded: boolean;
  retries: number;
  slow: boolean;
  repeatedWrong: boolean;
};

const formatMs = (value: number) => value ? `${(value / 1000).toFixed(1)}초` : "-";
const formatDate = (value: string) => new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
const average = (values: number[]) => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
const questionLabels: Record<string, string> = { direction: "a의 부호와 볼록 방향", width: "|a|와 그래프 폭", axis: "b와 대칭축", intercept: "c와 y절편", relationship: "a, b, c 종합 관계" };
const CLASS_OPTIONS = ["4반", "5반", "6반", "11반", "12반", "13반"];

function getStudentRow(session: TeacherSession, data: TeacherData, allResponses: number[]): StudentRow {
  const diagnoses = data.diagnoses.filter((item) => item.session_id === session.id);
  const checkpoints = data.checkpoints.filter((item) => item.session_id === session.id);
  const explorations = data.explorations.filter((item) => item.session_id === session.id);
  const finals = data.finalAttempts.filter((item) => item.session_id === session.id);
  const questionAttempts = new Map<string, { wrong: number; total: number }>();
  [...checkpoints.map((item) => ({ id: item.question_id, wrong: !item.is_correct })), ...finals.map((item) => ({ id: item.question_id, wrong: !item.is_correct }))].forEach(({ id, wrong }) => {
    const current = questionAttempts.get(id) ?? { wrong: 0, total: 0 };
    current.total += 1; if (wrong) current.wrong += 1; questionAttempts.set(id, current);
  });
  const retries = Math.max(0, [...questionAttempts.values()].reduce((sum, item) => sum + Math.max(0, item.total - 1), 0));
  const repeatedWrong = [...questionAttempts.values()].some((item) => item.wrong >= 2);
  const feedbackNeeded = !session.status || explorations.some((item) => item.feedback_status !== "generated") || (session.status !== "completed" && explorations.length === 0);
  const wrongDiagnoses = diagnoses.filter((item) => !item.is_correct).sort((a, b) => (a.question_order ?? 99) - (b.question_order ?? 99));
  const misconception = wrongDiagnoses.length ? questionLabels[wrongDiagnoses[0].question_id] ?? "진단 개념 확인" : repeatedWrong ? "확인문제 반복 오답" : "없음";
  const completedDiagnosis = new Set(diagnoses.map((item) => item.question_id)).size;
  const completedCheckpoints = new Set(checkpoints.filter((item) => item.is_correct).map((item) => `${item.path}:${item.question_id}`)).size;
  const progress = Math.min(100, Math.round(((completedDiagnosis / 5) + (completedCheckpoints / 6) + Math.min(explorations.length, 3) / 3 + (finals.some((item) => item.is_correct) ? 1 : 0)) / 4 * 100));
  const averageResponse = average(diagnoses.map((item) => item.response_time_ms ?? 0));
  const slowThreshold = Math.max(10000, average(allResponses) * 1.5);
  const status = session.status === "completed" ? "완료" : feedbackNeeded ? "피드백 필요" : retries > 0 ? "재도전" : "진행 중";
  return { session, path: explorations[0]?.path ?? "-", misconception, averageResponse, progress, status, feedbackNeeded, retries, slow: averageResponse >= slowThreshold, repeatedWrong };
}

export default function TeacherDashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<TeacherData | null>(null);
  const [email, setEmail] = useState("교사 계정");
  const [selectedClass, setSelectedClass] = useState("전체 학급");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!supabase) { setError("Supabase 환경 변수가 설정되지 않았습니다."); setLoading(false); return; }
    setLoading(true); setError(null);
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) { router.replace("/teacher/login"); return; }
    setEmail(sessionData.session.user.email ?? "교사 계정");
    const response = await fetch("/api/teacher/dashboard", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const result = await response.json() as { ok: boolean; data?: TeacherData; message?: string };
    if (response.status === 401) router.replace("/teacher/login");
    else if (!result.ok || !result.data) setError(result.message ?? "현황판을 불러오지 못했습니다.");
    else setData(result.data);
    setLoading(false);
  };

  useEffect(() => { void load().catch(() => { setError("현황판을 불러오지 못했습니다."); setLoading(false); }); }, [router]);

  const rows = useMemo(() => {
    if (!data) return [];
    const responseTimes = data.diagnoses.map((item) => item.response_time_ms ?? 0).filter(Boolean);
    return data.sessions.filter((session) => selectedClass === "전체 학급" || session.class_name === selectedClass).map((session) => getStudentRow(session, data, responseTimes));
  }, [data, selectedClass]);
  const summary = useMemo(() => ({
    diagnosisComplete: rows.filter((row) => row.session && data?.diagnoses.filter((item) => item.session_id === row.session.id).length >= 5).length,
    averageResponse: average(data?.diagnoses.filter((item) => rows.some((row) => row.session.id === item.session_id)).map((item) => item.response_time_ms ?? 0) ?? []),
    feedbackNeeded: rows.filter((row) => row.feedbackNeeded).length,
  }), [data, rows]);
  const pathCounts = useMemo(() => ["A", "B", "C"].map((path) => ({ path, count: rows.filter((row) => row.path === path).length })), [rows]);
  const priorities = useMemo(() => {
    const list: Array<{ type: string; row: StudentRow; text: string }> = [];
    rows.filter((row) => row.slow).sort((a, b) => b.averageResponse - a.averageResponse).slice(0, 3).forEach((row) => list.push({ type: "시계", row, text: `응답 시간이 깁니다 · ${formatMs(row.averageResponse)}` }));
    rows.filter((row) => row.repeatedWrong).slice(0, 3).forEach((row) => list.push({ type: "오답", row, text: "같은 문제를 반복해서 틀렸습니다" }));
    rows.filter((row) => row.retries >= 2).slice(0, 3).forEach((row) => list.push({ type: "재도전", row, text: `재도전 ${row.retries}회` }));
    rows.filter((row) => row.feedbackNeeded).slice(0, 3).forEach((row) => list.push({ type: "피드백", row, text: "피드백 확인이 필요합니다" }));
    return list.slice(0, 8);
  }, [rows]);
  const downloadCsv = () => {
    const header = ["학생 코드", "출발 경로", "주요 오개념", "평균 응답 시간", "학습 진행", "상태"];
    const body = rows.map((row) => [row.session.student_code, row.path, row.misconception, formatMs(row.averageResponse), `${row.progress}%`, row.status]);
    const csv = [header, ...body].map((line) => line.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" })); const link = document.createElement("a"); link.href = url; link.download = "graph-leader-students.csv"; link.click(); URL.revokeObjectURL(url);
  };
  const signOut = async () => { await supabase?.auth.signOut(); router.replace("/teacher/login"); };

  return <main className="teacher-dashboard-page"><header className="teacher-dashboard-header"><div className="teacher-brand"><span className="teacher-logo" aria-hidden="true"><span /><span /><span /></span><strong>그래프 리더</strong></div><h1>교사 현황판</h1><div className="teacher-header-actions"><label className="class-select"><span className="sr-only">학급 선택</span><select value={selectedClass} onChange={(event) => setSelectedClass(event.target.value)}><option>전체 학급</option>{CLASS_OPTIONS.map((option) => <option key={option}>{option}</option>)}</select></label><details className="teacher-account"><summary>{email}</summary><div><button type="button" onClick={() => void signOut()}>로그아웃</button></div></details></div></header>{loading && <div className="teacher-empty">현황을 불러오는 중입니다...</div>}{error && <div className="teacher-alert error" role="alert">{error}</div>}{data && <><section className="teacher-summary-grid"><SummaryCard icon="✓" label="진단 완료" value={`${summary.diagnosisComplete} / ${rows.length}명`} tone="blue" /><SummaryCard icon="◷" label="평균 응답 시간" value={formatMs(summary.averageResponse)} tone="navy" /><SummaryCard icon="!" label="피드백 필요" value={`${summary.feedbackNeeded}명`} tone="orange" /></section><div className="teacher-dashboard-layout"><section className="teacher-student-panel"><div className="teacher-section-heading"><div><span className="eyebrow">STUDENT OVERVIEW</span><h2>학생별 현황</h2></div><span>{rows.length}명</span></div>{rows.length === 0 ? <div className="teacher-empty">아직 학습 기록이 없습니다.</div> : <div className="teacher-student-table-wrap"><table className="teacher-student-table"><thead><tr><th>학생 코드</th><th>출발 경로</th><th>주요 오개념</th><th>평균 응답</th><th>학습 진행</th><th>상태</th></tr></thead><tbody>{rows.map((row) => <tr key={row.session.id} tabIndex={0} onClick={() => router.push(`/teacher/students/${row.session.id}`)} onKeyDown={(event) => { if (event.key === "Enter") router.push(`/teacher/students/${row.session.id}`); }}><td><strong>{row.session.student_code}</strong></td><td><span className={`path-badge path-${row.path.toLowerCase()}`}>{row.path}</span></td><td>{row.misconception}</td><td>{formatMs(row.averageResponse)}</td><td><div className="progress-cell"><div className="student-progress"><span style={{ width: `${row.progress}%` }} /></div><small>{row.progress}%</small></div></td><td><span className={`dashboard-status ${row.status === "완료" ? "done" : row.status === "피드백 필요" ? "attention" : row.status === "재도전" ? "retry" : "ongoing"}`}>{row.status}</span></td></tr>)}</tbody></table></div>}</section><aside className="teacher-analysis-column"><section className="teacher-analysis-card"><h2>출발 경로 분포</h2>{rows.length === 0 ? <p className="teacher-muted">아직 학습 기록이 없습니다.</p> : <div className="path-distribution">{pathCounts.map(({ path, count }) => <div className="path-bar-row" key={path}><b>{path}</b><div className="path-bar"><span style={{ width: `${rows.length ? count / rows.length * 100 : 0}%` }} /></div><strong>{count}명</strong></div>)}</div>}</section><section className="teacher-analysis-card"><h2>우선 확인</h2>{priorities.length === 0 ? <p className="teacher-muted">현재 우선 확인할 학생이 없습니다.</p> : <div className="priority-list">{priorities.map((item, index) => <button type="button" className="priority-item" key={`${item.row.session.id}-${item.type}-${index}`} onClick={() => router.push(`/teacher/students/${item.row.session.id}`)}><span>{item.type}</span><strong>{item.row.session.student_code}</strong><small>{item.text}</small><b>→</b></button>)}</div>}</section></aside></div><footer className="teacher-dashboard-footer"><button className="secondary-button" type="button" onClick={() => document.querySelector(".teacher-student-panel")?.scrollIntoView({ behavior: "smooth" })}>학생별 보기</button><button className="secondary-button" type="button" onClick={downloadCsv}>CSV 다운로드</button><button className="secondary-button" type="button" onClick={() => void load()}>새로고침</button></footer></>}</main>;
}

function SummaryCard({ icon, label, value, tone }: { icon: string; label: string; value: string; tone: string }) { return <article className={`summary-card summary-${tone}`}><span className="summary-icon">{icon}</span><div><span>{label}</span><strong>{value}</strong></div></article>; }
