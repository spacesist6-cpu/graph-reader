"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { checkSupabaseConnection, saveDiagnosisResponse, startLearningSession } from "../lib/supabase/client";

type Step = "start" | "diagnosis" | "explore" | "challenge" | "complete";

const graphOptions = [
  { id: "A", title: "A 그래프", formula: "y = x²", note: "위로 열리고 꼭짓점은 (0, 0)" },
  { id: "B", title: "B 그래프", formula: "y = (x - 2)² - 1", note: "오른쪽으로 2, 아래로 1 이동" },
  { id: "C", title: "C 그래프", formula: "y = -x² + 2", note: "아래로 열리고 꼭짓점은 (0, 2)" },
];

type GeoGebraApi = {
  evalCommand: (command: string) => boolean;
  setValue?: (name: string, value: number) => void;
  showAlgebraInput?: (show: boolean) => void;
  showToolBar?: (show: boolean) => void;
  showMenuBar?: (show: boolean) => void;
  showResetIcon?: (show: boolean) => void;
  setPerspective?: (perspective: string) => void;
  setCoordSystem?: (xmin: number, xmax: number, ymin: number, ymax: number) => void;
};

type GeoGebraApplet = {
  inject: (element: HTMLElement) => void;
};

type QuadraticValues = { a: number; b: number; c: number };
type PathId = "A" | "B" | "C";
type CoefficientChange = QuadraticValues & { path: PathId; changedAt: string };
type ExplorationRecord = { path: PathId; promptId: string; responseText: string; coefficientSnapshot: QuadraticValues; writtenAt: string };
type LearningSession = { studentCode: string; sessionId: string; startedAt: string };
const SESSION_STORAGE_KEY = "graph-reader-learning-session";
let currentLearningSessionId = "";
type ExplorationPrompt = { promptId: string; question: string; support: string };

const explorationPrompts: Record<PathId, ExplorationPrompt> = {
  A: { promptId: "explore-a", question: "a의 값을 바꾸면 포물선의 방향과 폭은 어떻게 변하는가?", support: "a가 양수와 음수일 때 그래프는 어떻게 달라지는가?" },
  B: { promptId: "explore-b", question: "a와 b의 값을 바꾸면 그래프의 모양, 꼭짓점, 대칭축은 어떻게 변하는가?", support: "b가 변할 때 대칭축은 어떻게 움직이는가?" },
  C: { promptId: "explore-c", question: "a, b, c를 바꾸면 그래프의 방향, 폭, 꼭짓점, 대칭축, y절편은 어떻게 변하는가?", support: "각 계수는 그래프의 어떤 특징에 영향을 주는가?" },
};

type GraphChoice = { id: string; formula: string; a: number; b: number; c: number; vertex: { x: number; y: number }; axis: string; yIntercept: number; isCorrect: boolean; errorType?: "direction" | "width" | "vertex" | "yIntercept" };
const finalQuestion = {
  id: "final-001",
  formula: "y = 2x² - 4x + 1",
  coefficients: { a: 2, b: -4, c: 1 },
  vertex: { x: 1, y: -1 },
  axis: "x = 1",
  yIntercept: 1,
  correctChoiceId: "choice-2",
  graphChoices: [
    { id: "choice-1", formula: "y = -2x² + 4x + 1", a: -2, b: 4, c: 1, vertex: { x: 1, y: 3 }, axis: "x = 1", yIntercept: 1, isCorrect: false, errorType: "direction" },
    { id: "choice-2", formula: "y = 2x² - 4x + 1", a: 2, b: -4, c: 1, vertex: { x: 1, y: -1 }, axis: "x = 1", yIntercept: 1, isCorrect: true },
    { id: "choice-3", formula: "y = 2x² - 4x + 3", a: 2, b: -4, c: 3, vertex: { x: 1, y: 1 }, axis: "x = 1", yIntercept: 3, isCorrect: false, errorType: "yIntercept" },
    { id: "choice-4", formula: "y = x² - 2x + 1", a: 1, b: -2, c: 1, vertex: { x: 1, y: 0 }, axis: "x = 1", yIntercept: 1, isCorrect: false, errorType: "width" },
  ] as GraphChoice[],
};

const pathDefaults: Record<PathId, QuadraticValues> = {
  A: { a: 1, b: 0, c: 0 },
  B: { a: 2, b: -4, c: 0 },
  C: { a: 2, b: -4, c: 1 },
};

const pathSliders: Record<PathId, (keyof QuadraticValues)[]> = {
  A: ["a"],
  B: ["a", "b"],
  C: ["a", "b", "c"],
};

const sliderRanges: Record<keyof QuadraticValues, { min: number; max: number }> = {
  a: { min: -5, max: 5 },
  b: { min: -10, max: 10 },
  c: { min: -5, max: 5 },
};

type DiagnosisQuestion = {
  id: string;
  prompt: string;
  choices: { id: string; label: string }[];
  correct: string;
};

