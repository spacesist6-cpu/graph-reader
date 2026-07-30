"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { aggregateExplorationFeedback, checkSupabaseConnection, loadExplorationResults, loadLearningRecords, saveCheckpointAttempt, saveDiagnosisResponse, saveExplorationFeedback, saveFinalChallengeAttempt, startLearningSession, type AggregateExplorationFeedback, type ExplorationFeedback, type LearningRecords } from "../lib/supabase/client";
import { createDiagnosisQuestions } from "../lib/diagnosis/questions";
import { createFinalChallengeQuestion, type FinalChallengeQuestion } from "../lib/final-challenge/questions";

type Step = "start" | "diagnosis" | "diagnosis-feedback" | "explore" | "checkpoint" | "feedback" | "challenge" | "complete";
type ReviewSection = "menu" | "diagnosis" | "exploration-A" | "exploration-B" | "exploration-C" | "final";

const graphOptions = [
  { id: "A", title: "1단계 탐구 그래프", formula: "y = x²", note: "아래로 볼록, 꼭짓점은 (0, 0)" },
  { id: "B", title: "B 그래프", formula: "y = (x - 2)² - 1", note: "오른쪽으로 2, 아래로 1 이동" },
  { id: "C", title: "3단계 탐구 그래프", formula: "y = -x² + 2", note: "위로 볼록, 꼭짓점은 (0, 2)" },
];

type GeoGebraApi = {
  evalCommand: (command: string) => boolean;
  setValue?: (name: string, value: number) => void;
  setSize?: (width: number, height: number) => void;
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

type CheckpointOption = { id: string; label: string };
type CheckpointQuestion = { questionId: string; prompt: string; options: CheckpointOption[]; correctOptionId: string; explanation: string; questionParameters: Record<string, unknown> };

function createVariantSeed(studentCode: string, sessionId: string, questionId: string) {
  let hash = 2166136261;
  for (const character of `${studentCode}:${sessionId}:${questionId}`) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return hash >>> 0;
}

function getCheckpointQuestions(path: PathId, studentCode: string, sessionId: string): CheckpointQuestion[] {
  const seed = createVariantSeed(studentCode, sessionId, `checkpoint-${path}`);
  if (path === "A") {
    const magnitude = seed % 2 === 0 ? 2 : 3;
    return [
      { questionId: "checkpoint-a-direction", prompt: `a=${magnitude}일 때 그래프는 어떻게 볼록한가요?`, options: [{ id: "up", label: "아래로 볼록" }, { id: "down", label: "위로 볼록" }, { id: "line", label: "직선이 됨" }], correctOptionId: "up", explanation: "a가 양수이면 그래프는 아래로 볼록입니다.", questionParameters: { templateId: "a-direction", variantSeed: seed, a: magnitude } },
      { questionId: "checkpoint-a-width", prompt: `|a|=${magnitude}인 그래프는 y=x²보다 어떻게 보이나요?`, options: [{ id: "narrow", label: "더 좁게 보임" }, { id: "same", label: "같은 폭으로 보임" }, { id: "wide", label: "더 넓게 보임" }], correctOptionId: "narrow", explanation: "|a|가 1보다 크면 y=x²보다 좁게 보입니다.", questionParameters: { templateId: "a-width", variantSeed: seed, a: magnitude, baselineA: 1 } },
    ];
  }
  if (path === "B") {
    const axis = seed % 2 === 0 ? 1 : 2;
    const a = 2;
    const b = -2 * a * axis;
    return [
      { questionId: "checkpoint-b-change", prompt: "a와 b를 바꾸면 그래프의 어떤 특징이 달라질 수 있나요?", options: [{ id: "position", label: "꼭짓점과 대칭축의 위치" }, { id: "yIntercept", label: "y절편만" }, { id: "none", label: "아무것도 달라지지 않음" }], correctOptionId: "position", explanation: "a와 b는 대칭축과 꼭짓점의 위치에 영향을 줍니다.", questionParameters: { templateId: "ab-change", variantSeed: seed, a, b, axis } },
      { questionId: "checkpoint-b-axis", prompt: `y=${a}x² ${b < 0 ? `- ${Math.abs(b)}x` : `+ ${b}x`}+1의 대칭축은 무엇인가요?`, options: [{ id: "axis-1", label: "x = 1" }, { id: "axis-2", label: "x = 2" }, { id: "axis-0", label: "x = 0" }], correctOptionId: axis === 1 ? "axis-1" : "axis-2", explanation: "대칭축은 x=-b/(2a)로 구합니다.", questionParameters: { templateId: "ab-axis", variantSeed: seed, a, b, axis } },
    ];
  }
  return [
    { questionId: "checkpoint-c-intercept", prompt: "c는 그래프의 어떤 특징을 결정하나요?", options: [{ id: "direction", label: "개방 방향" }, { id: "intercept", label: "y절편" }, { id: "width", label: "그래프의 폭" }], correctOptionId: "intercept", explanation: "x=0일 때 y=c이므로 c는 y절편입니다.", questionParameters: { templateId: "abc-intercept", variantSeed: seed, a: 2, b: -4, c: 1, yIntercept: 1 } },
    { questionId: "checkpoint-c-summary", prompt: "a=2, b=-4, c=1인 그래프의 설명으로 알맞은 것은 무엇인가요?", options: [{ id: "correct", label: "아래로 볼록하고, 좁으며, 꼭짓점 (1,-1), y절편 1" }, { id: "wrong-direction", label: "위로 볼록하고, 꼭짓점 (1,-1)" }, { id: "wrong-intercept", label: "아래로 볼록하고, y절편 3" }], correctOptionId: "correct", explanation: "a, b, c를 각각 방향·폭·꼭짓점·대칭축·y절편과 연결합니다.", questionParameters: { templateId: "abc-summary", variantSeed: seed, a: 2, b: -4, c: 1, vertex: { x: 1, y: -1 }, axis: "x = 1", yIntercept: 1 } },
  ];
}

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

const sliderRanges: Record<keyof QuadraticValues, { min: number; max: number; step: number }> = {
  a: { min: -3, max: 3, step: 0.5 },
  b: { min: -6, max: 6, step: 0.5 },
  c: { min: -5, max: 5, step: 1 },
};

type DiagnosisQuestion = {
  id: string;
  questionType: "direction" | "width" | "axis" | "intercept" | "relationship";
  prompt: string;
  choices: { id: string; label: string }[];
  correct: string;
  explanation: string;
  parameters: Record<string, number>;
  variantSeed: number;
  version: string;
};

const legacyDiagnosisQuestions = [
  { id: "direction", prompt: "a가 음수인 이차함수 그래프는 어떻게 볼록한가요?", choices: [{ id: "up", label: "위로 볼록" }, { id: "down", label: "아래로 볼록" }, { id: "line", label: "직선이 됨" }], correct: "up" },
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

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function formatQuadraticExpression({ a, b, c }: QuadraticValues) {
  const terms: string[] = [];
  if (a !== 0) terms.push(`${a < 0 ? "-" : ""}${Math.abs(a) === 1 ? "" : formatNumber(Math.abs(a))}x²`);
  if (b !== 0) terms.push(`${b < 0 ? "-" : "+"} ${Math.abs(b) === 1 ? "" : formatNumber(Math.abs(b))}x`);
  if (c !== 0) terms.push(`${c < 0 ? "-" : "+"} ${formatNumber(Math.abs(c))}`);
  return `y = ${terms.length ? terms.join(" ") : "0"}`;
}

function getGraphCoordSystem() {
  return { xmin: -6, xmax: 6, ymin: -6, ymax: 6 };
}

function GeoGebraGraph({ path = "C", onCoefficientChange, observation }: { path?: PathId; onCoefficientChange?: (change: CoefficientChange) => void; observation?: ReactNode } = {}) {
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

      const size = Math.max(280, Math.min(560, container.clientWidth || 560));
      const applet = new geoWindow.GGBApplet({
        appName: "graphing",
        language: "ko",
        width: size,
        height: size,
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
          const viewport = getGraphCoordSystem();
          api.setCoordSystem?.(viewport.xmin, viewport.xmax, viewport.ymin, viewport.ymax);
          window.setTimeout(() => {
            api.setPerspective?.("G");
            api.evalCommand('SetPerspective("G")');
            api.showAlgebraInput?.(false);
            api.showToolBar?.(false);
            api.showMenuBar?.(false);
            api.showResetIcon?.(false);
            const nextViewport = getGraphCoordSystem();
            api.setCoordSystem?.(nextViewport.xmin, nextViewport.xmax, nextViewport.ymin, nextViewport.ymax);
          }, 250);
          setLoadError(null);
        },
      }, true);

      container.innerHTML = "";
      applet.inject(container);
    };

    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      const api = apiRef.current;
      const currentContainer = containerRef.current;
      if (!api || !currentContainer) return;
      const nextSize = Math.max(280, Math.min(560, currentContainer.clientWidth || 560));
      api.setSize?.(nextSize, nextSize);
      const viewport = getGraphCoordSystem();
      api.setCoordSystem?.(viewport.xmin, viewport.xmax, viewport.ymin, viewport.ymax);
    });
    resizeObserver?.observe(container);

    const existingScript = document.querySelector<HTMLScriptElement>("script[data-geogebra-loader]");
    if (existingScript) {
      loadApplet();
      return () => resizeObserver?.disconnect();
    }

    const script = document.createElement("script");
    script.src = "https://www.geogebra.org/apps/deployggb.js";
    script.async = true;
    script.dataset.geogebraLoader = "true";
    script.onload = loadApplet;
    script.onerror = () => setLoadError("GeoGebra를 불러오지 못했어요. 인터넷 연결을 확인해주세요.");
    document.head.appendChild(script);
    return () => resizeObserver?.disconnect();
  }, []);

  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    api.setValue?.("a", values.a);
    api.setValue?.("b", values.b);
    api.setValue?.("c", values.c);
    const viewport = getGraphCoordSystem();
    api.setCoordSystem?.(viewport.xmin, viewport.xmax, viewport.ymin, viewport.ymax);
  }, [values]);

  return (
    <div className="geogebra-stack">
      <div className="geogebra-frame">
      <div ref={containerRef} className="geogebra-container" aria-label="GeoGebra 그래프 계산기" />
      {loadError && <div className="geogebra-status error" role="alert">{loadError}</div>}
      </div>
      <div className="coefficient-panel">
      <div className="coefficient-heading">변경 가능한 계수</div>
      <div className="coefficient-controls" aria-label="이차함수 계수 조절">
        {pathSliders[path].map((key) => (
          <label key={key}>
            <span style={{ textTransform: "none" }}>{key} <b>{values[key]}</b></span>
            <input type="range" min={sliderRanges[key].min} max={sliderRanges[key].max} step={sliderRanges[key].step} value={values[key]} onChange={(event) => updateValue(key, event.target.value)} />
          </label>
        ))}
      </div>
      <div className="fixed-coefficients"><span>고정된 계수</span>{(["a", "b", "c"] as const).filter((key) => !pathSliders[path].includes(key)).map((key) => <span key={key}>🔒 {key} = {values[key]}</span>)}</div>
      <p className="coefficient-guide">슬라이더를 움직여 함수식과 그래프의 변화를 관찰해보세요.</p>
      </div>
      <div className="graph-information" aria-live="polite">
        <div className="current-function"><span>현재 함수 · y = ax² + bx + c</span><strong>{formatQuadraticExpression(values)}</strong></div>
        {values.a === 0 ? <p className="invalid-quadratic">a가 0이면 이차함수 그래프를 만들 수 없습니다.</p> : <><div><span>볼록 방향</span><strong>{values.a > 0 ? "아래로 볼록" : "위로 볼록"}</strong></div><div><span>꼭짓점</span><strong>({formatNumber(-values.b / (2 * values.a))}, {formatNumber(values.c - (values.b ** 2) / (4 * values.a))})</strong></div><div><span>대칭축</span><strong>x = {formatNumber(-values.b / (2 * values.a))}</strong></div><div><span>y절편</span><strong>{formatNumber(values.c)}</strong></div></>}
      </div>
      {observation}
    </div>
  );
}

