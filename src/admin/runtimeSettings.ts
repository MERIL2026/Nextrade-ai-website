import crypto from 'node:crypto';
import type { AuthDatabase } from '../auth/db';
import { redactSensitiveText } from './observabilityMath';
import {
  APPROVED_GEMINI_MODELS,
  DEFAULT_PLATFORM_CONFIG,
  PlatformConfigBundle,
} from './types';

export const DEFAULT_RESEARCH_SYSTEM_PROMPT =
  'You are Nextrade AI Research Engine, an objective, explainable financial intelligence assistant. Be concise, institutional, balanced, and risk-aware. Never promise profits, guaranteed predictions, or personalized financial advice.';

export const DEFAULT_RESEARCH_USER_TEMPLATE =
  'Analyze the financial research topic for {{symbol}} covering key drivers, valuation context, market structure, and downside risk dispersion: {{query}}';

export interface ActivePromptConfig {
  id: string;
  versionNumber: number;
  title: string;
  systemPrompt: string;
  userPromptTemplate: string;
  modelTarget: string;
}

export interface ActiveAiPolicyConfig {
  id: string;
  versionNumber: number;
  name: string;
  allowedModels: string[];
  defaultModel: string;
  fallbackModel: string;
  fallbackEnabled: boolean;
  rateLimitPerMin: number;
  maxInputChars: number;
  maxOutputTokens: number;
  timeoutMs: number;
  safetyMode: 'STRICT' | 'STANDARD';
  redactSensitiveInputs: boolean;
  blockPromptInjection: boolean;
  disabledCapabilities: string[];
}

export interface RuntimeConfigManager {
  getConfig: () => Promise<PlatformConfigBundle>;
  invalidateCache: () => void;
  getActivePrompt: () => Promise<ActivePromptConfig>;
  getActiveAiPolicy: () => Promise<ActiveAiPolicyConfig | null>;
  ensureSeeded: () => Promise<void>;
  updateSetting: (
    key: keyof PlatformConfigBundle,
    value: PlatformConfigBundle[keyof PlatformConfigBundle],
    adminId: string | null,
    reason?: string,
  ) => Promise<{
    previous: PlatformConfigBundle[keyof PlatformConfigBundle];
    next: PlatformConfigBundle[keyof PlatformConfigBundle];
  }>;
  recordAiRequest: (entry: {
    userId: string | null;
    symbol: string;
    queryPreview: string;
    feature: 'workspace_research' | 'public_research';
    provider: string;
    model: string;
    status: 'SUCCESS' | 'FALLBACK' | 'FAILED' | 'BLOCKED';
    latencyMs: number;
    promptTokens: number | null;
    completionTokens: number | null;
    totalTokens: number | null;
    errorMessage: string | null;
  }) => Promise<void>;
}

const SETTING_DESCRIPTIONS: Record<keyof PlatformConfigBundle, { category: string; description: string }> = {
  maintenance_mode: {
    category: 'operations',
    description: 'Controls public/workspace maintenance gate while keeping /admin recovery routes open.',
  },
  feature_flags: {
    category: 'features',
    description: 'Platform capability toggles for AI research, paper trading, public signup, and banners.',
  },
  ai_config: {
    category: 'ai',
    description: 'Active Gemini model, AI Building Mode / provider policy, and query character bounds.',
  },
  market_data_config: {
    category: 'markets',
    description: 'Market data classification, active regions, and disabled instrument symbols.',
  },
  rate_limits: {
    category: 'security',
    description: 'Sliding-window rate-limit thresholds enforced across public and authenticated endpoints.',
  },
  workspace_defaults: {
    category: 'workspace',
    description: 'Default region, display currency, and chart timeframe for newly provisioned workspaces.',
  },
  alert_thresholds: {
    category: 'observability',
    description: 'Configurable observability alert thresholds, cooldown windows, and telemetry retention days.',
  },
  governance_policies: {
    category: 'governance',
    description: 'Platform governance, privacy export/deletion lifecycle windows, retention rules, and notification flags.',
  },
};

