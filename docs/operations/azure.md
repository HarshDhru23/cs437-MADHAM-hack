# Hosting CoursePath on Azure (Azure for Students)

Decision 7 Nov 2026 (Harsh): host on Azure App Service (Linux, B1) with a managed Azure Database for PostgreSQL Flexible Server (Burstable B1ms), the app in Central India and the database in South India Central (`indiasouthcentral`). The student policy allows only `centralindia`, `indiasouthcentral`, `malaysiawest`, `indonesiacentral` and `koreacentral`, and the PostgreSQL create was rejected with `SkuNotAvailable` for B1ms in `centralindia` (a failed create leaves the server name in a `Dropping` state for a while, so retry under a new name). Estimated cost about $25-30 a month against the $100 student credit. One origin: gunicorn runs Django, WhiteNoise serves `frontend/dist`, the platform terminates HTTPS. Live URL: https://coursepath-iitgn.azurewebsites.net

Never put a real value from this page in Git, CI logs or screenshots. Secrets live in the App Service application settings only.

## Names

| Thing | Name |
| --- | --- |
| Resource group | `coursepath-rg` |
| App Service plan / web app | `coursepath-plan` (B1, Linux) / `coursepath-iitgn` (Python 3.13) |
| PostgreSQL server / database | `coursepath-db-isc` (Standard_B1ms, v16, `indiasouthcentral`) / `coursepath` |

## One-time setup (already done on 7 Nov)

```powershell
az login --tenant 7c21bd5f-12e7-4869-9a23-9ad39d684f76   # IITGN requires MFA for resource changes
az group create --name coursepath-rg --location centralindia
az appservice plan create --name coursepath-plan --resource-group coursepath-rg --location centralindia --sku B1 --is-linux
az postgres flexible-server create --resource-group coursepath-rg --name coursepath-db-isc --location indiasouthcentral `
  --admin-user cpadmin --admin-password <generated> --sku-name Standard_B1ms --tier Burstable --storage-size 32 --version 16 --public-access 0.0.0.0 --yes
az postgres flexible-server db create --resource-group coursepath-rg --server-name coursepath-db-isc --name coursepath
az webapp create --resource-group coursepath-rg --plan coursepath-plan --name coursepath-iitgn --runtime "PYTHON:3.13"
az webapp update --resource-group coursepath-rg --name coursepath-iitgn --https-only true
az webapp config set --resource-group coursepath-rg --name coursepath-iitgn --always-on true --min-tls-version 1.2 --ftps-state Disabled `
  --startup-file "python server/manage.py migrate --noinput && python server/manage.py purge_previews && gunicorn server.config.wsgi --bind 0.0.0.0:8000 --workers 2 --timeout 120 --access-logfile -"
```

**Import previews (CR-109).** The startup command above also runs `purge_previews`, which deletes expired import previews (they hold unreviewed grades). That is a purge at every start, not a periodic one; deploys restart the app, so in practice it runs at each deploy. The app also deletes every student's expired previews whenever anyone imports or commits, and empties a preview as soon as it is committed. **The live App Service still has the older startup command** (without `purge_previews`): applying this needs the owner's go-ahead, then `az webapp config set --resource-group coursepath-rg --name coursepath-iitgn --startup-file "<the command above>"`, followed by a check of `/api/v1/health`.

`--public-access 0.0.0.0` creates the rule "allow all Azure services and resources", which admits **every** Azure-hosted resource, including other customers', not only this app, and the app connects as the server admin `cpadmin`. That is the state the database was created in; see "Database access: what is open and how to narrow it" below. The app settings (names are in `.env.example`):

```powershell
az webapp config appsettings set --resource-group coursepath-rg --name coursepath-iitgn --settings `
  COURSEPATH_ENV=production COURSEPATH_SECRET_KEY=<generated> `
  COURSEPATH_ALLOWED_HOSTS=coursepath-iitgn.azurewebsites.net COURSEPATH_CSRF_TRUSTED_ORIGINS=https://coursepath-iitgn.azurewebsites.net `
  COURSEPATH_DB_NAME=coursepath COURSEPATH_DB_USER=cpadmin COURSEPATH_DB_PASSWORD=<generated> `
  COURSEPATH_DB_HOST=coursepath-db-isc.postgres.database.azure.com COURSEPATH_DB_PORT=5432 `
  SCM_DO_BUILD_DURING_DEPLOYMENT=true WEBSITES_PORT=8000
