import assert from "node:assert/strict";
import test from "node:test";
import { generatedQuestionBatchSchema, normalizeQuestionInput } from "./questions.js";

test("question normalization accepts one valid four-option question", () => {
  const question = normalizeQuestionInput({
    questionId: "source-1",
    category: "Science",
    difficulty: "easy",
    text: "What planet is known as the Red Planet?",
    options: ["Venus", "Mars", "Jupiter", "Mercury"],
    correctIndex: 1,
  }, "import", "active");

  assert.ok(question);
  assert.equal(question.questionId, "source-1");
  assert.equal(question.category, "Science");
  assert.equal(question.correct, 1);
  assert.equal(question.status, "active");
});

test("question normalization rejects duplicate answer options", () => {
  const question = normalizeQuestionInput({
    category: "Science",
    difficulty: "easy",
    text: "Which option is duplicated?",
    options: ["Same", "Same", "Different", "Another"],
    correctIndex: 0,
  }, "openai", "active");

  assert.equal(question, null);
});

test("question normalization rejects an answer option that simply repeats the prompt", () => {
  const question = normalizeQuestionInput({
    category: "Science",
    difficulty: "easy",
    text: "Which planet is known as the Red Planet?",
    options: ["Which planet is known as the Red Planet?", "Mars", "Venus", "Mercury"],
    correctIndex: 1,
  }, "openai", "active");

  assert.equal(question, null);
});

test("question normalization rejects degenerate one-character answer options", () => {
  const question = normalizeQuestionInput({
    category: "Science",
    difficulty: "easy",
    text: "Which answer identifies the correct chemical element?",
    options: ["A", "B", "C", "D"],
    correctIndex: 2,
  }, "openai", "active");

  assert.equal(question, null);
});

test("generated question schema rejects malformed batches", () => {
  const parsed = generatedQuestionBatchSchema.safeParse({
    questions: [{
      category: "Science",
      difficulty: "easy",
      text: "Too few options?",
      options: ["Yes", "No"],
      correctIndex: 0,
    }],
  });

  assert.equal(parsed.success, false);
});
