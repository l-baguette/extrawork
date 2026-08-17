/**
 * Minimal in-process metric registry exposing a Prometheus text endpoint.
 * Report §11.5 lists the required signals; §14.1 asks for OpenTelemetry-
 * compatible instrumentation so this can be swapped for an OTel meter without
 * touching call sites.
 */

type Labels = Record<string, string | number>;

function labelKey(labels: Labels | undefined): string {
  if (!labels) return '';
  return Object.keys(labels)
    .sort()
    .map((k) => `${k}="${String(labels[k]).replace(/["\\\n]/g, '_')}"`)
    .join(',');
}

interface Series {
  help: string;
  type: 'counter' | 'gauge' | 'histogram';
  values: Map<string, number>;
  /** Histogram-only cumulative bucket state. */
  buckets?: number[];
  bucketCounts?: Map<string, number[]>;
  sums?: Map<string, number>;
  counts?: Map<string, number>;
}

export class MetricsRegistry {
  private readonly series = new Map<string, Series>();

  counter(name: string, help: string, labels?: Labels, delta = 1): void {
    const s = this.ensure(name, help, 'counter');
    const key = labelKey(labels);
    s.values.set(key, (s.values.get(key) ?? 0) + delta);
  }

  gauge(name: string, help: string, value: number, labels?: Labels): void {
    const s = this.ensure(name, help, 'gauge');
    s.values.set(labelKey(labels), value);
  }

  observe(name: string, help: string, value: number, labels?: Labels, buckets?: number[]): void {
    const s = this.ensure(name, help, 'histogram');
    s.buckets ??= buckets ?? [5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000];
    s.bucketCounts ??= new Map();
    s.sums ??= new Map();
    s.counts ??= new Map();
    const key = labelKey(labels);
    const counts = s.bucketCounts.get(key) ?? new Array(s.buckets.length).fill(0);
    for (let i = 0; i < s.buckets.length; i += 1) {
      const bound = s.buckets[i];
      if (bound !== undefined && value <= bound) counts[i] += 1;
    }
    s.bucketCounts.set(key, counts);
    s.sums.set(key, (s.sums.get(key) ?? 0) + value);
    s.counts.set(key, (s.counts.get(key) ?? 0) + 1);
  }

  private ensure(name: string, help: string, type: Series['type']): Series {
    let s = this.series.get(name);
    if (!s) {
      s = { help, type, values: new Map() };
      this.series.set(name, s);
    }
    return s;
  }

  /** Prometheus text exposition format. */
  render(): string {
    const lines: string[] = [];
    for (const [name, s] of this.series) {
      lines.push(`# HELP ${name} ${s.help}`);
      lines.push(`# TYPE ${name} ${s.type}`);
      if (s.type === 'histogram' && s.buckets && s.bucketCounts && s.sums && s.counts) {
        for (const [key, counts] of s.bucketCounts) {
          const base = key ? `${key},` : '';
          s.buckets.forEach((bound, i) => {
            lines.push(`${name}_bucket{${base}le="${bound}"} ${counts[i] ?? 0}`);
          });
          lines.push(`${name}_bucket{${base}le="+Inf"} ${s.counts.get(key) ?? 0}`);
          lines.push(`${name}_sum${key ? `{${key}}` : ''} ${s.sums.get(key) ?? 0}`);
          lines.push(`${name}_count${key ? `{${key}}` : ''} ${s.counts.get(key) ?? 0}`);
        }
      } else {
        for (const [key, value] of s.values) {
          lines.push(`${name}${key ? `{${key}}` : ''} ${value}`);
        }
      }
    }
    return `${lines.join('\n')}\n`;
  }

  reset(): void {
    this.series.clear();
  }
}

export const metrics = new MetricsRegistry();

/** Named constants so dashboards and alerts reference one spelling. */
export const METRIC = {
  HTTP_REQUESTS: 'extrawork_http_requests_total',
  HTTP_DURATION: 'extrawork_http_request_duration_ms',
  DECISION_ATTEMPTS: 'extrawork_public_decision_attempts_total',
  DECISION_FAILURES: 'extrawork_public_decision_failures_total',
  DECISION_DURATION: 'extrawork_public_decision_duration_ms',
  PUBLIC_READ_DURATION: 'extrawork_public_read_duration_ms',
  OUTBOX_OLDEST_SECONDS: 'extrawork_outbox_oldest_unpublished_seconds',
  OUTBOX_PUBLISHED: 'extrawork_outbox_published_total',
  JOB_RUNS: 'extrawork_job_runs_total',
  JOB_DURATION: 'extrawork_job_duration_ms',
  JOB_QUEUE_DEPTH: 'extrawork_job_queue_depth',
  JOB_OLDEST_SECONDS: 'extrawork_job_oldest_available_seconds',
  JOB_DEAD_LETTER: 'extrawork_job_dead_letter_total',
  PDF_DURATION: 'extrawork_pdf_generation_duration_ms',
  PDF_FAILURES: 'extrawork_pdf_generation_failures_total',
  PROVIDER_CALLS: 'extrawork_provider_calls_total',
  OTP_SENT: 'extrawork_otp_sent_total',
  OTP_VERIFIED: 'extrawork_otp_verified_total',
  INTEGRITY_MISMATCH: 'extrawork_integrity_mismatch_total',
  AUDIT_CHAIN_INVALID: 'extrawork_audit_chain_invalid_total',
  RATE_LIMIT_HITS: 'extrawork_rate_limit_hits_total',
  DB_POOL_IN_USE: 'extrawork_db_pool_in_use',
} as const;
