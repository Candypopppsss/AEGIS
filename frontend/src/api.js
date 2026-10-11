export async function request(path, token, body, method = body ? 'POST' : 'GET') {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    let response;
    try {
      response = await fetch(`/api${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch {
      throw new Error(controller.signal.aborted
        ? 'The request timed out. Please try again.'
        : 'Cannot reach the server. Please try again.');
    }

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const error = new Error(data.message || (response.status === 401
        ? 'Your session expired. Please sign in again.'
        : response.status === 429
        ? 'Too many attempts. Please wait a minute and try again.'
        : 'Request failed. Please try again.'));
      error.status = response.status;
      throw error;
    }
    try {
      return await response.json();
    } catch {
      throw new Error(controller.signal.aborted
        ? 'The request timed out. Please try again.'
        : 'The server returned an invalid response. Please try again.');
    }
  } finally {
    clearTimeout(timer);
  }
}
