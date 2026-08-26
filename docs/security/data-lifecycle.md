# Data lifecycle and local backup

All source, task, event, analysis, memory, approval, invocation, and audit records carry `userId`. `UserDataLifecycle` provides:

- Export: a versioned JSON-compatible snapshot of every user-scoped collection.
- Backup: the same snapshot with an explicit local-backup format and encryption warning. The application does not claim that plaintext JSON is encrypted; store it only on encrypted local media.
- Delete: removes the user identity and every scoped task, step, event, source record, analysis, memory, approval, invocation, session, and audit record.
- Retention purge: deletes event/audit/invocation history older than the selected cutoff; session and approval expiry also use MongoDB TTL indexes.

Deletion is permanent. Export and verify a backup first when recovery may be required.
