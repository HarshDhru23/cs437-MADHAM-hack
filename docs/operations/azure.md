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

`--public-access 0.0.0.0` lets Azure services reach the database; nothing else can. The app settings (names are in `.env.example`):

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
python scripts/package_azure.py                      # coursepath-azure.zip: git-tracked files + frontend/dist only
az webapp deploy --resource-group coursepath-rg --name coursepath-iitgn --src-path coursepath-azure.zip --type zip --async true
```

The startup command runs `migrate` on every start. Back the database up first once real users exist (`scripts/backup.py dump`, see runbook section 4.2, with the `COURSEPATH_DB_*` settings pointing at the Azure database and a firewall rule for your own IP).

The first start is slow (about 100 s: Oryx unpacks the build, the image refreshes certificates, then `migrate` runs), so `az webapp deploy` can report "failed to start within 10 mins" or time out while the site is in fact coming up. Check `az webapp log startup show` and the health URL before redeploying.

## Smoke test (deploy.md step 5)

1. `GET https://coursepath-iitgn.azurewebsites.net/api/v1/health` returns `{"status":"ok","database":"ok"}`.
2. Sign in with an IITGN Google account (a non-IITGN account must be refused), paste the synthetic IMS table, review and confirm, see the audit, add a course to a plan and save.
3. Over HTTPS the API needs an `Origin` header on mutations (browsers send it; a bare script gets 403 from Django's CSRF check).
4. Open the same account in a second browser and see the saved plan; reload a deep link such as `/plan/<id>`.

## Operations

- Logs: `az webapp log tail --resource-group coursepath-rg --name coursepath-iitgn`.
- Stop spending after the demo: `az group delete --name coursepath-rg` removes everything (irreversible; confirm first).
- The Azure health-check feature is not enabled: its probe sends the container IP as the Host header, which `ALLOWED_HOSTS` rejects.
