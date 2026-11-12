import { useMemo, useState, type ReactElement } from 'react';
import type { CatalogueCourse, PlanCheckRequirement, RequirementDefinition } from '../../api/types';
import { CoursePicker, courseDepartments, ProjectCourseForm, type PickedCourse } from '../../components/CoursePicker';
import { Dialog } from '../../components/Dialog';
import { Tabs } from '../../components/Tabs';
import { formatTerm } from '../../lib/format';
import { OnlineCourseForm, type OnlineCourseChoice } from './OnlineCourseForm';
import { PlaceholderForm, type NewPlaceholder } from './PlaceholderForm';
import { moreCredits } from './PlanProgress';

export type AddKind = 'course' | 'project' | 'online' | 'placeholder';

const LABELS: Record<AddKind, string> = { course: 'Course', project: 'Project', online: 'Online course', placeholder: 'Placeholder' };

/**
 * One box for everything that can go into a semester: a course from the list, a project, an online course or a placeholder.
 * Every kind has the same layout and ends the same way (its own add button, then Cancel). It opens on the kind of the button that was pressed.
 */
export function AddToSemesterDialog({
  term,
  initial,
  kinds = ['course', 'project', 'online', 'placeholder'],
  courses,
  coverage,
  requirements,
  room,
  placeholderOptions,
  onClose,
  onPickCourse,
  onAddOnline,
  onAddPlaceholder,
}: {
  term: string;
  initial: AddKind;
  kinds?: AddKind[];
  courses: CatalogueCourse[];
  coverage: string;
  requirements: PlanCheckRequirement[] | undefined;
  /** Credits that still fit in the semester, from the server (undefined before its first answer). */
  room: string | undefined;
  placeholderOptions: (RequirementDefinition & { depth: number })[];
  onClose: () => void;
  onPickCourse: (course: PickedCourse) => void;
  onAddOnline: (choice: OnlineCourseChoice) => void;
  onAddPlaceholder: (placeholder: NewPlaceholder) => void;
}) {
  const [kind, setKind] = useState<AddKind>(kinds.includes(initial) ? initial : (kinds[0] ?? 'course'));
  const label = formatTerm(term);
  const title = kind === 'online' ? `Add online course to ${label}` : kind === 'placeholder' ? `Add placeholder to ${label}` : `Add course to ${label}`;
  const departments = useMemo(() => courseDepartments(courses), [courses]);
  const roomLine =
    room !== undefined && kind !== 'online' ? (
      <p className="add-room muted">{Number(room) > 0 ? `Room for ${moreCredits(room)} in this semester.` : 'This semester has no room left. You can still add to it; the plan will say it is over the limit.'}</p>
    ) : null;

  const content: Record<AddKind, ReactElement> = {
    course: <CoursePicker term={term} courses={courses} coverage={coverage} parts={{ search: true, project: false, manual: true }} onPick={onPickCourse} onCancel={onClose} />,
    project: <ProjectCourseForm departments={departments} onPick={onPickCourse} onCancel={onClose} />,
    online: <OnlineCourseForm term={term} requirements={requirements} room={room} onAdd={onAddOnline} onCancel={onClose} />,
    placeholder: <PlaceholderForm options={placeholderOptions} onAdd={onAddPlaceholder} onCancel={onClose} />,
  };

  return (
    <Dialog open title={title} onClose={onClose} variant="drawer">
      <div className="add-box">
        <Tabs
          label="What to add"
          selected={kind}
          onSelect={(id) => setKind(id as AddKind)}
          tabs={kinds.map((k) => ({
            id: k,
            label: LABELS[k],
            content: (
              <>
                {roomLine}
                {content[k]}
              </>
            ),
          }))}
        />
      </div>
    </Dialog>
  );
}
