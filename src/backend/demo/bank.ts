/**
 * Synthetic-demo question bank. Three form families, each with equivalent forms A and B
 * (same item slots: same type / skill / difficulty, different content):
 *
 *   cs-fundamentals  11 auto-scored items + 2 confidence_likert   (~5.5 min)
 *   ai-literacy       9 auto-scored items + 2 confidence_likert   (~5 min)
 *   workshop-quick    6 auto-scored items + 1 confidence_likert   (~3 min)
 *
 * Every snippet below was traced by hand; the expected output is noted next to each answer key.
 * Public `config` never contains answer data; the answer key lives in `key`.
 * Ordering items are stored in a scrambled order in `config` (the server shuffles at serve
 * time anyway) so the stored config does not leak the solution.
 */
import type { Difficulty, QuestionType, SkillCategory } from '../../shared/types';

export interface QuestionDef {
  type: QuestionType;
  skill: SkillCategory;
  difficulty: Difficulty;
  points: number;
  prompt: string;
  /** Public config (matches the zod schemas in src/shared/validation.ts). */
  config: Record<string, unknown>;
  /** Answer key; null only for confidence_likert. */
  key: Record<string, unknown> | null;
  /** Generator-only: plausible wrong typed answers for short_logic (never accepted). */
  wrongAnswers?: string[];
}

export interface FormDef {
  family: string;
  label: 'A' | 'B';
  title: string;
  description: string;
  difficulty: Difficulty;
  estimatedMinutes: number;
  questions: QuestionDef[];
}

const ID = ['a', 'b', 'c', 'd', 'e', 'f'];

function choice(
  type: 'multiple_choice' | 'code_comprehension' | 'predict_output',
  skill: SkillCategory,
  difficulty: Difficulty,
  prompt: string,
  code: string | null,
  options: string[],
  correct: number,
): QuestionDef {
  return {
    type,
    skill,
    difficulty,
    points: 1,
    prompt,
    config: {
      ...(code ? { code, language: 'python' } : {}),
      options: options.map((label, i) => ({ id: ID[i] as string, label })),
    },
    key: { correctOptionId: ID[correct] as string },
  };
}

function multi(
  skill: SkillCategory,
  difficulty: Difficulty,
  prompt: string,
  options: string[],
  correct: number[],
): QuestionDef {
  return {
    type: 'multiple_select',
    skill,
    difficulty,
    points: 2,
    prompt,
    config: { options: options.map((label, i) => ({ id: ID[i] as string, label })) },
    key: { correctOptionIds: correct.map((i) => ID[i] as string) },
  };
}

/** `steps` are given in the CORRECT order; `shownOrder` are indexes into `steps` for the stored config order. */
function ordering(
  skill: SkillCategory,
  difficulty: Difficulty,
  prompt: string,
  steps: string[],
  shownOrder: number[],
): QuestionDef {
  return {
    type: 'ordering',
    skill,
    difficulty,
    points: 2,
    prompt,
    config: { items: shownOrder.map((i) => ({ id: ID[i] as string, label: steps[i] as string })) },
    key: { correctOrder: steps.map((_, i) => ID[i] as string) },
  };
}

function debugging(
  skill: SkillCategory,
  difficulty: Difficulty,
  prompt: string,
  code: string,
  bugLine: number,
): QuestionDef {
  return {
    type: 'debugging',
    skill,
    difficulty,
    points: 1,
    prompt,
    config: { code, language: 'python', hint: 'Read each line and ask what it is supposed to do.' },
    key: { bugLine },
  };
}

function shortLogic(
  skill: SkillCategory,
  difficulty: Difficulty,
  prompt: string,
  accepted: string[],
  wrong: string[],
  placeholder = 'Type a number',
): QuestionDef {
  return {
    type: 'short_logic',
    skill,
    difficulty,
    points: 1,
    prompt,
    config: { placeholder, maxLength: 20 },
    key: { acceptedAnswers: accepted, caseSensitive: false },
    wrongAnswers: wrong,
  };
}

function likert(skill: SkillCategory, prompt: string): QuestionDef {
  return {
    type: 'confidence_likert',
    skill,
    difficulty: 'intro',
    points: 0,
    prompt,
    config: { minLabel: 'Not at all confident', maxLabel: 'Very confident' },
    key: null,
  };
}

