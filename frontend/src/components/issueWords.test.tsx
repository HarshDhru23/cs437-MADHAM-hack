import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { issue } from '../test/harness';
import { IssueList, studentMessage } from './IssueList';

/** CR-76: an issue that carries policy text is shown to a student in plain words, chosen by its code. */
const POLICY = issue('ADDITIONAL_LEARNING_POLICY_UNKNOWN', 'unknown', ['a-1'], 'Learning-designation inclusion is unresolved.');

describe('student wording of issues', () => {
  it('the additional-learning policy note reads as a plain sentence in the list', () => {
    render(<IssueList issues={[POLICY]} />);
    expect(screen.getByText('Courses marked as additional learning (honours or minor) are not counted in your CPI here yet.')).toBeInTheDocument();
    expect(screen.queryByText(/Learning-designation|unresolved/)).not.toBeInTheDocument();
  });

  it('studentMessage uses the plain sentence for that code and the cleaned server message for any other', () => {
    expect(studentMessage(POLICY)).toMatch(/^Courses marked as additional learning/);
    // Negative: other issues keep their message (only decision references and codes are stripped).
    expect(studentMessage(issue('OFFERING_UNKNOWN', 'unknown', [], 'No 2027-28-II timetable is published yet (D-33).'))).toBe('No 2027-28-II timetable is published yet.');
  });

  it('the button that shows the affected items is named with the same plain words', () => {
    render(<IssueList issues={[POLICY]} onSelect={() => undefined} />);
    expect(screen.getByRole('button', { name: /Show affected items: Courses marked as additional learning/ })).toBeInTheDocument();
  });
});
