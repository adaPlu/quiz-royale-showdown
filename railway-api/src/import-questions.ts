import { pool } from "./db.js";
import { importQuestionsFromSource } from "./question-service.js";
import { closeCache } from "./cache.js";

async function main(): Promise<void> {
  const result = await importQuestionsFromSource();
  console.log(JSON.stringify({ ok: true, ...result }));
}

main()
  .catch((error) => {
    console.error((error as Error).message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.all([pool.end(), closeCache()]);
  });