const diagnosisQuestions: DiagnosisQuestion[] = [
  { id: "direction", prompt: "a가 음수인 이차함수 그래프의 방향은 무엇인가요?", choices: [{ id: "up", label: "위로 열림" }, { id: "down", label: "아래로 열림" }, { id: "line", label: "직선이 됨" }], correct: "down" },
  { id: "width", prompt: "y = 3x²는 y = x²와 비교해 어떻게 보이나요?", choices: [{ id: "wide", label: "더 넓게 보임" }, { id: "same", label: "같은 폭으로 보임" }, { id: "narrow", label: "더 좁게 보임" }], correct: "narrow" },
  { id: "axis", prompt: "y = x² - 4x의 대칭축은 어디인가요?", choices: [{ id: "minus2", label: "x = -2" }, { id: "two", label: "x = 2" }, { id: "four", label: "x = 4" }], correct: "two" },
  { id: "intercept", prompt: "y = 2x² - 3x + 5의 y절편은 무엇인가요?", choices: [{ id: "minus3", label: "-3" }, { id: "2", label: "2" }, { id: "5", label: "5" }], correct: "5" },
  { id: "relationship", prompt: "y = (x - 2)² + 3의 꼭짓점은 어디인가요?", choices: [{ id: "one", label: "(2, 3)" }, { id: "two", label: "(-2, 3)" }, { id: "three", label: "(2, -3)" }], correct: "one" },
];

const diagnosisPathRules = {
  A: { min: 0, max: 2 },
  B: { min: 3, max: 4 },
  C: { min: 5, max: 5 },
} as const;

function assignPath(score: number): PathId {
  return (Object.entries(diagnosisPathRules).find(([, rule]) => score >= rule.min && score <= rule.max)?.[0] ?? "A") as PathId;
}

function GeoGebraGraph({ path = "C", onCoefficientChange }: { path?: PathId; onCoefficientChange?: (change: CoefficientChange) => void } = {}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<GeoGebraApi | null>(null);
  const [values, setValues] = useState<QuadraticValues>(pathDefaults[path]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const updateValue = (key: keyof QuadraticValues, value: string) => {
    const next = { ...values, [key]: Number(value) };
    if (path === "A") next.b = 0, next.c = 0;
    if (path === "B") next.c = 0;
    setValues(next);
    onCoefficientChange?.({ ...next, path, changedAt: new Date().toISOString() });
  };

  useEffect(() => {
    const next = pathDefaults[path];
    setValues(next);
    onCoefficientChange?.({ ...next, path, changedAt: new Date().toISOString() });
  }, [path]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const loadApplet = () => {
      const geoWindow = window as typeof window & {
        GGBApplet?: new (params: Record<string, unknown>, prerelease?: boolean) => GeoGebraApplet;
      };
      if (!geoWindow.GGBApplet || !containerRef.current) {
        setLoadError("GeoGebra를 불러오지 못했어요. 잠시 후 다시 확인해주세요.");
        return;
      }

      const width = Math.max(280, Math.min(650, container.clientWidth || 650));
      const height = Math.round(width * 0.66);
      const applet = new geoWindow.GGBApplet({
        appName: "graphing",
        language: "ko",
        width,
        height,
        showToolBar: false,
        showToolBarHelp: false,
        showMenuBar: false,
        showAlgebraInput: false,
        showAlgebraView: false,
        showResetIcon: false,
        showZoomButtons: false,
        allowStyleBar: false,
        enableShiftDragZoom: false,
        enableRightClick: false,
        showFullscreenButton: false,
        appletOnLoad: (api: GeoGebraApi) => {
          apiRef.current = api;
          api.evalCommand(`a=${values.a}`);
          api.evalCommand(`b=${values.b}`);
          api.evalCommand(`c=${values.c}`);
          api.evalCommand("f(x)=a*x^2+b*x+c");
          api.showAlgebraInput?.(false);
          api.showToolBar?.(false);
          api.showMenuBar?.(false);
          api.showResetIcon?.(false);
          api.setPerspective?.("G");
          api.evalCommand('SetPerspective("G")');
          api.setCoordSystem?.(-6, 6, -12, 8);
          window.setTimeout(() => {
            api.setPerspective?.("G");
            api.evalCommand('SetPerspective("G")');
            api.showAlgebraInput?.(false);
            api.showToolBar?.(false);
            api.showMenuBar?.(false);
            api.showResetIcon?.(false);
          }, 250);
          setLoadError(null);
        },
      }, true);

      container.innerHTML = "";
      applet.inject(container);
    };

    const existingScript = document.querySelector<HTMLScriptElement>("script[data-geogebra-loader]");
    if (existingScript) {
      loadApplet();
      return;
    }

    const script = document.createElement("script");
    script.src = "https://www.geogebra.org/apps/deployggb.js";
    script.async = true;
    script.dataset.geogebraLoader = "true";
    script.onload = loadApplet;
    script.onerror = () => setLoadError("GeoGebra를 불러오지 못했어요. 인터넷 연결을 확인해주세요.");
    document.head.appendChild(script);
  }, []);

  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    api.setValue?.("a", values.a);
    api.setValue?.("b", values.b);
    api.setValue?.("c", values.c);
  }, [values]);

  return (
    <div className="geogebra-stack">
      <div className="geogebra-frame">
      <div ref={containerRef} className="geogebra-container" aria-label="GeoGebra 그래프 계산기" />
      {loadError && <div className="geogebra-status error" role="alert">{loadError}</div>}
      </div>
      <div className="coefficient-panel">
      <div className="coefficient-heading">변화시키는 계수</div>
      <div className="coefficient-controls" aria-label="이차함수 계수 조절">
        {pathSliders[path].map((key) => (
          <label key={key}>
            <span>{key} <b>{values[key]}</b></span>
            <input type="range" min={sliderRanges[key].min} max={sliderRanges[key].max} step="1" value={values[key]} onChange={(event) => updateValue(key, event.target.value)} />
          </label>
        ))}
      </div>
      <div className="fixed-coefficients"><span>고정된 계수</span>{(["a", "b", "c"] as const).filter((key) => !pathSliders[path].includes(key)).map((key) => <span key={key}>🔒 {key} = {values[key]}</span>)}</div>
      <p className="coefficient-guide">계수를 움직여 그래프의 변화를 관찰해보세요.</p>
      </div>
      <div className="graph-information" aria-live="polite">
        <div><span>현재 함수식</span><strong>y = {values.a}x² {values.b < 0 ? `- ${Math.abs(values.b)}x` : `+ ${values.b}x`} {values.c < 0 ? `- ${Math.abs(values.c)}` : `+ ${values.c}`}</strong></div>
        {values.a === 0 ? <p className="invalid-quadratic">a가 0이면 이차함수 그래프를 만들 수 없습니다.</p> : <><div><span>꼭짓점</span><strong>({(-values.b / (2 * values.a)).toFixed(2)}, {(values.c - (values.b ** 2) / (4 * values.a)).toFixed(2)})</strong></div><div><span>대칭축</span><strong>x = {(-values.b / (2 * values.a)).toFixed(2)}</strong></div><div><span>y절편</span><strong>{values.c}</strong></div></>}
      </div>
    </div>
  );
}

