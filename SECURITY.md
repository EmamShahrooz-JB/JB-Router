# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Use GitHub's
[private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
(Repository → Security → Advisories → *Report a vulnerability*) or contact the maintainer
directly. We aim to acknowledge reports within a few days.

## Deployment hardening checklist

JB-Router is a self-hosted gateway that holds provider credentials, so treat the deployment
as a secret store:

- Set a strong `JWT_SECRET` and change `INITIAL_PASSWORD` right after the first login.
- Keep `AUTH_COOKIE_SECURE=true` on HTTPS deployments.
- Leave **Require API key** enabled on the Endpoint page so `/v1` is never open.
- Create one API key per client and pause/delete it when a device stops being used.
- Never commit `.dev.vars`, `.env*`, Wrangler state (`.wrangler/`) or Durable Object exports.
- Provider tokens are stored in the deployment's Durable Object SQLite — they are only as
  safe as your Cloudflare account. Use a scoped Cloudflare token and enable 2FA.
- Rotate a credential immediately if it was ever pasted into a chat, issue or log.