/* ------------------------------------------------------------------ */
/* cs-fundamentals                                                      */
/* ------------------------------------------------------------------ */

const csA: QuestionDef[] = [
  // 5 -> 8 -> 16
  choice(
    'predict_output',
    'variables',
    'intro',
    'What does this program print?',
    'score = 5\nscore = score + 3\nscore = score * 2\nprint(score)',
    ['8', '10', '16', '13'],
    2,
  ),
  choice(
    'multiple_choice',
    'data_types',
    'intro',
    'Which of these values is a string (text) in Python?',
    null,
    ['42', '"42"', '4.2', 'True'],
    1,
  ),
  // 72 > 90 no; 72 > 65 yes -> nice
  choice(
    'predict_output',
    'conditionals',
    'intro',
    'What does this program print?',
    'temp = 72\nif temp > 90:\n    print("hot")\nelif temp > 65:\n    print("nice")\nelse:\n    print("cold")',
    ['cold', 'hot', 'Nothing is printed', 'nice'],
    3,
  ),
  // 1+2+3+4 = 10
  choice(
    'predict_output',
    'loops',
    'intermediate',
    'What does this program print?',
    'total = 0\nfor i in range(1, 5):\n    total = total + i\nprint(total)',
    ['10', '4', '15', '9'],
    0,
  ),
  // finds the largest (9)
  choice(
    'code_comprehension',
    'loops',
    'intermediate',
    'What does this code do?',
    'numbers = [3, 8, 1, 9, 4]\nbest = numbers[0]\nfor n in numbers:\n    if n > best:\n        best = n\nprint(best)',
    [
      'Adds up all of the numbers',
      'Finds the largest number in the list',
      'Counts how many numbers are in the list',
      'Finds the smallest number in the list',
    ],
    1,
  ),
  // double(4) + double(3) = 8 + 6 = 14
  choice(
    'predict_output',
    'functions',
    'intermediate',
    'What does this program print?',
    'def double(x):\n    return x * 2\n\nresult = double(4) + double(3)\nprint(result)',
    ['14', '7', '24', '11'],
    0,
  ),
  // line 3: total / 3 should be total / 2
  debugging(
    'debugging',
    'intermediate',
    'This function should return the average of two numbers, but average(4, 6) gives the wrong answer. Which line has the bug?',
    'def average(a, b):\n    total = a + b\n    return total / 3\n\nprint(average(4, 6))',
    3,
  ),
  // True: a (True and True), c (False or True)
  multi(
    'logic',
    'intermediate',
    'Which of these expressions are True? Choose all that apply.',
    ['5 > 3 and 2 > 1', '5 > 3 and 2 > 4', '5 < 3 or 2 > 1', 'not (5 > 3)'],
    [0, 2],
  ),
  ordering(
    'computational_thinking',
    'intermediate',
    'Put the steps of this algorithm for counting the vowels in a word in the correct order.',
    [
      'Set a counter to 0',
      'Go through the word one letter at a time',
      'If the letter is a vowel, add 1 to the counter',
      'After the last letter, show the counter',
    ],
    [2, 0, 3, 1],
  ),
  // ceil(95 / 30) = 4
  shortLogic(
    'problem_solving',
    'intermediate',
    'A school bus holds 30 students. How many buses are needed to carry 95 students?',
    ['4', 'four'],
    ['3', '5', '30', '95'],
  ),
  // evens: 4, 6, 10 -> 3
  choice(
    'code_comprehension',
    'code_comprehension',
    'advanced',
    'What does the function mystery return for this list?',
    'def mystery(items):\n    count = 0\n    for item in items:\n        if item % 2 == 0:\n            count = count + 1\n    return count\n\nprint(mystery([1, 4, 6, 7, 10]))',
    [
      '5, because it counts every number in the list',
      '28, because it adds up the numbers',
      '3, because it counts the even numbers',
      '2, because it counts the odd numbers',
    ],
    2,
  ),
  likert(
    'programming_fundamentals',
    'How confident are you that you could write a short program that uses a loop?',
  ),
  likert(
    'debugging',
    "How confident are you that you could find and fix a bug in someone else's code?",
  ),
];