export default function Home() {
  const [step, setStep] = useState<Step>("start");
  const [studentCode, setStudentCode] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [startedAt, setStartedAt] = useState("");
  const [completedAt, setCompletedAt] = useState("");
  const [sessionHydrated, setSessionHydrated] = useState(false);
  const [diagnosisIndex, setDiagnosisIndex] = useState(0);
  const [diagnosisAnswers, setDiagnosisAnswers] = useState<Record<string, { answer: string; shownAt: string; submittedAt: string }>>({});
  const [diagnosisResults, setDiagnosisResults] = useState<Record<string, boolean>>({});
  const [responseTimes, setResponseTimes] = useState<Record<string, number>>({});
  const [shownAtByQuestion, setShownAtByQuestion] = useState<Record<string, string>>({});
  const [currentPath, setCurrentPath] = useState<PathId | null>(null);
  const [assignedAt, setAssignedAt] = useState<string | null>(null);
  const [explorationResults, setExplorationResults] = useState<Record<PathId, ExplorationRecord[]>>({ A: [], B: [], C: [] });
  const [finalChoiceId, setFinalChoiceId] = useState<string | null>(null);
  const [finalFeedback, setFinalFeedback] = useState<string | null>(null);
  const [finalAttempts, setFinalAttempts] = useState(0);
  const [challengeDone, setChallengeDone] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(SESSION_STORAGE_KEY);
      if (saved) {
        const session = JSON.parse(saved) as Partial<ReturnType<typeof getPersistedSession>>;
        if (session.studentCode && session.sessionId && session.startedAt) {
          setStudentCode(session.studentCode);
          setSessionId(session.sessionId);
          currentLearningSessionId = session.sessionId;
          setStartedAt(session.startedAt);
          setCompletedAt(session.completedAt ?? "");
          setStep(session.step ?? "start");
          setDiagnosisIndex(session.diagnosisIndex ?? 0);
          setDiagnosisAnswers(session.diagnosisAnswers ?? {});
          setDiagnosisResults(session.diagnosisResults ?? {});
          setResponseTimes(session.responseTimes ?? {});
          setShownAtByQuestion(session.shownAtByQuestion ?? {});
          setCurrentPath(session.currentPath ?? null);
          setAssignedAt(session.assignedAt ?? null);
          setExplorationResults(session.explorationResults ?? { A: [], B: [], C: [] });
          setFinalChoiceId(session.finalChoiceId ?? null);
          setFinalFeedback(session.finalFeedback ?? null);
          setFinalAttempts(session.finalAttempts ?? 0);
          setChallengeDone(session.challengeDone ?? false);
        }
      }
    } catch {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
    } finally {
      setSessionHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!sessionHydrated || !studentCode || !sessionId || !startedAt) return;
    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(getPersistedSession()));
  }, [sessionHydrated, studentCode, sessionId, startedAt, completedAt, step, diagnosisIndex, diagnosisAnswers, diagnosisResults, responseTimes, shownAtByQuestion, currentPath, assignedAt, explorationResults, finalChoiceId, finalFeedback, finalAttempts, challengeDone]);

  function getPersistedSession() {
    return { studentCode, sessionId, startedAt, completedAt, step, diagnosisIndex, diagnosisAnswers, diagnosisResults, responseTimes, shownAtByQuestion, currentPath, assignedAt, explorationResults, finalChoiceId, finalFeedback, finalAttempts, challengeDone };
  }

  const startSession = async (value: string) => {
    const normalized = value.trim().toUpperCase();
    if (!/^[A-Z0-9]{4,12}$/.test(normalized)) return { ok: false, message: "학습 코드를 확인해주세요." };
    const result = await startLearningSession(normalized);
    if (!result.ok || !result.session) return result;
    setStudentCode(result.session.studentCode);
    setSessionId(result.session.sessionId);
    currentLearningSessionId = result.session.sessionId;
    setStartedAt(result.session.startedAt);
    setCompletedAt("");
    setStep("diagnosis");
    return result;
  };

  const progress = useMemo(
    () => ({ start: 0, diagnosis: 25, explore: 50, challenge: 75, complete: 100 })[step],
    [step],
  );

  const goNext = () => {
    if (step === "start") setStep("diagnosis");
    else if (step === "diagnosis") setStep("explore");
    else if (step === "explore") setStep("challenge");
    else if (step === "challenge" && challengeDone) { setCompletedAt(new Date().toISOString()); setStep("complete"); }
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        {studentCode && <span className="student-code-chip">학습 코드 {studentCode}</span>}
        <div className="brand"><span className="brand-mark">g</span><span className="brand-copy"><strong>그래프 리더</strong><small>Graph Reader · Graph Leader</small></span></div>
        <div className="topbar-right"><span className="save-dot" /> 기기에서 진행 중 <span className="avatar">민</span></div>
      </header>

      <section className="progress-wrap" aria-label="학습 진행률">
        <div className="progress-meta"><span>오늘의 미션</span><strong>{progress}% 완료</strong></div>
        <div className="progress-track"><div className="progress-fill" style={{ width: `${progress}%` }} /></div>
        <div className="step-labels">
          <span className={step === "start" ? "active" : ""}>시작</span>
          <span className={step === "diagnosis" ? "active" : ""}>진단</span>
          <span className={step === "explore" ? "active" : ""}>그래프 탐색</span>
          <span className={step === "challenge" ? "active" : ""}>최종 도전</span>
          <span className={step === "complete" ? "active" : ""}>완료</span>
        </div>
      </section>

      <section className="content">
        {step === "start" && <StudentCodeStartScreenV2 onStart={startSession} />}
        {step === "diagnosis" && <DiagnosisScreen index={diagnosisIndex} answers={diagnosisAnswers} results={diagnosisResults} responseTimes={responseTimes} shownAtByQuestion={shownAtByQuestion} onQuestionShown={(questionId, shownAt) => setShownAtByQuestion((current) => current[questionId] ? current : { ...current, [questionId]: shownAt })} onSubmit={(question, answer, submittedAt, responseTimeMs, isCorrect) => { const nextAnswers = { ...diagnosisAnswers, [question.id]: { answer, shownAt: shownAtByQuestion[question.id] ?? submittedAt, submittedAt } }; const nextResults = { ...diagnosisResults, [question.id]: isCorrect }; const nextTimes = { ...responseTimes, [question.id]: responseTimeMs }; setDiagnosisAnswers(nextAnswers); setDiagnosisResults(nextResults); setResponseTimes(nextTimes); if (diagnosisIndex === diagnosisQuestions.length - 1) { const path = assignPath(Object.values(nextResults).filter(Boolean).length); const now = new Date().toISOString(); setCurrentPath(path); setAssignedAt(now); setStep("explore"); } else { setDiagnosisIndex((current) => current + 1); } }} />}
        {step === "explore" && <ExploreScreen selected={currentPath ?? "A"} savedResults={explorationResults[currentPath ?? "A"]} onSave={(record) => setExplorationResults((current) => ({ ...current, [record.path]: [...current[record.path], record] }))} onNext={goNext} />}
        {step === "challenge" && <ChallengeScreen selected={finalChoiceId} feedback={finalFeedback} attempts={finalAttempts} done={challengeDone} onSelect={(choice) => { setFinalChoiceId(choice.id); if (choice.isCorrect) { setChallengeDone(true); setFinalFeedback("정확합니다. a, b, c의 값을 그래프의 방향, 폭, 꼭짓점, y절편과 연결해 해석했습니다."); } else { setChallengeDone(false); const feedback = choice.errorType === "direction" ? "a의 부호를 다시 확인해보세요." : choice.errorType === "width" ? "|a|의 크기가 그래프의 폭에 어떤 영향을 주는지 살펴보세요." : choice.errorType === "vertex" ? "대칭축 x=1과 꼭짓점 (1,-1)을 확인해보세요." : "x=0일 때 y의 값을 계산해보세요."; setFinalFeedback(feedback); } }} onRetry={() => { setFinalChoiceId(null); setFinalFeedback(null); setChallengeDone(false); setFinalAttempts((current) => current + 1); }} onNext={goNext} />}
        {step === "complete" && <CompleteScreen studentCode={studentCode} completedAt={completedAt} onRestart={() => { window.localStorage.removeItem(SESSION_STORAGE_KEY); setStep("start"); setStudentCode(""); setSessionId(""); setStartedAt(""); setCompletedAt(""); setDiagnosisIndex(0); setDiagnosisAnswers({}); setDiagnosisResults({}); setResponseTimes({}); setShownAtByQuestion({}); setCurrentPath(null); setAssignedAt(null); setExplorationResults({ A: [], B: [], C: [] }); setFinalChoiceId(null); setFinalFeedback(null); setFinalAttempts(0); setChallengeDone(false); }} />}
      </section>

      <footer>학습 기록은 현재 이 브라우저에서만 임시로 유지됩니다 · 저장 기능은 다음 단계에서 연결할 예정이에요.</footer>
    </main>
  );
}

