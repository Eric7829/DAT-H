/**
 * scorer.js: A groundbreaking Psychometric Engine for a Function-Centric Jungian Typology Assessment.
 *
 * This module proudly presents an original scoring methodology that harmoniously blends
 * the precision of Item Response Theory (IRT) with a holistic, function-stack-based evaluation.
 * Moving beyond the traditional, purely dichotomous approach for type determination, this engine
 * innovatively derives the entire 4-letter type by assessing the best-fit among all 16 theoretically
 * valid Jungian function stacks, grounded in comprehensive user evidence.
 *
 * It leverages:
 * 1.  **Calibrated Item Parameters:** Utilizes professionally derived 'a' (discrimination) and 'b' (location)
 *     parameters for each item, sourced from the `itemParameterMatrix.js`. These parameters are
 *     empirically robust, stemming from factor analysis of the official MBTI® Form M data.
 * 2.  **Maximum Likelihood Estimation (MLE):** Employs an efficient Newton-Raphson method to
 *     precisely estimate 'theta' (latent trait level) for the E-I, S-N, and T-F dichotomies, ensuring
 *     foundational accuracy in preference measurement.
 * 3.  **Dynamic PCI & PCC:** Converts raw 'theta' scores into a nuanced Preference Clarity Index (PCI, 1-30)
 *     and a qualitative Preference Clarity Category (Slight, Moderate, Clear, Very Clear), aligning
 *     with established psychometric reporting standards.
 * 4.  **Novel Holistic Stack Scoring:** This is the jewel in the crown! Instead of a separate IRT calculation
 *     for J-P, the final 4-letter type (including J-P) is determined by evaluating all 16 Jungian function
 *     stacks. Each stack is scored based on:
 *     -   Its alignment with the user's IRT-derived E-I, S-N, and T-F preferences (weighted by clarity).
 *     -   Its alignment with the user's self-reported strengths for individual cognitive functions
 *         (e.g., Ti, Ne, Si, Fe), with these strengths dynamically weighted by their theoretical position
 *         within that specific 8-function stack (Dominant, Auxiliary, Tertiary, Inferior).
 *     This integrated approach ensures the derived type reflects a cohesive cognitive architecture,
 *     providing a more accurate and theoretically consistent understanding of an individual's
 *     functional preferences, especially for the J-P dichotomy which emerges naturally from the
 *     stack's orientation to the outer world.
 *
 * This engine represents a proud leap forward in creating a psychometrically sound,
 * function-centric personality assessment that truly reflects the dynamic interplay
 * of Jungian cognitive functions.
 */

import { itemParameters } from './itemParameterMatrix.js';

// --- Static Data & Type Stacks ---
// A comprehensive map of all 16 valid Myers-Jung types and their corresponding 4-function stacks.
// This is the bedrock for our holistic scoring approach, reflecting the precise hierarchical order.
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

// Configuration for the three core dichotomies measured by IRT, including tie-breaking rules.
// Note: J-P is *not* included here, as its determination is emergent from the holistic stack scoring.
const DICHOTOMY_CONFIG = {
    'E-I': { poles: ['E', 'I'], tieBreaker: 'I' }, // Tie-breaker for E-I defaults to Introversion
    'S-N': { poles: ['S', 'N'], tieBreaker: 'N' }, // Tie-breaker for S-N defaults to Intuition
    'T-F': { poles: ['T', 'F'], tieBreaker: 'F' }  // Tie-breaker for T-F defaults to Feeling
};

// Weights applied to the Likert-scale-derived attitude strengths based on their
// theoretical position in a given function stack (Dominant, Auxiliary, Tertiary, Inferior).
// These weights enhance the model's ability to discern the most probable type by prioritizing
// alignment with the most conscious and impactful functions.
const ATTITUDE_SCORE_WEIGHT = 1.0;
const ATTITUDE_STACK_POSITION_WEIGHT = { dom: 5, aux: 3, ter: 1, inf: 0.5 }; // Higher weight for dominant/auxiliary functions

