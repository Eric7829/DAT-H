// app.js: Main Application Logic for UI/UX

import { calculateHybridResults } from './scorer.js';

// --- DOM Element References ---
const screens = {
    welcome: document.getElementById('welcome-screen'),
    quiz: document.getElementById('quiz-screen'),
    results: document.getElementById('results-screen'),
};
const startBtn = document.getElementById('start-btn');
const backBtn = document.getElementById('back-btn');
const nextBtn = document.getElementById('next-btn');
const restartBtn = document.getElementById('restart-btn');
const questionContainer = document.getElementById('question-container');
const progressBar = document.getElementById('progress-bar');
const errorMessage = document.getElementById('error-message');
const finalTypeText = document.getElementById('final-type-text');
const rationaleText = document.getElementById('rationale-text');

// --- Application State ---
let allQuestions = [];
let currentQuestionIndex = 0;
let userAnswers = {}; // { qId: 'value' }

// --- UI Logic ---

/**
 * Switches the active screen.
 * @param {string} screenName - The key of the screen to show ('welcome', 'quiz', 'results').
 */
function showScreen(screenName) {
    Object.values(screens).forEach(screen => screen.classList.remove('active'));
    screens[screenName].classList.add('active');
}

/**
 * Renders a single question based on the current index.
 */
function renderQuestion() {
    if (currentQuestionIndex < 0 || currentQuestionIndex >= allQuestions.length) return;

    const q = allQuestions[currentQuestionIndex];
    let html = '';

    // Handle MBTI Forced-Choice Questions
    if (q.type === 'mbti') {
        const questionText = q.question ? `<p class="question-text">${q.question}</p>` : `<p class="question-text">Which word appeals to you more?</p>`;
        html = `
            ${questionText}
            <div class="options-container" data-question-id="${q.number}">
                <label class="option-label">
                    <input type="radio" name="q${q.number}" value="A">
                    <span class="radio-custom"></span>
                    <span>${q.options.A.text}</span>
                </label>
                <label class="option-label">
                    <input type="radio" name="q${q.number}" value="B">
                    <span class="radio-custom"></span>
                    <span>${q.options.B.text}</span>
                </label>
            </div>
        `;
    }
    // Handle Attitude Likert-Scale Questions
    else if (q.type === 'attitude') {
        const likertLabels = ['Definitely', 'Somewhat', 'Neutral<br>(neither/both)', 'Somewhat', 'Definitely'];
        html = `
            <div class="likert-scale-container" data-question-id="${q.id}">
                <p class="question-text">${q.text}</p>
                <div class="likert-layout">
                    <p class="likert-description-left">${q.construct1.description}</p>
                    <div class="likert-button-group">
                        ${[1, 2, 3, 4, 5].map((val, index) => `
                            <label class="likert-btn-label">
                                <input type="radio" name="${q.id}" value="${val}">
                                <span class="likert-btn">${likertLabels[index]}</span>
                            </label>
                        `).join('')}
                    </div>
                    <p class="likert-description-right">${q.construct2.description}</p>
                </div>
            </div>
        `;
    }

    questionContainer.innerHTML = html;
    updateSelection();
    updateNavigation();
    updateProgressBar();
}

/**
 * Updates the UI to reflect the currently saved answer for a question.
 */
function updateSelection() {
    const q = allQuestions[currentQuestionIndex];
    const qId = q.type === 'mbti' ? q.number : q.id;
    const savedAnswer = userAnswers[qId];

    document.querySelectorAll('.option-label, .likert-btn-label').forEach(label => label.classList.remove('selected'));

    if (savedAnswer) {
        const selectedInput = document.querySelector(`input[value="${savedAnswer}"]`);
        if (selectedInput) {
            selectedInput.checked = true;
            selectedInput.closest('label').classList.add('selected');
        }
    }
    nextBtn.disabled = !savedAnswer;
}

/**
 * Updates the visibility and text of navigation buttons.
 */
function updateNavigation() {
    backBtn.style.visibility = currentQuestionIndex > 0 ? 'visible' : 'hidden';
    nextBtn.textContent = currentQuestionIndex === allQuestions.length - 1 ? 'Get My Result' : 'Next';
}

/**
 * Updates the progress bar width.
 */
function updateProgressBar() {
    const progress = (currentQuestionIndex / allQuestions.length) * 100;
    progressBar.style.width = `${progress}%`;
}

/**
 * Handles navigation to the next question or submits the quiz.
 */
function handleNext() {
    const q = allQuestions[currentQuestionIndex];
    const qId = q.type === 'mbti' ? q.number : q.id;

    if (!userAnswers[qId]) {
        errorMessage.textContent = 'Please select an option.';
        return;
    }
    errorMessage.textContent = '';

    if (currentQuestionIndex < allQuestions.length - 1) {
        currentQuestionIndex++;
        renderQuestion();
    } else {
        submitQuiz();
    }
}

/**
 * Handles navigation to the previous question.
 */
function handleBack() {
    if (currentQuestionIndex > 0) {
        currentQuestionIndex--;
        renderQuestion();
    }
}

/**
 * Handles saving the user's answer for the current question.
 * @param {Event} e - The input change event.
 */
function handleAnswerSelect(e) {
    if (e.target.name) {
        const q = allQuestions[currentQuestionIndex];
        const qId = q.type === 'mbti' ? q.number : q.id;
        userAnswers[qId] = e.target.value;
        updateSelection();
        errorMessage.textContent = '';
    }
}

/**
 * Gathers answers, calls the scorer, and displays the results.
 */
function submitQuiz() {
    const mbtiAnswers = {};
    const attitudeAnswers = {};

    allQuestions.forEach(q => {
        if (q.type === 'mbti' && userAnswers[q.number]) {
            mbtiAnswers[q.number] = { choice: userAnswers[q.number] };
        } else if (q.type === 'attitude' && userAnswers[q.id]) {
            attitudeAnswers[q.id] = { choice: userAnswers[q.id] };
        }
    });

    // Pass only the relevant question arrays to the scorer
    const mbtiQuestions = allQuestions.filter(q => q.type === 'mbti');
    const attitudeQuestions = allQuestions.filter(q => q.type === 'attitude');

    // Call the external scoring function
    const result = calculateHybridResults(mbtiAnswers, attitudeAnswers, mbtiQuestions, attitudeQuestions);

    finalTypeText.textContent = result.finalType;
    rationaleText.textContent = result.rationale;
    showScreen('results');
}

/**
 * Resets the application to its initial state.
 */
function restartQuiz() {
    currentQuestionIndex = 0;
    userAnswers = {};
    renderQuestion();
    showScreen('welcome');
}

/**
 * Initializes the application.
 */
async function init() {
    try {
        const response = await fetch('./questions.json');
        const data = await response.json();
        const mbtiQuestions = data.mbtiQuestions.map(q => ({...q, type: 'mbti' }));
        const attitudeQuestions = data.attitudeQuestions.map(q => ({...q, type: 'attitude' }));
        allQuestions = [...mbtiQuestions, ...attitudeQuestions];

        startBtn.addEventListener('click', () => {
            showScreen('quiz');
            renderQuestion();
        });
        nextBtn.addEventListener('click', handleNext);
        backBtn.addEventListener('click', handleBack);
        restartBtn.addEventListener('click', restartQuiz);
        questionContainer.addEventListener('change', handleAnswerSelect);

        showScreen('welcome');
    } catch (error) {
        console.error("Failed to load questions:", error);
        questionContainer.innerHTML = "<p>Error: Could not load the assessment. Please try again later.</p>";
    }
}


// --- Initial Load ---
document.addEventListener('DOMContentLoaded', init);