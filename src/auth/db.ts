import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const candidateRoot = path.resolve(__dirname, '../..');
const PROJECT_ROOT = fs.existsSync(path.join(candidateRoot, 'migrations'))
  ? candidateRoot
  : process.cwd();

export type AccountStatus = 'active' | 'disabled' | 'suspended';
export type UserRole =
  | 'user'
  | 'admin'
  | 'super_admin'
  | 'security_admin'
  | 'ai_admin'
  | 'data_admin'
  | 'support_admin'
  | 'viewer';
export type AuthDialect = 'sqlite' | 'postgres';

const ORDERED_MIGRATIONS = [
  '0001_init_auth',
  '0002_phase2_workspace',
  '0003_phase3_admin',
  '0004_phase4_observability',
  '0005_phase5_governance',
  '0006_phase6_super_ops',
  '0007_market_data_cache',
] as const;

export interface DbUserRow {
  id: string;
  full_name: string;
  email: string;
  password_hash: string;
  email_verified: number | boolean;
  account_status: AccountStatus;
  role: UserRole;
  created_at: string | Date;
  updated_at: string | Date;
  last_login_at: string | Date | null;
}

export interface DbSessionRow {
  id: string;
  user_id: string;
  session_token_hash: string;
  user_agent: string;
  ip_address: string;
  remember_me: number | boolean;
  expires_at: string | Date;
  created_at: string | Date;
  last_active_at: string | Date;
  revoked_at: string | Date | null;
}

export interface DbTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string | Date;
  used_at: string | Date | null;
  created_at: string | Date;
}

export interface AuthQueryRunner {
  dialect: AuthDialect;
  queryOne: <T>(sqliteSql: string, pgSql: string, params?: unknown[]) => Promise<T | undefined>;
  queryAll: <T>(sqliteSql: string, pgSql: string, params?: unknown[]) => Promise<T[]>;
  execute: (sqliteSql: string, pgSql: string, params?: unknown[]) => Promise<{ changes: number }>;
}

export interface AuthDatabase extends AuthQueryRunner {
  dbPath: string;
  sqliteDb?: DatabaseSync;
  pgSql?: postgres.Sql;
  runMigrations: () => Promise<void>;
  rollbackLastMigration: () => Promise<void>;
  withTransaction: <T>(fn: (tx: AuthQueryRunner) => Promise<T>) => Promise<T>;
  close: () => Promise<void>;
}

const DB_URL_PLACEHOLDERS = new Set([
  '',
  'YOUR_SUPABASE_DATABASE_URL',
  'postgresql://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres',
]);