```

PostgreSQL requires TLS; psycopg negotiates it by default. `WEBSITE_HOSTNAME` is set by App Service and is trusted automatically by `settings.py`.

## Google sign-in (D-46, once)

Only IITGN Google accounts can sign in. Create the OAuth client in the Google Cloud console (any project signed in with an `@iitgn.ac.in` account; the "Internal" user type keeps it to the IITGN Workspace, which is a second lock on top of the server's own check):

1. APIs & Services, OAuth consent screen: user type **Internal** (only available to a project inside the IITGN organisation; otherwise choose External and publish it, the server still refuses other domains).
2. Credentials, Create credentials, **OAuth client ID**, application type **Web application**. Under **Authorised JavaScript origins** add `https://coursepath-iitgn.azurewebsites.net` (and `http://localhost:5173` for local trials). No redirect URI is needed: the button hands the page a signed token.
3. Put the client ID (it is public, not a secret) in the App Service settings and restart:

```powershell
az webapp config appsettings set --resource-group coursepath-rg --name coursepath-iitgn --settings COURSEPATH_GOOGLE_CLIENT_ID=<client id>.apps.googleusercontent.com
```

While it is set, password sign-up and sign-in are off. To keep password sign-in for accounts made before this change (never for new ones), also set `COURSEPATH_ALLOW_PASSWORD_LOGIN=1`. Remove the client ID setting to go back to username and password.

## Automatic releases

`.github/workflows/ci.yml` deploys main automatically. Only a `push` to `refs/heads/main` can enter **Deploy production**, and it depends on both the `test` and `postgres` jobs succeeding. The test job packages its checked-out revision after the full suites and statement report pass, then uploads a commit-named artifact. Production downloads that exact artifact; it does not build a different branch.

Authentication is passwordless GitHub OIDC through the user-assigned managed identity `coursepath-github-actions`. Its federated credential accepts issuer `https://token.actions.githubusercontent.com`, audience `api://AzureADTokenExchange`, and only subject `repo:HarshDhru23/cs437-MADHAM-hack:ref:refs/heads/main`. Its Website Contributor role is scoped to the `coursepath-iitgn` web app, not the resource group or database. The deploy job requests `id-token: write`; PR jobs do not. It deliberately has no GitHub Environment, so the OIDC subject remains bound to the branch rather than an environment name.

The repository variables `AZURE_CLIENT_ID`, `AZURE_TENANT_ID` and `AZURE_SUBSCRIPTION_ID` contain public identifiers for `azure/login@v2`. No publish-profile credential or client secret is exported or saved. Database and Django secrets stay in Azure app settings; deployment does not change those settings.

Main CI/release runs are not cancelled by a newer push, and production jobs are serialized. When reviewing several PRs, wait for each merged revision's deploy to succeed before merging the next. This gives each accepted merge its own test and deployment evidence and prevents an older Azure build finishing over a newer one.

The artifact includes `frontend/dist/release.json` with the tested commit SHA. After Azure accepts the deployment, the job waits for `/api/v1/health` to report a healthy database and for `/release.json` to return that SHA. Check the latest successful **Deploy production** job in GitHub Actions for the commit and live URL. A failed test or PostgreSQL rehearsal never starts deployment.

## Manual recovery release

Use this only for a deliberate recovery after tests pass. Normal reviewed merges use the automatic workflow above.

