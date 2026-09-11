import pg from "pg";
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 12,
  connectionTimeoutMillis: 8000,
  idleTimeoutMillis: 30000,
});
export type DB = pg.PoolClient;
export async function transaction<T>(
  tenant: string | null,
  fn: (db: DB) => Promise<T>,
): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query(
      "SELECT set_config('caju.tenant_id',$1,true), set_config('statement_timeout','10000',true)",
      [tenant ?? ""],
    );
    const value = await fn(db);
    await db.query("COMMIT");
    return value;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}
export async function assertDatabaseRole() {
  const {
    rows: [role],
  } = await pool.query(
    "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
  );
  if (!role || role.rolsuper || role.rolbypassrls)
    throw new Error("DATABASE_URL must use a NOSUPERUSER NOBYPASSRLS role.");
}
