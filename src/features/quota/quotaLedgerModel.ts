import type {
  AuthFileItem,
  AntigravityQuotaState,
  ClaudeQuotaState,
  CodexQuotaState,
  DevinQuotaState,
  KimiQuotaState,
  MetaQuotaState,
  XaiQuotaState,
} from '@/types';
import { deriveAuthFileIdentity } from '@/features/authFiles/identity';
import type { QuotaCardState } from './providers';
import type { QuotaProviderType } from './providers/types';

export interface LedgerMetric {
  id: string;
  label: string;
  labelKey?: string;
  labelParams?: Record<string, string | number>;
  remaining: number | null;
  resetAtMs: number | null;
  resetLabel?: string;
  periodHours: number | null;
}

const percent = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;

const remainingFromUsed = (used: number | null | undefined): number | null =>
  typeof used === 'number' && Number.isFinite(used) ? percent(100 - used) : null;

/** Reuse already-normalized observations; the ledger never fetches or changes credentials. */
export function ledgerMetricsFor(
  provider: QuotaProviderType,
  quota: QuotaCardState | undefined
): LedgerMetric[] {
  if (quota?.status !== 'success') return [];

  if (provider === 'codex' || provider === 'claude') {
    const { windows } = quota as CodexQuotaState | ClaudeQuotaState;
    return windows.map((window) => ({
      ...window,
      remaining: remainingFromUsed(window.usedPercent),
      resetAtMs: window.resetAtMs ?? null,
      periodHours: window.periodHours ?? null,
    }));
  }
  if (provider === 'antigravity') {
    return (quota as AntigravityQuotaState).groups.flatMap((group) =>
      group.buckets.map((bucket) => ({
        id: bucket.id,
        label: bucket.label,
        remaining: percent(bucket.remainingFraction * 100),
        resetAtMs: bucket.resetAtMs ?? null,
        resetLabel: bucket.resetTime,
        periodHours: bucket.periodHours ?? null,
      }))
    );
  }
  if (provider === 'kimi') {
    return (quota as KimiQuotaState).rows.map((row) => ({
      id: row.id,
      label: row.label ?? row.id,
      labelKey: row.labelKey,
      labelParams: row.labelParams,
      remaining: row.limit > 0 ? percent(((row.limit - row.used) / row.limit) * 100) : null,
      resetAtMs: row.resetAtMs ?? null,
      resetLabel: row.resetHint,
      periodHours: row.periodHours ?? null,
    }));
  }
  if (provider === 'devin') {
    return (quota as DevinQuotaState).windows.map((window) => ({
      id: window.id,
      label: window.label ?? window.id,
      labelKey: `devin_quota.${window.id}`,
      remaining: percent(window.remainingPercent),
      resetAtMs: window.resetAtMs,
      periodHours: window.periodHours,
    }));
  }
  if (provider === 'meta') {
    return ((quota as MetaQuotaState).data?.windows ?? []).map((window) => ({
      id: window.id,
      label: window.id,
      labelKey: `meta_quota.${window.id}`,
      remaining: remainingFromUsed(window.usedPercent),
      resetAtMs: window.resetAt === undefined ? null : window.resetAt * 1000,
      periodHours: window.durationMinutes === undefined ? null : window.durationMinutes / 60,
    }));
  }
  const billing = (quota as XaiQuotaState).billing;
  if (!billing || billing.mode === 'paid-health') return [];
  return [
    {
      id: billing.periodType,
      label: billing.periodType,
      labelKey: `xai_quota.${billing.periodType === 'weekly' ? 'weekly_limit' : 'monthly_credits'}`,
      remaining: remainingFromUsed(billing.usagePercent),
      resetAtMs: billing.resetAtMs ?? null,
      periodHours: billing.periodHours ?? null,
    },
  ];
}

/** Prefer the ordinary account weekly window over model-specific or review limits. */
export function primaryLedgerMetric(metrics: LedgerMetric[]): LedgerMetric | undefined {
  return (
    metrics.find((metric) => metric.id === 'weekly' || metric.id === 'seven_day') ??
    metrics.find((metric) => metric.periodHours !== null && metric.periodHours >= 24 * 7) ??
    metrics[0]
  );
}

export function summarizeLedgerMetrics(accounts: LedgerMetric[][], now: number) {
  const primary = primaryLedgerMetric(accounts.flat());
  // Every segment refers to the same window. Missing/different windows stay unknown.
  const segments = accounts.map((metrics) => metrics.find((metric) => metric.id === primary?.id));
  const known = segments.filter(
    (metric): metric is LedgerMetric => metric !== undefined && metric.remaining !== null
  );
  const resets = known
    .map((metric) => metric.resetAtMs)
    .filter((at): at is number => at !== null && Number.isFinite(at) && at > now);
  return {
    primary,
    segments,
    loadedCount: known.length,
    remaining: known.length
      ? known.reduce((sum, metric) => sum + (metric.remaining ?? 0), 0)
      : null,
    capacity: accounts.length * 100,
    nextResetAtMs: resets.length ? Math.min(...resets) : null,
  };
}

/** Only public display names are accepted; never use the credential's account field. */
export function maskLedgerEmail(name: string): string {
  return name.replace(/[^\s@]+@[^\s@]+/g, (email) => {
    const [local, domain] = email.split('@');
    const prefix =
      local.match(/^(?:codex|claude|antigravity|kimi|xai|devin|meta)-(?:[a-f\d]{8,64}-)?/i)?.[0] ??
      '';
    const fileSuffix =
      domain.match(/(?:-(?:plus|pro|free|team|business|enterprise|max))?\.json$/i)?.[0] ?? '';
    const emailDomain = domain.slice(0, domain.length - fileSuffix.length);
    const suffix = emailDomain.match(/\.[a-z]{2,}$/i)?.[0] ?? '';
    return `${prefix}${local.slice(prefix.length, prefix.length + 1)}•••@${emailDomain.slice(0, 1)}•••${suffix}${fileSuffix}`;
  });
}

/** Prefer the backend's public identity metadata, never its secret account field. */
export function getLedgerAccountLabel(file: AuthFileItem, showEmails: boolean): string {
  const { primary } = deriveAuthFileIdentity(file);
  return showEmails ? primary : maskLedgerEmail(primary);
}