const csB: QuestionDef[] = [
  // 4 -> 10 -> 7
  choice(
    'predict_output',
    'variables',
    'intro',
    'What does this program print?',
    'points = 4\npoints = points + 6\npoints = points - 3\nprint(points)',
    ['4', '10', '13', '7'],
    3,
  ),
  choice(
    'multiple_choice',
    'data_types',
    'intro',
    'Which of these values is a boolean (a True/False value) in Python?',
    null,
    ['"True"', '1', 'True', '1.0'],
    2,
  ),
  // 40 > 80 no; 40 > 50 no -> low
  choice(
    'predict_output',
    'conditionals',
    'intro',
    'What does this program print?',
    'level = 40\nif level > 80:\n    print("high")\nelif level > 50:\n    print("medium")\nelse:\n    print("low")',
    ['medium', 'high', 'low', 'Nothing is printed'],
    2,
  ),
  // 1+2+3+4+5 = 15
  choice(
    'predict_output',
    'loops',
    'intermediate',
    'What does this program print?',
    'count = 0\nfor n in range(1, 6):\n    count = count + n\nprint(count)',
    ['21', '5', '15', '10'],
    2,
  ),
  // finds the smallest (55)
  choice(
    'code_comprehension',
    'loops',
    'intermediate',
    'What does this code do?',
    'scores = [70, 55, 90, 62]\nlow = scores[0]\nfor s in scores:\n    if s < low:\n        low = s\nprint(low)',
    [
      'Finds the smallest score in the list',
      'Finds the largest score in the list',
      'Adds up all of the scores',
      'Counts how many scores are in the list',
    ],
    0,
  ),
  // add_five(2) * add_five(1) = 7 * 6 = 42
  choice(
    'predict_output',
    'functions',
    'intermediate',
    'What does this program print?',
    'def add_five(n):\n    return n + 5\n\nresult = add_five(2) * add_five(1)\nprint(result)',
    ['8', '13', '15', '42'],
    3,
  ),
  // line 2: width + height should be width * height
  debugging(
    'debugging',
    'intermediate',
    'This function should return the area of a rectangle, but area(3, 4) gives the wrong answer. Which line has the bug?',
    'def area(width, height):\n    result = width + height\n    return result\n\nprint(area(3, 4))',
    2,
  ),
  // 4==4 and 3!=3 -> False; 4==4 or 3!=3 -> True; not (2>5) -> True; 2>5 or 1>3 -> False
  multi(
    'logic',
    'intermediate',
    'Which of these expressions are True? Choose all that apply.',
    ['4 == 4 and 3 != 3', '4 == 4 or 3 != 3', 'not (2 > 5)', '2 > 5 or 1 > 3'],
    [1, 2],
  ),
  ordering(
    'computational_thinking',
    'intermediate',
    'Put the steps of this algorithm for adding up a shopping list in the correct order.',
    [
      'Set the total to 0',
      'Go through the items one at a time',
      "Add the current item's price to the total",
      'After the last item, show the total',
    ],
    [2, 3, 0, 1],
  ),
  // ceil(50 / 12) = 5
  shortLogic(
    'problem_solving',
    'intermediate',
    'Cookies are packed 12 to a box. How many boxes are needed for 50 cookies?',
    ['5', 'five'],
    ['4', '6', '12', '50'],
  ),
  // words longer than 3 letters: robot, python -> 2
  choice(
    'code_comprehension',
    'code_comprehension',
    'advanced',
    'What does the function mystery return for this list?',
    'def mystery(words):\n    count = 0\n    for word in words:\n        if len(word) > 3:\n            count = count + 1\n    return count\n\nprint(mystery(["hi", "robot", "a", "python", "fun"]))',
    [
      '5, because it counts every word in the list',
      '2, because it counts the words longer than 3 letters',
      '17, because it adds up the lengths of the words',
      '3, because it counts the words with 3 letters or fewer',
    ],
    1,
  ),
  likert(
    'programming_fundamentals',
    'How confident are you that you could write a short program that makes decisions with if statements?',
  ),
  likert(
    'debugging',
    'How confident are you that you could work out why your own program is not doing what you expect?',
  ),
];

