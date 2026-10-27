import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { saveRegistry } from '../api/saveRegistry';

afterEach(() => {
  cleanup();
  // Kept drafts are per-tab module state; never let one test's draft leak into the next.
  saveRegistry.clear();
});
