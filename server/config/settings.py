import os
import re
from pathlib import Path
from django.core.management.utils import get_random_secret_key

BASE_DIR = Path(__file__).resolve().parents[2]
# Committed reference data (D-22, D-24). A staff-loaded reviewed snapshot in the database wins for its term; None turns a source off.
COURSEPATH_OFFERINGS_DIR = BASE_DIR / 'data' / 'offerings'
COURSEPATH_CALENDAR_DIR = BASE_DIR / 'data' / 'calendars'
LOCAL_DIR = BASE_DIR / 'server' / '.local'
LOCAL_DIR.mkdir(exist_ok=True)
DEBUG = os.getenv('COURSEPATH_ENV', 'development') != 'production'
SECRET_KEY = os.getenv('COURSEPATH_SECRET_KEY')
if not SECRET_KEY:
    if not DEBUG:
        raise RuntimeError('COURSEPATH_SECRET_KEY is required in production')
    secret_path = LOCAL_DIR / 'secret'
    if not secret_path.exists():
        try:
            with secret_path.open('x') as handle:
                handle.write(get_random_secret_key())
        except FileExistsError:
            pass
    SECRET_KEY = secret_path.read_text()
ALLOWED_HOSTS = [host.strip() for host in os.getenv('COURSEPATH_ALLOWED_HOSTS', 'localhost,127.0.0.1,testserver').split(',') if host.strip()]
if os.getenv('WEBSITE_HOSTNAME'):  # Azure App Service sets this to the app's own host name
    ALLOWED_HOSTS.append(os.environ['WEBSITE_HOSTNAME'])
CSRF_TRUSTED_ORIGINS = [origin.strip() for origin in os.getenv('COURSEPATH_CSRF_TRUSTED_ORIGINS', '').split(',') if origin.strip()]
# One origin: Django serves /api/v1/* and the built React app (frontend/dist). COURSEPATH_FRONTEND_DIR moves the build for tests.
COURSEPATH_FRONTEND_DIR = Path(os.getenv('COURSEPATH_FRONTEND_DIR') or BASE_DIR / 'frontend' / 'dist')
WHITENOISE_ROOT = COURSEPATH_FRONTEND_DIR


def immutable_asset(path, url):
    """Vite writes content-hashed files under /assets/ (name-<hash>.js), so a browser may keep them for good; index.html keeps the short default."""
    return re.match(r'^/assets/.+-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$', url) is not None


WHITENOISE_IMMUTABLE_FILE_TEST = immutable_asset
COURSEPATH_CSP_REPORT_ONLY = os.getenv('COURSEPATH_CSP_REPORT_ONLY') == '1'   # send the policy without enforcing it (server/api/csp.py)
ROOT_URLCONF = 'server.config.urls'
WSGI_APPLICATION = 'server.config.wsgi.application'
INSTALLED_APPS = ['django.contrib.auth', 'django.contrib.contenttypes', 'django.contrib.sessions', 'server.records']
MIDDLEWARE = ['server.api.csp.ContentSecurityPolicyMiddleware', 'django.middleware.security.SecurityMiddleware', 'django.contrib.sessions.middleware.SessionMiddleware',
              'django.middleware.common.CommonMiddleware', 'django.middleware.csrf.CsrfViewMiddleware',
              'django.contrib.auth.middleware.AuthenticationMiddleware', 'django.middleware.clickjacking.XFrameOptionsMiddleware']
if not DEBUG:  # static files of the React build (assets/, index.html); the platform proxy terminates TLS
    MIDDLEWARE.insert(2, 'whitenoise.middleware.WhiteNoiseMiddleware')   # after the CSP and security middleware, which wrap it
    # Safe only because the platform proxy overwrites this header on every request (Azure App Service does).
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
COURSEPATH_TRUST_FORWARDED_FOR = not DEBUG   # behind the platform proxy the client's address is the last X-Forwarded-For entry (see client_address)
SECURE_REDIRECT_EXEMPT = [r'^api/v1/health$']  # the platform's readiness probe is plain HTTP
DATABASES = {'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': LOCAL_DIR / 'coursepath.sqlite3', 'OPTIONS': {'timeout': 20}}}
if DEBUG and os.getenv('COURSEPATH_SQLITE_PATH'):
    DATABASES['default']['NAME'] = os.environ['COURSEPATH_SQLITE_PATH']