function DetailedSupabaseConnectionCheck() {
  const [status, setStatus] = useState<"idle" | "checking" | "success" | "error">("idle");
  const [result, setResult] = useState<Awaited<ReturnType<typeof checkSupabaseConnection>> | null>(null);

  const checkConnection = async () => {
    setStatus("checking");
    const nextResult = await checkSupabaseConnection();
    setResult(nextResult);
    setStatus(nextResult.ok ? "success" : "error");
  };

  return <div className="supabase-check"><button type="button" className="supabase-check-button" onClick={checkConnection} disabled={status === "checking"}>Supabase 연결 확인</button>{result && <div className={`supabase-check-message ${status}`} role="status"><p>{result.message}</p>{result.error && <dl className="supabase-error-details"><div><dt>error.message</dt><dd>{result.error.message || "-"}</dd></div><div><dt>error.code</dt><dd>{result.error.code || "-"}</dd></div><div><dt>error.details</dt><dd>{result.error.details || "-"}</dd></div><div><dt>error.hint</dt><dd>{result.error.hint || "-"}</dd></div></dl>}</div>}</div>;
}

function SupabaseConnectionCheck() {
  const [status, setStatus] = useState<"idle" | "checking" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  const checkConnection = async () => {
    setStatus("checking");
    const result = await checkSupabaseConnection();
    setStatus(result.ok ? "success" : "error");
    setMessage(result.message);
  };

  return <div className="supabase-check"><button type="button" className="supabase-check-button" onClick={checkConnection} disabled={status === "checking"}>Supabase 연결 확인</button>{message && <p className={`supabase-check-message ${status}`} role="status">{message}</p>}</div>;
}

