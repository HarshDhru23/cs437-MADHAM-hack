import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../app/session';
import { useTheme } from '../app/theme';

interface Command {
  id: string;
  label: string;
  hint: string;
  run: () => void;
}

const EDITABLE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

function typingIn(target: EventTarget | null) {
  return target instanceof Element && target.closest(EDITABLE) !== null;
}

/**
 * The command bar: Ctrl+K (Cmd+K) anywhere, or "/" outside a text field. Type to filter, arrow keys to move, Enter to run, Escape to close.
 * Only real actions are listed: pages, starting a plan, the theme and signing in or out.
 */
export function CommandBar({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const session = useSession();
  const navigate = useNavigate();
  const { theme, toggle } = useTheme();
  const ref = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<Element | null>(null);
  const base = useId();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);

  const signedIn = Boolean(session.user);
  const commands = useMemo<Command[]>(() => {
    const go = (id: string, label: string, to: string, hint = 'Page'): Command => ({ id, label, hint, run: () => navigate(to) });
    const list: Command[] = [
      go('requirements', 'Go to Requirements', '/'),
      go('record', 'Go to My record', '/record'),
      go('performance', 'Go to Performance', '/performance'),
      go('import', 'Import your record', '/record/import', 'Action'),
      go('plan', 'Go to Plan', '/plan'),
      go('scenarios', 'Go to Scenarios', '/scenarios'),
      go('generate', 'Generate a plan', '/plan?generate=1', 'Action'),
    ];
    if (signedIn) list.push(go('account', 'Go to Account', '/account'));
    else {
      list.push(go('login', 'Sign in', '/login', 'Account'));
      list.push(go('signup', 'Create an account', '/signup', 'Account'));
    }
    list.push({ id: 'theme', label: theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme', hint: 'Appearance', run: toggle });
    if (signedIn)
      list.push({
        id: 'signout',
        label: 'Sign out',
        hint: 'Account',
        run: () => {
          void session.logout().then(() => navigate('/'));
        },
      });
    return list;
  }, [signedIn, theme, toggle, navigate, session]);

  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = commands.filter((c) => words.every((w) => c.label.toLowerCase().includes(w)));
  const active = Math.min(selected, Math.max(0, matches.length - 1));

  // Shortcuts that open (and close) the bar from anywhere.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        onOpenChange(!open);
        return;
      }
      if (!open && event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !typingIn(event.target) && !document.querySelector('dialog[open]')) {
        event.preventDefault();
        onOpenChange(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  // Open and close the native dialog (jsdom has no showModal), remember who opened it and give focus back.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      opener.current = document.activeElement;
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
      setQuery('');
      setSelected(0);
      input.current?.focus();
    }
    if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
      if (opener.current instanceof HTMLElement) opener.current.focus();
    }
  }, [open]);

  const run = (command: Command | undefined) => {
    if (!command) return;
    onOpenChange(false);
    command.run();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelected(matches.length ? (active + 1) % matches.length : 0);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelected(matches.length ? (active - 1 + matches.length) % matches.length : 0);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      run(matches[active]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onOpenChange(false);
    }
  };

  const optionId = (id: string) => `${base}-option-${id}`;
  const activeCommand = matches[active];

  return (
    <dialog
      ref={ref}
      className="command"
      aria-label="Search or jump to"
      onCancel={(event) => {
        event.preventDefault();
        onOpenChange(false);
      }}
      onClose={() => {
        if (open) onOpenChange(false);
      }}
    >
      {open ? (
        <>
          <div className="command-input">
            <span className="prompt" aria-hidden="true">
              &gt;
            </span>
            <input
              ref={input}
              type="text"
              role="combobox"
              aria-label="Search or jump to"
              aria-expanded="true"
              aria-controls={`${base}-list`}
              aria-activedescendant={activeCommand ? optionId(activeCommand.id) : undefined}
              aria-autocomplete="list"
              autoComplete="off"
              spellCheck={false}
              placeholder="Type a page or an action"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSelected(0);
              }}
              onKeyDown={onKeyDown}
            />
            <span className="kbd" aria-hidden="true">
              Esc
            </span>
          </div>
          {matches.length > 0 ? (
            <ul id={`${base}-list`} role="listbox" aria-label="Commands" className="command-list">
              {matches.map((command, index) => (
                <li
                  key={command.id}
                  id={optionId(command.id)}
                  role="option"
                  aria-selected={index === active}
                  onMouseMove={() => setSelected(index)}
                  onClick={() => run(command)}
                >
                  <span>{command.label}</span>
                  <span className="kbd">{command.hint}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p id={`${base}-list`} className="command-empty" role="status">
              No command matches
            </p>
          )}
        </>
      ) : null}
    </dialog>
  );
}
