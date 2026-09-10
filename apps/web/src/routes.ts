export type AppView = 'landing' | 'nav' | 'replay';

export function viewForLocation(pathname: string, search = ''): AppView {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/app/replay') return 'replay';
  if (path === '/app' || path === '/app/nav-oracle') return 'nav';
  if (path === '/' && new URLSearchParams(search).has('demo')) return 'nav';
  return 'landing';
}
