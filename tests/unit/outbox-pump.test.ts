import { describe, expect, it } from 'vitest';
import { OUTBOX_TOPICS } from '@extrawork/contracts';
import type { OutboxRow } from '@extrawork/db';
import { jobsFor } from '../../apps/worker/src/outbox-pump.js';

function event(topic: string): OutboxRow {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    organizationId: '00000000-0000-4000-8000-000000000002',
    topic,
    aggregateId: '00000000-0000-4000-8000-000000000003',
    payload: {},
    attemptCount: 1,
    createdAt: new Date('2026-08-18T00:00:00.000Z'),
  };
}

describe('outbox topic dispatch', () => {
  it('rejects an unknown topic instead of silently acknowledging it', () => {
    expect(() => jobsFor(event('future.unknown.v1'))).toThrow(
      'Unsupported outbox topic: future.unknown.v1',
    );
  });

  it.each([OUTBOX_TOPICS.APPROVAL_DECIDED, OUTBOX_TOPICS.CHANGE_ORDER_SENT])(
    'intentionally acknowledges the declared notification-only topic %s',
    (topic) => {
      expect(jobsFor(event(topic))).toEqual([]);
    },
  );
});