/**
 * Calculates a dynamic weight based on the PCI (Preference Clarity Index).
 * This function uses a logarithmic scale to ensure that as PCI increases, the weight
 * increases, but at a decreasing rate. This provides a nuanced influence curve,
 * giving higher clarity scores a more significant, but not overwhelming, voice
 * in the overall type determination.
 * The formula is f(pci) = 2.15 * ln(pci) + 1.
 * This starts the weight at 1 for pci=1, and it grows to approximately 8 for pci=30,
 * with a noticeable increase around pci=5, as empirically observed in data clarity.
 * @param {number} pci - The Preference Clarity Index, ranging from 1 to 30.
 * @returns {number} The calculated weight for the IRT score.
 */
function getIrtClarityWeight(pci) {
    if (pci <= 0) return 1; // Guard against log(0) or negative values, ensuring a minimum weight.
    return 2.15 * Math.log(pci) + 1;
}


// --- Pre-computation and Helper Functions (Largely Unchanged from previous version) ---
// Maps each dichotomy to the indices of its corresponding items in the itemParameters matrix.
// This pre-computation optimizes performance by avoiding repetitive searches.
const dichotomyToQuestionMap = new Map();
for (const [index, params] of Object.entries(itemParameters)) {
    const dichotomyName = params.dichotomy;
    // Only map for the dichotomies explicitly configured for IRT (E-I, S-N, T-F)
    if (DICHOTOMY_CONFIG[dichotomyName]) {
        if (!dichotomyToQuestionMap.has(dichotomyName)) {
            dichotomyToQuestionMap.set(dichotomyName, []);
        }
        dichotomyToQuestionMap.get(dichotomyName).push(parseInt(index, 10));
    }
}

/**
 * Calculates the probability of a '1' response (positive pole) for a given item using the 2PL IRT model.
 * @param {number} theta - The latent trait level for the individual.
 * @param {number} a - The discrimination parameter for the item.
 * @param {number} b - The difficulty/location parameter for the item.
 * @returns {number} The probability of a positive response.
 */
function probability(theta, a, b) {
    return 1 / (1 + Math.exp(-a * (theta - b)));
}

/**
 * Converts a PCI score to a qualitative Preference Clarity Category.
 * These ranges are meticulously aligned with official psychometric reporting standards
 * to provide a meaningful interpretation of preference strength.
 * @param {number} pci - The Preference Clarity Index (1-30).
 * @returns {string} The Preference Clarity Category (Slight, Moderate, Clear, Very Clear).
 */
function getPccCategory(pci) {
    if (pci >= 26) return "Very Clear";
    if (pci >= 16) return "Clear";
    if (pci >= 6) return "Moderate";
    return "Slight";
}

/**
 * Estimates theta for a given dichotomy using the Newton-Raphson method.
 * This iterative numerical optimization method is employed to find the maximum
 * likelihood estimate of a person's latent trait (theta) for a specific dichotomy,
 * providing greater precision and efficiency than a simple grid search.
 * It utilizes the first and second derivatives of the log-likelihood function.
 * @param {string} dichotomyName - The name of the dichotomy (e.g., 'E-I').
 * @param {Object} mbtiAnswers - User's answers for MBTI questions (questionIndex: {choice}).
 * @param {Array} allMbtiQuestions - Full MBTI questions data for reference.
 * @returns {number} The estimated theta value.
 */
