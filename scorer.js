// scorer.js: Final Psychometric Engine with Holistic Stack Scoring

import { itemParameters } from './itemParameterMatrix.js';

// --- Static Data & Type Stacks ---
const TYPE_FUNCTION_STACKS = {
    'INTP': ['Ti', 'Ne', 'Si', 'Fe'], 'ENTP': ['Ne', 'Ti', 'Fe', 'Si'],
    'ISTP': ['Ti', 'Se', 'Ni', 'Fe'], 'ESTP': ['Se', 'Ti', 'Fe', 'Ni'],
    'INFJ': ['Ni', 'Fe', 'Ti', 'Se'], 'ENFJ': ['Fe', 'Ni', 'Se', 'Ti'],
    'INTJ': ['Ni', 'Te', 'Fi', 'Se'], 'ENTJ': ['Te', 'Ni', 'Se', 'Fi'],
    'ISFP': ['Fi', 'Se', 'Ni', 'Te'], 'ESFP': ['Se', 'Fi', 'Te', 'Ni'],
    'INFP': ['Fi', 'Ne', 'Si', 'Te'], 'ENFP': ['Ne', 'Fi', 'Te', 'Si'],
    'ISTJ': ['Si', 'Te', 'Fi', 'Ne'], 'ESTJ': ['Te', 'Si', 'Ne', 'Fi'],
    'ISFJ': ['Si', 'Fe', 'Ti', 'Ne'], 'ESFJ': ['Fe', 'Si', 'Ne', 'Ti']
};

const DICHOTOMY_CONFIG = {
    'E-I': { poles: ['E', 'I'], tieBreaker: 'I' },
    'S-N': { poles: ['S', 'N'], tieBreaker: 'N' },
    'T-F': { poles: ['T', 'F'], tieBreaker: 'F' }
};

// --- Weighting Parameters ---
// These weights determine the influence of each data source on the final score.
const IRT_CLARITY_WEIGHT = { 'Slight': 2.0, 'Moderate': 4.0, 'Clear': 6.0, 'Very Clear': 8.0 };
const ATTITUDE_SCORE_WEIGHT = 1.0;
const ATTITUDE_STACK_POSITION_WEIGHT = { dom: 4, aux: 3, ter: 1.5, inf: 1 };


// --- Pre-computation and Helper Functions (Largely Unchanged) ---
const dichotomyToQuestionMap = new Map();
for (const [index, params] of Object.entries(itemParameters)) {
    const dichotomyName = params.dichotomy;
    if (DICHOTOMY_CONFIG[dichotomyName]) {
        if (!dichotomyToQuestionMap.has(dichotomyName)) {
            dichotomyToQuestionMap.set(dichotomyName, []);
        }
        dichotomyToQuestionMap.get(dichotomyName).push(parseInt(index, 10));
    }
}
function probability(theta, a, b) { return 1 / (1 + Math.exp(-a * (theta - b))); }
function getPccCategory(pci) {
    if (pci >= 26) return "Very Clear"; if (pci >= 16) return "Clear"; if (pci >= 6) return "Moderate"; return "Slight";
}
function findBestThetaForDichotomy(dichotomyName, answers, allQuestions) {
    const allDichotomyIndices = dichotomyToQuestionMap.get(dichotomyName) || [];
    const answeredQuestionIndices = allDichotomyIndices.filter(qIndex => answers[qIndex + 1]);
    if (answeredQuestionIndices.length === 0) return 0;
    const items = answeredQuestionIndices.map(qIndex => {
        const params = itemParameters[qIndex];
        const answer = answers[qIndex + 1];
        const questionData = allQuestions.find(q => q.number === (qIndex + 1));
        const userScoreKey = questionData.options[answer.choice].scoreKey;
        return { a: params.params.a, b: params.params.b, u: userScoreKey };
    });
    let theta = 0.0;
    for (let iter = 0; iter < 20; iter++) {
        let firstDerivative = 0.0, secondDerivative = 0.0;
        for (const item of items) {
            const { a, b, u } = item; const P = probability(theta, a, b);
            firstDerivative += a * (u - P); secondDerivative += -a * a * (1 - P) * P;
        }
        if (Math.abs(secondDerivative) < 1e-9) break;
        const newTheta = theta - (firstDerivative / secondDerivative);
        const clampedTheta = Math.max(-3, Math.min(3, newTheta));
        if (Math.abs(clampedTheta - theta) < 0.0001) { theta = clampedTheta; break; }
        theta = clampedTheta;
    }
    return theta;
}


