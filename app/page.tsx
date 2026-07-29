"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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
          window.setTimeout(() => {
            api.setPerspective?.("G");
            api.evalCommand('SetPerspective("G")');
            api.showAlgebraInput?.(false);
            api.showToolBar?.(false);
            api.showMenuBar?.(false);
            api.showResetIcon?.(false);
          }, 250);
          api.setCoordSystem?.(-5, 5, -2, 8);
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
  const [diagnosis, setDiagnosis] = useState<string | null>(null);
  const [selectedGraph, setSelectedGraph] = useState("B");
  const [challengeAnswer, setChallengeAnswer] = useState<string | null>(null);
  const [challengeDone, setChallengeDone] = useState(false);

  const progress = useMemo(
    () => ({ start: 0, diagnosis: 25, explore: 50, challenge: 75, complete: 100 })[step],
    [step],
  );

  const goNext = () => {
    if (step === "start") setStep("diagnosis");
    else if (step === "diagnosis") setStep("explore");
    else if (step === "explore") setStep("challenge");
    else if (step === "challenge" && challengeDone) setStep("complete");
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">f</span><span>함수의 감각</span></div>
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
        {step === "start" && <StartScreen onNext={goNext} />}
        {step === "diagnosis" && <DiagnosisScreen value={diagnosis} onSelect={setDiagnosis} onNext={goNext} />}
        {step === "explore" && <ExploreScreen selected={selectedGraph} onSelect={setSelectedGraph} onNext={goNext} />}
        {step === "challenge" && <ChallengeScreen answer={challengeAnswer} onAnswer={setChallengeAnswer} done={challengeDone} setDone={setChallengeDone} onNext={goNext} />}
        {step === "complete" && <CompleteScreen onRestart={() => { setStep("start"); setDiagnosis(null); setChallengeDone(false); setChallengeAnswer(null); }} />}
      </section>

      <footer>학습 기록은 현재 이 브라우저에서만 임시로 유지됩니다 · 저장 기능은 다음 단계에서 연결할 예정이에요.</footer>
    </main>
  );
}

function StartScreen({ onNext }: { onNext: () => void }) {
  return (
    <div className="hero-grid">
      <div className="hero-copy">
        <span className="eyebrow">오늘의 맞춤 미션 · 10분</span>
        <h1>이차함수 그래프,<br /><em>감으로 먼저</em> 이해해볼까요?</h1>
        <p>공식부터 외우지 않아도 괜찮아요. 그래프의 움직임을 직접 비교하며 나만의 감각을 만들어봅니다.</p>
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

function DiagnosisScreen({ value, onSelect, onNext }: { value: string | null; onSelect: (v: string) => void; onNext: () => void }) {
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

function ExploreScreen({ selected, onSelect, onNext }: { selected: string; onSelect: (v: string) => void; onNext: () => void }) {
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

function ChallengeScreen({ answer, onAnswer, done, setDone, onNext }: { answer: string | null; onAnswer: (v: string) => void; done: boolean; setDone: (v: boolean) => void; onNext: () => void }) {
  return (
    <div className="question-page"><div className="section-intro"><span className="eyebrow">03 · 최종 도전</span><h2>마지막으로, 감각을 확인해볼까요?</h2><p>그래프 <b>y = (x - 3)² + 2</b>의 꼭짓점은 어디일까요?</p></div><div className="challenge-card"><div className="challenge-visual"><span>최종 도전</span><strong>y = (x - 3)² + 2</strong><small>꼭짓점의 이동을 생각해보세요</small></div><div className="answer-area"><div className="answer-grid">{["(0, 0)", "(3, 2)", "(-3, 2)"].map((item) => <button key={item} className={`answer ${answer === item ? "selected" : ""}`} onClick={() => { onAnswer(item); setDone(item === "(3, 2)"); }}>{item}</button>)}</div>{answer && <p className={done ? "feedback success" : "feedback error"}>{done ? "정확해요! x가 3만큼, y가 2만큼 이동했어요." : "거의 다 왔어요. (x - 3), +2를 다시 살펴보세요."}</p>}</div></div><button className="primary-button" disabled={!done} onClick={onNext}>결과 확인하기 <span>→</span></button></div>
  );
}

function CompleteScreen({ onRestart }: { onRestart: () => void }) {
  return <div className="complete-page"><div className="confetti">✦　✧　✦</div><div className="complete-icon">✓</div><span className="eyebrow">MISSION COMPLETE</span><h2>오늘의 그래프 감각,<br /><em>완성했어요!</em></h2><p>꼭짓점의 이동을 직접 비교하고, 마지막 도전까지 통과했어요.<br />짧지만 확실한 한 걸음입니다.</p><div className="result-card"><div><span>완료한 미션</span><strong>이차함수 그래프 감각</strong></div><div><span>획득한 배지</span><strong>첫 그래프 탐험가 🏅</strong></div></div><button className="secondary-button" onClick={onRestart}>처음부터 다시 해보기</button></div>;
}