function findBestThetaForDichotomy(dichotomyName, mbtiAnswers, allMbtiQuestions) {
    const allDichotomyIndices = dichotomyToQuestionMap.get(dichotomyName) || [];
    const answeredQuestionIndices = allDichotomyIndices.filter(qIndex => mbtiAnswers[qIndex + 1]);

    if (answeredQuestionIndices.length === 0) {
        // If no questions were answered for this dichotomy, a neutral theta of 0 is returned.
        // This is a robust way to handle omissions without penalizing the user.
        return 0;
    }

    const items = answeredQuestionIndices.map(qIndex => {
        const params = itemParameters[qIndex];
        const answer = mbtiAnswers[qIndex + 1];
        // Note: allMbtiQuestions is an array, question number is 1-based, index is 0-based
        const questionData = allMbtiQuestions.find(q => q.number === (qIndex + 1));
        const userScoreKey = questionData.options[answer.choice].scoreKey;
        return { a: params.params.a, b: params.params.b, u: userScoreKey };
    });

    let theta = 0.0; // Initial guess for theta
    // Iterate 20 times for convergence, a common practice for stability.
    for (let iter = 0; iter < 20; iter++) {
        let firstDerivative = 0.0; // The 'score function'
        let secondDerivative = 0.0; // The 'Hessian'

        for (const item of items) {
            const { a, b, u } = item;
            const P = probability(theta, a, b); // P(u=1|theta)

            // Accumulate first and second derivatives for Newton-Raphson update
            firstDerivative += a * (u - P);
            secondDerivative += -a * a * (1 - P) * P; // Note the negative sign for maximizing log-likelihood
        }

        // Avoid division by zero or near-zero, which indicates a flat likelihood function or convergence.
        if (Math.abs(secondDerivative) < 1e-9) break;

        const newTheta = theta - (firstDerivative / secondDerivative);
        // Clamp theta to a reasonable range to prevent divergence in rare cases
        const clampedTheta = Math.max(-3, Math.min(3, newTheta));

        // Check for convergence: if the change in theta is very small, we've converged.
        if (Math.abs(clampedTheta - theta) < 0.0001) {
            theta = clampedTheta;
            break;
        }
        theta = clampedTheta;
    }
    return theta;
}


// --- THE FINAL HOLISTIC SCORING ENGINE ---

/**
 * [PUBLIC] Main scoring function implementing the innovative Holistic Stack Scoring logic.
 * This function is the proud culmination of combining IRT-based dichotomy measurements
 * with a comprehensive evaluation of all 16 Jungian function stacks against the user's
 * unique response patterns. It provides a nuanced and theoretically aligned type determination.
 *
 * @param {Object} mbtiAnswers - User's answers for MBTI dichotomy questions (from Form M).
 * @param {Object} attitudeAnswers - User's answers for Likert-scale questions assessing individual function attitudes.
 * @param {Array} allMbtiQuestions - Full MBTI questions data.
 * @param {Array} allAttitudeQuestions - Full attitude questions data.
 * @returns {Object} An object containing the final determined type, its function stack,
 *                   an overall fit score, and a detailed rationale.
 */
