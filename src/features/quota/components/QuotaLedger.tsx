import { useTranslation } from 'react-i18next';
import { IconRefreshCw } from '@/components/ui/icons';
import { useNow } from '@/hooks/useNow';
import type { ResolvedTheme } from '@/types';
import { buildResetDisplay, resolveQuotaErrorMessage } from '@/utils/quota';
import { getQuotaCacheKey, getQuotaDisplayName } from '@/utils/quota/identity';
import { getAuthFileIcon, getTypeLabel } from '@/features/authFiles/constants';
import { QUOTA_TAB_ORDER } from '../constants';
import type { QuotaFileEntry } from '../logic';
import { QUOTA_ADAPTERS, type QuotaCardState } from '../providers';
import {
  getLedgerAccountLabel,
  ledgerMetricsFor,
  maskLedgerEmail,
  summarizeLedgerMetrics,
  type LedgerMetric,
} from '../quotaLedgerModel';
import { bindQuotaClasses } from '../types';
import { QuotaMeter } from './QuotaMeter';
import bodyStyles from './QuotaBody.module.scss';
import styles from './QuotaLedger.module.scss';

const meterClasses = bindQuotaClasses(bodyStyles, 'QuotaBody.module.scss');

type QuotaLedgerProps = {
  entries: QuotaFileEntry[];
  summaryEntries: QuotaFileEntry[];
  quotaFor: (entry: QuotaFileEntry) => QuotaCardState | undefined;
  resolvedTheme: ResolvedTheme;
  showEmails: boolean;
  canRefresh: boolean;
  resettingName: string | null;
  onRefresh: (entry: QuotaFileEntry) => void;
  onReset: (entry: QuotaFileEntry) => void;
};

function Metric({ metric, now }: { metric: LedgerMetric; now: number }) {
  const { t, i18n } = useTranslation();
  const label = metric.labelKey ? t(metric.labelKey, metric.labelParams) : metric.label;
  const reset = buildResetDisplay(metric.resetLabel, metric.resetAtMs, now, i18n.resolvedLanguage);
  return (
    <div className={styles.metric}>
      <div className={styles.metricHeader}>
        <span>{label}</span>
        <strong>{metric.remaining === null ? '--' : `${Math.round(metric.remaining)}%`}</strong>
      </div>
      <QuotaMeter percent={metric.remaining} classes={meterClasses} />
      <div className={styles.reset}>
        {reset?.relative ? (
          <>
            <span>{reset.relative}</span>
            <span> · {reset.absolute}</span>
          </>
        ) : (
          reset?.absolute ||
          t(
            `quota_management.${metric.remaining === 100 ? 'ledger_no_reset' : 'ledger_reset_unavailable'}`
          )
        )}
      </div>
    </div>
  );
}

