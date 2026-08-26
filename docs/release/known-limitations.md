# Known limitations

- Instagram DOM and access rules can change; extraction is bounded, read-oriented, and requires a user-authorized local session.
- Live Instagram validation cannot run in CI and is never enabled by default.
- The local model's quality and speed depend on available RAM, CPU/GPU, and the selected Ollama model.
- The MVP uses one configured local API session and is not an internet-facing multi-tenant identity system.
- Approval-pending work remains paused across restart; the user must make a fresh explicit decision through the API/dashboard.
- Backups are local plaintext unless the operator encrypts the destination as documented in the data-lifecycle guide.
- Instagram rate limits and inaccessible/private accounts are reported per account or post; the agent does not bypass them.