function StudentCodeStartScreenV2({ onStart }: { onStart: (code: string) => Promise<{ ok: boolean; message: string; error?: { message?: string; code?: string; details?: string; hint?: string } }> }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [debugError, setDebugError] = useState("");
  const [saving, setSaving] = useState(false);
  const normalized = code.trim().toUpperCase();
  const isValid = /^[A-Z0-9]{4,12}$/.test(normalized);

  const submit = async () => {
    if (!normalized) { setError("학습 코드를 입력해주세요."); return; }
    if (!isValid) { setError("영문 대문자와 숫자를 조합해 4~12자로 입력해주세요."); return; }
    setSaving(true);
    setError("");
    setDebugError("");
    const result = await onStart(normalized);
    if (!result.ok) {
      setError("학습 기록을 시작하지 못했습니다. 잠시 후 다시 시도해주세요.");
      if (process.env.NODE_ENV !== "production") setDebugError([result.error?.message, result.error?.code, result.error?.details, result.error?.hint].filter(Boolean).join(" | "));
    }
    setSaving(false);
  };

  return <div className="hero-grid"><div className="hero-copy"><span className="eyebrow">오늘의 맞춤 미션 · 10분</span><h1>계수를 읽고,<br /><em>그래프를 이끌어</em>보세요.</h1><p>계수를 읽으면 그래프가 보이고,<br />계수를 바꾸면 그래프의 변화가 보입니다.</p><div className="reader-leader-guide"><p><strong>Reader</strong> · a, b, c가 그래프에 어떤 영향을 주는지 읽어봅니다.</p><p><strong>Leader</strong> · a, b, c를 직접 바꾸며 그래프의 변화를 이끌어봅니다.</p></div><div className="student-code-form"><label htmlFor="student-code">학습 코드를 입력하세요</label><p>선생님에게 받은 학습 코드를 입력하면 학습 기록이 저장됩니다.</p><input id="student-code" value={code} maxLength={12} placeholder="예) A20301" autoCapitalize="characters" onChange={(event) => { setCode(event.target.value.toUpperCase()); setError(""); }} onKeyDown={(event) => { if (event.key === "Enter") void submit(); }} />{error && <span className="student-code-error" role="alert">{error}</span>}{debugError && <span className="student-code-debug" role="status">개발 오류: {debugError}</span>}<button className="primary-button" onClick={() => void submit()} disabled={saving}>{saving ? "학습 기록 저장 중..." : "학습 시작하기"} <span>→</span></button><DetailedSupabaseConnectionCheck /></div></div><div className="start-art"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="star star-one">✦</div><div className="star star-two">✧</div><div className="graph-card-decoration"><span>GeoGebra</span><strong>정확한 그래프를<br />곧 만나요</strong></div><div className="floating-note">그래프를<br /><strong>움직여보세요</strong> <span>↗</span></div></div></div>;
}

function StudentCodeStartScreen({ onStart }: { onStart: (code: string) => boolean }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const normalized = code.trim().toUpperCase();
  const isValid = /^[A-Z0-9]{4,12}$/.test(normalized);

  const submit = () => {
    if (!normalized) { setError("학습 코드를 입력해주세요."); return; }
    if (!isValid) { setError("영문 대문자와 숫자를 조합해 4~12자로 입력해주세요."); return; }
    if (!onStart(normalized)) setError("학습 코드를 확인해주세요.");
  };

  return (
    <div className="hero-grid">
      <div className="hero-copy">
        <span className="eyebrow">오늘의 맞춤 미션 · 10분</span>
        <h1>계수를 읽고,<br /><em>그래프를 이끌어</em>보세요.</h1>
        <p>계수를 읽으면 그래프가 보이고,<br />계수를 바꾸면 그래프의 변화가 보입니다.</p>
        <div className="reader-leader-guide"><p><strong>Reader</strong> · a, b, c가 그래프에 어떤 영향을 주는지 읽어봅니다.</p><p><strong>Leader</strong> · a, b, c를 직접 바꾸며 그래프의 변화를 이끌어봅니다.</p></div>
        <div className="student-code-form"><label htmlFor="student-code">학습 코드를 입력하세요</label><p>선생님에게 받은 학습 코드를 입력하면 학습 기록이 저장됩니다.</p><input id="student-code" value={code} maxLength={12} placeholder="예) A20301" autoCapitalize="characters" onChange={(event) => { setCode(event.target.value.toUpperCase()); setError(""); }} onKeyDown={(event) => { if (event.key === "Enter") submit(); }} aria-describedby={error ? "student-code-error" : undefined} />{error && <span id="student-code-error" className="student-code-error" role="alert">{error}</span>}<button className="primary-button" onClick={submit}>학습 시작하기 <span>→</span></button><DetailedSupabaseConnectionCheck /></div>
      </div>
      <div className="start-art"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="star star-one">✦</div><div className="star star-two">✧</div><div className="graph-card-decoration"><span>GeoGebra</span><strong>정확한 그래프를<br />곧 만나요</strong></div><div className="floating-note">그래프를<br /><strong>움직여보세요</strong> <span>↗</span></div></div>
    </div>
  );
}

