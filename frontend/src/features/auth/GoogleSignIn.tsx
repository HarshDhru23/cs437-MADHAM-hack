import { useEffect, useRef, useState } from 'react';

/** The slice of Google Identity Services this page uses (https://accounts.google.com/gsi/client). */
interface GoogleIdentity {
  accounts: {
    id: {
      initialize: (config: {
        client_id: string;
        callback: (response: { credential?: string }) => void;
        auto_select?: boolean;
        cancel_on_tap_outside?: boolean;
      }) => void;
      renderButton: (parent: HTMLElement, options: Record<string, string | number>) => void;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleIdentity;
  }
}

const SCRIPT_URL = 'https://accounts.google.com/gsi/client';
let loading: Promise<GoogleIdentity> | null = null;

/** Loads Google's sign-in script once. A failed load can be tried again. */
export function loadGoogleIdentity(): Promise<GoogleIdentity> {
  if (window.google?.accounts?.id) return Promise.resolve(window.google);
  if (!loading) {
    loading = new Promise<GoogleIdentity>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = SCRIPT_URL;
      script.async = true;
      script.onload = () => (window.google?.accounts?.id ? resolve(window.google) : reject(new Error('Google sign-in did not start.')));
      script.onerror = () => reject(new Error('Google sign-in could not be loaded.'));
      document.head.appendChild(script);
    }).catch((error: unknown) => {
      loading = null;
      document.querySelector(`script[src="${SCRIPT_URL}"]`)?.remove();
      throw error;
    });
  }
  return loading;
}

/**
 * Google's own "Sign in with Google" button. It hands back a signed ID token, which goes to the server; the server checks it with Google
 * and accepts only IITGN accounts. Nothing here decides who may sign in.
 */
export function GoogleSignIn({ clientId, onCredential }: { clientId: string; onCredential: (credential: string) => void }) {
  const holder = useRef<HTMLDivElement>(null);
  const callback = useRef(onCredential);
  callback.current = onCredential;
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setFailed(false);
    loadGoogleIdentity()
      .then((google) => {
        if (!active || !holder.current) return;
        google.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => {
            if (response.credential) callback.current(response.credential);
          },
          auto_select: false,
          cancel_on_tap_outside: true,
        });
        holder.current.replaceChildren();
        google.accounts.id.renderButton(holder.current, {
          type: 'standard',
          theme: 'filled_black',
          size: 'large',
          text: 'signin_with',
          shape: 'rectangular',
          logo_alignment: 'left',
          width: 280,
        });
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [clientId, attempt]);

  return (
    <div className="google-signin">
      <div ref={holder} data-testid="google-button" />
      {failed ? (
        <p className="callout" data-tone="warning" role="alert">
          Google sign-in could not be loaded. Check your connection and{' '}
          <button type="button" className="btn btn-small" onClick={() => setAttempt((n) => n + 1)}>
            try again
          </button>
          .
        </p>
      ) : null}
    </div>
  );
}
