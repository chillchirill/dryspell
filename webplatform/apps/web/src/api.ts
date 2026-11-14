import type { ApiError, SessionInfo } from '@dryspell/contracts';
let csrf = '';
export function setSession(session: SessionInfo) { csrf = session.csrfToken || ''; }
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/v1${path}`,{...options,credentials:'same-origin',headers:{'Content-Type':'application/json',...(csrf?{'X-CSRF-Token':csrf}:{}),...options.headers}});
  const body = response.status===204 ? null : await response.json().catch(()=>null);
  if (!response.ok) throw new Error((body as ApiError)?.error?.message || `Request failed (${response.status}). Retry when the service is available.`);
  return body as T;
}
export function arrayOf<T>(value: unknown, key: string): T[] { if(Array.isArray(value))return value; const v=value as Record<string,unknown>|null; return (v?.[key]||v?.items||v?.data||[]) as T[]; }