export function resolvePostgresConnectionUrl(): string {
  const raw = (process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || '').trim();
  if (!raw || DB_URL_PLACEHOLDERS.has(raw)) return '';
  if (raw.includes('[PROJECT-REF]') || raw.includes('[PASSWORD]')) return '';
  if (!/^postgres(ql)?:\/\//i.test(raw)) return '';
  return raw;
}

export function toIsoTimestamp(value: string | Date | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export function toBool(value: number | boolean | null | undefined): boolean {
  return value === true || value === 1;
}

export function isUniqueConstraintError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const record = err as { code?: unknown; message?: unknown };
  if (record.code === '23505') return true;
  const msg = typeof record.message === 'string' ? record.message : '';
  return msg.includes('UNIQUE') || msg.toLowerCase().includes('duplicate key');
}

function getDefaultSqlitePath(): string {
  const configured = (process.env.AUTH_DB_PATH ?? '').trim();
  if (configured) return configured;
  if (process.env.VERCEL) {
    return path.join(os.tmpdir(), 'nextrade-data', 'nextrade-auth.sqlite');
  }
  return path.join(PROJECT_ROOT, '.data', 'nextrade-auth.sqlite');
}

function createSqliteRunner(db: DatabaseSync): AuthQueryRunner {
  return {
    dialect: 'sqlite',
    queryOne: async <T>(sqliteSql: string, _pgSql: string, params: unknown[] = []) => {
      const row = db.prepare(sqliteSql).get(...(params as SQLInputValue[]));
      return row as T | undefined;
    },
    queryAll: async <T>(sqliteSql: string, _pgSql: string, params: unknown[] = []) => {
      return db.prepare(sqliteSql).all(...(params as SQLInputValue[])) as unknown as T[];
    },
    execute: async (sqliteSql: string, _pgSql: string, params: unknown[] = []) => {
      const info = db.prepare(sqliteSql).run(...(params as SQLInputValue[]));
      return { changes: Number(info.changes ?? 0) };
    },
  };
}

function createPostgresRunner(sql: postgres.Sql): AuthQueryRunner {
  return {
    dialect: 'postgres',
    queryOne: async <T>(_sqliteSql: string, pgSql: string, params: unknown[] = []) => {
      const rows = await sql.unsafe(pgSql, params as postgres.ParameterOrJSON<never>[]);
      return rows[0] as T | undefined;
    },
    queryAll: async <T>(_sqliteSql: string, pgSql: string, params: unknown[] = []) => {
      const rows = await sql.unsafe(pgSql, params as postgres.ParameterOrJSON<never>[]);
      return rows as unknown as T[];
    },
    execute: async (_sqliteSql: string, pgSql: string, params: unknown[] = []) => {
      const rows = await sql.unsafe(pgSql, params as postgres.ParameterOrJSON<never>[]);
      return { changes: Number((rows as { count?: number }).count ?? rows.length ?? 0) };
    },
  };
}

function createSqliteAuthDatabase(customDbPath?: string): AuthDatabase {
  const dbPath = customDbPath ?? getDefaultSqlitePath();
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  if (dbPath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
  }

  const migrationsDir = path.join(PROJECT_ROOT, 'migrations');
  const runner = createSqliteRunner(db);

  const runMigrations = async () => {
    const hasMigrationsTable = Boolean(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
        .get(),
    );
    const applied = new Set<string>(
      hasMigrationsTable
        ? (
            db.prepare('SELECT version FROM schema_migrations').all() as { version: string }[]
          ).map((r) => r.version)
        : [],
    );

    for (const version of ORDERED_MIGRATIONS) {
      if (applied.has(version)) continue;
      const upSqlPath = path.join(migrationsDir, `${version}.sql`);
      const upSql = fs.readFileSync(upSqlPath, 'utf8');
      db.exec(upSql);
      db.prepare('INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)').run(version);
    }
  };

  const rollbackLastMigration = async () => {
    const hasMigrationsTable = Boolean(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
        .get(),
    );
    if (!hasMigrationsTable) return;
    const latest = db
      .prepare('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1')
      .get() as { version: string } | undefined;
    if (!latest) return;
    const downSqlPath = path.join(migrationsDir, `${latest.version}.down.sql`);
    if (!fs.existsSync(downSqlPath)) {
      throw new Error(`Missing rollback migration file for ${latest.version}`);
    }
    const downSql = fs.readFileSync(downSqlPath, 'utf8');
    db.exec(downSql);
  };

  const withTransaction = async <T>(fn: (tx: AuthQueryRunner) => Promise<T>): Promise<T> => {
    db.exec('BEGIN IMMEDIATE;');
    try {
      const result = await fn(runner);
      db.exec('COMMIT;');
      return result;
    } catch (err) {
      try {
        db.exec('ROLLBACK;');
      } catch {
        // ignore rollback failure if already aborted
      }
      throw err;
    }
  };

  return {
    ...runner,
    dbPath,
    sqliteDb: db,
    runMigrations,
    rollbackLastMigration,
    withTransaction,
    close: async () => {
      db.close();
    },
  };
}

async function createPostgresAuthDatabase(connectionUrl: string): Promise<AuthDatabase> {
  const isLocalHost =
    connectionUrl.includes('localhost') ||
    connectionUrl.includes('127.0.0.1');

  const sql = postgres(connectionUrl, {
    prepare: false, // Compatible with Supabase PgBouncer Transaction Pooler (port 6543)
    max_pipeline: 1, // Avoid pipelining deadlock over PgBouncer transaction pooling
    ssl: isLocalHost ? false : 'require',
    max: 10,
    idle_timeout: 20,
    connect_timeout: 15,
  });

  const migrationsDir = path.join(PROJECT_ROOT, 'migrations', 'postgres');
  const runner = createPostgresRunner(sql);

  const runMigrations = async () => {
    const tableCheck = await sql.unsafe(
      "SELECT to_regclass('public.schema_migrations') AS tbl",
    );
    const hasTable = Boolean((tableCheck[0] as { tbl?: string | null } | undefined)?.tbl);
    const applied = new Set<string>();
    if (hasTable) {
      const rows = await sql.unsafe('SELECT version FROM schema_migrations');
      for (const row of rows) {
        const v = (row as { version?: string }).version;
        if (v) applied.add(v);
      }
    }

    for (const version of ORDERED_MIGRATIONS) {
      if (applied.has(version)) continue;
      const upSqlPath = path.join(migrationsDir, `${version}.sql`);
      await sql.file(upSqlPath);
      await sql.unsafe(
        'INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT (version) DO NOTHING',
        [version],
      );
    }
  };

  const rollbackLastMigration = async () => {
    const tableCheck = await sql.unsafe(
      "SELECT to_regclass('public.schema_migrations') AS tbl",
    );
    const hasTable = Boolean((tableCheck[0] as { tbl?: string | null } | undefined)?.tbl);
    if (!hasTable) return;
    const rows = await sql.unsafe(
      'SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1',
    );
    const latest = (rows[0] as { version?: string } | undefined)?.version;
    if (!latest) return;
    const downSqlPath = path.join(migrationsDir, `${latest}.down.sql`);
    if (!fs.existsSync(downSqlPath)) {
      throw new Error(`Missing Postgres rollback migration file for ${latest}`);
    }
    await sql.file(downSqlPath);
  };

  const withTransaction = async <T>(fn: (tx: AuthQueryRunner) => Promise<T>): Promise<T> => {
    return (await sql.begin(async (txSql) => {
      const txRunner = createPostgresRunner(txSql as unknown as postgres.Sql);
      return await fn(txRunner);
    })) as T;
  };

  return {
    ...runner,
    dbPath: 'supabase-postgres',
    pgSql: sql,
    runMigrations,
    rollbackLastMigration,
    withTransaction,
    close: async () => {
      await sql.end({ timeout: 5 });
    },
  };
}

export async function createAuthDatabase(customDbPath?: string): Promise<AuthDatabase> {
  const pgUrl = customDbPath ? '' : resolvePostgresConnectionUrl();
  if (pgUrl) {
    try {
      const database = await createPostgresAuthDatabase(pgUrl);
      await database.runMigrations();
      return database;
    } catch (err) {
      console.warn(
        '[Nextrade DB] PostgreSQL connection/migration failed, falling back to SQLite:',
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  const database = createSqliteAuthDatabase(customDbPath);
  await database.runMigrations();
  return database;
}