function ExplorationResponsePanel({ prompt, responseText, onResponseChange, savedCount, saving, onSave, saveError, saved }: { prompt: ExplorationPrompt; responseText: string; onResponseChange: (value: string) => void; savedCount: number; saving: boolean; onSave: () => void | Promise<void>; saveError: string | null; saved: boolean }) {
  return <div className="exploration-response"><span className="eyebrow">관찰 기록 · 탐구 결과 작성</span><h3>관찰 기록</h3><p className="observation-guide">슬라이더를 움직이며 함수식과 그래프의 변화를 관찰해보세요.</p><h4>{prompt.question}</h4><p>{prompt.support}</p><textarea value={responseText} onChange={(event) => onResponseChange(event.target.value)} placeholder="관찰한 내용을 자신의 말로 작성해보세요." rows={6} aria-label="탐구 결과 작성" /><div className="response-meta"><span>{responseText.length}자 · 최소 20자</span><span>작성 횟수: {savedCount}</span></div><button className="primary-button" disabled={responseText.trim().length < 20 || saving} onClick={() => void onSave()}>{saving ? "저장하고 분석 중..." : "탐구 결과 저장"} <span>→</span></button>{saveError && <p className="supabase-error" role="alert">{saveError}</p>}{saved && <p className="response-saved" role="status">탐구 결과를 저장했습니다. 피드백 화면으로 이동합니다.</p>}</div>;
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
  const [explorationFeedback, setExplorationFeedback] = useState<AggregateExplorationFeedback | null>(null);
  const [finalChoiceId, setFinalChoiceId] = useState<string | null>(null);
  const [finalFeedback, setFinalFeedback] = useState<string | null>(null);
  const [finalAttempts, setFinalAttempts] = useState(0);
  const [challengeDone, setChallengeDone] = useState(false);
  const diagnosisQuestions = useMemo(() => createDiagnosisQuestions(studentCode, sessionId), [studentCode, sessionId]);
  const finalQuestion = useMemo(() => createFinalChallengeQuestion(studentCode, sessionId), [studentCode, sessionId]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(SESSION_STORAGE_KEY);
      if (saved) {
        const session = JSON.parse(saved) as Partial<ReturnType<typeof getPersistedSession>>;
        if (session.studentCode && session.sessionId && session.startedAt) {
          const restoredResults = session.diagnosisResults ?? {};
          const restoredResultCount = Object.values(restoredResults).filter(Boolean).length;
          const restoredPath = Object.keys(restoredResults).length === 5
            ? assignPath(restoredResultCount)
            : session.currentPath ?? null;
          if (process.env.NODE_ENV !== "production") {
            console.info("[diagnosis] localStorage session restored", {
              step: session.step ?? "start",
              diagnosisResultCount: restoredResultCount,
              diagnosisQuestionCount: Object.keys(restoredResults).length,
              storedPath: session.currentPath ?? null,
              restoredPath,
            });
            if (session.step === "explore" && restoredResultCount < 5) {
              console.warn("[diagnosis] restored exploration state has fewer than 5 diagnosis results", {
                diagnosisResultCount: restoredResultCount,
              });
            }
          }
          setStudentCode(session.studentCode);
          setSessionId(session.sessionId);
          currentLearningSessionId = session.sessionId;
          setStartedAt(session.startedAt);
          setCompletedAt(session.completedAt ?? "");
          setStep(session.step ?? "start");
          setDiagnosisIndex(session.diagnosisIndex ?? 0);
          setDiagnosisAnswers(session.diagnosisAnswers ?? {});
          setDiagnosisResults(restoredResults);
          setResponseTimes(session.responseTimes ?? {});
          setShownAtByQuestion(session.shownAtByQuestion ?? {});
          setCurrentPath(restoredPath);
          setAssignedAt(session.assignedAt ?? null);
          setExplorationResults(session.explorationResults ?? { A: [], B: [], C: [] });
          setExplorationFeedback(session.explorationFeedback ?? null);
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
  }, [sessionHydrated, studentCode, sessionId, startedAt, completedAt, step, diagnosisIndex, diagnosisAnswers, diagnosisResults, responseTimes, shownAtByQuestion, currentPath, assignedAt, explorationResults, explorationFeedback, finalChoiceId, finalFeedback, finalAttempts, challengeDone]);

  useEffect(() => {
    if (!sessionHydrated || !sessionId) return;
    let cancelled = false;
    void loadExplorationResults(sessionId).then((result) => {
      if (cancelled || !result.ok || !result.results) return;
      const grouped: Record<PathId, ExplorationRecord[]> = { A: [], B: [], C: [] };
      for (const item of result.results) {
        grouped[item.path].push({ path: item.path, promptId: item.promptId, responseText: item.responseText, coefficientSnapshot: item.coefficientSnapshot, writtenAt: item.writtenAt });
      }
      setExplorationResults(grouped);
      const stageFeedback = result.results
        .flatMap((item) => item.feedback ? [{ stage: item.path === "A" ? 1 : item.path === "B" ? 2 : 3, strengths: item.feedback.strengths, improvements: item.feedback.improvements, nextQuestion: item.feedback.nextQuestion, hint: item.feedback.hint }] : [])
        .sort((a, b) => a.stage - b.stage);
      if (stageFeedback.length > 0) setExplorationFeedback({ feedback: stageFeedback.map(({ stage, strengths, improvements, nextQuestion, hint }) => ({ stage, strengths, improvements, nextQuestion, hint })) });
    });
    return () => { cancelled = true; };
  }, [sessionHydrated, sessionId]);

  function getPersistedSession() {
    return { studentCode, sessionId, startedAt, completedAt, step, diagnosisIndex, diagnosisAnswers, diagnosisResults, responseTimes, shownAtByQuestion, currentPath, assignedAt, explorationResults, explorationFeedback, finalChoiceId, finalFeedback, finalAttempts, challengeDone };
  }

  const startSession = async (value: string) => {
    const normalized = value.trim().toUpperCase();
    if (!/^[A-Z0-9]{4,12}$/.test(normalized)) return { ok: false, message: "학습 코드를 확인해주세요." };
    const result = await startLearningSession(normalized);
    if (!result.ok || !result.session) return result;
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    setStudentCode(result.session.studentCode);
    setSessionId(result.session.sessionId);
    currentLearningSessionId = result.session.sessionId;
    setStartedAt(result.session.startedAt);
    setCompletedAt("");
    setDiagnosisIndex(0);
    setDiagnosisAnswers({});
    setDiagnosisResults({});
    setResponseTimes({});
    setShownAtByQuestion({});
    setCurrentPath(null);
    setAssignedAt(null);
    setExplorationResults({ A: [], B: [], C: [] });
    setExplorationFeedback(null);
    setFinalChoiceId(null);
    setFinalFeedback(null);
    setFinalAttempts(0);
    setChallengeDone(false);
    setStep("diagnosis");
    if (process.env.NODE_ENV !== "production") {
      console.info("[diagnosis] new session started with cleared local state");
    }
    return result;
  };

  const progress = useMemo(
    () => ({ start: 0, diagnosis: 25, "diagnosis-feedback": 37, explore: 50, checkpoint: 58, feedback: 70, challenge: 82, complete: 100 })[step],
    [step],
  );

  const saveExploration = async (record: ExplorationRecord) => {
    const coreConcept = record.path === "A" ? "a의 부호와 절댓값, 개방 방향과 그래프의 폭" : record.path === "B" ? "a와 b, 꼭짓점과 대칭축" : "a, b, c와 개방 방향, 폭, 꼭짓점, 대칭축, y절편";
    const snapshot = record.coefficientSnapshot;
    if (!snapshot || !Number.isFinite(snapshot.a) || !Number.isFinite(snapshot.b) || !Number.isFinite(snapshot.c)) {
      return { ok: false, message: "탐구 결과를 저장하지 못했습니다.", error: { message: "현재 GeoGebra 계수값(coefficientSnapshot)이 없어 저장할 수 없습니다.", code: "INVALID_INPUT" } };
    }
    const result = await saveExplorationFeedback({ sessionId, path: record.path, promptId: record.promptId, studentResponse: record.responseText, coefficientSnapshot: { a: snapshot.a, b: snapshot.b, c: snapshot.c } });
    if (result.ok) {
      setExplorationResults((current) => ({ ...current, [record.path]: [...current[record.path], record] }));
      setStep("checkpoint");
    }
    return result;
  };

  const submitFinalChallenge = async (choice: GraphChoice) => {
    const feedback = choice.isCorrect
      ? "정확합니다. a, b, c의 값과 그래프의 방향, 폭, 꼭짓점, y절편을 올바르게 연결했습니다."
      : choice.errorType === "direction"
        ? "a의 부호를 다시 확인해보세요."
        : choice.errorType === "width"
          ? "|a|의 크기가 그래프의 폭에 어떤 영향을 주는지 살펴보세요."
          : choice.errorType === "vertex"
            ? "꼭짓점 (1, -1)과 대칭축 x=1을 확인해보세요."
            : "x=0을 대입했을 때 y값이 얼마인지 확인해보세요.";
    const result = await saveFinalChallengeAttempt({
      sessionId,
      questionId: finalQuestion.id,
      questionFormula: finalQuestion.formula,
      questionParameters: {
        variantSeed: finalQuestion.variantSeed,
        version: finalQuestion.version,
        a: finalQuestion.coefficients.a,
        b: finalQuestion.coefficients.b,
        c: finalQuestion.coefficients.c,
        vertex: finalQuestion.vertex,
        axis: finalQuestion.axis,
        yIntercept: finalQuestion.yIntercept,
        explanation: finalQuestion.explanation,
      },
      selectedChoiceId: choice.id,
      selectedFormula: choice.formula,
      isCorrect: choice.isCorrect,
      feedback,
    });
    if (result.ok) {
      setFinalChoiceId(choice.id);
      setFinalFeedback(feedback);
      setFinalAttempts(result.attemptNumber ?? finalAttempts + 1);
      setChallengeDone(choice.isCorrect);
      if (choice.isCorrect) {
        setCompletedAt(result.completedAt ?? new Date().toISOString());
        setStep("complete");
      }
    }
    return result;
  };

  const goNext = () => {
    if (step === "start") setStep("diagnosis");
    else if (step === "diagnosis-feedback") setStep("explore");
    else if (step === "feedback") setStep("challenge");
    else if (step === "challenge" && challengeDone) { setCompletedAt(new Date().toISOString()); setStep("complete"); }
  };

  const advanceFromCheckpoint = async () => {
    if (currentPath === "A") { setCurrentPath("B"); setStep("explore"); return; }
    if (currentPath === "B") { setCurrentPath("C"); setStep("explore"); return; }
    const loaded = await loadExplorationResults(sessionId);
    const rows = loaded.ok && loaded.results ? loaded.results : Object.values(explorationResults).flat().map((item) => ({ ...item, feedback: null }));
    const completedRows = (["A", "B", "C"] as PathId[])
      .map((path) => rows.find((item) => item.path === path))
      .filter((item): item is NonNullable<typeof rows[number]> => Boolean(item));
    if (completedRows.length > 0) {
      const aggregate = await aggregateExplorationFeedback({
        sessionId,
        explorations: completedRows.map((item) => {
          const index = item.path === "A" ? 0 : item.path === "B" ? 1 : 2;
          return ({
          stage: item.path === "A" ? 1 : item.path === "B" ? 2 : 3,
          path: item!.path,
          promptId: item!.promptId,
          question: explorationPrompts[item!.path].question,
          studentResponse: item!.responseText,
          coefficientSnapshot: item!.coefficientSnapshot,
          coreConcept: index === 0 ? "a의 부호와 |a|가 그래프의 볼록한 방향과 폭에 미치는 영향" : index === 1 ? "a와 b가 꼭짓점과 대칭축에 미치는 영향" : "a, b, c의 종합 해석과 y절편",
        });
        }),
      });
      if (aggregate.ok && aggregate.feedback) setExplorationFeedback(aggregate.feedback);
    }
    setStep("feedback");
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
        {step === "diagnosis" && <DiagnosisScreen questions={diagnosisQuestions} index={diagnosisIndex} answers={diagnosisAnswers} results={diagnosisResults} responseTimes={responseTimes} shownAtByQuestion={shownAtByQuestion} onQuestionShown={(questionId, shownAt) => setShownAtByQuestion((current) => current[questionId] ? current : { ...current, [questionId]: shownAt })} onSubmit={(question, answer, submittedAt, responseTimeMs, isCorrect) => { const nextAnswers = { ...diagnosisAnswers, [question.id]: { answer, shownAt: shownAtByQuestion[question.id] ?? submittedAt, submittedAt } }; const nextResults = { ...diagnosisResults, [question.id]: isCorrect }; const nextTimes = { ...responseTimes, [question.id]: responseTimeMs }; setDiagnosisAnswers(nextAnswers); setDiagnosisResults(nextResults); setResponseTimes(nextTimes); if (diagnosisIndex === diagnosisQuestions.length - 1) { const correctCount = Object.values(nextResults).filter(Boolean).length; const path = assignPath(correctCount); if (process.env.NODE_ENV !== "production") { console.info("[diagnosis] completed", { resultCount: Object.keys(nextResults).length, correctCount, expectedQuestionCount: diagnosisQuestions.length, assignedPath: path }); } const now = new Date().toISOString(); setCurrentPath(path); setAssignedAt(now); setStep("diagnosis-feedback"); } else { setDiagnosisIndex((current) => current + 1); } }} />}
        {step === "diagnosis-feedback" && <DiagnosisFeedbackScreen questions={diagnosisQuestions} answers={diagnosisAnswers} results={diagnosisResults} onNext={goNext} />}
        {step === "explore" && <ExploreScreen selected={currentPath ?? "A"} savedResults={explorationResults[currentPath ?? "A"]} onSave={saveExploration} />}
        {step === "checkpoint" && <CheckpointScreen path={currentPath ?? "A"} studentCode={studentCode} sessionId={sessionId} onAdvance={() => void advanceFromCheckpoint()} />}
        {step === "feedback" && <ExplorationFeedbackScreen results={explorationResults} feedback={explorationFeedback} onNext={goNext} />}
        {step === "challenge" && <FinalChallengeScreen question={finalQuestion} selected={finalChoiceId} feedback={finalFeedback} attempts={finalAttempts} done={challengeDone} onSelect={(choice) => { setFinalChoiceId(choice.id); setFinalFeedback(null); setChallengeDone(false); }} onSubmit={submitFinalChallenge} onRetry={() => { setFinalChoiceId(null); setFinalFeedback(null); setChallengeDone(false); }} />}
        {step === "complete" && <CompleteScreen studentCode={studentCode} completedAt={completedAt} onRestart={() => { window.localStorage.removeItem(SESSION_STORAGE_KEY); setStep("start"); setStudentCode(""); setSessionId(""); setStartedAt(""); setCompletedAt(""); setDiagnosisIndex(0); setDiagnosisAnswers({}); setDiagnosisResults({}); setResponseTimes({}); setShownAtByQuestion({}); setCurrentPath(null); setAssignedAt(null); setExplorationResults({ A: [], B: [], C: [] }); setExplorationFeedback(null); setFinalChoiceId(null); setFinalFeedback(null); setFinalAttempts(0); setChallengeDone(false); }} />}
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

 return <div className="hero-grid"><div className="hero-copy"><span className="eyebrow">오늘의 맞춤 미션 · 10분</span><h1>계수를 읽고,<br /><em>그래프를 이끌어</em>보세요.</h1><p>계수를 읽으면 그래프가 보이고,<br />계수를 바꾸면 그래프의 변화가 보입니다.</p><div className="reader-leader-guide"><p><strong>Reader</strong> · a, b, c가 그래프에 어떤 영향을 주는지 읽어봅니다.</p><p><a className="leader-link inline-block cursor-pointer px-0.5 py-1 -mx-0.5 -my-1 no-underline hover:text-[var(--blue)] focus-visible:outline-2 focus-visible:outline-[var(--blue)] focus-visible:outline-offset-2" href="/teacher/login"><strong>Leader</strong></a> · a, b, c를 직접 바꾸며 그래프의 변화를 이끌어봅니다.</p></div><div className="student-code-form"><label htmlFor="student-code">학습 코드를 입력하세요</label><p>선생님에게 받은 학습 코드를 입력하면 학습 기록이 저장됩니다.</p><input id="student-code" value={code} maxLength={12} placeholder="예) A20301" autoCapitalize="characters" onChange={(event) => { setCode(event.target.value.toUpperCase()); setError(""); }} onKeyDown={(event) => { if (event.key === "Enter") void submit(); }} />{error && <span className="student-code-error" role="alert">{error}</span>}{debugError && <span className="student-code-debug" role="status">개발 오류: {debugError}</span>}<button className="primary-button" onClick={() => void submit()} disabled={saving}>{saving ? "학습 기록 저장 중..." : "학습 시작하기"} <span>→</span></button><DetailedSupabaseConnectionCheck /></div></div><div className="start-art"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="star star-one">✦</div><div className="star star-two">✧</div><div className="graph-card-decoration"><span>GeoGebra</span><strong>정확한 그래프를<br />곧 만나요</strong></div><div className="floating-note">그래프를<br /><strong>움직여보세요</strong> <span>↗</span></div></div></div>;
  return <div className="hero-grid"><div className="hero-copy"><span className="eyebrow">오늘의 맞춤 미션 · 10분</span><h1>계수를 읽고,<br /><em>그래프를 이끌어</em>보세요.</h1><p>계수를 읽으면 그래프가 보이고,<br />계수를 바꾸면 그래프의 변화가 보입니다.</p><div className="reader-leader-guide"><p><strong>Reader</strong> · a, b, c가 그래프에 어떤 영향을 주는지 읽어봅니다.</p><p><a className="leader-link inline-block cursor-pointer px-0.5 py-1 -mx-0.5 -my-1 no-underline hover:text-[var(--blue)] focus-visible:outline-2 focus-visible:outline-[var(--blue)] focus-visible:outline-offset-2" href="/teacher/login"><strong>Leader</strong></a> · a, b, c를 직접 바꾸며 그래프의 변화를 이끌어봅니다.</p></div><div className="student-code-form"><label htmlFor="student-code">학습 코드를 입력하세요</label><p>선생님에게 받은 학습 코드를 입력하면 학습 기록이 저장됩니다.</p><input id="student-code" value={code} maxLength={12} placeholder="예) A20301" autoCapitalize="characters" onChange={(event) => { setCode(event.target.value.toUpperCase()); setError(""); }} onKeyDown={(event) => { if (event.key === "Enter") void submit(); }} />{error && <span className="student-code-error" role="alert">{error}</span>}{debugError && <span className="student-code-debug" role="status">개발 오류: {debugError}</span>}<button className="primary-button" onClick={() => void submit()} disabled={saving}>{saving ? "학습 기록 저장 중..." : "학습 시작하기"} <span>→</span></button><DetailedSupabaseConnectionCheck /></div></div><div className="start-art"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="star star-one">✦</div><div className="star star-two">✧</div><div className="graph-card-decoration"><span>GeoGebra</span><strong>정확한 그래프를<br />곧 만나요</strong></div><div className="floating-note">그래프를<br /><strong>움직여보세요</strong> <span>↗</span></div></div></div>;
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
        <div className="reader-leader-guide"><p><strong>Reader</strong> · a, b, c가 그래프에 어떤 영향을 주는지 읽어봅니다.</p><p><a className="leader-link inline-block cursor-pointer px-0.5 py-1 -mx-0.5 -my-1 no-underline hover:text-[var(--blue)] focus-visible:outline-2 focus-visible:outline-[var(--blue)] focus-visible:outline-offset-2" href="/teacher/login"><strong>Leader</strong></a> · a, b, c를 직접 바꾸며 그래프의 변화를 이끌어봅니다.</p></div>
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

const diagnosisFeedbackCopy: Record<DiagnosisQuestion["questionType"], { title: string; concept: string; guidance: string; question: string }> = {
  direction: { title: "그래프의 볼록한 방향을 다시 확인해보세요.", concept: "a의 부호와 그래프의 볼록한 방향", guidance: "a가 양수이면 그래프는 아래로 볼록이고, a가 음수이면 위로 볼록입니다.", question: "a의 부호가 바뀌면 그래프의 방향은 어떻게 달라질까요?" },
  width: { title: "a의 절댓값과 그래프의 폭을 다시 확인해보세요.", concept: "|a|와 그래프의 폭", guidance: "|a|가 클수록 그래프는 더 좁고 뾰족해지고, |a|가 작을수록 더 넓어집니다.", question: "y=x²와 y=3x² 중 어느 그래프가 더 좁게 보일까요?" },
  axis: { title: "대칭축 공식을 다시 확인해보세요.", concept: "b와 대칭축 또는 꼭짓점의 x좌표", guidance: "이차함수 y=ax²+bx+c의 대칭축은 x=-b/(2a)입니다.", question: "식에서 a와 b를 찾아 공식에 대입해보세요." },
  intercept: { title: "c와 y절편의 관계를 다시 확인해보세요.", concept: "c와 y절편", guidance: "x=0을 대입하면 y=c가 되므로 c는 y절편입니다.", question: "함수식에 x=0을 대입하면 y값은 무엇이 될까요?" },
  relationship: { title: "a, b, c가 그래프에 미치는 영향을 연결해보세요.", concept: "a, b, c와 그래프의 종합 관계", guidance: "a는 볼록한 방향과 폭, b는 꼭짓점과 대칭축의 위치, c는 y절편에 영향을 줍니다.", question: "각 계수를 하나씩 바꾸면 그래프의 어떤 특징이 달라질까요?" },
};

function DiagnosisFeedbackScreen({ questions, answers, results, onNext }: {
  questions: DiagnosisQuestion[];
  answers: Record<string, { answer: string; shownAt: string; submittedAt: string }>;
  results: Record<string, boolean>;
  onNext: () => void;
}) {
  const wrongQuestions = questions.filter((question) => results[question.id] === false);
  const allCorrect = wrongQuestions.length === 0 && questions.every((question) => results[question.id] === true);
  return <div className="question-page diagnosis-feedback-page">
    <div className="section-intro"><span className="eyebrow">진단 결과 피드백</span><h2>{allCorrect ? "진단을 잘 마쳤어요!" : "진단 결과를 함께 돌아볼까요?"}</h2><p>{allCorrect ? "이차함수의 기본 개념을 잘 이해하고 있습니다." : "틀린 문항을 중심으로 핵심 개념을 다시 확인해봅시다."}</p></div>
    {allCorrect ? <article className="feedback-card diagnosis-all-correct"><h3>이제 그래프의 변화를 탐구해볼까요?</h3><p>a: 그래프의 볼록한 방향과 폭</p><p>b: 꼭짓점과 대칭축의 위치</p><p>c: y절편</p><p>이제 계수 a, b, c를 움직이며 그래프의 변화를 탐구해볼까요?</p></article> : <div className="feedback-card-list">{wrongQuestions.map((question) => { const copy = diagnosisFeedbackCopy[question.questionType]; const selectedLabel = question.choices.find((choice) => choice.id === answers[question.id]?.answer)?.label ?? "선택한 답을 확인할 수 없습니다."; return <article className="feedback-card" key={question.id}><span className="eyebrow">확인할 문항</span><h3>{copy.title}</h3><p><strong>문항</strong><br />{question.prompt}</p><p><strong>학생이 선택한 답</strong><br />{selectedLabel}</p><p><strong>확인할 개념</strong><br />{copy.concept}</p><p><strong>기본 피드백</strong><br />{copy.guidance}</p><p><strong>다시 생각해볼 질문</strong><br />{copy.question}</p></article>; })}</div>}
    <button className="primary-button" onClick={onNext}>그래프 탐구 시작하기 <span>→</span></button>
  </div>;
}

function DiagnosisScreen({ questions, index, answers, shownAtByQuestion, onQuestionShown, onSubmit, onDevPath }: {
  questions: DiagnosisQuestion[];
  index: number;
  answers: Record<string, { answer: string; shownAt: string; submittedAt: string }>;
  results: Record<string, boolean>;
  responseTimes: Record<string, number>;
  shownAtByQuestion: Record<string, string>;
  onQuestionShown: (questionId: string, shownAt: string) => void;
  onSubmit: (question: DiagnosisQuestion, answer: string, submittedAt: string, responseTimeMs: number, isCorrect: boolean) => void;
  onDevPath?: (path: PathId) => void;
}) {
  const question = questions[index];
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
    const isCorrect = selected === question.correct;
    if (process.env.NODE_ENV !== "production") {
      console.info("[diagnosis] answer submitted", {
        questionId: question.id,
        selectedChoiceId: selected,
        correctChoiceId: question.correct,
        isCorrect,
      });
    }
    const result = await saveDiagnosisResponse({ sessionId: currentLearningSessionId, questionId: question.id, questionVersion: question.version, questionParameters: question.parameters, answer: selected, isCorrect, shownAt, submittedAt, responseTimeMs });
    if (!result.ok) {
      setSaveError(result.error ?? { message: result.message });
      setSaving(false);
      return;
    }
    onSubmit(question, selected, submittedAt, responseTimeMs, isCorrect);
    setSaving(false);
  };

  return (
    <div className="question-page">
      <div className="section-intro"><span className="eyebrow">01 · 빠른 진단</span><h2>그래프를 얼마나 알고 있는지 확인해볼까요?</h2><p>각 문항을 읽고 가장 알맞은 답을 골라주세요.</p></div>
      <div className="diagnosis-progress" aria-label={`진단 진행률 ${index + 1}/5`}>{index + 1}/5</div>
      <div className="diagnosis-card"><h3>{question.prompt}</h3><div className="diagnosis-choice-list">{question.choices.map((choice) => <button type="button" key={choice.id} className={`diagnosis-choice ${selected === choice.id ? "selected" : ""}`} onClick={() => setSelected(choice.id)}>{choice.label}</button>)}</div></div>
      {saveError && <div className="supabase-error" role="alert"><p>{saveError.message ?? "진단 응답을 저장하지 못했습니다."}</p>{process.env.NODE_ENV !== "production" && <small>{[saveError.code, saveError.details, saveError.hint].filter(Boolean).join(" | ")}</small>}</div>}
      <button className="primary-button" disabled={!selected || saving} onClick={() => void submit()}>{saving ? "저장 중..." : index === questions.length - 1 ? "진단 완료" : "다음 문항"} <span>→</span></button>
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

function ExploreScreen({ selected, savedResults, onSave }: { selected: PathId; savedResults: ExplorationRecord[]; onSave: (record: ExplorationRecord) => Promise<{ ok: boolean; message: string; error?: { message?: string; code?: string; details?: string; hint?: string }; feedback?: ExplorationFeedback }>; }) {
  const [lastCoefficientChange, setLastCoefficientChange] = useState<CoefficientChange | null>(null);
  const prompt = explorationPrompts[selected];
  const latest = savedResults[savedResults.length - 1];
  const [responseText, setResponseText] = useState(latest?.responseText ?? "");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const currentA = lastCoefficientChange?.a ?? pathDefaults[selected].a;
  const currentB = lastCoefficientChange?.b ?? pathDefaults[selected].b;
  const currentC = lastCoefficientChange?.c ?? pathDefaults[selected].c;

  useEffect(() => { setResponseText(latest?.responseText ?? ""); setSaved(false); }, [selected]);

  const saveResponse = async () => {
    if (responseText.trim().length < 20) return;
    if (saving) return;
    if (![currentA, currentB, currentC].every(Number.isFinite)) {
      setSaveError("현재 GeoGebra 계수값이 없어 저장할 수 없습니다.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    const result = await onSave({ path: selected, promptId: prompt.promptId, responseText: responseText.trim(), coefficientSnapshot: { a: currentA, b: currentB, c: currentC }, writtenAt: new Date().toISOString() });
    if (!result.ok) setSaveError(result.error?.message ?? result.message);
    else setSaved(true);
    setSaving(false);
  };

  return (
    <div className="question-page explore-question-page">
      <div className="section-intro row-intro"><div><span className="eyebrow">02 · 그래프 탐색</span><h2>계수를 움직이며 그래프의 변화를 관찰해보세요.</h2><p>표시된 계수 슬라이더를 조절하고 포물선의 변화를 살펴보세요.</p></div><span className="hint-pill">실험 <b>↗</b></span></div>
      <div className="explore-layout explore-layout-single"><div><GeoGebraGraph path={selected} onCoefficientChange={(change) => { setLastCoefficientChange(change); setSaved(false); }} observation={<ExplorationResponsePanel prompt={prompt} responseText={responseText} onResponseChange={(value) => { setResponseText(value); setSaved(false); setSaveError(null); }} savedCount={savedResults.length} saving={saving} onSave={saveResponse} saveError={saveError} saved={saved} />} /><span className="sr-only">최근 계수 변경 {lastCoefficientChange?.changedAt ?? "없음"}</span></div></div>
      <div className="exploration-response"><span className="eyebrow">관찰 기록 · 탐구 결과 작성</span><h3>관찰 기록</h3><p className="observation-guide">슬라이더를 움직이며 함수식과 그래프의 변화를 관찰해보세요.</p><h4>{prompt.question}</h4><p>{prompt.support}</p><textarea value={responseText} onChange={(event) => { setResponseText(event.target.value); setSaved(false); setSaveError(null); }} placeholder="관찰한 내용을 자신의 말로 작성해보세요." rows={6} aria-label="탐구 결과 작성" /><div className="response-meta"><span>{responseText.length}자 · 최소 20자</span><span>작성 횟수: {savedResults.length}</span></div><button className="primary-button" disabled={responseText.trim().length < 20 || saving} onClick={() => void saveResponse()}>{saving ? "저장하고 분석 중..." : "탐구 결과 저장"} <span>→</span></button>{saveError && <p className="supabase-error" role="alert">{saveError}</p>}{saved && <p className="response-saved" role="status">탐구 결과를 저장했습니다. 피드백 화면으로 이동합니다.</p>}</div>
    </div>
  );
}

function CheckpointScreen({ path, studentCode, sessionId, onAdvance }: { path: PathId; studentCode: string; sessionId: string; onAdvance: () => void }) {
  const questions = useMemo(() => getCheckpointQuestions(path, studentCode, sessionId), [path, studentCode, sessionId]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [questionResult, setQuestionResult] = useState<boolean | null>(null);
  const [results, setResults] = useState<Array<boolean | null>>([null, null]);
  const [shownAt, setShownAt] = useState(() => Date.now());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const [attemptNumber, setAttemptNumber] = useState(0);
  const question = questions[questionIndex];
  const selectedOption = question.options.find((option) => option.id === selectedAnswer);
  const allCorrect = results.every((result) => result === true);

  useEffect(() => {
    setShownAt(Date.now());
  }, [questionIndex]);

  const submitAnswer = async () => {
    if (!selectedOption || saving || questionResult !== null) return;
    setSaving(true);
    setSaveError(null);
    const result = await saveCheckpointAttempt({
      sessionId,
      path,
      questionId: question.questionId,
      questionVersion: "checkpoint-v1",
      questionParameters: question.questionParameters,
      studentAnswer: selectedOption.label,
      isCorrect: selectedOption.id === question.correctOptionId,
      responseTimeMs: Math.max(0, Date.now() - shownAt),
    });
    if (result.ok && typeof result.isCorrect === "boolean") {
      setQuestionResult(result.isCorrect);
      setAttemptNumber(result.attemptNumber ?? attemptNumber + 1);
      setResults((current) => current.map((value, index) => index === questionIndex ? result.isCorrect ?? false : value));
      if (result.isCorrect && questionIndex === questions.length - 1) setFinished(true);
    } else if (!result.ok) {
      setSaveError(result.error?.message ?? result.message);
    }
    setSaving(false);
  };

  const continueCheckpoint = () => {
    if (questionResult !== true) return;
    if (questionIndex < questions.length - 1) {
      setQuestionIndex((current) => current + 1);
      setSelectedAnswer(null);
      setQuestionResult(null);
      setSaveError(null);
      setAttemptNumber(0);
    } else {
      setFinished(true);
    }
  };

  const retryQuestion = () => {
    if (questionResult !== false || saving) return;
    setSelectedAnswer(null);
    setQuestionResult(null);
    setSaveError(null);
    setFinished(false);
    setAttemptNumber(0);
    setShownAt(Date.now());
  };

  if (questionResult === false) return <div className="question-page checkpoint-page"><div className="section-intro"><span className="eyebrow">탐구 확인 문제</span><h2>방금 관찰한 내용을 확인해봅시다.</h2><p>틀린 문제는 같은 문제로 다시 도전할 수 있습니다.</p></div><div className="checkpoint-progress">확인문제 {questionIndex + 1} / {questions.length}</div><article className="checkpoint-card"><h3>{question.prompt}</h3><div className="checkpoint-options">{question.options.map((option) => <button type="button" key={option.id} className={`checkpoint-option ${selectedAnswer === option.id ? "selected" : ""}`} disabled><span className="checkpoint-option-mark">{option.id === selectedAnswer ? "✓" : ""}</span><span>{option.label}</span></button>)}</div><div className="checkpoint-result incorrect" role="status"><strong>다시 생각해봅시다.</strong><p>{question.explanation}</p>{attemptNumber > 0 && <small className="attempt-count">현재 시도: {attemptNumber}회</small>}</div><button type="button" className="secondary-button checkpoint-retry-button" onClick={retryQuestion}>다시 도전하기</button></article></div>;

  return <div className="question-page checkpoint-page"><div className="section-intro"><span className="eyebrow">탐구 확인 문제</span><h2>방금 관찰한 내용을 확인해봅시다.</h2><p>두 문제를 모두 맞히면 다음 활동으로 이동합니다.</p></div><div className="checkpoint-progress">확인문제 {questionIndex + 1} / {questions.length}</div><article className="checkpoint-card"><h3>{question.prompt}</h3><div className="checkpoint-options">{question.options.map((option) => <button type="button" key={option.id} className={`checkpoint-option ${selectedAnswer === option.id ? "selected" : ""}`} disabled={saving || questionResult !== null} onClick={() => { setSelectedAnswer(option.id); setSaveError(null); }}><span className="checkpoint-option-mark">{option.id === selectedAnswer ? "✓" : ""}</span><span>{option.label}</span></button>)}</div><button type="button" className="primary-button checkpoint-submit-button" disabled={!selectedOption || saving || questionResult !== null} onClick={() => void submitAnswer()}>{saving ? "제출 중..." : "제출하기"} <span>→</span></button>{saveError && <div className="final-feedback error" role="alert">{saveError}</div>}{questionResult !== null && <div className={`checkpoint-result ${questionResult ? "correct" : "incorrect"}`} role="status"><strong>{questionResult ? "정답입니다." : "다시 생각해봅시다."}</strong><p>{question.explanation}</p></div>}</article>{finished ? <div className={`checkpoint-summary ${allCorrect ? "correct" : "incorrect"}`} role="status"><strong>{allCorrect ? "두 문제를 모두 맞혔습니다." : "한 문제 이상 다시 확인해봅시다."}</strong><p>{allCorrect ? "다음 탐구 활동으로 이동합니다." : "틀린 개념을 다시 살펴본 뒤 같은 탐구를 다시 해보세요."}</p><button type="button" className="primary-button" onClick={allCorrect ? onAdvance : onRetry}>{allCorrect ? (path === "C" ? "탐구 결과 피드백 보기" : "다음 탐구로 이동") : "다시 탐구해보기"} <span>→</span></button></div> : questionResult !== null && <button type="button" className="secondary-button checkpoint-next-button" onClick={continueCheckpoint}>다음 확인문제 <span>→</span></button>}</div>;
}

function ExplorationFeedbackScreen({ results, feedback, onNext }: { results: Record<PathId, ExplorationRecord[]>; feedback: AggregateExplorationFeedback | null; onNext: () => void }) {
  const feedbackList = Array.isArray(feedback?.feedback) ? feedback.feedback : [];
  const stages = (["A", "B", "C"] as PathId[])
    .map((path) => ({ path, stage: path === "A" ? 1 : path === "B" ? 2 : 3, record: results[path][results[path].length - 1] }))
    .filter((item): item is typeof item & { record: ExplorationRecord } => Boolean(item.record))
    .map((item) => ({ ...item, feedback: feedbackList.find((feedbackItem) => feedbackItem.stage === item.stage) }));
  const fallback = (stage: number) => stage === 1
    ? { strengths: ["a와 그래프의 변화를 관찰했습니다."], improvements: ["a의 부호와 |a|가 방향과 폭에 미치는 영향을 다시 확인해보세요."], nextQuestion: "a의 부호와 크기는 그래프를 어떻게 바꿀까요?", hint: "a의 부호와 |a|를 그래프와 연결해보세요." }
    : stage === 2
      ? { strengths: ["a와 b의 변화를 꼭짓점과 연결하려고 했습니다."], improvements: ["대칭축 x=-b/(2a)와 꼭짓점의 관계를 확인해보세요."], nextQuestion: "b가 바뀌면 대칭축은 어떻게 이동할까요?", hint: "a와 b로 대칭축과 꼭짓점을 계산해보세요." }
      : { strengths: ["a, b, c와 그래프의 특징을 종합적으로 살펴보았습니다."], improvements: ["x=0을 대입해 c와 y절편의 관계를 확인해보세요."], nextQuestion: "세 계수는 그래프의 어떤 특징에 영향을 줄까요?", hint: "방향, 폭, 꼭짓점, 대칭축, y절편을 식과 대조해보세요." };
  return <div className="question-page exploration-feedback-page"><div className="section-intro"><span className="eyebrow">탐구 결과 피드백</span><h2>탐구 과정을 함께 돌아봅시다.</h2><p>각 탐구에서 작성한 답변과 관찰 내용을 순서대로 확인해봅시다.</p></div>{stages.length === 0 ? <div className="feedback-empty" role="status"><strong>아직 저장된 탐구 결과가 없습니다.</strong><p>탐구 답변을 작성하고 저장하면 피드백이 표시됩니다.</p></div> : <div className="feedback-card-list">{stages.map(({ stage, path, record, feedback: stageFeedback }) => { const safe = stageFeedback ?? fallback(stage); return <article className="feedback-card" key={path}><span className="eyebrow">{stage}단계 탐구</span><h3>탐구 질문</h3><p>{explorationPrompts[path].question}</p><h3>학생의 서술형 답변</h3><p className="student-response">{record.responseText}</p><p className="coefficient-snapshot">현재 계수 · a={record.coefficientSnapshot.a}, b={record.coefficientSnapshot.b}, c={record.coefficientSnapshot.c}</p><h3>잘한 점</h3><ul>{safe.strengths.map((item) => <li key={item}>{item}</li>)}</ul><h3>보완할 점</h3><ul>{safe.improvements.map((item) => <li key={item}>{item}</li>)}</ul><h3>다시 생각해볼 질문</h3><p>{safe.nextQuestion}</p><h3>최종 미션 힌트</h3><p>{safe.hint}</p></article>; })}</div>}<button className="primary-button" onClick={onNext}>최종 미션 도전하기 <span>→</span></button></div>;
}

function LegacyAggregateExplorationFeedbackScreen({ results, feedback, onNext }: { results: Record<PathId, ExplorationRecord[]>; feedback: AggregateExplorationFeedback | null; onNext: () => void }) {
  const feedbackList = Array.isArray(feedback?.feedback) ? feedback.feedback : [];
  const stages = (["A", "B", "C"] as PathId[])
    .map((path) => ({ path, stage: path === "A" ? 1 : path === "B" ? 2 : 3, record: results[path][results[path].length - 1] }))
    .filter((item): item is typeof item & { record: ExplorationRecord } => Boolean(item.record))
    .map((item) => ({ ...item, feedback: feedbackList.find((feedbackItem) => feedbackItem.stage === item.stage) }));
  const hasResults = stages.some((item) => item.record);
  const fallback = (stage: number) => stage === 1 ? { strengths: ["a와 그래프의 변화를 관찰했습니다."], improvements: ["a가 양수이면 그래프는 아래로 볼록이고, 음수이면 위로 볼록입니다."], nextQuestion: "|a|의 크기는 그래프의 폭에 어떤 영향을 줄까요?", hint: "a의 부호와 |a|를 최종 미션의 그래프와 연결해보세요." } : stage === 2 ? { strengths: ["a와 b의 변화를 꼭짓점과 연결하려고 했습니다."], improvements: ["대칭축 x = -b/(2a)와 꼭짓점의 관계를 확인해보세요."], nextQuestion: "b가 바뀌면 대칭축은 어떻게 이동할까요?", hint: "a와 b로 대칭축과 꼭짓점을 먼저 계산해보세요." } : { strengths: ["a, b, c와 그래프 특징을 종합적으로 살펴보았습니다."], improvements: ["x=0을 대입해 c와 y절편의 관계를 확인해보세요."], nextQuestion: "세 계수가 그래프에 미치는 영향을 한 문장으로 설명해볼까요?", hint: "방향, 폭, 꼭짓점, 대칭축, y절편을 모두 식과 대조해보세요." };
  return <div className="question-page exploration-feedback-page"><div className="section-intro"><span className="eyebrow">탐구 결과 종합 피드백</span><h2>세 단계 탐구를 함께 돌아봅시다.</h2><p>각 탐구에서 작성한 답변과 관찰 내용을 순서대로 확인해봅시다.</p></div>{!hasResults ? <div className="feedback-empty" role="status"><strong>아직 저장된 탐구 결과가 없습니다.</strong><p>탐구 답변을 작성하고 저장하면 단계별 피드백이 표시됩니다.</p></div> : <div className="feedback-card-list">{stages.map(({ stage, record, feedback: stageFeedback }) => { const safe = stageFeedback ?? fallback(stage); return <article className="feedback-card" key={stage}><span className="eyebrow">{stage}단계 탐구</span><h3>탐구 질문</h3><p>{record ? explorationPrompts[record.path].question : "아직 저장된 탐구 결과가 없습니다."}</p>{record && <><h3>학생의 서술형 답변</h3><p className="student-response">{record.responseText}</p><p className="coefficient-snapshot">현재 계수 · a={record.coefficientSnapshot.a}, b={record.coefficientSnapshot.b}, c={record.coefficientSnapshot.c}</p></>}<h3>잘한 점</h3><ul>{safe.strengths.map((item) => <li key={item}>{item}</li>)}</ul><h3>보완할 점</h3><ul>{safe.improvements.map((item) => <li key={item}>{item}</li>)}</ul><h3>다시 생각해볼 질문</h3><p>{safe.nextQuestion}</p><h3>최종 미션 힌트</h3><p>{safe.hint ?? "최종 미션 전에 핵심 개념을 다시 확인해보세요."}</p></article>; })}</div>}<section className="feedback-card feedback-summary"><h3>이번 탐구에서 발견한 점</h3><ul><li>a는 그래프의 볼록한 방향과 폭에 영향을 줍니다. a가 양수이면 그래프는 아래로 볼록이고, 음수이면 위로 볼록입니다.</li><li>b는 꼭짓점의 위치와 대칭축에 영향을 줍니다.</li><li>c는 y절편에 영향을 줍니다.</li><li>a, b, c와 방향, 폭, 꼭짓점, 대칭축, y절편을 연결한 점을 확인했습니다.</li><li>최종 미션 전에 |a|가 클수록 더 뾰족하고, 작을수록 더 넓어진다는 점을 다시 확인해보세요.</li></ul></section><button className="primary-button" onClick={onNext}>최종 미션 도전하기 <span>→</span></button></div>;
}

function LegacyExplorationFeedbackScreen({ records, feedback, onNext }: { records: ExplorationRecord[]; feedback: ExplorationFeedback | null; onNext: () => void }) {
  const latest = records[records.length - 1];
  if (!latest) return <div className="question-page exploration-feedback-page"><div className="section-intro"><span className="eyebrow">탐구 결과 피드백</span><h2>탐구 결과를 확인해보세요.</h2><p>아직 저장된 탐구 결과가 없습니다.</p></div><div className="feedback-empty" role="status"><strong>탐구 답변이 아직 없어요.</strong><p>탐구 답변을 작성하고 저장하면 학생 답변과 계수별 피드백이 여기에 표시됩니다.</p></div><button className="primary-button" onClick={onNext}>최종 미션 도전하기 <span>→</span></button></div>;
  const safeFeedback = feedback ?? { strengths: ["작성한 내용을 확인했습니다."], improvements: ["그래프의 특징과 계수의 관계를 다시 연결해보세요."], nextQuestion: "계수를 바꾸면 그래프의 어떤 특징이 달라졌나요?", hint: "식의 a, b, c를 그래프의 방향, 폭, 꼭짓점, 대칭축, y절편과 연결해보세요." };
  return <div className="question-page exploration-feedback-page"><div className="section-intro"><span className="eyebrow">탐구 결과 피드백</span><h2>탐구 결과를 돌아봅시다</h2><p>작성한 내용을 다시 읽고, 그래프에서 발견한 관계를 확인해보세요.</p></div><div className="feedback-card-list">{latest && <article className="feedback-card"><span className="eyebrow">{latest.path === "A" ? "첫 번째 탐구" : latest.path === "B" ? "두 번째 탐구" : "세 번째 탐구"}</span><h3>탐구 질문</h3><p>{explorationPrompts[latest.path].question}</p><h3>작성한 답변</h3><p className="student-response">{latest.responseText}</p><p className="coefficient-snapshot">현재 계수 · a={latest.coefficientSnapshot.a}, b={latest.coefficientSnapshot.b}, c={latest.coefficientSnapshot.c}</p><h3>잘 발견한 점</h3><ul>{safeFeedback.strengths.map((item) => <li key={item}>{item}</li>)}</ul><h3>보완할 점</h3><ul>{safeFeedback.improvements.map((item) => <li key={item}>{item}</li>)}</ul><h3>다시 생각해볼 질문</h3><p>{safeFeedback.nextQuestion}</p><h3>다음 미션을 위한 힌트</h3><p>{safeFeedback.hint}</p></article>}</div><button className="primary-button" onClick={onNext}>최종 미션 도전하기 <span>→</span></button></div>;
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

type GraphRange = { xmin: number; xmax: number; ymin: number; ymax: number };
let activeFinalGraphRange: GraphRange | null = null;

function calculateGraphRange(choices: GraphChoice[]): GraphRange {
  const xValues = choices.flatMap((choice) => [0, choice.vertex.x]);
  const xMin = Math.min(...xValues) - 2;
  const xMax = Math.max(...xValues) + 2;
  const sampleXValues = choices.flatMap((choice) => [0, choice.vertex.x - 2, choice.vertex.x, choice.vertex.x + 2]);
  const yValues = choices.flatMap((choice) => sampleXValues.map((x) => choice.a * x * x + choice.b * x + choice.c));
  const yMin = Math.min(0, ...yValues, ...choices.map((choice) => choice.vertex.y), ...choices.map((choice) => choice.yIntercept)) - 1;
  const yMax = Math.max(0, ...yValues, ...choices.map((choice) => choice.vertex.y), ...choices.map((choice) => choice.yIntercept)) + 1;
  const centerX = (xMin + xMax) / 2;
  const centerY = (yMin + yMax) / 2;
  const span = Math.max(8, Math.ceil(Math.max(xMax - xMin, yMax - yMin) / 2) * 2);
  return { xmin: centerX - span / 2, xmax: centerX + span / 2, ymin: centerY - span / 2, ymax: centerY + span / 2 };
}

function FunctionGraph({ choice, range = activeFinalGraphRange ?? calculateGraphRange([choice]) }: { choice: GraphChoice; range?: GraphRange }) {
  const plotLeft = 30;
  const plotTop = 12;
  const plotSize = 204;
  const domainMin = range.xmin;
  const domainMax = range.xmax;
  const gridValues = Array.from({ length: Math.round(domainMax - domainMin) + 1 }, (_, index) => domainMin + index);
  const labelValues = [-4, -2, 0, 2, 4];
  const visibleLabelValues = labelValues.filter((value) => value >= range.xmin && value <= range.xmax && value >= range.ymin && value <= range.ymax);
  const points = Array.from({ length: 121 }, (_, index) => range.xmin + index * ((range.xmax - range.xmin) / 120)).map((x) => [x, choice.a * x * x + choice.b * x + choice.c]);
  const toX = (x: number) => plotLeft + ((x - range.xmin) / (range.xmax - range.xmin)) * plotSize;
  const toY = (y: number) => plotTop + ((range.ymax - y) / (range.ymax - range.ymin)) * plotSize;
  const path = points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${toX(x).toFixed(1)},${toY(y).toFixed(1)}`).join(" ");
  const clipId = `function-graph-clip-${choice.id}`;
  return <svg className="function-graph" viewBox="0 0 240 240" role="img" aria-label={`${choice.formula} 그래프`}>
    <defs><clipPath id={clipId}><rect x={plotLeft} y={plotTop} width={plotSize} height={plotSize} /></clipPath></defs>
    {gridValues.map((value) => <line key={`vertical-${value}`} x1={toX(value)} y1={plotTop} x2={toX(value)} y2={plotTop + plotSize} className={value % 2 === 0 ? "function-grid major" : "function-grid"} />)}
    {gridValues.map((value) => <line key={`horizontal-${value}`} x1={plotLeft} y1={toY(value)} x2={plotLeft + plotSize} y2={toY(value)} className={value % 2 === 0 ? "function-grid major" : "function-grid"} />)}
    <line x1={plotLeft} y1={toY(0)} x2={plotLeft + plotSize} y2={toY(0)} className="function-axis" />
    <line x1={toX(0)} y1={plotTop} x2={toX(0)} y2={plotTop + plotSize} className="function-axis" />
    {visibleLabelValues.map((value) => <g key={`x-label-${value}`}><line x1={toX(value)} y1={toY(0) - 3} x2={toX(value)} y2={toY(0) + 3} className="function-tick" /><text x={toX(value)} y={toY(0) + 17} className="function-label" textAnchor="middle">{value}</text></g>)}
    {visibleLabelValues.map((value) => <g key={`y-label-${value}`}><line x1={toX(0) - 3} y1={toY(value)} x2={toX(0) + 3} y2={toY(value)} className="function-tick" /><text x={toX(0) - 8} y={toY(value) + 4} className="function-label" textAnchor="end">{value}</text></g>)}
    <g clipPath={`url(#${clipId})`}><path d={path} className="function-curve" /></g>
  </svg>;
}

function LegacyFunctionGraph({ choice }: { choice: GraphChoice }) {
  const points = Array.from({ length: 49 }, (_, index) => -6 + index * 0.25).map((x) => [x, choice.a * x * x + choice.b * x + choice.c]);
  const toX = (x: number) => 12 + ((x + 6) / 12) * 176;
  const toY = (y: number) => 92 - ((y + 12) / 24) * 80;
  const path = points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${toX(x).toFixed(1)},${toY(y).toFixed(1)}`).join(" ");
  return <svg className="function-graph" viewBox="0 0 200 104" role="img" aria-label={`${choice.formula} 그래프`}><line x1="12" y1={toY(0)} x2="188" y2={toY(0)} className="function-axis" /><line x1={toX(0)} y1="8" x2={toX(0)} y2="92" className="function-axis" /><path d={path} className="function-curve" /></svg>;
}

function FinalChallengeScreen({ question, selected, feedback, attempts, done, onSelect, onSubmit, onRetry }: { question: FinalChallengeQuestion; selected: string | null; feedback: string | null; attempts: number; done: boolean; onSelect: (choice: GraphChoice) => void; onSubmit: (choice: GraphChoice) => Promise<{ ok: boolean; message: string; error?: { message?: string; code?: string; details?: string; hint?: string }; attemptNumber?: number; feedback?: string }>; onRetry: () => void }) {
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const selectedChoice = question.graphChoices.find((choice) => choice.id === selected);
  activeFinalGraphRange = calculateGraphRange(question.graphChoices);
  question.graphChoices.sort((left, right) => Number(left.id.replace("choice-", "")) - Number(right.id.replace("choice-", "")));

  const submit = async () => {
    if (!selectedChoice || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    const result = await onSubmit(selectedChoice);
    if (!result.ok) setSubmitError(result.error?.message ?? result.message);
    setSubmitting(false);
  };

  return <div className="question-page"><div className="section-intro"><span className="eyebrow">03 · 최종 미션</span><h2>그래프의 특징을 연결해볼까요?</h2><p>다음 이차함수의 그래프에 해당하는 것을 고르시오.</p><div className="final-formula">{question.formula}</div></div><div className="final-choices">{question.graphChoices.map((choice) => <button type="button" key={choice.id} className={`final-choice ${selected === choice.id ? "selected" : ""} ${selected === choice.id && done ? "correct" : ""}`} disabled={submitting} onClick={() => { setSubmitError(null); onSelect(choice); }}><FunctionGraph choice={choice} /><strong>그래프 {choice.id.replace("choice-", "")}</strong></button>)}</div><button type="button" className="primary-button final-submit-button" disabled={!selectedChoice || submitting} onClick={() => void submit()}>{submitting ? "제출 중..." : "제출하기"} <span>→</span></button>{submitError && <div className="final-feedback error" role="alert">{submitError}</div>}{feedback && <div className={`final-feedback ${done ? "success" : "error"}`} role="status">{feedback}</div>}{feedback && !done && <button type="button" className="secondary-button retry-button" onClick={() => { setSubmitError(null); onRetry(); }}>다시 도전하기</button>}<small className="attempt-count final-attempt-count">시도 횟수: {attempts}회</small></div>;
}

function ChallengeScreen({ selected, feedback, attempts, done, onSelect, onRetry, onNext }: { selected: string | null; feedback: string | null; attempts: number; done: boolean; onSelect: (choice: GraphChoice) => void; onRetry: () => void; onNext: () => void }) {
  return (
    <div className="question-page"><div className="section-intro"><span className="eyebrow">03 · 최종 도전</span><h2>그래프의 특징을 연결해볼까요?</h2><p>다음 이차함수의 그래프에 해당하는 것을 고르시오.</p><div className="final-formula">{finalQuestion.formula}</div></div><div className="final-choices">{finalQuestion.graphChoices.map((choice) => <button type="button" key={choice.id} className={`final-choice ${selected === choice.id ? "selected" : ""} ${selected === choice.id && choice.isCorrect ? "correct" : ""}`} onClick={() => onSelect(choice)}><FunctionGraph choice={choice} /><strong>그래프 {choice.id.replace("choice-", "")}</strong></button>)}</div>{feedback && <div className={`final-feedback ${done ? "success" : "error"}`} role="status">{feedback}</div>}{feedback && !done && <button className="secondary-button retry-button" onClick={onRetry}>다시 도전하기</button>}<small className="attempt-count final-attempt-count">재도전 횟수: {attempts}회</small><button className="primary-button" disabled={!done} onClick={onNext}>최종 미션 완료 <span>→</span></button></div>
  );
}

function reviewPathLabel(path: PathId) {
  return path === "A" ? "1단계 탐구" : path === "B" ? "2단계 탐구" : "3단계 탐구";
}

function reviewFeedbackValue(feedback: Record<string, unknown> | null, key: string) {
  const value = feedback?.[key];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string").join(" ");
  return typeof value === "string" ? value : "저장된 피드백이 없습니다.";
}

function LearningReviewMenu({ records, onSelect }: { records: LearningRecords | null; onSelect: (section: Exclude<ReviewSection, "menu">) => void }) {
  const hasExploration = (path: PathId) => Boolean(records?.explorations.some((item) => item.path === path));
  const items: Array<{ section: Exclude<ReviewSection, "menu">; label: string; available: boolean }> = [
    { section: "diagnosis", label: "진단 결과 돌아보기", available: Boolean(records?.diagnosis.length) },
    { section: "exploration-A", label: "1단계 탐구 돌아보기", available: hasExploration("A") },
    { section: "exploration-B", label: "2단계 탐구 돌아보기", available: hasExploration("B") },
    { section: "exploration-C", label: "3단계 탐구 돌아보기", available: hasExploration("C") },
    { section: "final", label: "최종 미션 결과 보기", available: Boolean(records?.finalAttempts.length) },
  ];
  return <section className="learning-review-menu" aria-labelledby="learning-review-title"><h3 id="learning-review-title">학습 기록 돌아보기</h3><p>완료한 학습 기록을 읽기 전용으로 다시 확인할 수 있어요.</p><div className="learning-review-actions">{items.map((item) => <button type="button" className="secondary-button" key={item.section} disabled={!item.available} onClick={() => onSelect(item.section)}>{item.label}</button>)}</div></section>;
}

function LearningReviewScreen({ section, records, loading, error, questions, onBack, onSelect }: { section: Exclude<ReviewSection, "menu">; records: LearningRecords | null; loading: boolean; error: string | null; questions: DiagnosisQuestion[]; onBack: () => void; onSelect: (section: Exclude<ReviewSection, "menu">) => void }) {
  if (loading) return <div className="question-page"><div className="section-intro"><h2>학습 기록을 불러오는 중이에요.</h2></div></div>;
  if (error) return <div className="question-page"><div className="section-intro"><h2>학습 기록 돌아보기</h2><p>{error}</p></div><button type="button" className="secondary-button" onClick={onBack}>완료 화면으로 돌아가기</button></div>;
  if (!records) return <div className="question-page"><div className="feedback-empty" role="status">저장된 기록이 없습니다.</div><button type="button" className="secondary-button" onClick={onBack}>완료 화면으로 돌아가기</button></div>;

  if (section === "diagnosis") {
    return <div className="question-page learning-review-page"><div className="section-intro"><span className="eyebrow">읽기 전용 기록</span><h2>진단 결과 돌아보기</h2><p>진단 문항과 제출 기록을 다시 확인해보세요.</p></div>{records.diagnosis.length ? <div className="feedback-card-list">{records.diagnosis.map((record) => { const question = questions.find((item) => item.id === record.question_id); const selected = question?.choices.find((choice) => choice.id === record.answer)?.label ?? record.answer; return <article className="feedback-card" key={record.id}><h3>{question?.prompt ?? record.question_id}</h3><p><strong>학생이 선택한 답</strong><br />{selected}</p><p><strong>정답 여부</strong><br />{record.is_correct ? "정답" : "다시 확인할 내용이 있어요."}</p><p><strong>응답 시간</strong><br />{record.response_time_ms ?? 0}ms</p><p><strong>진단 기본 피드백</strong><br />{record.is_correct ? "핵심 개념을 잘 연결했습니다." : question ? diagnosisFeedbackCopy[question.questionType].guidance : "문항의 핵심 개념을 다시 확인해보세요."}</p></article>; })}</div> : <div className="feedback-empty">저장된 기록이 없습니다.</div>}<ReviewNavigation section={section} onBack={onBack} onSelect={onSelect} /></div>;
  }

  if (section.startsWith("exploration-")) {
    const path = section.endsWith("A") ? "A" : section.endsWith("B") ? "B" : "C" as PathId;
    const record = [...records.explorations].reverse().find((item) => item.path === path);
    const checkpoints = records.checkpoints.filter((item) => item.path === path);
    const snapshot = record?.coefficient_snapshot;
    const snapshotA = snapshot?.a ?? 0;
    return <div className="question-page learning-review-page"><div className="section-intro"><span className="eyebrow">읽기 전용 기록</span><h2>{reviewPathLabel(path)} 돌아보기</h2><p>저장된 탐구 답변과 피드백을 다시 확인해보세요.</p></div>{record ? <article className="feedback-card"><h3>탐구 질문</h3><p>{explorationPrompts[path].question}</p><h3>학생의 서술형 답변</h3><p className="student-response">{record.response_text || "작성된 답변이 없습니다."}</p><h3>답변 저장 당시의 계수</h3><p className="coefficient-snapshot">a = {snapshot?.a ?? "-"}, b = {snapshot?.b ?? "-"}, c = {snapshot?.c ?? "-"}</p><h3>그래프 요약</h3><p>{snapshot ? `a=${snapshot.a}일 때 ${snapshot.a > 0 ? "아래로 볼록" : "위로 볼록"}이며, b와 c에 따라 꼭짓점·대칭축·y절편이 결정됩니다.` : "저장된 그래프 요약이 없습니다."}</p><h3>Gemini 또는 기본 피드백</h3><p><strong>잘한 점</strong><br />{reviewFeedbackValue(record.ai_feedback, "strengths")}</p><p><strong>보완할 점</strong><br />{reviewFeedbackValue(record.ai_feedback, "improvements")}</p><p><strong>다시 생각해볼 질문</strong><br />{reviewFeedbackValue(record.ai_feedback, "nextQuestion")}</p><p><strong>피드백 상태</strong><br />{record.feedback_status ?? "fallback"}</p><h3>확인문제 결과</h3><p>{checkpoints.length ? `${checkpoints.length}개의 제출 기록, 총 ${Math.max(...checkpoints.map((item) => item.attempt_number), 0)}회차까지 기록되었습니다.` : "저장된 확인문제 기록이 없습니다."}</p></article> : <div className="feedback-empty">저장된 기록이 없습니다.</div>}<ReviewNavigation section={section} onBack={onBack} onSelect={onSelect} /></div>;
  }

  const finalRecord = [...records.finalAttempts].reverse().find((item) => item.is_correct) ?? records.finalAttempts[records.finalAttempts.length - 1];
  return <div className="question-page learning-review-page"><div className="section-intro"><span className="eyebrow">읽기 전용 기록</span><h2>최종 미션 결과 보기</h2><p>그래프를 다시 선택하거나 제출할 수 없는 결과 화면입니다.</p></div>{finalRecord ? <article className="feedback-card"><h3>최종 미션 함수식</h3><p className="final-formula">{finalRecord.question_formula}</p><h3>학생이 선택한 그래프</h3><p>{finalRecord.selected_formula || finalRecord.selected_choice_id}</p><h3>정답 여부</h3><p>{finalRecord.is_correct ? "정답" : "아직 정답 기록이 없습니다."}</p><h3>제출 당시의 피드백</h3><p>{finalRecord.feedback || "저장된 피드백이 없습니다."}</p><h3>전체 시도 횟수</h3><p>{Math.max(...records.finalAttempts.map((item) => item.attempt_number), 0)}회</p></article> : <div className="feedback-empty">저장된 기록이 없습니다.</div>}<ReviewNavigation section={section} onBack={onBack} onSelect={onSelect} /></div>;
}

function ReviewNavigation({ section, onBack, onSelect }: { section: Exclude<ReviewSection, "menu">; onBack: () => void; onSelect: (section: Exclude<ReviewSection, "menu">) => void }) {
  const items: Array<{ section: Exclude<ReviewSection, "menu">; label: string }> = [{ section: "diagnosis", label: "진단 결과" }, { section: "exploration-A", label: "1단계 탐구" }, { section: "exploration-B", label: "2단계 탐구" }, { section: "exploration-C", label: "3단계 탐구" }, { section: "final", label: "최종 미션" }];
  return <div className="learning-review-navigation"><div>{items.filter((item) => item.section !== section).map((item) => <button type="button" className="text-button" key={item.section} onClick={() => onSelect(item.section)}>{item.label} 돌아보기</button>)}</div><button type="button" className="primary-button" onClick={onBack}>완료 화면으로 돌아가기</button></div>;
}

function CompleteScreen({ studentCode, completedAt, onRestart }: { studentCode: string; completedAt: string; onRestart: () => void }) {
  const [section, setSection] = useState<ReviewSection>("menu");
  const [records, setRecords] = useState<LearningRecords | null>(null);
  const [error, setError] = useState<string | null>(null);
  const questions = useMemo(() => createDiagnosisQuestions(studentCode, currentLearningSessionId), [studentCode]);
  useEffect(() => {
    if (records || !currentLearningSessionId) return;
    setError(null);
    void loadLearningRecords(currentLearningSessionId).then((result) => {
      if (result.ok && result.records) setRecords(result.records);
      else setError(result.message);
    });
  }, [records, section]);
  if (section !== "menu") return <LearningReviewScreen section={section} records={records} loading={!records && !error} error={error} questions={questions} onBack={() => setSection("menu")} onSelect={setSection} />;
  const formattedCompletedAt = completedAt ? new Date(completedAt).toLocaleString("ko-KR") : "";
  return <div className="complete-page"><div className="complete-icon">✓</div><span className="eyebrow">GRAPH LEADER</span><h2>그래프 리더 미션<br /><em>완료했습니다.</em></h2><p>함수의 계수를 살펴보고 그래프의 변화를 직접 탐구했습니다.</p><div className="result-card"><div><span>학생 코드</span><strong>{studentCode}</strong></div><div><span>완료 시각</span><strong>{formattedCompletedAt}</strong></div></div><LearningReviewMenu records={records} onSelect={setSection} /><button className="secondary-button" onClick={onRestart}>처음부터 다시 해보기</button></div>;
  }
  /*
  return <div className="complete-page"><div className="confetti">?╉?㎯??/div><div className="complete-icon">??/div><span className="eyebrow">GRAPH LEADER</span><h2>洹몃옒??由щ뜑 誘몄뀡??br /><em>?꾨즺?덉뒿?덈떎.</em></h2><p>?⑥닔?앹쓽 怨꾩닔瑜??쎄퀬,<br />洹몃옒?꾩쓽 蹂?붾? 吏곸젒 ?대걣?대깉?듬땲??</p><div className="result-card"><div><span>?숈뒿 肄붾뱶</span><strong>{studentCode}</strong></div><div><span>?꾨즺 ?쒓컖</span><strong>{formattedCompletedAt}</strong></div></div><p className="completion-message">?숈뒿 肄붾뱶 {studentCode}??誘몄뀡???꾨즺?섏뿀?듬땲??</p><LearningReviewMenu records={records} onSelect={setSection} /><button className="secondary-button" onClick={onRestart}>泥섏쓬遺???ㅼ떆 ?대낫湲?/button></div>;
}

*/
/* function LegacyCompleteScreen({ studentCode, completedAt, onRestart }: { studentCode: string; completedAt: string; onRestart: () => void }) {
  const formattedCompletedAt = completedAt ? new Date(completedAt).toLocaleString("ko-KR") : "";
  return <div className="complete-page"><div className="confetti">✦　✧　✦</div><div className="complete-icon">✓</div><span className="eyebrow">GRAPH LEADER</span><h2>그래프 리더 미션을<br /><em>완료했습니다.</em></h2><p>함수식의 계수를 읽고,<br />그래프의 변화를 직접 이끌어냈습니다.</p><div className="result-card"><div><span>학습 코드</span><strong>{studentCode}</strong></div><div><span>완료 시각</span><strong>{formattedCompletedAt}</strong></div></div><p className="completion-message">학습 코드 {studentCode}의 미션이 완료되었습니다.</p><button className="secondary-button" onClick={onRestart}>처음부터 다시 해보기</button></div>;
}
*/
