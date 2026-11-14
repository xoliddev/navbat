import { ApiError, type Backend } from './types';

export interface HttpOptions {
  baseUrl: string;
  slug: string;
  /** Returns the Authorization header value (`tma …`, `Bearer …` or `dev …`). */
  auth: () => string | null;
}

/** Production backend: talks to the Fastify API. */
export function createHttpBackend(opts: HttpOptions): Backend {
  const root = `${opts.baseUrl.replace(/\/$/, '')}/api/b/${encodeURIComponent(opts.slug)}`;

  async function call<T>(method: string, path: string, body?: unknown, raw = false): Promise<T> {
    const headers: Record<string, string> = {};
    const a = opts.auth();
    if (a) headers.authorization = a;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(`${root}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 204) return undefined as T;
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: { code: string; message: string; details?: Record<string, unknown> } } | null;
      throw new ApiError(data?.error?.code ?? 'INTERNAL', data?.error?.message ?? res.statusText, res.status, data?.error?.details);
    }
    return (raw ? await res.text() : await res.json()) as T;
  }

  const q = (params: Record<string, string | undefined>) => {
    const s = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined) s.set(k, v);
    return `?${s.toString()}`;
  };
  const sq = (x: { serviceIds: string[]; staffId: string | null }) => ({
    services: x.serviceIds.join(','),
    staff: x.staffId ?? 'any',
  });

  return {
    mode: 'http',
    now: () => Date.now(),
    catalog: () => call('GET', '/catalog'),
    slots: (x) => call('GET', `/slots${q({ ...sq(x), date: x.date })}`),
    availability: (x) => call('GET', `/availability${q({ ...sq(x), month: x.month })}`),
    firstAvailable: async (x) => (await call<{ date: string | null }>('GET', `/first-available${q(sq(x))}`)).date,
    me: () => call('GET', '/me'),
    patchMe: (body) => call('PATCH', '/me', body),
    myBookings: () => call('GET', '/me/bookings'),
    createBooking: (body) => call('POST', '/bookings', body),
    booking: (id) => call('GET', `/bookings/${id}`),
    reschedule: (id, start) => call('POST', `/bookings/${id}/reschedule`, { start }),
    cancel: (id, reason) => call('POST', `/bookings/${id}/cancel`, { reason }),
    late: (id, minutes) => call('POST', `/bookings/${id}/late`, { minutes }),
    review: (id, rating, comment) => call('POST', `/bookings/${id}/review`, { rating, comment }),
    completeSandboxPayment: (ref) => call('POST', `/payments/sandbox/${encodeURIComponent(ref)}/complete`, {}),
    adminMe: () => call('GET', '/admin/me'),
    adminCatalog: () => call('GET', '/admin/catalog'),
    calendar: (x) => call('GET', `/admin/calendar${q({ from: x.from, to: x.to, staff: x.staffIds?.join(',') })}`),
    adminCreateBooking: (body) => call('POST', '/admin/bookings', body),
    adminBooking: (id) => call('GET', `/admin/bookings/${id}`),
    adminReschedule: (id, start, staffId) => call('POST', `/admin/bookings/${id}/reschedule`, { start, staffId }),
    adminCancel: (id, reason) => call('POST', `/admin/bookings/${id}/cancel`, { reason }),
    adminStatus: (id, event) => call('POST', `/admin/bookings/${id}/status`, { event }),
    createTimeOff: (body) => call('POST', '/admin/time-off', body),
    deleteTimeOff: (id) => call('DELETE', `/admin/time-off/${id}`),
    saveService: (body) => call('PUT', '/admin/services', body),
    saveStaff: (body) => call('PUT', '/admin/staff', body),
    schedule: (id) => call('GET', `/admin/staff/${id}/schedule`),
    saveSchedule: (id, rules) => call('PUT', `/admin/staff/${id}/schedule`, { rules }),
    saveSettings: (body) => call('PUT', '/admin/settings', body),
    clients: (search) => call('GET', `/admin/clients${q({ search })}`),
    client: (id) => call('GET', `/admin/clients/${id}`),
    analytics: (x) => call('GET', `/admin/analytics${q(x)}`),
    exportCsv: (x) => call('GET', `/admin/export.csv${q(x)}`, undefined, true),
  };
}
