"""Content-Security-Policy for the app shell (CR-110 item 5).

The policy lets the page run only its own scripts, Google's sign-in script (https://accounts.google.com/gsi/client) and the one inline theme
script in index.html, which is allowed by its SHA-256 hash rather than by 'unsafe-inline'. The hash is computed from the built index.html, so
editing that script cannot leave the policy stale. Google's sign-in button needs its frame, its connections and its stylesheet, as Google documents, and Google's script also injects an inline <style>
element that carries the button's own rules (checked in a real browser: with inline styles blocked the button is rendered unstyled, 336 px tall), so
inline styles are allowed for style elements and style attributes (React components set `style` props). That is a deliberate trade-off: inline
CSS cannot run script, and scripts stay limited to the list above, with no `eval`.

The header is added to HTML responses only (the API answers JSON). `COURSEPATH_CSP_REPORT_ONLY=1` sends the same policy as
Content-Security-Policy-Report-Only, which the browser reports but does not enforce: a way back if a real page is ever blocked.
"""
import base64
import hashlib
import re
from pathlib import Path
from django.conf import settings

GOOGLE = 'https://accounts.google.com/gsi/'
# An inline script has no src attribute. Anything with src is covered by 'self' or the Google entry.
INLINE_SCRIPT = re.compile(r'<script(?![^>]*\bsrc\s*=)[^>]*>(.*?)</script>', re.S | re.I)
_hashes = {}   # index.html path -> (mtime, hashes)


def inline_script_hashes(index):
    """The CSP hash sources ('sha256-...') of the inline scripts in the built index.html, cached until the file changes."""
    path = Path(index)
    try:
        stamp = path.stat().st_mtime_ns
    except OSError:
        return []
    cached = _hashes.get(str(path))
    if cached and cached[0] == stamp:
        return cached[1]
    html = path.read_text(encoding='utf-8', errors='replace')
    found = ["'sha256-" + base64.b64encode(hashlib.sha256(body.encode('utf-8')).digest()).decode() + "'" for body in INLINE_SCRIPT.findall(html) if body.strip()]
    _hashes[str(path)] = (stamp, found)
    return found


def policy():
    scripts = ["'self'", GOOGLE + 'client', *inline_script_hashes(Path(settings.COURSEPATH_FRONTEND_DIR) / 'index.html')]
    return '; '.join([
        "default-src 'self'",
        'script-src ' + ' '.join(scripts),
        "style-src 'self' 'unsafe-inline' " + GOOGLE + 'style',
        'frame-src ' + GOOGLE,
        "connect-src 'self' " + GOOGLE,
        "img-src 'self' data: https://*.googleusercontent.com",
        "font-src 'self' data:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
    ])


class ContentSecurityPolicyMiddleware:
    """Placed first in MIDDLEWARE so it also covers pages WhiteNoise serves from the build."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        if response.get('Content-Type', '').startswith('text/html'):
            name = 'Content-Security-Policy-Report-Only' if getattr(settings, 'COURSEPATH_CSP_REPORT_ONLY', False) else 'Content-Security-Policy'
            if name not in response:
                response[name] = policy()
        return response