// --- THE FINAL HOLISTIC SCORING ENGINE ---

/**
 * [PUBLIC] Main scoring function with the new Holistic Stack Scoring logic.
 */
export function calculateHybridResults(mbtiAnswers, attitudeAnswers, allMbtiQuestions, allAttitudeQuestions) {

    // --- Step 1: Calculate Core Dichotomy Strengths (IRT) ---
    const coreResults = {};
    for (const [dichotomy, config] of Object.entries(DICHOTOMY_CONFIG)) {
        const theta = findBestThetaForDichotomy(dichotomy, mbtiAnswers, allMbtiQuestions);
        const pci = theta === 0 ? 1 : Math.max(1, Math.round((Math.abs(theta) / 3.0) * 30));
        coreResults[dichotomy] = { pcc: getPccCategory(pci), theta };
    }
    const { 'E-I': eiResult, 'S-N': snResult, 'T-F': tfResult } = coreResults;

    // --- Step 2: Calculate Raw Attitude Strengths from Likert Scales ---
    const attitudeStrengths = { Ti: 0, Te: 0, Fi: 0, Fe: 0, Si: 0, Se: 0, Ni: 0, Ne: 0 };
    const likertWeights = { 1: 2, 2: 1, 3: 0, 4: -1, 5: -2 };
    allAttitudeQuestions.forEach(q => {
        const answer = attitudeAnswers[q.id];
        if (answer && answer.choice) {
            const score = likertWeights[answer.choice];
            if (score > 0) attitudeStrengths[q.construct1.pole] += score;
            else if (score < 0) attitudeStrengths[q.construct2.pole] += Math.abs(score);
        }
    });

    // --- Step 3: Holistic Scoring of All 16 Valid Stacks ---
    // This is the new core logic. It evaluates each of the 16 valid types
    // against the user's total evidence to find the best overall fit.
    let bestFitType = null;
    let maxScore = -Infinity;
    const typeScores = {}; // For debugging

    for (const [type, stack] of Object.entries(TYPE_FUNCTION_STACKS)) {
        let currentScore = 0;
        const [dom, aux, ter, inf] = stack;

        // Part A: Score based on match with core IRT dichotomies.
        // The IRT theta score is the primary driver, weighted by its clarity.
        const eiMatch = type.startsWith('E') ? eiResult.theta : -eiResult.theta;
        const snMatch = type.includes('S') ? snResult.theta : -snResult.theta;
        const tfMatch = type.includes('T') ? tfResult.theta : -tfResult.theta;

        currentScore += eiMatch * IRT_CLARITY_WEIGHT[eiResult.pcc];
        currentScore += snMatch * IRT_CLARITY_WEIGHT[snResult.pcc];
        currentScore += tfMatch * IRT_CLARITY_WEIGHT[tfResult.pcc];

        // Part B: Score based on alignment with attitude strengths, weighted by stack position.
        const attitudeScore =
            (attitudeStrengths[dom] * ATTITUDE_STACK_POSITION_WEIGHT.dom) +
            (attitudeStrengths[aux] * ATTITUDE_STACK_POSITION_WEIGHT.aux) +
            (attitudeStrengths[ter] * ATTITUDE_STACK_POSITION_WEIGHT.ter) +
            (attitudeStrengths[inf] * ATTITUDE_STACK_POSITION_WEIGHT.inf);

        currentScore += attitudeScore * ATTITUDE_SCORE_WEIGHT;

        typeScores[type] = currentScore; // Store score for debugging
        if (currentScore > maxScore) {
            maxScore = currentScore;
            bestFitType = type;
        }
    }

    // --- Step 4: Finalize and Generate Rationale ---
    const finalStack = TYPE_FUNCTION_STACKS[bestFitType];
    const rationale = `
        Core IRT Theta: E/I=${eiResult.theta.toFixed(2)}(${eiResult.pcc}), S/N=${snResult.theta.toFixed(2)}(${snResult.pcc}), T/F=${tfResult.theta.toFixed(2)}(${tfResult.pcc}).
        After evaluating all 16 valid types, the model identified ${bestFitType} as the best overall fit with a final score of ${maxScore.toFixed(2)}.
    `.trim().replace(/\s+/g, ' ');

    return {
        finalType: bestFitType,
        dominant: finalStack[0],
        auxiliary: finalStack[1],
        tertiary: finalStack[2],
        inferior: finalStack[3],
        score: maxScore,
        rationale: rationale,
        allTypeScores: typeScores // For advanced debugging
    };
}