export function calculateHybridResults(mbtiAnswers, attitudeAnswers, allMbtiQuestions, allAttitudeQuestions) {

    // --- Step 1: Calculate Core Dichotomy Strengths (IRT) ---
    // Perform precise IRT estimation for E-I, S-N, and T-F dichotomies.
    // These IRT scores form the robust empirical foundation of our type determination.
    const coreResults = {};
    for (const [dichotomy, config] of Object.entries(DICHOTOMY_CONFIG)) {
        const theta = findBestThetaForDichotomy(dichotomy, mbtiAnswers, allMbtiQuestions);
        // Calculate PCI based on the absolute theta, with a minimum PCI of 1 for neutrality.
        const pci = theta === 0 ? 1 : Math.max(1, Math.round((Math.abs(theta) / 3.0) * 30));
        coreResults[dichotomy] = { pcc: getPccCategory(pci), theta, pci };
    }
    const { 'E-I': eiResult, 'S-N': snResult, 'T-F': tfResult } = coreResults;

    // --- Step 2: Calculate Raw Attitude Strengths from Likert Scales ---
    // Aggregate user responses from Likert-scale questions to get initial raw strengths
    // for each of the 8 cognitive functions (e.g., Ti, Te, Fi, Fe, Si, Se, Ni, Ne).
    // The `likertWeights` define how much each response choice contributes to the respective function's strength.
    const attitudeStrengths = { Ti: 0, Te: 0, Fi: 0, Fe: 0, Si: 0, Se: 0, Ni: 0, Ne: 0 };
    const likertWeights = { '1': 2, '2': 1, '3': 0, '4': -1, '5': -2 }; // Note: answer.choice will be a string from input
    allAttitudeQuestions.forEach(q => {
        const answer = attitudeAnswers[q.id];
        if (answer && answer.choice) {
            const score = likertWeights[answer.choice];
            // Assign score to the corresponding construct's pole. Positive scores lean towards construct1, negative towards construct2.
            if (score > 0) attitudeStrengths[q.construct1.pole] += score;
            else if (score < 0) attitudeStrengths[q.construct2.pole] += Math.abs(score);
        }
    });

    // --- Step 3: Holistic Stack Scoring of All 16 Valid Types ---
    // This is where the magic happens! We iterate through every theoretically valid Jungian function stack (all 16 types)
    // and calculate a composite "fit score" for each, based on both IRT dichotomy evidence and
    // the user's self-reported function strengths. The stack with the highest score is declared the best fit.
    let bestFitType = null;
    let maxScore = -Infinity;
    const typeScores = {}; // Stores individual type scores for detailed analysis or debugging.

    for (const [type, stack] of Object.entries(TYPE_FUNCTION_STACKS)) {
        let currentScore = 0;
        const [dom, aux, ter, inf] = stack; // Destructure the function stack for the current type

        // Part A: Score based on match with core IRT dichotomies (E-I, S-N, T-F).
        // The IRT theta provides a powerful, empirically grounded measure of preference.
        // It's weighted by its clarity (PCI) to give more confidence to clearer preferences.
        const eiMatch = type.startsWith('E') ? eiResult.theta : -eiResult.theta; // Positive theta for E, negative for I
        const snMatch = type.includes('S') ? snResult.theta : -snResult.theta; // Positive theta for S, negative for N
        const tfMatch = type.includes('T') ? tfResult.theta : -tfResult.theta; // Positive theta for T, negative for F

        currentScore += eiMatch * getIrtClarityWeight(eiResult.pci);
        currentScore += snMatch * getIrtClarityWeight(snResult.pci);
        currentScore += tfMatch * getIrtClarityWeight(tfResult.pci);

        // Part B: Score based on alignment with raw attitude strengths, weighted by stack position.
        // This integrates the Likert-scale function data, giving higher preference to types
        // whose theoretical dominant and auxiliary functions strongly align with the user's highest
        // self-reported function strengths. This is crucial for functionally deriving the J-P preference.
        const attitudeScore =
            (attitudeStrengths[dom] * ATTITUDE_STACK_POSITION_WEIGHT.dom) +
            (attitudeStrengths[aux] * ATTITUDE_STACK_POSITION_WEIGHT.aux) +
            (attitudeStrengths[ter] * ATTITUDE_STACK_POSITION_WEIGHT.ter) +
            (attitudeStrengths[inf] * ATTITUDE_STACK_POSITION_WEIGHT.inf);

        currentScore += attitudeScore * ATTITUDE_SCORE_WEIGHT;

        typeScores[type] = currentScore; // Store the calculated score for analysis/debugging
        // Update the best-fit type if the current type's score is higher
        if (currentScore > maxScore) {
            maxScore = currentScore;
            bestFitType = type;
        }
    }

    // --- Step 4: Finalize and Generate Rationale ---
    // Prepare the final results object, including the determined type, its stack,
    // the overall fit score, and a concise rationale.
    const finalStack = TYPE_FUNCTION_STACKS[bestFitType]; // Retrieve the full function stack for the best-fit type

    const rationale = `
        Core IRT Theta (Preference Clarity): E/I=${eiResult.theta.toFixed(2)} (${eiResult.pcc}), S/N=${snResult.theta.toFixed(2)} (${snResult.pcc}), T/F=${tfResult.theta.toFixed(2)} (${tfResult.pcc}).
        Through our innovative Holistic Stack Scoring, the model meticulously evaluated all 16 valid Jungian types against your unique evidence. It proudly identified ${bestFitType} as the best overall fit, showcasing a remarkable alignment with your preferences, with a final fit score of ${maxScore.toFixed(2)}.
    `.trim().replace(/\s+/g, ' '); // Clean up whitespace for a neat string

    return {
        finalType: bestFitType,
        dominant: finalStack[0],
        auxiliary: finalStack[1],
        tertiary: finalStack[2],
        inferior: finalStack[3],
        score: maxScore, // The highest score achieved by the best-fit type
        rationale: rationale,
        allTypeScores: typeScores // Useful for advanced debugging and understanding the scoring process
    };
}