/* ------------------------------------------------------------------ */
/* ai-literacy                                                          */
/* ------------------------------------------------------------------ */

const aiA: QuestionDef[] = [
  choice(
    'multiple_choice',
    'computational_thinking',
    'intro',
    'A team trains a model to recognize cats in photos. How does the model mostly learn to do this?',
    null,
    [
      'Programmers write a rule for every possible cat shape',
      'It finds patterns in many example photos that are labeled',
      'It looks up each photo on the internet while running',
      'It guesses randomly until someone fixes it',
    ],
    1,
  ),
  choice(
    'multiple_choice',
    'problem_solving',
    'intermediate',
    'A face-unlock model was trained mostly on photos of people with light skin. What is the most likely problem?',
    null,
    [
      'It will work perfectly for everyone because it uses a camera',
      'It may work worse for people who were rare in the training photos',
      'It will refuse to unlock for anyone',
      'It only needs more battery power',
    ],
    1,
  ),
  // "refund please" contains "refund" -> billing
  choice(
    'predict_output',
    'conditionals',
    'intro',
    'What does this program print?',
    'message = "refund please"\nif "refund" in message:\n    reply = "billing"\nelif "password" in message:\n    reply = "account"\nelse:\n    reply = "general"\nprint(reply)',
    ['general', 'account', 'billing', 'Nothing is printed'],
    2,
  ),
  // "cat" appears 3 times
  choice(
    'predict_output',
    'data_types',
    'intro',
    'What does this program print?',
    'labels = ["cat", "dog", "cat", "bird", "cat"]\nprint(labels.count("cat"))',
    ['5', '2', '3', 'cat'],
    2,
  ),
  // line 5 subtracts 1 instead of adding 1 (prints -2)
  debugging(
    'debugging',
    'intermediate',
    'This code should count how many example messages look like spam, but it prints -2. Which line has the bug?',
    'examples = ["win money", "hello friend", "free prize"]\nspam_count = 0\nfor text in examples:\n    if "free" in text or "win" in text:\n        spam_count = spam_count - 1\nprint(spam_count)',
    5,
  ),
  multi(
    'logic',
    'intermediate',
    'Which of these are good ways to check whether an AI answer is reliable? Choose all that apply.',
    [
      'Trust it because it sounds confident',
      'Compare it with a trusted source',
      'Trust it because the answer is long',
      'Check whether the sources it names are real',
    ],
    [1, 3],
  ),
  ordering(
    'computational_thinking',
    'intermediate',
    'Put the steps of building a simple machine-learning model in a sensible order.',
    [
      'Collect labeled example data',
      'Train the model on the training examples',
      'Test the model on new examples it has not seen',
      'Improve the data or the model and try again',
    ],
    [1, 3, 0, 2],
  ),
  choice(
    'code_comprehension',
    'code_comprehension',
    'intermediate',
    'What does this function do?',
    'def predict(temp):\n    if temp > 30:\n        return "swim"\n    elif temp > 15:\n        return "walk"\n    return "stay in"',
    [
      'Converts a temperature to Fahrenheit',
      'Suggests an activity based on the temperature',
      "Predicts tomorrow's weather from past data",
      'Counts how many hot days there were',
    ],
    1,
  ),
  // 8 / 10 = 80%
  shortLogic(
    'problem_solving',
    'intermediate',
    'A model gets 8 of 10 test questions right. What percent is that? (number only)',
    ['80', '80%'],
    ['8', '20', '0.8', '10'],
  ),
  likert(
    'computational_thinking',
    'How confident are you that you could explain to a friend how a machine-learning model learns?',
  ),
  likert(
    'problem_solving',
    'How confident are you that you could spot when an AI answer might be wrong?',
  ),
];