function StartScreen({ onNext }: { onNext: () => void }) {
  return (
    <div className="hero-grid">
      <div className="hero-copy">
        <span className="eyebrow">오늘의 맞춤 미션 · 10분</span>
        <h1>계수를 읽고,<br /><em>그래프를 이끌어</em>보세요.</h1>
        <p>계수를 읽으면 그래프가 보이고,<br />계수를 바꾸면 그래프의 변화가 보입니다.</p>
        <div className="reader-leader-guide"><p><strong>Reader</strong> · a, b, c가 그래프에 어떤 영향을 주는지 읽어봅니다.</p><p><strong>Leader</strong> · a, b, c를 직접 바꾸며 그래프의 변화를 이끌어봅니다.</p></div>
        <button className="primary-button" onClick={onNext}>미션 시작하기 <span>→</span></button>
        <div className="micro-proof"><span>●</span> 지금까지 1,284명의 학생이 시작했어요</div>
      </div>
      <div className="start-art">
        <div className="orbit orbit-one" /><div className="orbit orbit-two" />
        <div className="star star-one">✦</div><div className="star star-two">✦</div>
        <div className="graph-card-decoration"><span>GeoGebra</span><strong>정확한 그래프를<br />곧 만나요</strong></div>
        <div className="floating-note">그래프를<br /><strong>움직여보세요</strong> <span>↗</span></div>
      </div>
    </div>
  );
}

