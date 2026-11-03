import os
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
ALLOWED_HOSTS = os.getenv('COURSEPATH_ALLOWED_HOSTS', 'localhost,127.0.0.1,testserver').split(',')
ROOT_URLCONF = 'server.config.urls'
WSGI_APPLICATION = 'server.config.wsgi.application'
INSTALLED_APPS = ['django.contrib.auth', 'django.contrib.contenttypes', 'django.contrib.sessions', 'server.records']
MIDDLEWARE = ['django.middleware.security.SecurityMiddleware', 'django.contrib.sessions.middleware.SessionMiddleware',
              'django.middleware.common.CommonMiddleware', 'django.middleware.csrf.CsrfViewMiddleware',
              'django.contrib.auth.middleware.AuthenticationMiddleware', 'django.middleware.clickjacking.XFrameOptionsMiddleware']
DATABASES = {'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': LOCAL_DIR / 'coursepath.sqlite3', 'OPTIONS': {'timeout': 20}}}
if DEBUG and os.getenv('COURSEPATH_SQLITE_PATH'):
    DATABASES['default']['NAME'] = os.environ['COURSEPATH_SQLITE_PATH']
if not DEBUG or os.getenv('COURSEPATH_DB_ENGINE') == 'postgresql':
    DATABASES = {'default': {'ENGINE': 'django.db.backends.postgresql', 'NAME': os.environ['COURSEPATH_DB_NAME'],
                           'USER': os.environ['COURSEPATH_DB_USER'], 'PASSWORD': os.environ['COURSEPATH_DB_PASSWORD'],
                           'HOST': os.environ['COURSEPATH_DB_HOST'], 'PORT': os.getenv('COURSEPATH_DB_PORT', '5432')}}
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
