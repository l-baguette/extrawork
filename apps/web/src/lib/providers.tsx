'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError } from './api';
import { OfflineBanner } from '@/components/offline-banner';

/**
 * Server-state configuration — report §6.4.
 *
 * The retry policy matters more than it looks: report §7.6 says not to
 * automatically retry validation, authentication or policy errors. Blindly
 * retrying a 409 on a decision would also be wrong, so retries are limited to
 * genuinely transient failures.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Contractors work in short bursts on a flaky connection; a small
            // stale window avoids a refetch storm when the app regains focus.
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: true,
            retry: (failureCount, error) => {
              if (error instanceof ApiError && !error.retryable) return false;
              return failureCount < 2;
            },
            retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8_000),
          },
          mutations: {
            // Mutations carry idempotency keys, but an automatic retry still
            // hides failures from the user, so they retry explicitly instead.
            retry: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      <OfflineBanner />
      {children}
    </QueryClientProvider>
  );
}
