'use client';

import { create } from 'zustand';
import type { ComposerValues } from './schema';

/**
 * Cross-route composer draft state — report §6.4 is explicit that Zustand is
 * used only for "cross-route composer drafts and upload progress", and that all
 * API data is NOT mirrored into a global store.
 *
 * Local persistence implements report §6.8: an unsent draft survives a reload
 * or a lost connection, but a *send* is never queued offline because it needs a
 * canonical server version and timestamp.
 */

const STORAGE_PREFIX = 'extrawork.draft.';
const STORAGE_VERSION = 1;

export interface UploadProgress {
  fileObjectId: string;
  filename: string;
  status: 'UPLOADING' | 'SCANNING' | 'READY' | 'FAILED';
  percent: number;
  error?: string;
}

interface DraftState {
  /** Keyed by change-order id, or `new:{projectId}` before one exists. */
  drafts: Record<string, { values: ComposerValues; savedAt: number; lockVersion: number | null }>;
  uploads: Record<string, UploadProgress[]>;
  /** Last server sync per draft, for the "Saved" indicator. */
  syncedAt: Record<string, number>;

  setDraft: (key: string, values: ComposerValues, lockVersion: number | null) => void;
  getDraft: (key: string) => ComposerValues | null;
  markSynced: (key: string) => void;
  clearDraft: (key: string) => void;
  setUploads: (key: string, uploads: UploadProgress[]) => void;
  hydrate: (key: string) => void;
}

function persist(key: string, payload: unknown): void {
  try {
    localStorage.setItem(
      `${STORAGE_PREFIX}${key}`,
      JSON.stringify({ v: STORAGE_VERSION, payload }),
    );
  } catch {
    // A full or unavailable localStorage must never break the composer; the
    // server-side autosave is the real durability mechanism.
  }
}

function read(
  key: string,
): { values: ComposerValues; savedAt: number; lockVersion: number | null } | null {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { v: number; payload: unknown };
    if (parsed.v !== STORAGE_VERSION) return null;
    return parsed.payload as {
      values: ComposerValues;
      savedAt: number;
      lockVersion: number | null;
    };
  } catch {
    return null;
  }
}

export const useDraftStore = create<DraftState>((set, get) => ({
  drafts: {},
  uploads: {},
  syncedAt: {},

  setDraft: (key, values, lockVersion) => {
    const entry = { values, savedAt: Date.now(), lockVersion };
    persist(key, entry);
    set((state) => ({ drafts: { ...state.drafts, [key]: entry } }));
  },

  getDraft: (key) => get().drafts[key]?.values ?? null,

  markSynced: (key) => set((state) => ({ syncedAt: { ...state.syncedAt, [key]: Date.now() } })),

  clearDraft: (key) => {
    try {
      localStorage.removeItem(`${STORAGE_PREFIX}${key}`);
    } catch {
      /* ignore */
    }
    set((state) => {
      const drafts = { ...state.drafts };
      const uploads = { ...state.uploads };
      delete drafts[key];
      delete uploads[key];
      return { drafts, uploads };
    });
  },

  setUploads: (key, uploads) => set((state) => ({ uploads: { ...state.uploads, [key]: uploads } })),

  hydrate: (key) => {
    const stored = read(key);
    if (stored) set((state) => ({ drafts: { ...state.drafts, [key]: stored } }));
  },
}));

/** Removes drafts abandoned locally for 30 days, mirroring the server policy. */
export function pruneLocalDrafts(maxAgeDays = 30): void {
  try {
    const cutoff = Date.now() - maxAgeDays * 86_400_000;
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (!key?.startsWith(STORAGE_PREFIX)) continue;
      const entry = read(key.slice(STORAGE_PREFIX.length));
      if (!entry || entry.savedAt < cutoff) localStorage.removeItem(key);
    }
  } catch {
    /* ignore */
  }
}
