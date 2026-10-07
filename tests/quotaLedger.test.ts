import { describe, expect, test } from 'bun:test';
import type { CodexQuotaState, KimiQuotaState } from '@/types';
import {
  getLedgerAccountLabel,
  ledgerMetricsFor,
  maskLedgerEmail,
  summarizeLedgerMetrics,
  type LedgerMetric,
} from '@/features/quota/quotaLedgerModel';

const weekly = (remaining: number | null, resetAtMs = 2000): LedgerMetric => ({
  id: 'weekly',
  label: 'Weekly limit',
  remaining,
  resetAtMs,
  periodHours: 168,
});

describe('quota ledger totals', () => {
  test('adds account remaining capacity and preserves unloaded accounts as unknown', () => {
    const result = summarizeLedgerMetrics([[weekly(74)], [weekly(25, 3000)], []], 1000);
    expect(result.remaining).toBe(99);
    expect(result.capacity).toBe(300);
    expect(result.loadedCount).toBe(2);
    expect(result.segments[2]).toBeUndefined();
    expect(result.nextResetAtMs).toBe(2000);
  });

  test('unloaded, failed, and missing percentages never look like exhausted quotas', () => {
    expect(summarizeLedgerMetrics([[], [weekly(null)]], 1000).remaining).toBeNull();
    expect(ledgerMetricsFor('codex', { status: 'error', error: 'offline' })).toEqual([]);
    expect(ledgerMetricsFor('codex', undefined)).toEqual([]);
  });

  test('compares the ordinary weekly window, never a five-hour or model-specific limit', () => {
    const session = { ...weekly(90), id: 'five-hour', periodHours: 5 };
    const spark = { ...weekly(100), id: 'spark-weekly' };
    const result = summarizeLedgerMetrics([[session, spark, weekly(12)], [session]], 1000);
    expect(result.primary?.id).toBe('weekly');
    expect(result.remaining).toBe(12);
    expect(result.loadedCount).toBe(1);
  });

  test('ignores elapsed reset times without hiding reported capacity', () => {
    const result = summarizeLedgerMetrics([[weekly(100, 500)], [weekly(40, 3000)]], 1000);
    expect(result.remaining).toBe(140);
    expect(result.nextResetAtMs).toBe(3000);
  });

  test('converts used percentages and handles non-finite observations', () => {
    const quota: CodexQuotaState = {
      status: 'success',
      windows: [
        { id: 'weekly', label: 'Weekly', usedPercent: 26, resetLabel: '', resetAtMs: null },
        { id: 'bad', label: 'Bad payload', usedPercent: Number.NaN, resetLabel: '' },
      ],
    };
    expect(ledgerMetricsFor('codex', quota).map((metric) => metric.remaining)).toEqual([74, null]);
  });

  test('a Kimi zero limit is unknown, while a reported used amount gives remaining capacity', () => {
    const quota: KimiQuotaState = {
      status: 'success',
      rows: [
        { id: 'weekly', used: 30, limit: 120 },
        { id: 'missing', used: 0, limit: 0 },
      ],
    };
    expect(ledgerMetricsFor('kimi', quota).map((metric) => metric.remaining)).toEqual([75, null]);
  });
});

describe('quota ledger identity privacy', () => {
  test('distinguishes accounts with the same initial using their actual public email', () => {
    const first = { name: 'codex-1234abcd.json', email: 'robin.personal@example.com' };
    const second = { name: 'codex-5678efab.json', email: 'robin.work@example.com' };
    expect(getLedgerAccountLabel(first, true)).toBe('robin.personal@example.com');
    expect(getLedgerAccountLabel(second, true)).toBe('robin.work@example.com');
    expect(getLedgerAccountLabel(first, false)).toBe('r•••@e•••.com');
  });
  test('never displays secret account fields or guesses an email from a filename', () => {
    expect(
      getLedgerAccountLabel({ name: 'codex-work.json', account: 'secret-api-key' }, true)
    ).toBe('codex-work');
    expect(getLedgerAccountLabel({ name: 'codex-hash-a-b@example.com-team.json' }, true)).toBe(
      'codex-hash-a-b@example.com-team'
    );
  });
  test('masks emails embedded in filenames and appended display identities', () => {
    const masked = maskLedgerEmail('codex-id-alice@example.com-plus.json · bob@company.dev');
    expect(masked).not.toContain('alice');
    expect(masked).not.toContain('example');
    expect(masked).not.toContain('bob');
    expect(masked).not.toContain('company');
    expect(masked).toContain('•••');
  });
  test('keeps non-email credential names readable', () => {
    expect(maskLedgerEmail('codex-work.json')).toBe('codex-work.json');
  });
  test('uses the email initial and preserves credential identifiers to distinguish accounts', () => {
    expect(maskLedgerEmail('codex-1234abcd-alice@example.com-plus.json')).toBe(
      'codex-1234abcd-a•••@e•••.com-plus.json'
    );
    expect(maskLedgerEmail('codex-5678efab-alice@example.com-plus.json')).toBe(
      'codex-5678efab-a•••@e•••.com-plus.json'
    );
    expect(maskLedgerEmail('bob@company.dev')).toBe('b•••@c•••.dev');
  });
});