const aiB: QuestionDef[] = [
  choice(
    'multiple_choice',
    'computational_thinking',
    'intro',
    'A team trains a model to tell spam emails from normal emails. How does the model mostly learn to do this?',
    null,
    [
      'It finds patterns in many example emails that are labeled spam or not spam',
      'Programmers read every new email and decide by hand',
      'It copies the filter that another company uses',
      'It blocks every email that has an attachment',
    ],
    0,
  ),
  choice(
    'multiple_choice',
    'problem_solving',
    'intermediate',
    'A voice assistant was trained mostly on voices from one region. What is the most likely problem?',
    null,
    [
      'It will understand every accent equally well',
      'It will only answer yes/no questions',
      'It may misunderstand speakers with accents it rarely heard in training',
      'It will stop working after one week',
    ],
    2,
  ),
  // "reset my password": no "refund"; has "password" -> account
  choice(
    'predict_output',
    'conditionals',
    'intro',
    'What does this program print?',
    'message = "reset my password"\nif "refund" in message:\n    reply = "billing"\nelif "password" in message:\n    reply = "account"\nelse:\n    reply = "general"\nprint(reply)',
    ['billing', 'account', 'general', 'Nothing is printed'],
    1,
  ),
  // "ok" appears 4 times
  choice(
    'predict_output',
    'data_types',
    'intro',
    'What does this program print?',
    'labels = ["spam", "ok", "ok", "spam", "ok", "ok"]\nprint(labels.count("ok"))',
    ['4', '2', '6', 'ok'],
    0,
  ),
  // line 4 adds 1 instead of the rating r (prints 1.0)
  debugging(
    'debugging',
    'intermediate',
    'This code should print the average rating, but it prints 1.0. Which line has the bug?',
    'ratings = [4, 5, 3, 5]\ntotal = 0\nfor r in ratings:\n    total = total + 1\naverage = total / len(ratings)\nprint(average)',
    4,
  ),
  multi(
    'logic',
    'intermediate',
    'Which of these are good ways to check whether an AI answer is reliable? Choose all that apply.',
    [
      'Test it on a question you already know the answer to',
      'Accept it because it answered quickly',
      'Check whether other trusted sources agree',
      'Accept it because it uses technical words',
    ],
    [0, 2],
  ),
  ordering(
    'computational_thinking',
    'intermediate',
    'Put the steps of planning and building a simple machine-learning model in a sensible order.',
    [
      'Decide what the model should predict',
      'Gather and label example data',
      'Train the model',
      'Check how well it does on new data',
    ],
    [2, 0, 3, 1],
  ),
  choice(
    'code_comprehension',
    'code_comprehension',
    'intermediate',
    'What does this function do?',
    'def advice(minutes):\n    if minutes > 120:\n        return "take a break"\n    elif minutes > 60:\n        return "stretch"\n    return "keep going"',
    [
      'Converts minutes into hours',
      'Counts how many minutes have passed',
      'Predicts how long a task will take',
      'Gives study advice based on how long someone has worked',
    ],
    3,
  ),
  // 45 / 50 = 90%
  shortLogic(
    'problem_solving',
    'intermediate',
    'A model labels 45 of 50 test emails correctly. What percent is that? (number only)',
    ['90', '90%'],
    ['9', '45', '50', '10'],
  ),
  likert(
    'computational_thinking',
    'How confident are you that you could describe the steps for training a simple model?',
  ),
  likert(
    'problem_solving',
    'How confident are you that you could double-check an AI answer before using it?',
  ),
];

/* ------------------------------------------------------------------ */
/* workshop-quick                                                       */
/* ------------------------------------------------------------------ */

const wqA: QuestionDef[] = [
  // y copies x's value (10) before x changes
  choice(
    'predict_output',
    'variables',
    'intro',
    'What does this program print?',
    'x = 10\ny = x\nx = 20\nprint(y)',
    ['20', '10', '30', 'An error'],
    1,
  ),
  // 7 / 2 = 3.5 -> float
  choice(
    'multiple_choice',
    'data_types',
    'intro',
    'What type of value does 7 / 2 give in Python 3?',
    null,
    ['str', 'int', 'bool', 'float'],
    3,
  ),
  choice(
    'predict_output',
    'conditionals',
    'intro',
    'What does this program print?',
    'age = 16\nif age >= 18:\n    print("adult")\nelse:\n    print("minor")',
    ['adult', 'minor', 'Nothing is printed', 'An error'],
    1,
  ),
  // line 3: greting is a typo for greeting
  debugging(
    'debugging',
    'intro',
    'This program should print a greeting, but it crashes with a NameError. Which line has the bug?',
    'name = "Sam"\ngreeting = "Hello, " + name\nprint(greting)',
    3,
  ),
  // range(3): 0, 1, 2 -> prints 0, 2, 4
  choice(
    'predict_output',
    'loops',
    'intermediate',
    'What is printed? (Each number is printed on its own line.)',
    'for i in range(3):\n    print(i * 2)',
    ['2 4 6', '0 1 2', '0 2 4', '0 2 4 6'],
    2,
  ),
  shortLogic(
    'problem_solving',
    'intermediate',
    'What number comes next in the pattern 2, 4, 8, 16, ...?',
    ['32'],
    ['24', '20', '18', '12'],
  ),
  likert(
    'programming_fundamentals',
    'How confident are you that you could write a short program on your own?',
  ),
];

