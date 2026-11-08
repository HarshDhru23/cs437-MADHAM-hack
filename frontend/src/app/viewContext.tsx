/**
 * What the current screen is showing: cohort, rule version and whether the
 * data is actual history, current enrolment, a projected plan or a scenario.
 * The shell's context bar always displays it.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type DataMode = 'public' | 'actual' | 'current' | 'projected' | 'scenario' | 'none';

export interface ViewInfo {
  ruleVersion: string | null;
  reviewStatus: string | null;
  dataMode: DataMode;
  recordRevision: number | null;
}

const DEFAULT: ViewInfo = { ruleVersion: null, reviewStatus: null, dataMode: 'none', recordRevision: null };

const Ctx = createContext<{ info: ViewInfo; set: (info: ViewInfo) => void }>({ info: DEFAULT, set: () => undefined });

export function ViewContextProvider({ children }: { children: ReactNode }) {
  const [info, set] = useState<ViewInfo>(DEFAULT);
  const value = useMemo(() => ({ info, set }), [info]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useViewInfo(): ViewInfo {
  return useContext(Ctx).info;
}

/** Publish the current screen's data context. */
export function usePublishView(info: Partial<ViewInfo>): void {
  const { set } = useContext(Ctx);
  const { ruleVersion = null, reviewStatus = null, dataMode = 'none', recordRevision = null } = info;
  useEffect(() => {
    set({ ruleVersion, reviewStatus, dataMode, recordRevision });
  }, [set, ruleVersion, reviewStatus, dataMode, recordRevision]);
}

export const DATA_MODE_LABEL: Record<DataMode, string> = {
  public: 'Requirements',
  actual: 'Your completed courses',
  current: 'Completed and current courses',
  projected: 'Your plan (not completed yet)',
  scenario: 'A what-if scenario',
  none: '—',
};
