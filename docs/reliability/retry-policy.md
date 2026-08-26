# Retry and recovery policy

| Failure class | Examples | Retry? |
|---|---|---|
| Validation | malformed model output, invalid tool input/schema | No |
| Permission | denied, prohibited, unsafe origin | No |
| Authentication | expired browser/API session | No; user action required |
| Cancelled | user cancellation or abort | No |
| Permanent | missing model/tool/record, unsupported operation | No |
| Transient | offline dependency, connection reset, temporary provider failure | Yes, within budget |
| Timeout | bounded tool/MCP/provider timeout | Yes, within budget |
| Rate limit | explicit throttling response | Yes, within budget |

Unknown failures default to permanent. The default retry policy allows three total attempts, starts at 250 ms, caps at 5 seconds, applies ±20% jitter, and never exceeds a 15-second cumulative delay budget. Cancellation interrupts backoff immediately.

At startup, recovery claims task snapshots using their revision. Interrupted `running` tasks return to `queued`; `approval_required` tasks remain paused. Recovery preserves existing step IDs/evidence, updates the snapshot timestamp, and will not claim the same pre-start snapshot twice.
