/**
 * Thin API client.
 *
 * The session lives in an httpOnly cookie, so every call is `credentials:
 * 'include'` and there is no token for JavaScript to leak or mishandle.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code = 'error',
    readonly details?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** First validation message for a field, if the server sent one. */
  fieldError(field: string): string | undefined {
    return this.details?.[field]?.[0];
  }
}

async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: 'include',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const error = (payload as { error?: { message?: string; code?: string; details?: Record<string, string[]> } } | null)?.error;
    throw new ApiError(response.status, error?.message ?? 'Something went wrong.', error?.code, error?.details);
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>('GET', path, undefined, signal),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
};

/** Builds a query string, dropping empty values so URLs stay clean. */
export function query(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const out = search.toString();
  return out ? `?${out}` : '';
}

/**
 * Uploads files with real progress. `fetch` cannot report upload progress,
 * so this uses XMLHttpRequest.
 */
export function upload<T>(
  path: string,
  form: FormData,
  onProgress?: (percent: number) => void,
): { promise: Promise<T>; abort: () => void } {
  const xhr = new XMLHttpRequest();

  const promise = new Promise<T>((resolve, reject) => {
    xhr.open('POST', `/api${path}`, true);
    xhr.withCredentials = true;

    xhr.upload.addEventListener('progress', (event) => {
      if (!onProgress) return;
      onProgress(event.lengthComputable ? Math.round((event.loaded / event.total) * 100) : 0);
    });

    xhr.addEventListener('load', () => {
      let payload: unknown = null;
      try {
        payload = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        payload = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(payload as T);
        return;
      }
      const error = (payload as { error?: { message?: string; code?: string; details?: Record<string, string[]> } } | null)?.error;
      reject(new ApiError(xhr.status, error?.message ?? 'That upload did not work.', error?.code, error?.details));
    });

    xhr.addEventListener('error', () => reject(new ApiError(0, 'The connection dropped mid-upload.')));
    xhr.addEventListener('abort', () => reject(new ApiError(0, 'Upload cancelled.')));

    xhr.send(form);
  });

  return { promise, abort: () => xhr.abort() };
}
