/** Typed wrappers for the implemented `/api/v1` routes. No academic logic here. */
import type { ApiClient, RequestOptions } from './client';
import type {
  AcademicPlan,
  AcademicRecord,
  AnalysisRequest,
  AnalysisResult,
  Catalogue,
  Curriculum,
  ImportCommitPayload,
  ImportPreview,
  PlanMutationResult,
  PlanPayload,
  PlanValidation,
  RecordPatch,
  SessionUser,
} from './types';

export interface Credentials {
  username: string;
  password: string;
}

export const endpoints = {
  signup: (api: ApiClient, body: Credentials) => api.send<SessionUser>('POST', '/auth/signup', body),
  login: (api: ApiClient, body: Credentials) => api.send<SessionUser>('POST', '/auth/login', body),
  logout: (api: ApiClient) => api.send<null>('POST', '/auth/logout', {}),
  changePassword: (api: ApiClient, body: { old_password: string; new_password: string }) => api.send<null>('POST', '/auth/password', body),

  curriculum: (api: ApiClient, o?: RequestOptions) => api.get<Curriculum>('/curricula/cse-2024', o),
  catalogue: (api: ApiClient, o?: RequestOptions) => api.get<Catalogue>('/catalogue', o),

  record: (api: ApiClient, o?: RequestOptions) => api.get<AcademicRecord>('/record', o),
  patchRecord: (api: ApiClient, body: RecordPatch, o?: RequestOptions) => api.send<AcademicRecord>('PATCH', '/record', body, o),

  previewIms: (api: ApiClient, text: string, expectedRevision: number, o?: RequestOptions) =>
    api.send<ImportPreview>('POST', '/imports/preview', { kind: 'ims', text, expected_revision: expectedRevision }, o),
  previewPdf: (api: ApiClient, file: File, expectedRevision: number, o?: RequestOptions) => {
    const form = new FormData();
    form.append('expected_revision', String(expectedRevision));
    form.append('file', file);
    return api.send<ImportPreview>('POST', '/imports/preview', form, o);
  },
  commitImport: (api: ApiClient, previewId: string, body: ImportCommitPayload, o?: RequestOptions) =>
    api.send<AcademicRecord>('POST', `/imports/${encodeURIComponent(previewId)}/commit`, body, o),

  plans: (api: ApiClient, o?: RequestOptions) => api.get<AcademicPlan[]>('/plans', o),
  createPlan: (api: ApiClient, body: PlanPayload, o?: RequestOptions) => api.send<PlanMutationResult>('POST', '/plans', body, o),
  plan: (api: ApiClient, id: string, o?: RequestOptions) => api.get<AcademicPlan>(`/plans/${encodeURIComponent(id)}`, o),
  patchPlan: (api: ApiClient, id: string, body: PlanPayload & { expected_revision: number }, o?: RequestOptions) =>
    api.send<PlanMutationResult>('PATCH', `/plans/${encodeURIComponent(id)}`, body, o),
  validatePlan: (api: ApiClient, id: string, body: { record_revision: number; plan_revision: number }, o?: RequestOptions) =>
    api.send<PlanValidation>('POST', `/plans/${encodeURIComponent(id)}/validate`, body, o),

  analysis: (api: ApiClient, body: AnalysisRequest, o?: RequestOptions) => api.send<AnalysisResult>('POST', '/analysis', body, o),
};

// A08: public term offering snapshot (latest reviewed, else latest draft).
import type { TermOfferingSnapshot } from './types';

export const offeringEndpoints = {
  offerings: (api: ApiClient, termId: string, o?: RequestOptions) => api.get<TermOfferingSnapshot>(`/offerings?term_id=${encodeURIComponent(termId)}`, o),
};
