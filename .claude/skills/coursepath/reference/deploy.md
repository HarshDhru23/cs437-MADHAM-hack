# Deploying CoursePath

The final deliverable is a hosted website judges and Aayush can open on 17 November, with accounts that persist across devices. Deployment problems surface late and look like "it works locally", so **deploy early and keep main deployable**: get a skeleton of the current main hosted as soon as possible, then redeploy after each merge.

Ownership: Harsh owns backend production settings/config (H14); Manashree owns the runbook, CI and backup rehearsal (M08); Aaryan owns the production frontend build (A12).

## Target shape (from roadmap §7 and contracts §7)

One origin. Django serves `/api/v1/*` **and** the built React app:

```
browser ── HTTPS ──> host TLS proxy ──> production WSGI server (e.g. gunicorn) ──> Django
                                                                          ├─ /api/v1/*  JSON
                                                                          ├─ /assets/*  Vite build (static files)
                                                                          └─ /*         index.html (SPA fallback for deep links)
                                                       PostgreSQL (managed, persistent)
```

No separate frontend host, no CORS, no Redis/queues.

## Gaps to close before the first hosted deploy

Observed in `server/config/settings.py` on `feature/harsh-oct27-backend` (commit `de7a0ab`, 23 Oct). Re-check each one, because it may already be fixed:

- [ ] **No production WSGI server** in `requirements.txt`. Add a pinned one (gunicorn on Linux hosts).
- [ ] **No static files config** (`STATIC_URL`, `STATIC_ROOT`, a static server such as WhiteNoise). The Vite build has nowhere to be served from.
- [ ] **No SPA fallback route.** Deep links like `/plan/<id>` will 404 on reload. Add a catch-all that returns `index.html` for non-API, non-asset paths, registered *after* the API routes.
- [ ] **`SECURE_PROXY_SSL_HEADER` not set.** Behind a platform TLS proxy, Django sees plain HTTP. `SECURE_SSL_REDIRECT=True` then loops forever, and CSRF origin checks fail on every POST. Set it to the header your host documents (usually `('HTTP_X_FORWARDED_PROTO', 'https')`).
- [ ] **`CSRF_TRUSTED_ORIGINS`** should list the exact `https://` origin (env-configured).
- [ ] **No health endpoint.** Add a cheap `GET /api/v1/health` that also touches the database, for the host's readiness check and for smoke tests.
- [ ] Logging: make sure request bodies (transcripts, grades) are never logged.

## Environment variables (names already used by settings.py)

`COURSEPATH_ENV=production`, `COURSEPATH_SECRET_KEY`, `COURSEPATH_ALLOWED_HOSTS`, `COURSEPATH_DB_NAME`, `COURSEPATH_DB_USER`, `COURSEPATH_DB_PASSWORD`, `COURSEPATH_DB_HOST`, `COURSEPATH_DB_PORT`, and `COURSEPATH_GOOGLE_CLIENT_ID` (required: the server refuses to start in production without it; password sign-in is never on in production). Keep `.env.example` listing names and descriptions only. Real values live in the host's secret settings, never in Git, CI logs or screenshots.

## Choosing a host

Pick one that gives you: HTTPS on a stable URL, a **persistent managed PostgreSQL**, environment-variable secrets, a build step and logs. Before committing to a free tier, check three things. First, whether its database **expires or is deleted** after a period, because that would wipe accounts before the demo. Second, whether the app **sleeps** and cold-starts slowly. Third, whether the local disk is ephemeral; it usually is, so never use SQLite in production. Record the decision and URL in `docs/operations/runbook.md`.

## Release procedure

1. Main is green in CI (full `scripts/test.py`, including the PostgreSQL job).
2. Build: `npm ci && npm run build` in `frontend/`; `pip install -r requirements.txt`; `manage.py collectstatic --noinput`.
3. `manage.py migrate` against the production DB (back it up first once real users exist).
4. `COURSEPATH_ENV=production manage.py check --deploy` shows no warnings you haven't consciously accepted. On Azure also run `scripts/check_azure_firewall.py` (docs/operations/azure.md, "Database access"): it fails while the database firewall admits all of Azure.
5. **Smoke test on the hosted URL** with a fresh synthetic account: sign up → paste synthetic IMS → review → confirm → see audit → add a course to the plan → save → open the same account in a second browser/device and see the save → reload a deep link.
6. Note the deployed commit SHA in the checkpoint evidence.

## Backup and fallback

- Take a database backup before each migration. Rehearse a restore into a separate database once (M08).
- Keep a tested **local fallback**: `python scripts/run.py` with seeded synthetic data. Use it if hosting or Wi-Fi fails on demo day. It is not evidence of hosted persistence.

## Never

- Never run `DEBUG=True` in production. Never use SQLite on an ephemeral disk. Never seed a default admin password. Never commit secrets.
- Never put real student records on a public demo account.
- Never "fix" CSRF errors by disabling CSRF or adding `csrf_exempt` to mutations.
