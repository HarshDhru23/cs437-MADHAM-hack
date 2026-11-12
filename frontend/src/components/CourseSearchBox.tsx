import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { CatalogueCourse } from '../api/types';
import { formatCredits } from '../lib/format';

/** Without a search, only this many courses are listed: the whole catalogue is hundreds. */
const SUGGESTED = 8;
const MOST = 30;

/** Lower-case, with spaces and punctuation taken out, so "cs 330", "CS330" and "cs-330" are the same code. */
const squash = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '');

/** The courses whose code, title, department or requirement contains what was typed, in code order. Nothing typed lists the first few. */
export function findCourses(courses: CatalogueCourse[], query: string): CatalogueCourse[] {
  const q = query.trim().toLowerCase();
  const code = squash(q);
  const sorted = [...courses].sort((a, b) => a.normalized_code.localeCompare(b.normalized_code, undefined, { numeric: true }));
  if (!q) return sorted;
  return sorted.filter(
    (c) =>
      squash(c.normalized_code).includes(code) ||
      (c.title ?? '').toLowerCase().includes(q) ||
      (c.department ?? '').toLowerCase() === q ||
      (c.could_satisfy ?? []).some((s) => s.toLowerCase().includes(q)),
  );
}

interface CourseSearchBoxProps {
  courses: CatalogueCourse[];
  /** The box's accessible name and visible label. */
  label: string;
  placeholder?: string;
  onPick: (course: CatalogueCourse) => void;
  /** True for a course that is there already: it is listed as "Added" and cannot be chosen again. */
  isAdded?: (course: CatalogueCourse) => boolean;
}

/**
 * A search box for the course list: type part of a code or a title, move with the arrow keys, press Enter or click to choose.
 * It chooses nothing by itself and never closes on its own account: after a choice the box is empty and keeps the focus,
 * so several courses can be added in a row.
 */
export function CourseSearchBox({ courses, label, placeholder, onPick, isAdded }: CourseSearchBoxProps) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const matches = useMemo(() => findCourses(courses, query), [courses, query]);
  const shown = matches.slice(0, query.trim() ? MOST : SUGGESTED);

  const choose = (course: CatalogueCourse | undefined) => {
    if (!course || isAdded?.(course) || !course.credits) return;
    onPick(course);
    setQuery('');
    setOpen(false);
    setActive(0);
    input.current?.focus();
  };

  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) setOpen(true);
      else setActive((i) => Math.min(i + 1, shown.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      if (open) {
        event.preventDefault();
        choose(shown[active]);
      }
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation(); // closes the list, not the dialog around it
      setOpen(false);
    }
  };

  const listId = `${id}-list`;
  return (
    <div className="search-box">
      <label htmlFor={`${id}-input`}>{label}</label>
      <div className="search-field">
        <input
          ref={input}
          id={`${id}-input`}
          type="search"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && shown[active] ? `${id}-opt-${active}` : undefined}
          autoComplete="off"
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onClick={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKey}
        />
      </div>
      {open ? (
        <ul id={listId} role="listbox" aria-label={label} className="search-list" onMouseDown={(e) => e.preventDefault() /* keep the focus in the box */}>
          {shown.map((c, i) => {
            const added = isAdded?.(c) ?? false;
            const unusable = added || !c.credits;
            return (
              <li
                key={c.id}
                id={`${id}-opt-${i}`}
                role="option"
                aria-selected={i === active}
                aria-disabled={unusable}
                className="search-option"
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(c)}
              >
                <span className="mono search-code">{c.normalized_code}</span>
                <span className="search-title">
                  <strong>{c.title || 'Untitled course'}</strong>
                  {c.could_satisfy?.[0] ? <span className="muted">{c.could_satisfy[0]}</span> : null}
                </span>
                <span className="num search-credits">{added ? 'Added' : c.credits ? `${formatCredits(c.credits)} credits` : 'Credits not listed'}</span>
              </li>
            );
          })}
          {shown.length === 0 ? <li className="search-empty">{`No course matches “${query.trim()}”. You can add it by its code below.`}</li> : null}
          {matches.length > shown.length ? <li className="search-empty">{query.trim() ? 'Keep typing to narrow the list.' : 'Type a code or a title to find more.'}</li> : null}
        </ul>
      ) : null}
    </div>
  );
}
