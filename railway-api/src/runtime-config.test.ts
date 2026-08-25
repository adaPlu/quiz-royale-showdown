import assert from "node:assert/strict";
import test from "node:test";
import { explicitReviewPassword, postgresConnectionConfig, postgresSslConfig } from "./runtime-config.js";

test("explicitReviewPassword requires an explicit nonblank password", () => {
  assert.equal(explicitReviewPassword({}), null);
  assert.equal(explicitReviewPassword({ GOOGLE_PLAY_REVIEW_PASSWORD: "   " }), null);
  assert.equal(explicitReviewPassword({ GOOGLE_PLAY_REVIEW_PASSWORD: " Test?Test " }), "Test?Test");
});

test("postgresSslConfig verifies certificates by default", () => {
  assert.deepEqual(postgresSslConfig({}), { rejectUnauthorized: true });
  assert.deepEqual(postgresSslConfig({ PGSSL_REJECT_UNAUTHORIZED: "false" }), { rejectUnauthorized: false });
  assert.equal(postgresSslConfig({ PGSSL: "disable" }), false);
});

test("postgresSslConfig supports source database env names", () => {
  assert.deepEqual(
    postgresSslConfig(
      { QUESTION_SOURCE_PGSSL_REJECT_UNAUTHORIZED: "false" },
      { modeKey: "QUESTION_SOURCE_PGSSL" },
    ),
    { rejectUnauthorized: false },
  );
});

test("postgresConnectionConfig removes SSL query parameters so explicit config wins", () => {
  const config = postgresConnectionConfig({
    DATABASE_URL: "postgres://user:pass@example.internal:5432/app?sslmode=require&sslrootcert=/tmp/ca.pem&connect_timeout=10",
    PGSSL_REJECT_UNAUTHORIZED: "false",
  });

  assert.equal(config.connectionString, "postgres://user:pass@example.internal:5432/app?connect_timeout=10");
  assert.deepEqual(config.ssl, { rejectUnauthorized: false });
});

test("postgresConnectionConfig supports source database URL env names", () => {
  const config = postgresConnectionConfig(
    {
      QUESTION_SOURCE_DATABASE_URL: "postgres://user:pass@example.internal/source?sslmode=require",
      QUESTION_SOURCE_PGSSL: "disable",
    },
    {
      urlKey: "QUESTION_SOURCE_DATABASE_URL",
      modeKey: "QUESTION_SOURCE_PGSSL",
    },
  );

  assert.equal(config.connectionString, "postgres://user:pass@example.internal/source");
  assert.equal(config.ssl, false);
});
