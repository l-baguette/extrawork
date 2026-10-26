import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EMPTY_COMPOSER } from '../../apps/web/src/features/composer/schema.js';
import { useDraftStore } from '../../apps/web/src/features/composer/draft-store.js';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe('composer draft hydration', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: new MemoryStorage(),
    });
  });

  afterEach(() => {
    useDraftStore.setState({ drafts: {}, uploads: {}, syncedAt: {} });
    Reflect.deleteProperty(globalThis, 'localStorage');
  });

  it('returns the persisted values so the mounted form can reset to them', () => {
    const values = {
      ...EMPTY_COMPOSER,
      title: 'Persisted electrical change',
      scope: 'Supply and install the additional electrical circuit requested on site.',
    };
    localStorage.setItem(
      'extrawork.draft.new:project-1',
      JSON.stringify({
        v: 1,
        payload: { values, savedAt: Date.now(), lockVersion: null },
      }),
    );

    expect(useDraftStore.getState().hydrate('new:project-1')).toEqual(values);
    expect(useDraftStore.getState().getDraft('new:project-1')).toEqual(values);
  });

  it('returns null when no local draft exists', () => {
    expect(useDraftStore.getState().hydrate('new:missing')).toBeNull();
  });

  it('discards a stale draft whose values no longer satisfy the composer schema', () => {
    localStorage.setItem(
      'extrawork.draft.new:stale',
      JSON.stringify({
        v: 1,
        payload: {
          values: { ...EMPTY_COMPOSER, scheduleDeltaDays: 'not-a-number' },
          savedAt: Date.now(),
          lockVersion: null,
        },
      }),
    );

    expect(useDraftStore.getState().hydrate('new:stale')).toBeNull();
    expect(useDraftStore.getState().getDraft('new:stale')).toBeNull();
  });

  it('discards malformed storage metadata rather than trusting a type cast', () => {
    localStorage.setItem(
      'extrawork.draft.new:malformed',
      JSON.stringify({
        v: 1,
        payload: { values: EMPTY_COMPOSER, savedAt: 'yesterday', lockVersion: -1.5 },
      }),
    );

    expect(useDraftStore.getState().hydrate('new:malformed')).toBeNull();
  });
});