export function QuotaLedger(props: QuotaLedgerProps) {
  const {
    entries,
    summaryEntries,
    quotaFor,
    resolvedTheme,
    showEmails,
    canRefresh,
    resettingName,
    onRefresh,
    onReset,
  } = props;
  const { t, i18n } = useTranslation();
  const now = useNow();

  return (
    <div className={styles.ledger}>
      <section className={styles.summary} aria-label={t('quota_management.ledger_summary')}>
        {QUOTA_TAB_ORDER.map((type) => {
          const group = summaryEntries.filter((entry) => entry.type === type);
          if (!group.length) return null;
          const summary = summarizeLedgerMetrics(
            group.map((entry) => ledgerMetricsFor(type, quotaFor(entry))),
            now
          );
          const icon = getAuthFileIcon(type, resolvedTheme);
          const primary = summary.primary;
          const reset = buildResetDisplay(
            undefined,
            summary.nextResetAtMs,
            now,
            i18n.resolvedLanguage
          );
          return (
            <article key={type} className={styles.summaryProvider}>
              <header className={styles.providerHeader}>
                <strong>
                  {icon && <img src={icon} alt="" />}
                  {getTypeLabel(t, type)}
                </strong>
                <span>{t('quota_management.meta_credentials', { count: group.length })}</span>
              </header>
              <div className={styles.summaryLabel}>
                {primary
                  ? primary.labelKey
                    ? t(primary.labelKey, primary.labelParams)
                    : primary.label
                  : t('quota_management.ledger_not_loaded')}
              </div>
              <div
                className={styles.summaryValue}
                title={t('quota_management.ledger_normalized_hint')}
              >
                <strong>
                  {summary.remaining === null ? '--' : `${Math.round(summary.remaining)}%`}
                </strong>
                <span>{t('quota_management.ledger_of', { capacity: summary.capacity })}</span>
              </div>
              <div className={styles.segments}>
                {summary.segments.map((metric, index) => (
                  <div key={getQuotaCacheKey(group[index].file)}>
                    <QuotaMeter percent={metric?.remaining ?? null} classes={meterClasses} />
                  </div>
                ))}
              </div>
              <div className={styles.reset}>
                {reset?.relative ? (
                  <>
                    <span>{reset.relative}</span>
                    <span> · {reset.absolute}</span>
                  </>
                ) : (
                  t(
                    `quota_management.${summary.remaining === summary.capacity ? 'ledger_no_reset' : 'ledger_reset_unavailable'}`
                  )
                )}
              </div>
              {summary.loadedCount < group.length && (
                <div className={styles.partial}>
                  {t('quota_management.ledger_partial', {
                    loaded: summary.loadedCount,
                    total: group.length,
                  })}
                </div>
              )}
            </article>
          );
        })}
      </section>

      {QUOTA_TAB_ORDER.map((type) => {
        const group = entries.filter((entry) => entry.type === type);
        if (!group.length) return null;
        const adapter = QUOTA_ADAPTERS[type];
        return (
          <section key={type} className={styles.providerGroup} aria-label={getTypeLabel(t, type)}>
            <h2>
              {getTypeLabel(t, type)} <span>{group.length}</span>
            </h2>
            {group.map((entry) => {
              const key = getQuotaCacheKey(entry.file);
              const quota = quotaFor(entry);
              const status = quota?.status ?? 'idle';
              const busy = status === 'loading' || resettingName === key;
              const metrics = ledgerMetricsFor(type, quota);
              const rawName = getQuotaDisplayName(entry.file);
              const name = getLedgerAccountLabel(entry.file, showEmails);
              const plan = (quota as { planType?: string } | undefined)?.planType;
              const showReset =
                quota?.status === 'success' && adapter.resetQuota && adapter.canResetQuota?.(quota);
              return (
                <article key={key} className={styles.accountRow} aria-busy={busy}>
                  <div className={styles.identity}>
                    <strong title={name}>{name}</strong>
                    {plan && <span className={styles.plan}>{plan}</span>}
                    {quota?.status === 'success' && (
                      <details className={styles.details}>
                        <summary>{t('quota_management.ledger_details')}</summary>
                        <div className={styles.detailsBody}>
                          <code className={styles.fileName}>
                            {showEmails ? rawName : maskLedgerEmail(rawName)}
                          </code>
                          <adapter.Body quota={quota} classes={meterClasses} />
                        </div>
                      </details>
                    )}
                  </div>
                  <div className={styles.metrics}>
                    {metrics.length ? (
                      metrics.map((metric) => <Metric key={metric.id} metric={metric} now={now} />)
                    ) : (
                      <div className={styles.status} role={status === 'error' ? 'alert' : 'status'}>
                        {status === 'error'
                          ? resolveQuotaErrorMessage(
                              t,
                              quota?.errorStatus,
                              quota?.error || t('common.unknown_error')
                            )
                          : t(`${adapter.i18nPrefix}.${busy ? 'loading' : 'idle'}`)}
                      </div>
                    )}
                  </div>
                  <div className={styles.actions}>
                    {showReset && (
                      <button
                        type="button"
                        disabled={!canRefresh || busy}
                        onClick={() => onReset(entry)}
                      >
                        <IconRefreshCw size={14} />
                        {t('codex_quota.reset_button')}
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={!canRefresh || busy || entry.file.disabled}
                      onClick={() => onRefresh(entry)}
                      aria-label={`${t('auth_files.quota_refresh_single')}: ${name}`}
                    >
                      <IconRefreshCw size={14} className={busy ? styles.spinning : undefined} />
                      {t('auth_files.quota_refresh_single')}
                    </button>
                  </div>
                </article>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