const wqB: QuestionDef[] = [
  // b copies a's value (3) before a changes
  choice(
    'predict_output',
    'variables',
    'intro',
    'What does this program print?',
    'a = 3\nb = a\na = 7\nprint(b)',
    ['An error', '7', '10', '3'],
    3,
  ),
  choice(
    'multiple_choice',
    'data_types',
    'intro',
    'What type of value does len("hello") give in Python 3?',
    null,
    ['int', 'float', 'str', 'bool'],
    0,
  ),
  // 50 >= 60 is False -> retry
  choice(
    'predict_output',
    'conditionals',
    'intro',
    'What does this program print?',
    'points = 50\nif points >= 60:\n    print("pass")\nelse:\n    print("retry")',
    ['pass', 'Nothing is printed', 'retry', 'An error'],
    2,
  ),
  // line 2: str + int raises TypeError
  debugging(
    'debugging',
    'intro',
    'This program crashes with a TypeError. Which line has the bug?',
    'count = 3\nmessage = "Items: " + count\nprint(message)',
    2,
  ),
  // range(4): 0..3 -> prints 1, 2, 3, 4
  choice(
    'predict_output',
    'loops',
    'intermediate',
    'What is printed? (Each number is printed on its own line.)',
    'for i in range(4):\n    print(i + 1)',
    ['0 1 2 3', '1 2 3 4', '1 2 3', '2 3 4 5'],
    1,
  ),
  shortLogic(
    'problem_solving',
    'intermediate',
    'What number comes next in the pattern 3, 6, 12, 24, ...?',
    ['48'],
    ['36', '30', '27', '96'],
  ),
  likert(
    'programming_fundamentals',
    'How confident are you that you could build a small project with what you learned today?',
  ),
];

export const FORMS: FormDef[] = [
  {
    family: 'cs-fundamentals',
    label: 'A',
    title: 'CS Fundamentals Check — Form A',
    description:
      'Short check of core programming ideas: variables, types, conditionals, loops, functions, debugging and logic.',
    difficulty: 'intermediate',
    estimatedMinutes: 6,
    questions: csA,
  },
  {
    family: 'cs-fundamentals',
    label: 'B',
    title: 'CS Fundamentals Check — Form B',
    description: 'Equivalent form of the CS Fundamentals check with different items.',
    difficulty: 'intermediate',
    estimatedMinutes: 6,
    questions: csB,
  },
  {
    family: 'ai-literacy',
    label: 'A',
    title: 'AI Literacy Check — Form A',
    description:
      'Short check of how machine learning works, reading simple decision code, spotting bias and checking AI answers.',
    difficulty: 'intermediate',
    estimatedMinutes: 5,
    questions: aiA,
  },
  {
    family: 'ai-literacy',
    label: 'B',
    title: 'AI Literacy Check — Form B',
    description: 'Equivalent form of the AI Literacy check with different items.',
    difficulty: 'intermediate',
    estimatedMinutes: 5,
    questions: aiB,
  },
  {
    family: 'workshop-quick',
    label: 'A',
    title: 'Workshop Quick Check — Form A',
    description: 'Six-item quick check for workshops and camp sessions.',
    difficulty: 'intro',
    estimatedMinutes: 3,
    questions: wqA,
  },
  {
    family: 'workshop-quick',
    label: 'B',
    title: 'Workshop Quick Check — Form B',
    description: 'Equivalent form of the Workshop Quick Check with different items.',
    difficulty: 'intro',
    estimatedMinutes: 3,
    questions: wqB,
  },
];
