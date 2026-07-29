export type FinalGraphChoice = {
  id: string;
  formula: string;
  a: number;
  b: number;
  c: number;
  vertex: { x: number; y: number };
  axis: string;
  yIntercept: number;
  isCorrect: boolean;
  errorType?: "direction" | "width" | "vertex" | "yIntercept";
};

export type FinalChallengeQuestion = {
  id: string;
  version: string;
  variantSeed: number;
  formula: string;
  coefficients: { a: number; b: number; c: number };
  vertex: { x: number; y: number };
  axis: string;
  yIntercept: number;
  correctChoiceId: string;
  explanation: string;
  graphChoices: FinalGraphChoice[];
};

export function createFinalChallengeVariantSeed(studentCode: string, sessionId: string, questionId: string) {
  let hash = 2166136261;
  for (const character of `${studentCode}:${sessionId}:${questionId}`) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return hash >>> 0;
}

function choose<T>(seed: number, values: T[]) { return values[seed % values.length]; }
function numberText(value: number) { return Number.isInteger(value) ? String(value) : value.toFixed(1); }
function formula(a: number, b: number, c: number) {
  const aText = a === 1 ? "" : a === -1 ? "-" : String(a);
  const bText = b < 0 ? `- ${Math.abs(b)}x` : `+ ${b}x`;
  const cText = c < 0 ? `- ${Math.abs(c)}` : `+ ${c}`;
  return `y = ${aText}x² ${bText} ${cText}`;
}
function vertex(a: number, b: number, c: number) { return { x: -b / (2 * a), y: c - (b * b) / (4 * a) }; }

export function createFinalChallengeQuestion(studentCode: string, sessionId: string, questionId = "final-001"): FinalChallengeQuestion {
  const variantSeed = createFinalChallengeVariantSeed(studentCode, sessionId, questionId);
  const a = choose(variantSeed, [2, 3, -2, -3]);
  const axisX = choose(variantSeed >>> 3, [-2, -1, 1, 2]);
  const c = choose(variantSeed >>> 6, [-3, -1, 1, 3]);
  const b = -2 * a * axisX;
  const correctVertex = vertex(a, b, c);
  const widthA = a > 0 ? 1 : -1;
  const vertexB = b + 2 * a;
  const wrongIntercept = c + 2;
  const wrongChoices = variantSeed % 2 === 0
    ? [
        { a: -a, b: -b, c, errorType: "direction" as const },
        { a: widthA, b: -2 * widthA * axisX, c, errorType: "width" as const },
        { a, b: vertexB, c, errorType: "vertex" as const },
      ]
    : [
        { a, b, c: wrongIntercept, errorType: "yIntercept" as const },
        { a: widthA, b: -2 * widthA * axisX, c, errorType: "width" as const },
        { a, b: vertexB, c, errorType: "vertex" as const },
      ];
  const choices = [
    ...wrongChoices.map((choice, index) => {
      const choiceVertex = vertex(choice.a, choice.b, choice.c);
      return {
        id: `choice-${index + 1}`,
        formula: formula(choice.a, choice.b, choice.c),
        a: choice.a,
        b: choice.b,
        c: choice.c,
        vertex: choiceVertex,
        axis: `x = ${numberText(choiceVertex.x)}`,
        yIntercept: choice.c,
        isCorrect: false,
        errorType: choice.errorType,
      } satisfies FinalGraphChoice;
    }),
    {
      id: "choice-4",
      formula: formula(a, b, c),
      a,
      b,
      c,
      vertex: correctVertex,
      axis: `x = ${numberText(axisX)}`,
      yIntercept: c,
      isCorrect: true,
    } satisfies FinalGraphChoice,
  ];
  const correctFirst = (variantSeed >>> 9) % choices.length;
  const graphChoices = choices.map((choice, index) => ({ ...choice, id: `choice-${((index + correctFirst) % choices.length) + 1}` }));
  const correctChoice = graphChoices.find((choice) => choice.isCorrect)!;

  return {
    id: questionId,
    version: "final-challenge-v2",
    variantSeed,
    formula: formula(a, b, c),
    coefficients: { a, b, c },
    vertex: correctVertex,
    axis: `x = ${numberText(axisX)}`,
    yIntercept: c,
    correctChoiceId: correctChoice.id,
    explanation: `a=${a}이므로 그래프는 ${a > 0 ? "아래로 볼록" : "위로 볼록"}이고, |a|=${Math.abs(a)}이므로 폭을 결정합니다. 꼭짓점은 (${numberText(correctVertex.x)}, ${numberText(correctVertex.y)}), 대칭축은 x=${numberText(axisX)}, y절편은 ${c}입니다.`,
    graphChoices,
  };
}
