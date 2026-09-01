export function explicitReviewPassword(env: NodeJS.ProcessEnv = process.env): string | null {
  const password = env.GOOGLE_PLAY_REVIEW_PASSWORD?.trim();
  if (!password) return null;
  const blocked = new Set(["Test?Test", "test?test", "password", "password1", "quizroyale"]);
  if (blocked.has(password) || password.length < 12) return null;
  return password;
}

export function postgresSslConfig(
  env: NodeJS.ProcessEnv = process.env,
  options: { modeKey?: string; rejectUnauthorizedKey?: string } = {},
): boolean | { rejectUnauthorized: boolean } {
  const modeKey = options.modeKey ?? "PGSSL";
  const rejectUnauthorizedKey = options.rejectUnauthorizedKey ?? `${modeKey}_REJECT_UNAUTHORIZED`;
  if (env[modeKey] === "disable") return false;
  return { rejectUnauthorized: env[rejectUnauthorizedKey] !== "false" };
}

export function postgresConnectionConfig(
  env: NodeJS.ProcessEnv = process.env,
  options: { urlKey?: string; modeKey?: string; rejectUnauthorizedKey?: string } = {},
): { connectionString: string | undefined; ssl: boolean | { rejectUnauthorized: boolean } } {
  const connectionString = env[options.urlKey ?? "DATABASE_URL"];
  const ssl = postgresSslConfig(env, options);
  return {
    connectionString: sanitizePostgresConnectionString(connectionString),
    ssl,
  };
}

function sanitizePostgresConnectionString(connectionString: string | undefined): string | undefined {
  if (!connectionString) return connectionString;

  try {
    const url = new URL(connectionString);
    for (const key of ["ssl", "sslmode", "sslcert", "sslkey", "sslrootcert"]) {
      url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return connectionString;
  }
}
