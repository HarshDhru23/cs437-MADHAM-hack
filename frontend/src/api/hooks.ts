/** Resource hooks. Keys encode owner + revisions so stale responses are discarded. */
import { useCallback } from 'react';
import { useSession } from '../app/session';
import { endpoints } from './endpoints';
import { useResource, useResourceCache } from './resources';
import type { AcademicPlan, AcademicRecord } from './types';

export function useCurriculum() {
  const { api } = useSession();
  return useResource('public:curriculum', (signal) => endpoints.curriculum(api, { signal }));
}

export function useCatalogue() {
  const { api } = useSession();
  return useResource('public:catalogue', (signal) => endpoints.catalogue(api, { signal }));
}

export function useRecord() {
  const { api, user } = useSession();
  return useResource(user ? `record:${user.id}` : null, (signal) => endpoints.record(api, { signal }));
}

export function usePlans() {
  const { api, user } = useSession();
  return useResource(user ? `plans:${user.id}` : null, (signal) => endpoints.plans(api, { signal }));
}

export function analysisKey(userId: string, record: AcademicRecord, plan: Pick<AcademicPlan, 'id' | 'revision'> | null): string {
  return `analysis:${userId}:r${record.revision}:${plan ? `${plan.id}@${plan.revision}` : 'noplan'}:${record.profile.curriculum_version}`;
}

export function useAnalysis(record: AcademicRecord | null, plan: Pick<AcademicPlan, 'id' | 'revision'> | null, enabled = true) {
  const { api, user } = useSession();
  const cache = useResourceCache();
  const key = enabled && user && record ? analysisKey(user.id, record, plan) : null;
  const resource = useResource(key, (signal) =>
    endpoints.analysis(
      api,
      { record_revision: record!.revision, ...(plan ? { plan_id: plan.id, plan_revision: plan.revision } : {}), award_ids: [] },
      { signal },
    ),
  );
  const conflict = resource.error?.kind === 'conflict';
  const { reload: reloadAnalysis } = resource;
  // A 409 means the record or plan changed elsewhere: retrying with the same
  // cached revisions would conflict forever, so reload them first. Analysis is
  // read-only, so this never overwrites anything.
  const reload = useCallback(() => {
    if (conflict) {
      cache.invalidate('record:');
      cache.invalidate('plan');
    }
    reloadAnalysis();
  }, [cache, conflict, reloadAnalysis]);
  return { ...resource, reload };
}