```powershell
git switch main; git pull --ff-only
cd frontend; npm ci; npm run build; cd ..
python -m whitenoise.compress frontend/dist             # gzip copies, served by WhiteNoise to browsers that accept gzip
python scripts/package_azure.py                      # coursepath-azure.zip: git-tracked files + frontend/dist only
az postgres flexible-server firewall-rule list --resource-group coursepath-rg --server-name coursepath-db-isc --output json | python scripts/check_azure_firewall.py -   # must pass once the plan in "Database access" is done
az webapp deploy --resource-group coursepath-rg --name coursepath-iitgn --src-path coursepath-azure.zip --type zip --async true
```

The startup command runs `migrate` on every start. Back the database up first once real users exist (`scripts/backup.py dump`, see runbook section 4.2, with the `COURSEPATH_DB_*` settings pointing at the Azure database and a firewall rule for your own IP).

The first start is slow (about 100 s: Oryx unpacks the build, the image refreshes certificates, then `migrate` runs), so `az webapp deploy` can report "failed to start within 10 mins" or time out while the site is in fact coming up. Check `az webapp log startup show` and the health URL before redeploying.

## Database access: what is open and how to narrow it (CR-108)

**State at creation (7 Nov):** the firewall has the `0.0.0.0` rule (all of Azure may try to connect) and the web app's `COURSEPATH_DB_USER` is the server admin `cpadmin`. The only barrier is the database password. Check the real state at any time (read-only; prints rule names and addresses, no settings):

```powershell
az postgres flexible-server firewall-rule list --resource-group coursepath-rg --server-name coursepath-db-isc --output json | python scripts/check_azure_firewall.py -
```