if not DEBUG or os.getenv('COURSEPATH_DB_ENGINE') == 'postgresql':
    DATABASES = {'default': {'ENGINE': 'django.db.backends.postgresql', 'NAME': os.environ['COURSEPATH_DB_NAME'],
                           'USER': os.environ['COURSEPATH_DB_USER'], 'PASSWORD': os.environ['COURSEPATH_DB_PASSWORD'],
                           'HOST': os.environ['COURSEPATH_DB_HOST'], 'PORT': os.getenv('COURSEPATH_DB_PORT', '5432'),
                           'OPTIONS': {'connect_timeout': 5}}}  # an unreachable database fails fast (health check answers 503) instead of hanging a worker
AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
USE_TZ = True
TIME_ZONE = 'Asia/Kolkata'
DATA_UPLOAD_MAX_MEMORY_SIZE = 11 * 1024 * 1024
FILE_UPLOAD_MAX_MEMORY_SIZE = 10 * 1024 * 1024
FILE_UPLOAD_HANDLERS = ['server.api.uploads.LimitedMemoryUploadHandler']  # memory only, capped at the 10 MB above: an upload never touches disk
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = 'Lax'
CSRF_COOKIE_SAMESITE = 'Lax'
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG
SECURE_SSL_REDIRECT = not DEBUG
SECURE_HSTS_SECONDS = 31536000 if not DEBUG else 0
SECURE_HSTS_INCLUDE_SUBDOMAINS = not DEBUG
SECURE_HSTS_PRELOAD = not DEBUG
CSRF_FAILURE_VIEW = 'server.api.views.csrf_failure'
# Sign-in (D-46, CR-140). In production every sign-in is a server-verified IITGN Google account: the server does not start without a Google client ID,
# and password sign-up and sign-in are never on. The username and password forms exist only in development and tests (no client ID, or the legacy switch).
COURSEPATH_PRODUCTION = os.getenv('COURSEPATH_ENV', 'development') == 'production'   # not DEBUG; Django's test runner switches DEBUG off, this stays put
# Without one (local development, tests only) the username and password forms work as before. The domain is fixed on purpose.
COURSEPATH_GOOGLE_CLIENT_ID = os.getenv('COURSEPATH_GOOGLE_CLIENT_ID', '').strip()
COURSEPATH_GOOGLE_DOMAIN = 'iitgn.ac.in'
if COURSEPATH_PRODUCTION and not COURSEPATH_GOOGLE_CLIENT_ID:
    raise RuntimeError('COURSEPATH_GOOGLE_CLIENT_ID is required in production: every sign-in must be a verified IITGN Google account (D-46)')
# Keeps password sign-in for accounts made before Google sign-in (never sign-up) on a development server. Off unless asked for, and ignored in production.
COURSEPATH_ALLOW_PASSWORD_LOGIN = not COURSEPATH_PRODUCTION and os.getenv('COURSEPATH_ALLOW_PASSWORD_LOGIN', '') == '1'
# "Try with a sample student" (CR-137): a throw-away account with a made-up record, so a reviewer can see the app working without a real transcript or an
# IITGN Google account. It is deleted when the visitor leaves it or after COURSEPATH_DEMO_HOURS; COURSEPATH_DEMO=0 turns it off.
COURSEPATH_DEMO_ENABLED = os.getenv('COURSEPATH_DEMO', '1') != '0'
COURSEPATH_DEMO_HOURS = 6
COURSEPATH_DEMO_MAX = 200   # live sample accounts at once; the 201st visitor is told to try again later
# Google's sign-in button opens a pop-up that talks back to this page; Django's default 'same-origin' would cut that link.
SECURE_CROSS_ORIGIN_OPENER_POLICY = 'same-origin-allow-popups'
