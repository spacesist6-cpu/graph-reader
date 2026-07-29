export type DiagnosisChoice = { id: string; label: string };

export type DiagnosisQuestion = {
  id: string;
  questionType: "direction" | "width" | "axis" | "intercept" | "relationship";
  prompt: string;
  choices: DiagnosisChoice[];
  correct: string;
  explanation: string;
  parameters: Record<string, number>;
  variantSeed: number;
  version: string;
};

export function createDiagnosisVariantSeed(studentCode: string, sessionId: string, questionId: string) {
  let hash = 2166136261;
  for (const character of `${studentCode}:${sessionId}:${questionId}`) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return hash >>> 0;
}

function choose(seed: number, values: number[]) { return values[seed % values.length]; }
function numberText(value: number) { return Number.isInteger(value) ? String(value) : value.toFixed(1); }
function formula(a: number, b: number, c: number) { return `y = ${a === 1 ? "" : a === -1 ? "-" : a}x² ${b < 0 ? `- ${Math.abs(b)}x` : `+ ${b}x`} ${c < 0 ? `- ${Math.abs(c)}` : `+ ${c}`}`; }
function vertex(a: number, b: number, c: number) { const x = -b / (2 * a); return { x, y: c - (b * b) / (4 * a) }; }

export function createDiagnosisQuestions(studentCode: string, sessionId: string): DiagnosisQuestion[] {
  const seed = (id: string) => createDiagnosisVariantSeed(studentCode, sessionId, id);
  const version = "diagnosis-v2";
  const directionSeed = seed("direction");
  const widthSeed = seed("width");
  const axisSeed = seed("axis");
  const interceptSeed = seed("intercept");
  const relationshipSeed = seed("relationship");

  const directionA = directionSeed % 2 === 0 ? choose(directionSeed, [2, 3]) : -choose(directionSeed, [2, 3]);
  const directionIsPositive = directionA > 0;
  const widthA = choose(widthSeed, [2, 3, 4]);
  const axis = choose(axisSeed, [1, 2, 3]);
  const axisB = -4 * axis;
  const interceptC = choose(interceptSeed, [-4, -2, 3, 5, 7]);
  const relationshipA = choose(relationshipSeed, [2, 3, -2]);
  const relationshipAxis = choose(relationshipSeed >>> 3, [1, 2]);
  const relationshipB = -2 * relationshipA * relationshipAxis;
  const relationshipC = choose(relationshipSeed >>> 5, [-2, 1, 4]);
  const relationshipVertex = vertex(relationshipA, relationshipB, relationshipC);
  const relationshipDirection = relationshipA > 0 ? "아래로 볼록" : "위로 볼록";
  const oppositeDirection = relationshipA > 0 ? "위로 볼록" : "아래로 볼록";
  const relationshipCorrect = `${relationshipDirection}, |a|=${Math.abs(relationshipA)}라서 ${Math.abs(relationshipA) > 1 ? "더 좁고 뾰족하며" : "기준 폭이고"} 꼭짓점 (${numberText(relationshipVertex.x)}, ${numberText(relationshipVertex.y)}), y절편 ${relationshipC}`;

  return [
    { id: "direction", questionType: "direction", prompt: `a = ${directionA}인 이차함수 그래프는 어떻게 볼록한가요?`, choices: [{ id: "up", label: "위로 볼록" }, { id: "down", label: "아래로 볼록" }, { id: "line", label: "직선이 됨" }], correct: directionIsPositive ? "down" : "up", explanation: directionIsPositive ? "a가 양수이면 그래프는 아래로 볼록입니다." : "a가 음수이면 그래프는 위로 볼록입니다.", parameters: { a: directionA }, variantSeed: directionSeed, version },
    { id: "width", questionType: "width", prompt: `y = ${widthA}x² 그래프는 y = x²와 비교해 폭이 어떻게 다른가요?`, choices: [{ id: "wide", label: "더 넓게 보임" }, { id: "same", label: "같은 폭으로 보임" }, { id: "narrow", label: "더 좁게 보임" }], correct: "narrow", explanation: `|a| = ${widthA}는 1보다 크므로 그래프가 더 좁고 뾰족합니다.`, parameters: { a: widthA, baselineA: 1 }, variantSeed: widthSeed, version },
    { id: "axis", questionType: "axis", prompt: `${formula(2, axisB, 1)}의 대칭축은 무엇인가요?`, choices: [{ id: `axis-${axis - 1}`, label: `x = ${axis - 1}` }, { id: `axis-${axis}`, label: `x = ${axis}` }, { id: `axis-${axis + 1}`, label: `x = ${axis + 1}` }], correct: `axis-${axis}`, explanation: `대칭축은 x = -b/(2a) = ${axis}입니다.`, parameters: { a: 2, b: axisB, c: 1, axis }, variantSeed: axisSeed, version },
    { id: "intercept", questionType: "intercept", prompt: `${formula(2, -3, interceptC)}의 y절편은 무엇인가요?`, choices: [{ id: `c-${interceptC - 2}`, label: String(interceptC - 2) }, { id: `c-${interceptC}`, label: String(interceptC) }, { id: `c-${interceptC + 2}`, label: String(interceptC + 2) }], correct: `c-${interceptC}`, explanation: `x = 0을 대입하면 y = c = ${interceptC}이므로 y절편은 ${interceptC}입니다.`, parameters: { a: 2, b: -3, c: interceptC, yIntercept: interceptC }, variantSeed: interceptSeed, version },
    { id: "relationship", questionType: "relationship", prompt: `${formula(relationshipA, relationshipB, relationshipC)}에서 a, b, c와 그래프 특징의 종합 관계로 알맞은 것은 무엇인가요?`, choices: [{ id: "correct", label: relationshipCorrect }, { id: "wrong-direction", label: `${oppositeDirection}, 꼭짓점은 (${numberText(relationshipVertex.x)}, ${numberText(relationshipVertex.y)})` }, { id: "wrong-intercept", label: `${relationshipDirection}, y절편은 ${relationshipC + 2}` }], correct: "correct", explanation: `a는 ${relationshipDirection}과 폭, b는 꼭짓점과 대칭축, c는 y절편을 결정합니다.`, parameters: { a: relationshipA, b: relationshipB, c: relationshipC, vertexX: relationshipVertex.x, vertexY: relationshipVertex.y, axis: relationshipVertex.x, yIntercept: relationshipC }, variantSeed: relationshipSeed, version },
  ];
}
