import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { formatCredits, formatTerm } from '../../lib/format';
import type { PlanItem } from './model';

interface PlannedCourseSearchProps {
  /** The planned courses that can still take a change, in plan order. */
  items: PlanItem[];
  /** The course's title from the catalogue, when it has one. */
  titleOf: (code: string) => string | undefined;
  /** The chosen item's id, or '' for none. */
  value: string;
  onChange: (id: string) => void;
}

/** "CS 330 · Operating Systems · 2026–27 Semester I · 4 credits": what the student sees for a planned course, with whatever of it is known. */
export function plannedCourseText(item: PlanItem, title?: string): string {
  return [item.code, title, formatTerm(item.term_id), item.credits ? `${formatCredits(item.credits)} credits` : null].filter(Boolean).join(' · ');
}

/** Lower case, one dash character, no accents of spacing: so "2026-27", "cs330" and "CS 330" all find what they should. */
const plain = (text: string) => text.toLowerCase().replace(/[–—]/g, '-');

function haystack(item: PlanItem, title: string | undefined): string {
  return plain([item.code, item.code.replace(/\s+/g, ''), title ?? '', formatTerm(item.term_id), item.term_id].join(' '));
}

/**
 * A search box for the planned courses of the baseline plan: type part of a code, a title or a semester ("oper", "cs330", "2027") and
 * choose from the matching courses with the mouse or the keyboard (arrow keys, Enter, Escape). The list is a listbox beside a combobox
 * (aria-activedescendant), so a screen reader hears the same list a sighted student sees.
 */
export function PlannedCourseSearch({ items, titleOf, value, onChange }: PlannedCourseSearchProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const [focusInput, setFocusInput] = useState(false);
  const chosen = items.find((i) => i.id === value) ?? null;

  const matches = useMemo(() => {
    const tokens = plain(query).split(/\s+/).filter(Boolean);
    return items.filter((item) => {
      const text = haystack(item, titleOf(item.code));
      return tokens.every((t) => text.includes(t));
    });
  }, [items, query, titleOf]);
  const current = matches.length === 0 ? -1 : Math.min(active, matches.length - 1);
  const optionId = (index: number) => `${id}-option-${index}`;

  useEffect(() => {
    if (current >= 0) document.getElementById(optionId(current))?.scrollIntoView?.({ block: 'nearest' });
  }, [current]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (focusInput && !chosen) {
      inputRef.current?.focus();
      setFocusInput(false);
    }
  }, [focusInput, chosen]);

  const pick = (item: PlanItem) => {
    onChange(item.id);
    setQuery('');
    setActive(-1);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive(matches.length === 0 ? -1 : (current + 1) % matches.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(matches.length === 0 ? -1 : current <= 0 ? matches.length - 1 : current - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault(); // never submits the change form from the search box
      const choice = current >= 0 ? matches[current] : matches.length === 1 ? matches[0] : undefined;
      if (choice) pick(choice);
    } else if (event.key === 'Escape' && query) {
      event.preventDefault();
      event.stopPropagation();
      setQuery('');
      setActive(-1);
    }
  };

  if (chosen) {
    const labelId = `${id}-label`;
    return (
      <div className="field">
        <span id={labelId} className="label">
          Planned course
        </span>
        <div role="group" aria-labelledby={labelId} className="panel-row">
          <strong>{plannedCourseText(chosen, titleOf(chosen.code))}</strong>
          <button
            type="button"
            className="btn btn-small"
            onClick={() => {
              onChange('');
              setFocusInput(true);
            }}
          >
            Choose a different course
          </button>
        </div>
      </div>
    );
  }

  const status = items.length === 0 ? null : matches.length === 0 ? 'No planned course matches' : query.trim() ? `${matches.length} matching ${matches.length === 1 ? 'course' : 'courses'}` : `${matches.length} planned ${matches.length === 1 ? 'course' : 'courses'}`;
  return (
    <div className="field planned-search">
      <label htmlFor={`${id}-search`}>Planned course</label>
      <input
        ref={inputRef}
        id={`${id}-search`}
        type="text"
        role="combobox"
        aria-expanded={items.length > 0}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={current >= 0 ? optionId(current) : undefined}
        autoComplete="off"
        placeholder="Type a course code, title or semester"
        value={query}
        disabled={items.length === 0}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(e.target.value.trim() ? 0 : -1);
        }}
        onKeyDown={onKeyDown}
      />
      {status ? (
        <span className="hint" role="status">
          {status}
        </span>
      ) : null}
      <ul id={`${id}-list`} role="listbox" aria-label="Planned courses" className="planned-search-list" hidden={items.length === 0}>
        {matches.map((item, index) => (
          <li
            key={item.id}
            id={optionId(index)}
            role="option"
            aria-selected={index === current}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => pick(item)}
          >
            {plannedCourseText(item, titleOf(item.code))}
          </li>
        ))}
      </ul>
    </div>
  );
}
