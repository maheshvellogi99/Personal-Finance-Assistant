const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1';

export async function apiFetch(path: string, options: RequestInit = {}) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  const headers = new Headers(options.headers || {});

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const urlPath = path.startsWith('/') ? path : `/${path}`;
  const response = await fetch(`${API_BASE_URL}${urlPath}`, {
    ...options,
    headers,
  });

  // Intercept 401 Unauthorized responses to auto-clear session and redirect
  if (response.status === 401 && typeof window !== 'undefined') {
    try {
      const clone = response.clone();
      const errData = await clone.json();
      if (errData && errData.detail === 'PDF_PASSWORD_REQUIRED') {
        return response; // Let the caller handle it (e.g. prompt for PDF password)
      }
    } catch {
      // Ignore JSON parse error, proceed to default 401 redirect
    }

    localStorage.removeItem('token');
    if (!window.location.pathname.startsWith('/login')) {
      window.location.href = '/login';
    }
  }

  return response;
}