function DiagnosisScreen({ index, answers, shownAtByQuestion, onQuestionShown, onSubmit, onDevPath }: {
  index: number;
  answers: Record<string, { answer: string; shownAt: string; submittedAt: string }>;
  results: Record<string, boolean>;
  responseTimes: Record<string, number>;
  shownAtByQuestion: Record<string, string>;
  onQuestionShown: (questionId: string, shownAt: string) => void;
  onSubmit: (question: DiagnosisQuestion, answer: string, submittedAt: string, responseTimeMs: number, isCorrect: boolean) => void;
  onDevPath?: (path: PathId) => void;
}) {
  const question = diagnosisQuestions[index];
  const [selected, setSelected] = useState(answers[question.id]?.answer ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<{ message?: string; code?: string; details?: string; hint?: string } | null>(null);
  const shownAtRef = useRef("");

  useEffect(() => {
    const shownAt = shownAtByQuestion[question.id] ?? new Date().toISOString();
    shownAtRef.current = shownAt;
    onQuestionShown(question.id, shownAt);
    setSelected(answers[question.id]?.answer ?? "");
  }, [answers, onQuestionShown, question.id, shownAtByQuestion]);

  const submit = async () => {
    if (!selected || saving || !currentLearningSessionId) return;
    setSaving(true);
    setSaveError(null);
    const submittedAt = new Date().toISOString();
    const shownAt = shownAtRef.current || submittedAt;
    const responseTimeMs = Math.max(0, new Date(submittedAt).getTime() - new Date(shownAt).getTime());
    const result = await saveDiagnosisResponse({ sessionId: currentLearningSessionId, questionId: question.id, answer: selected, isCorrect: selected === question.correct, shownAt, submittedAt, responseTimeMs });
    if (!result.ok) {
      setSaveError(result.error ?? { message: result.message });
      setSaving(false);
      return;
    }
    onSubmit(question, selected, submittedAt, responseTimeMs, selected === question.correct);
    setSaving(false);
  };

  return (
    <div className="question-page">
      <div className="section-intro"><span className="eyebrow">01 · 빠른 진단</span><h2>그래프를 얼마나 알고 있는지 확인해볼까요?</h2><p>각 문항을 읽고 가장 알맞은 답을 골라주세요.</p></div>
      <div className="diagnosis-progress" aria-label={`진단 진행률 ${index + 1}/5`}>{index + 1}/5</div>
      <div className="diagnosis-card"><h3>{question.prompt}</h3><div className="diagnosis-choice-list">{question.choices.map((choice) => <button type="button" key={choice.id} className={`diagnosis-choice ${selected === choice.id ? "selected" : ""}`} onClick={() => setSelected(choice.id)}>{choice.label}</button>)}</div></div>
      {saveError && <div className="supabase-error" role="alert"><p>{saveError.message ?? "진단 응답을 저장하지 못했습니다."}</p>{process.env.NODE_ENV !== "production" && <small>{[saveError.code, saveError.details, saveError.hint].filter(Boolean).join(" | ")}</small>}</div>}
      <button className="primary-button" disabled={!selected || saving} onClick={() => void submit()}>{saving ? "저장 중..." : index === diagnosisQuestions.length - 1 ? "진단 완료" : "다음 문항"} <span>→</span></button>
      {process.env.NODE_ENV !== "production" && onDevPath && <div className="dev-path-tools" aria-label="개발용 경로 테스트"><button type="button" onClick={() => onDevPath("A")}>A로 테스트</button><button type="button" onClick={() => onDevPath("B")}>B로 테스트</button><button type="button" onClick={() => onDevPath("C")}>C로 테스트</button></div>}
    </div>
  );
}

function DiagnosisLegacyScreen({ value, onSelect, onNext }: { value: string | null; onSelect: (v: string) => void; onNext: () => void }) {
  const choices = [
    { id: "new", icon: "🌱", title: "처음 만나요", text: "꼭짓점, 축 같은 말이 아직 낯설어요" },
    { id: "some", icon: "🧩", title: "조금 알아요", text: "문제는 풀어봤지만 그래프가 헷갈려요" },
    { id: "ready", icon: "🚀", title: "도전할래요", text: "기본 개념은 알고 응용해보고 싶어요" },
  ];

  return (
    <div className="question-page">
      <div className="section-intro"><span className="eyebrow">01 · 빠른 진단</span><h2>지금 이차함수와 얼마나 친한가요?</h2><p>정답은 없어요. 현재의 감각을 알려주면 오늘의 설명을 맞춰드릴게요.</p></div>
      <div className="choice-grid">{choices.map((item) => <button key={item.id} className={`choice-card ${value === item.id ? "selected" : ""}`} onClick={() => onSelect(item.id)}><span className="choice-icon">{item.icon}</span><span><strong>{item.title}</strong><small>{item.text}</small></span><span className="check">{value === item.id ? "✓" : "○"}</span></button>)}</div>
      <button className="primary-button" disabled={!value} onClick={onNext}>다음으로 <span>→</span></button>
    </div>
  );
}

function ExploreScreen({ selected, savedResults, onSave, onNext }: { selected: PathId; savedResults: ExplorationRecord[]; onSave: (record: ExplorationRecord) => void; onNext: () => void }) {
  const [lastCoefficientChange, setLastCoefficientChange] = useState<CoefficientChange | null>(null);
  const prompt = explorationPrompts[selected];
  const latest = savedResults[savedResults.length - 1];
  const [responseText, setResponseText] = useState(latest?.responseText ?? "");
  const [saved, setSaved] = useState(false);
  const snapshot = lastCoefficientChange ?? { ...pathDefaults[selected], path: selected, changedAt: new Date().toISOString() };

  useEffect(() => { setResponseText(latest?.responseText ?? ""); setSaved(false); }, [selected]);

  const saveResponse = () => {
    if (responseText.trim().length < 20) return;
    onSave({ path: selected, promptId: prompt.promptId, responseText: responseText.trim(), coefficientSnapshot: { a: snapshot.a, b: snapshot.b, c: snapshot.c }, writtenAt: new Date().toISOString() });
    setSaved(true);
  };

  return (
    <div className="question-page">
      <div className="section-intro row-intro"><div><span className="eyebrow">02 · 그래프 탐색</span><h2>계수를 움직이며 그래프의 변화를 관찰해보세요.</h2><p>표시된 계수 슬라이더를 조절하고 포물선의 변화를 살펴보세요.</p></div><span className="hint-pill">실험 <b>↗</b></span></div>
      <div className="explore-layout"><div><GeoGebraGraph path={selected} onCoefficientChange={(change) => { setLastCoefficientChange(change); setSaved(false); }} /><span className="sr-only">최근 계수 변경 {lastCoefficientChange?.changedAt ?? "없음"}</span></div><div className="observation"><span>◒</span><p><strong>관찰 포인트</strong><br />계수가 바뀌면 포물선의 모양과 위치가 어떻게 달라지는지 확인해보세요.</p></div></div>
      <div className="exploration-response"><span className="eyebrow">탐구 결과 작성</span><h3>{prompt.question}</h3><p>{prompt.support}</p><textarea value={responseText} onChange={(event) => { setResponseText(event.target.value); setSaved(false); }} placeholder="관찰한 내용을 자신의 말로 작성해보세요." rows={6} aria-label="탐구 결과 작성" /><div className="response-meta"><span>{responseText.length}자 · 최소 20자</span><span>작성 횟수: {savedResults.length}</span></div><button className="primary-button" disabled={responseText.trim().length < 20} onClick={saveResponse}>탐구 결과 저장 <span>→</span></button>{saved && <p className="response-saved" role="status">관찰한 내용을 저장했습니다. 다음 탐구로 이동합니다.</p>}</div>
      <button className="primary-button" disabled={!saved} onClick={onNext}>다음 단계로 이동 <span>→</span></button>
    </div>
  );
}

function ExploreLegacyScreenV2({ selected, onSelect, onNext }: { selected: string; onSelect: (v: string) => void; onNext: () => void }) {
  const [lastCoefficientChange, setLastCoefficientChange] = useState<CoefficientChange | null>(null);

  return (
    <div className="question-page">
      <div className="section-intro row-intro"><div><span className="eyebrow">02 · 그래프 탐색</span><h2>세 그래프의 차이를 찾아보세요</h2><p>카드를 눌러 경로를 바꾸고, 계수를 움직여 포물선의 변화를 관찰해보세요.</p></div><span className="hint-pill">힌트 <b>?</b></span></div>
      <div className="explore-layout"><div><GeoGebraGraph path={selected as PathId} onCoefficientChange={setLastCoefficientChange} /><span className="sr-only">최근 변경 시각 {lastCoefficientChange?.changedAt ?? "없음"}</span></div><div className="graph-options">{graphOptions.map((item) => <button key={item.id} className={`graph-option ${selected === item.id ? "selected" : ""}`} onClick={() => onSelect(item.id)}><span className={`letter letter-${item.id.toLowerCase()}`}>{item.id}</span><span><strong>{item.title}</strong><small>{item.note}</small></span><span className="arrow">→</span></button>)}<div className="observation"><span>💡</span><p><strong>관찰 포인트</strong><br />계수의 변화가 포물선의 모양과 위치를 어떻게 바꾸는지 살펴보세요.</p></div></div></div>
      <button className="primary-button" onClick={onNext}>탐색 완료, 최종 도전으로 <span>→</span></button>
    </div>
  );
}

function ExploreLegacyScreen({ selected, onSelect, onNext }: { selected: string; onSelect: (v: string) => void; onNext: () => void }) {
  return (
    <div className="question-page">
      <div className="section-intro row-intro"><div><span className="eyebrow">02 · 그래프 탐색</span><h2>세 그래프의 차이를 찾아보세요</h2><p>카드를 눌러 그래프를 바꿔보세요. 가장 눈에 띄는 변화는 무엇인가요?</p></div><span className="hint-pill">힌트 <b>?</b></span></div>
      <div className="explore-layout"><div><GeoGebraGraph /><p className="graph-caption">현재는 기준 포물선 <b>y = x²</b> 하나만 표시합니다. 슬라이더와 카드 연결은 다음 단계에서 추가할게요.</p></div><div className="graph-options">{graphOptions.map((item) => <button key={item.id} className={`graph-option ${selected === item.id ? "selected" : ""}`} onClick={() => onSelect(item.id)}><span className={`letter letter-${item.id.toLowerCase()}`}>{item.id}</span><span><strong>{item.title}</strong><small>{item.note}</small></span><span className="arrow">→</span></button>)}<div className="observation"><span>💡</span><p><strong>관찰 포인트</strong><br />이번에는 정확한 기준 포물선 하나가 보이는지 먼저 확인해보세요.</p></div></div></div>
      <button className="primary-button" onClick={onNext}>탐색 완료, 도전으로 <span>→</span></button>
    </div>
  );
}

function FunctionGraph({ choice }: { choice: GraphChoice }) {
  const points = Array.from({ length: 49 }, (_, index) => -6 + index * 0.25).map((x) => [x, choice.a * x * x + choice.b * x + choice.c]);
  const toX = (x: number) => 12 + ((x + 6) / 12) * 176;
  const toY = (y: number) => 92 - ((y + 12) / 24) * 80;
  const path = points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${toX(x).toFixed(1)},${toY(y).toFixed(1)}`).join(" ");
  return <svg className="function-graph" viewBox="0 0 200 104" role="img" aria-label={`${choice.formula} 그래프`}><line x1="12" y1={toY(0)} x2="188" y2={toY(0)} className="function-axis" /><line x1={toX(0)} y1="8" x2={toX(0)} y2="92" className="function-axis" /><path d={path} className="function-curve" /></svg>;
}

function ChallengeScreen({ selected, feedback, attempts, done, onSelect, onRetry, onNext }: { selected: string | null; feedback: string | null; attempts: number; done: boolean; onSelect: (choice: GraphChoice) => void; onRetry: () => void; onNext: () => void }) {
  return (
    <div className="question-page"><div className="section-intro"><span className="eyebrow">03 · 최종 도전</span><h2>그래프의 특징을 연결해볼까요?</h2><p>다음 이차함수의 그래프에 해당하는 것을 고르시오.</p><div className="final-formula">{finalQuestion.formula}</div></div><div className="final-choices">{finalQuestion.graphChoices.map((choice) => <button type="button" key={choice.id} className={`final-choice ${selected === choice.id ? "selected" : ""} ${selected === choice.id && choice.isCorrect ? "correct" : ""}`} onClick={() => onSelect(choice)}><FunctionGraph choice={choice} /><strong>그래프 {choice.id.replace("choice-", "")}</strong></button>)}</div>{feedback && <div className={`final-feedback ${done ? "success" : "error"}`} role="status">{feedback}</div>}{feedback && !done && <button className="secondary-button retry-button" onClick={onRetry}>다시 도전하기</button>}<small className="attempt-count final-attempt-count">재도전 횟수: {attempts}회</small><button className="primary-button" disabled={!done} onClick={onNext}>최종 미션 완료 <span>→</span></button></div>
  );
}

function CompleteScreen({ studentCode, completedAt, onRestart }: { studentCode: string; completedAt: string; onRestart: () => void }) {
  const formattedCompletedAt = completedAt ? new Date(completedAt).toLocaleString("ko-KR") : "";
  return <div className="complete-page"><div className="confetti">✦　✧　✦</div><div className="complete-icon">✓</div><span className="eyebrow">GRAPH LEADER</span><h2>그래프 리더 미션을<br /><em>완료했습니다.</em></h2><p>함수식의 계수를 읽고,<br />그래프의 변화를 직접 이끌어냈습니다.</p><div className="result-card"><div><span>학습 코드</span><strong>{studentCode}</strong></div><div><span>완료 시각</span><strong>{formattedCompletedAt}</strong></div></div><p className="completion-message">학습 코드 {studentCode}의 미션이 완료되었습니다.</p><button className="secondary-button" onClick={onRestart}>처음부터 다시 해보기</button></div>;
}
