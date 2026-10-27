import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ApiClient } from './api/client';
import { AppRoot } from './app/App';
import './styles/global.css';

async function start() {
  // Development-only synthetic API. `import.meta.env.MODE` is replaced at build
  // time, so production builds contain no mock code and always call /api/v1.
  let fetchImpl: typeof fetch | undefined;
  const mock = import.meta.env.MODE === 'mock';
  if (mock) {
    const { createMockFetch } = await import('./api/mock/mockServer');
    fetchImpl = createMockFetch();
  }
  const root = document.getElementById('root');
  if (!root) throw new Error('Missing #root');
  createRoot(root).render(
    <StrictMode>
      <AppRoot mock={mock} createClient={(onAuthExpired) => new ApiClient({ fetch: fetchImpl, onAuthExpired })} />
    </StrictMode>,
  );
}

void start();
