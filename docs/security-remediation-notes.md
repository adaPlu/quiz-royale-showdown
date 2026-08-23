# Security Remediation Notes

## Local Environment Secrets

The audit found real-looking credentials in ignored local environment files.
Those files are intentionally not tracked, so the code remediation is limited to
documenting the operational follow-up:

- Rotate any database, API, Railway, Cloudflare, email, or app-review secrets
  that were present in local `.env` files.
- Remove stale credentials from local `.env` files after rotation.
- Keep only non-secret placeholders in checked-in examples and documentation.
- Store production values in the deployment provider's secret manager.

Do not commit local `.env` files or copy their values into issue trackers,
pull requests, logs, screenshots, or support messages.
