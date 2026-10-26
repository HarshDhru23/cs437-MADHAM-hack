import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

export interface TabSpec {
  id: string;
  label: string;
  content: ReactNode;
}

interface TabsProps {
  label: string;
  tabs: TabSpec[];
  selected?: string;
  onSelect?: (id: string) => void;
}

/** WAI-ARIA tabs with automatic activation on arrow keys. */
export function Tabs({ label, tabs, selected, onSelect }: TabsProps) {
  const base = useId();
  const [internal, setInternal] = useState(tabs[0]?.id ?? '');
  const active = selected ?? internal;
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const choose = (id: string) => {
    setInternal(id);
    onSelect?.(id);
    refs.current[id]?.focus();
  };
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex((t) => t.id === active);
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    const tab = tabs[next];
    if (tab) choose(tab.id);
  };
  const current = tabs.find((t) => t.id === active) ?? tabs[0];
  return (
    <div>
      <div role="tablist" aria-label={label} className="tablist" onKeyDown={onKey}>
        {tabs.map((t) => (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[t.id] = el;
            }}
            type="button"
            role="tab"
            className="tab"
            id={`${base}-tab-${t.id}`}
            aria-selected={t.id === active}
            aria-controls={`${base}-panel-${t.id}`}
            tabIndex={t.id === active ? 0 : -1}
            onClick={() => choose(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {current ? (
        <div role="tabpanel" id={`${base}-panel-${current.id}`} aria-labelledby={`${base}-tab-${current.id}`} tabIndex={0}>
          {current.content}
        </div>
      ) : null}
    </div>
  );
}