export function createRuntimeConfigManager(db: AuthDatabase): RuntimeConfigManager {
  const isPg = db.dialect === 'postgres';
  const boolVal = (v: boolean) => (isPg ? v : v ? 1 : 0);

  let cachedConfig: { value: PlatformConfigBundle; expiresAt: number } | null = null;
  let cachedPrompt: { value: ActivePromptConfig; expiresAt: number } | null = null;
  let cachedAiPolicy: { value: ActiveAiPolicyConfig | null; expiresAt: number } | null = null;
  let seedPromise: Promise<void> | null = null;

  const CACHE_TTL_MS = 5000;

  function invalidateCache() {
    cachedConfig = null;
    cachedPrompt = null;
    cachedAiPolicy = null;
  }

  async function ensureSeededInternal() {
    const nowIso = new Date().toISOString();

    for (const key of Object.keys(DEFAULT_PLATFORM_CONFIG) as Array<keyof PlatformConfigBundle>) {
      const meta = SETTING_DESCRIPTIONS[key];
      const existing = await db.queryOne<{ setting_key: string }>(
        'SELECT setting_key FROM platform_settings WHERE setting_key = ?',
        'SELECT setting_key FROM platform_settings WHERE setting_key = $1',
        [key],
      );
      if (!existing) {
        await db.execute(
          `INSERT INTO platform_settings (setting_key, value_json, category, is_sensitive, description, updated_by, updated_at)
           VALUES (?, ?, ?, ?, ?, NULL, ?)`,
          `INSERT INTO platform_settings (setting_key, value_json, category, is_sensitive, description, updated_by, updated_at)
           VALUES ($1, $2, $3, $4, $5, NULL, $6::timestamptz)
           ON CONFLICT (setting_key) DO NOTHING`,
          [
            key,
            JSON.stringify(DEFAULT_PLATFORM_CONFIG[key]),
            meta.category,
            boolVal(false),
            meta.description,
            nowIso,
          ],
        );
      }
    }

    const existingPrompt = await db.queryOne<{ id: string }>(
      "SELECT id FROM ai_prompt_versions WHERE template_key = 'equity_research_system' LIMIT 1",
      "SELECT id FROM ai_prompt_versions WHERE template_key = 'equity_research_system' LIMIT 1",
    );
    if (!existingPrompt) {
      await db.execute(
        `INSERT INTO ai_prompt_versions (id, template_key, version_number, title, system_prompt, user_prompt_template, model_target, status, notes, created_by, activated_at, created_at)
         VALUES (?, 'equity_research_system', 1, ?, ?, ?, ?, 'ACTIVE', ?, NULL, ?, ?)`,
        `INSERT INTO ai_prompt_versions (id, template_key, version_number, title, system_prompt, user_prompt_template, model_target, status, notes, created_by, activated_at, created_at)
         VALUES ($1, 'equity_research_system', 1, $2, $3, $4, $5, 'ACTIVE', $6, NULL, $7::timestamptz, $8::timestamptz)
         ON CONFLICT (template_key, version_number) DO NOTHING`,
        [
          crypto.randomUUID(),
          'Default Explainable Research System Prompt',
          DEFAULT_RESEARCH_SYSTEM_PROMPT,
          DEFAULT_RESEARCH_USER_TEMPLATE,
          APPROVED_GEMINI_MODELS[0],
          'Initial verified baseline production prompt.',
          nowIso,
          nowIso,
        ],
      );
    }
  }

  async function ensureSeeded() {
    if (!seedPromise) {
      seedPromise = ensureSeededInternal().catch((err) => {
        seedPromise = null;
        throw err;
      });
    }
    await seedPromise;
  }

  async function getConfig(): Promise<PlatformConfigBundle> {
    if (cachedConfig && cachedConfig.expiresAt > Date.now()) {
      return cachedConfig.value;
    }

    await ensureSeeded();

    const rows = await db.queryAll<{ setting_key: string; value_json: string }>(
      'SELECT setting_key, value_json FROM platform_settings',
      'SELECT setting_key, value_json FROM platform_settings',
    );

    const bundle: PlatformConfigBundle = structuredClone(DEFAULT_PLATFORM_CONFIG);

    for (const row of rows) {
      const k = row.setting_key as keyof PlatformConfigBundle;
      if (!(k in DEFAULT_PLATFORM_CONFIG)) continue;
      try {
        const parsed = JSON.parse(row.value_json);
        if (parsed && typeof parsed === 'object') {
          (bundle[k] as unknown) = {
            ...(DEFAULT_PLATFORM_CONFIG[k] as unknown as Record<string, unknown>),
            ...(parsed as Record<string, unknown>),
          };
        }
      } catch {
        // Keep safe defaults on malformed JSON
      }
    }

    cachedConfig = {
      value: bundle,
      expiresAt: Date.now() + CACHE_TTL_MS,
    };
    return bundle;
  }

  async function getActivePrompt(): Promise<ActivePromptConfig> {
    if (cachedPrompt && cachedPrompt.expiresAt > Date.now()) {
      return cachedPrompt.value;
    }

    await ensureSeeded();
    const row = await db.queryOne<{
      id: string;
      version_number: number;
      title: string;
      system_prompt: string;
      user_prompt_template: string;
      model_target: string;
    }>(
      `SELECT id, version_number, title, system_prompt, user_prompt_template, model_target
       FROM ai_prompt_versions
       WHERE template_key = 'equity_research_system' AND status = 'ACTIVE'
       ORDER BY version_number DESC LIMIT 1`,
      `SELECT id, version_number, title, system_prompt, user_prompt_template, model_target
       FROM ai_prompt_versions
       WHERE template_key = 'equity_research_system' AND status = 'ACTIVE'
       ORDER BY version_number DESC LIMIT 1`,
    );

    const active: ActivePromptConfig = row
      ? {
          id: row.id,
          versionNumber: Number(row.version_number),
          title: row.title,
          systemPrompt: row.system_prompt,
          userPromptTemplate: row.user_prompt_template,
          modelTarget: row.model_target,
        }
      : {
          id: 'default-v1',
          versionNumber: 1,
          title: 'Default Explainable Research System Prompt',
          systemPrompt: DEFAULT_RESEARCH_SYSTEM_PROMPT,
          userPromptTemplate: DEFAULT_RESEARCH_USER_TEMPLATE,
          modelTarget: APPROVED_GEMINI_MODELS[0],
        };

    cachedPrompt = {
      value: active,
      expiresAt: Date.now() + CACHE_TTL_MS,
    };
    return active;
  }

  async function getActiveAiPolicy(): Promise<ActiveAiPolicyConfig | null> {
    if (cachedAiPolicy && cachedAiPolicy.expiresAt > Date.now()) {
      return cachedAiPolicy.value;
    }
    try {
      const row = await db.queryOne<Record<string, unknown>>(
        `SELECT * FROM ai_policy_versions WHERE status = 'ACTIVE' ORDER BY version_number DESC LIMIT 1`,
        `SELECT * FROM ai_policy_versions WHERE status = 'ACTIVE' ORDER BY version_number DESC LIMIT 1`,
      );
      if (!row) {
        cachedAiPolicy = { value: null, expiresAt: Date.now() + CACHE_TTL_MS };
        return null;
      }
      const parseArr = (raw: unknown, fallback: string[]) => {
        if (typeof raw !== 'string') return fallback;
        try {
          const parsed = JSON.parse(raw);
          return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : fallback;
        } catch {
          return fallback;
        }
      };
      const policy: ActiveAiPolicyConfig = {
        id: String(row.id),
        versionNumber: Number(row.version_number ?? 1),
        name: String(row.name ?? 'Baseline AI Policy'),
        allowedModels: parseArr(row.allowed_models_json, [...APPROVED_GEMINI_MODELS]),
        defaultModel: String(row.default_model ?? APPROVED_GEMINI_MODELS[0]),
        fallbackModel: String(row.fallback_model ?? 'none'),
        fallbackEnabled: row.fallback_enabled === true || row.fallback_enabled === 1,
        rateLimitPerMin: Number(row.rate_limit_per_min ?? 25),
        maxInputChars: Number(row.max_input_chars ?? 1000),
        maxOutputTokens: Number(row.max_output_tokens ?? 1400),
        timeoutMs: Number(row.timeout_ms ?? 18000),
        safetyMode: row.safety_mode === 'STANDARD' ? 'STANDARD' : 'STRICT',
        redactSensitiveInputs: row.redact_sensitive_inputs === true || row.redact_sensitive_inputs === 1,
        blockPromptInjection: row.block_prompt_injection === true || row.block_prompt_injection === 1,
        disabledCapabilities: parseArr(row.disabled_capabilities_json, []),
      };
      cachedAiPolicy = { value: policy, expiresAt: Date.now() + CACHE_TTL_MS };
      return policy;
    } catch {
      return null;
    }
  }

  async function updateSetting(
    key: keyof PlatformConfigBundle,
    value: PlatformConfigBundle[keyof PlatformConfigBundle],
    adminId: string | null,
    reason = '',
  ) {
    await ensureSeeded();
    const currentBundle = await getConfig();
    const previous = currentBundle[key];
    const nowIso = new Date().toISOString();
    const meta = SETTING_DESCRIPTIONS[key];

    await db.withTransaction(async (tx) => {
      await tx.execute(
        `INSERT INTO platform_settings (setting_key, value_json, category, is_sensitive, description, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(setting_key) DO UPDATE SET
           value_json = excluded.value_json,
           updated_by = excluded.updated_by,
           updated_at = excluded.updated_at`,
        `INSERT INTO platform_settings (setting_key, value_json, category, is_sensitive, description, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz)
         ON CONFLICT (setting_key) DO UPDATE SET
           value_json = EXCLUDED.value_json,
           updated_by = EXCLUDED.updated_by,
           updated_at = EXCLUDED.updated_at`,
        [
          key,
          JSON.stringify(value),
          meta.category,
          boolVal(false),
          meta.description,
          adminId,
          nowIso,
        ],
      );

      await tx.execute(
        `INSERT INTO admin_config_audit (id, admin_id, config_key, previous_value_redacted, new_value_redacted, reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        `INSERT INTO admin_config_audit (id, admin_id, config_key, previous_value_redacted, new_value_redacted, reason, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz)`,
        [
          crypto.randomUUID(),
          adminId,
          key,
          JSON.stringify(previous),
          JSON.stringify(value),
          reason.slice(0, 300),
          nowIso,
        ],
      );
    });

    invalidateCache();
    return { previous, next: value };
  }

  async function recordAiRequest(entry: {
    userId: string | null;
    symbol: string;
    queryPreview: string;
    feature: 'workspace_research' | 'public_research';
    provider: string;
    model: string;
    status: 'SUCCESS' | 'FALLBACK' | 'FAILED' | 'BLOCKED';
    latencyMs: number;
    promptTokens: number | null;
    completionTokens: number | null;
    totalTokens: number | null;
    errorMessage: string | null;
  }) {
    try {
      await db.execute(
        `INSERT INTO ai_request_logs (id, user_id, symbol, query_preview, feature, provider, model, status, latency_ms, prompt_tokens, completion_tokens, total_tokens, error_message, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        `INSERT INTO ai_request_logs (id, user_id, symbol, query_preview, feature, provider, model, status, latency_ms, prompt_tokens, completion_tokens, total_tokens, error_message, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::timestamptz)`,
        [
          crypto.randomUUID(),
          entry.userId,
          entry.symbol.slice(0, 24) || 'MARKET',
          redactSensitiveText(entry.queryPreview, 190),
          entry.feature,
          entry.provider.slice(0, 32),
          entry.model.slice(0, 64),
          entry.status,
          Math.max(0, Math.round(entry.latencyMs)),
          entry.promptTokens,
          entry.completionTokens,
          entry.totalTokens,
          entry.errorMessage ? redactSensitiveText(entry.errorMessage, 380) : null,
          new Date().toISOString(),
        ],
      );
    } catch {
      // Telemetry failures must never break primary AI research execution
    }
  }

  return {
    getConfig,
    invalidateCache,
    getActivePrompt,
    getActiveAiPolicy,
    ensureSeeded,
    updateSetting,
    recordAiRequest,
  };
}
