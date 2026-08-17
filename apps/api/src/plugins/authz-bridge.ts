/**
 * Re-exports the domain authorization surface so HTTP code imports it from one
 * place. The policy itself lives in `packages/domain` (report §14.4: no domain
 * rules in route handlers).
 */
export {
  assertFreshAuthentication,
  assertWritableSubscription,
  authorize,
  isAllowed,
  isMutatingAction,
  roleAllows,
  type Action,
  type Actor,
} from '@extrawork/domain';

export { privacyHash } from '@extrawork/observability';
