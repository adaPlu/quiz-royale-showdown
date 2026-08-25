import pg from "pg";
import { postgresConnectionConfig } from "./runtime-config.js";

const { Pool } = pg;

export type DbClient = pg.PoolClient | pg.Pool;

export const pool = new Pool(postgresConnectionConfig());

export async function tx<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
