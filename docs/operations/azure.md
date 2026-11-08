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
  --startup-file "python server/manage.py migrate --noinput && gunicorn server.config.wsgi --bind 0.0.0.0:8000 --workers 2 --timeout 120 --access-logfile -"
```

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

## Every release

```powershell
git switch main; git pull
cd frontend; npm ci; npm run build; cd ..
python scripts/package_azure.py                      # coursepath-azure.zip: git-tracked files + frontend/dist only
az webapp deploy --resource-group coursepath-rg --name coursepath-iitgn --src-path coursepath-azure.zip --type zip
```

The startup command runs `migrate` on every start. Back the database up first once real users exist (`scripts/backup.py dump`, see runbook section 4.2, with the `COURSEPATH_DB_*` settings pointing at the Azure database and a firewall rule for your own IP).

The first start is slow (about 100 s: Oryx unpacks the build, the image refreshes certificates, then `migrate` runs), so `az webapp deploy` can report "failed to start within 10 mins" or time out while the site is in fact coming up. Check `az webapp log startup show` and the health URL before redeploying.

## Smoke test (deploy.md step 5)

1. `GET https://coursepath-iitgn.azurewebsites.net/api/v1/health` returns `{"status":"ok","database":"ok"}`.
2. Sign up a synthetic account, paste the synthetic IMS table, review and confirm, see the audit, add a course to a plan and save.
3. Over HTTPS the API needs an `Origin` header on mutations (browsers send it; a bare script gets 403 from Django's CSRF check).
4. Open the same account in a second browser and see the saved plan; reload a deep link such as `/plan/<id>`.

## Operations

- Logs: `az webapp log tail --resource-group coursepath-rg --name coursepath-iitgn`.
- Stop spending after the demo: `az group delete --name coursepath-rg` removes everything (irreversible; confirm first).
- The Azure health-check feature is not enabled: its probe sends the container IP as the Host header, which `ALLOWED_HOSTS` rejects.
