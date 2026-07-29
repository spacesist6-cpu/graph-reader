"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase/client";

export default function TeacherLoginPage() {
  const router = useRouter(); const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [error, setError] = useState<string | null>(null); const [loading, setLoading] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!supabase || loading) return; setLoading(true); setError(null);
    const { data, error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (signInError || !data.user) { setError("이메일 또는 비밀번호를 확인해주세요."); setLoading(false); return; }
    if (data.user.app_metadata?.role !== "teacher") { await supabase.auth.signOut(); setError("교사 권한이 있는 계정만 로그인할 수 있습니다."); setLoading(false); return; }
    router.replace("/teacher/dashboard");
  };
  return <main className="teacher-auth-page"><div className="teacher-auth-card"><span className="eyebrow">GRAPH LEADER · TEACHER</span><h1>교사 로그인</h1><p>학습 현황과 학생별 탐구 기록을 확인할 수 있습니다.</p>{!supabase && <div className="teacher-alert error">Supabase 환경 변수가 설정되지 않았습니다.</div>}<form onSubmit={submit}><label>이메일<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label><label>비밀번호<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>{error && <div className="teacher-alert error" role="alert">{error}</div>}<button className="primary-button teacher-submit" type="submit" disabled={!supabase || loading}>{loading ? "로그인 중..." : "로그인"}</button></form><a className="teacher-back-link" href="/">학생 화면으로 돌아가기</a></div></main>;
}
