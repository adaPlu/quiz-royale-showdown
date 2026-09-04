import assert from "node:assert/strict";
import test from "node:test";
import { selectDifficultyQuestions } from "./difficulty-questions.js";

test("difficulty selector returns only requested active difficulty", async () => {
  const queries: Array<{ text: string; values: unknown[] }> = [];
  const db = {
    async query<T>(text: string, values: unknown[]) {
      queries.push({ text, values });
      return {
        rows: [
          {
            id: "q-hard-1",
            prompt: "Which planet has the Great Red Spot?",
            optionA: "Earth",
            optionB: "Mars",
            optionC: "Jupiter",
            optionD: "Venus",
            correctIndex: 2,
            category: "Science",
            difficulty: "HARD",
          },
        ] as T[],
        rowCount: 1,
      };
    },
  };

  const questions = await selectDifficultyQuestions(db as never, "hard", 1);
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0]?.values, ["hard", 1]);
  assert.deepEqual(questions, [{
    id: "q-hard-1",
    category: "Science",
    difficulty: "hard",
    text: "Which planet has the Great Red Spot?",
    options: ["Earth", "Mars", "Jupiter", "Venus"],
    correct: 2,
  }]);
});

test("difficulty selector fails closed when the requested pool is undersized", async () => {
  const db = {
    async query<T>() {
      return { rows: [] as T[], rowCount: 0 };
    },
  };
  await assert.rejects(
    () => selectDifficultyQuestions(db as never, "easy", 3),
    /not enough active easy questions/,
  );
});
