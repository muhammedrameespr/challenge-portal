let csrfToken = null;
let sessionExpiredHandler = null;
let tokenRequest = null;

export class ApiError extends Error {
  constructor(message, status = 0, code = 'NETWORK_ERROR', retryAfter = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export function setCsrfToken(value) { csrfToken = value; }
export function onSessionExpired(handler) { sessionExpiredHandler = handler; }

export async function refreshCsrfToken() {
  if (tokenRequest) return tokenRequest;
  csrfToken = null;
  tokenRequest = (async () => {
    const data = await request('/auth/csrf', { auth: false });
    if (!data.csrfToken) throw new ApiError('Could not initialize a secure session. Please retry.');
    csrfToken = data.csrfToken;
    return csrfToken;
  })();
  try { return await tokenRequest; } finally { tokenRequest = null; }
}

export async function request(path, { method = 'GET', body, auth = true, responseType = 'json' } = {}) {
  const headers = { 'Cache-Control': 'no-store' };
  const isForm = body instanceof FormData;
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  if (!['GET', 'HEAD'].includes(method)) {
    if (!csrfToken) await refreshCsrfToken();
    headers['X-CSRF-Token'] = csrfToken;
  }
  let response;
  try {
    response = await fetch(`/api${path}`, {
      method, headers, credentials: 'same-origin', cache: 'no-store',
      ...(body === undefined ? {} : { body: isForm ? body : JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError('The service is unavailable. Please retry.');
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const error = new ApiError(data.error?.message || 'The request could not be completed. Please retry.', response.status, data.error?.code, response.headers.get('Retry-After'));
    if (response.status === 401 && auth) {
      csrfToken = null;
      sessionExpiredHandler?.();
    }
    // Renew an expired token, but never automatically repeat a mutation.
    if (response.status === 403 && /csrf/i.test(error.code || '')) {
      await refreshCsrfToken().catch(() => {});
    }
    throw error;
  }
  if (response.status === 204) return null;
  if (responseType === 'blob') return response.blob();
  try { return await response.json(); } catch { throw new ApiError('The service returned an unreadable response. Please retry.'); }
}

export function readableError(error, fallback = 'The request could not be completed. Please retry.') {
  const message = error instanceof ApiError ? error.message : fallback;
  if (error?.retryAfter) {
    const seconds = Number(error.retryAfter);
    return `${message} ${Number.isFinite(seconds) ? `Try again in ${seconds} seconds.` : `Retry after ${error.retryAfter}.`}`;
  }
  return message;
}

export async function downloadAttachment(id, filename) {
  const blob = await request(`/challenges/${id}/attachment`, { responseType: 'blob' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
