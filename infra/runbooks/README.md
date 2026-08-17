# Operational runbooks

Report §13.6 lists the runbooks that must exist before production. Each file
below covers one of them.

| Runbook                                                  | Report §13.6 item                                            |
| -------------------------------------------------------- | ------------------------------------------------------------ |
| [revoke-leaked-token.md](revoke-leaked-token.md)         | Revoke leaked approval token and issue a new version         |
| [rotate-credentials.md](rotate-credentials.md)           | Rotate Meta/payment/auth webhook credentials                 |
| [replay-events.md](replay-events.md)                     | Replay webhook and outbox events                             |
| [repair-project-totals.md](repair-project-totals.md)     | Repair incorrect project totals                              |
| [restore-database.md](restore-database.md)               | Restore database and verify audit chains                     |
| [failed-migration.md](failed-migration.md)               | Recover from a failed migration                              |
| [data-subject-request.md](data-subject-request.md)       | Handle customer deletion/export request                      |
| [support-access.md](support-access.md)                   | Grant and revoke support access                              |
| [cross-tenant-disclosure.md](cross-tenant-disclosure.md) | Respond to suspected cross-tenant disclosure                 |
| [freeze-organization.md](freeze-organization.md)         | Freeze one organization without affecting others             |
| [backup-and-restore.md](backup-and-restore.md)           | Backup schedule, health checks and restore rehearsal (§11.6) |

## Conventions used in every runbook

- **Never edit evidence by hand.** `audit_events`, `decisions` and frozen
  version columns are protected by triggers _and_ by role privileges
  (report §9.6, §12.1). Every legitimate correction goes through a repair
  command that records before/after digests and emits a repair event.
- **Two connections.** Ordinary operations use the runtime role
  (`DATABASE_URL`). Repairs use the maintenance role
  (`DATABASE_MAINTENANCE_URL`), which is the only one that may set
  `extrawork.allow_repair`.
- **Verify after every repair.** Run `pnpm db:verify-chain` and the project
  integrity job before declaring an incident closed.
- **Record what you did.** Every runbook ends with an audit step. A repair that
  is not recorded is indistinguishable from tampering.