It exits 1 while a `0.0.0.0` rule exists. **Run it in every release; once the plan below is done it must pass.** (It is also a step of the release procedure in the coursepath skill's `reference/deploy.md`.)

**The plan (not applied: these are production changes and need the owner's go-ahead; change one thing at a time, check `/api/v1/health` after each, back the database up first with `scripts/backup.py dump`):**

1. *Give the app its own database role, not the admin.* As `cpadmin` (from your own IP, rule added for the purpose), in database `coursepath`:
   ```sql
   CREATE ROLE coursepath_app LOGIN PASSWORD '<generated, never in Git>';
   GRANT coursepath_app TO cpadmin;               -- PostgreSQL lets you hand ownership only to a role you could become
   ALTER DATABASE coursepath OWNER TO coursepath_app;
   ALTER SCHEMA public OWNER TO coursepath_app;
   -- Hand over only this app's tables and sequences, one by one. Do NOT use REASSIGN OWNED BY cpadmin: it also moves
   -- every shared object the admin owns (other databases, tablespaces), which would give the app far more than it needs.
   DO $$
   DECLARE r record;
   BEGIN
     FOR r IN SELECT tablename AS n FROM pg_tables WHERE schemaname = 'public' LOOP
       EXECUTE format('ALTER TABLE public.%I OWNER TO coursepath_app', r.n);
     END LOOP;
     FOR r IN SELECT sequence_name AS n FROM information_schema.sequences WHERE sequence_schema = 'public' LOOP
       EXECUTE format('ALTER SEQUENCE public.%I OWNER TO coursepath_app', r.n);
     END LOOP;
   END $$;
   -- Check: each query must return no rows.
   SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tableowner <> 'coursepath_app';
   SELECT datname FROM pg_database WHERE pg_get_userbyid(datdba) = 'coursepath_app' AND datname <> 'coursepath';
   ```
   `migrate` runs at every start and alters tables, so the app role must own them. Owning the `coursepath` database objects is not server admin: the role cannot create roles or databases or read other databases. The stricter alternative (the app role may only read and write rows, and a separate migrate role runs `migrate` at deploy) needs a change to the startup command and the release steps; do it later if wanted.
2. *Switch the web app to that role.* Set `COURSEPATH_DB_USER=coursepath_app` and `COURSEPATH_DB_PASSWORD=<the new password>` in the App Service settings (never right before or during a deploy; a restart mid-build left Kudu stuck on 8 Nov), restart, check `/api/v1/health`. **Rollback:** set the two settings back to the previous values and restart. Keep `cpadmin` and its password out of the app settings from then on.
3. *Replace the all-of-Azure rule with the app's outbound addresses.*
   ```powershell
   az webapp show --resource-group coursepath-rg --name coursepath-iitgn --query possibleOutboundIpAddresses --output tsv   # the full set, not only the current one
   az postgres flexible-server firewall-rule create --resource-group coursepath-rg --server-name coursepath-db-isc --name app-<ip> --start-ip-address <ip> --end-ip-address <ip>   # once per address
   # check /api/v1/health and a real sign-in, then:
   az postgres flexible-server firewall-rule delete --resource-group coursepath-rg --server-name coursepath-db-isc --name <name of the 0.0.0.0 rule> --yes
   ```
   **Rollback:** `az postgres flexible-server firewall-rule create ... --name AllowAllAzureServices --start-ip-address 0.0.0.0 --end-ip-address 0.0.0.0`.
   **Trade-off:** the outbound addresses can change when the plan is resized or moved (the `possibleOutboundIpAddresses` list is the safe superset). When they change the site loses its database until the rules are updated, so re-run the `az webapp show` command after any plan change and before a deploy that follows one. Your own IP needs its own rule when you run `scripts/backup.py` or `psql`, and it should be removed afterwards.
4. *Stronger, later:* regional VNet integration plus a private endpoint for the database removes the public path entirely; it costs more (a private endpoint is billed) and adds setup, so it is not worth it for the hackathon.

## Content-Security-Policy (CR-110 item 5)

Every HTML page the app serves carries a `Content-Security-Policy` header (`server/api/csp.py`): scripts only from the app itself, Google's sign-in script (`https://accounts.google.com/gsi/client`) and the one inline theme script in `index.html`, allowed by its SHA-256 hash (computed from the built file, so editing that script cannot leave the policy stale); frames only from `https://accounts.google.com/gsi/`; no `eval`, no plugins, no framing of the app. Inline **styles** are allowed because Google's script injects the sign-in button's CSS inline (with them blocked the button renders unstyled); inline CSS cannot run script. If a real page is ever blocked, set the app setting `COURSEPATH_CSP_REPORT_ONLY=1` and restart: the same policy is then sent as `Content-Security-Policy-Report-Only` (the browser reports violations in its console and enforces nothing), which is a way back without a deploy. After any change to `index.html`, a script or the sign-in, open `/login` and the main pages in a browser and check the console for violations.

## Client address behind App Service (CR-107, not yet verified)

The sign-in limit counts failures per client address. In production (`not DEBUG`) `server/api/views.py::client_address` takes the **last** `X-Forwarded-For` entry as the client, on the assumption that App Service's front end appends the address it saw (with a port) and leaves anything the client sent in front of it. That assumption is **not yet confirmed**: the tests build the header themselves and prove only the parsing, not what the real ingress sends, and nobody has observed a live request. Check it once after the next deploy, before relying on the limit:

1. From a known address, send a request with a made-up header, for example `curl -H 'X-Forwarded-For: 198.51.100.9' https://coursepath-iitgn.azurewebsites.net/api/v1/session`, and look at what the app receives (a temporary log line, or `az webapp log tail`).
2. The **last** entry must be your own address. If it is the made-up one, or the front end's, the limit can be dodged or shared by the whole site, and `client_address` must change.

## Smoke test (deploy.md step 5)

1. `GET https://coursepath-iitgn.azurewebsites.net/api/v1/health` returns `{"status":"ok","database":"ok"}`.
2. Sign in with an IITGN Google account (a non-IITGN account must be refused), paste the synthetic IMS table, review and confirm, see the audit, add a course to a plan and save.
3. Over HTTPS the API needs an `Origin` header on mutations (browsers send it; a bare script gets 403 from Django's CSRF check).
4. Open the same account in a second browser and see the saved plan; reload a deep link such as `/plan/<id>`.

## Operations

- Logs: `az webapp log tail --resource-group coursepath-rg --name coursepath-iitgn`.
- Stop spending after the demo: `az group delete --name coursepath-rg` removes everything (irreversible; confirm first).
- The Azure health-check feature is not enabled: its probe sends the container IP as the Host header, which `ALLOWED_HOSTS` rejects.
