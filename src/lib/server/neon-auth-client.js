// @ts-nocheck
export const NEON_SESSION_COOKIE = '__Secure-neon-auth.session_token';

export class NeonAuthApiError extends Error {
	constructor(status, message, code = null, options = undefined) {
		super(message || `Neon Auth request failed with status ${status}`, options);
		this.name = 'NeonAuthApiError';
		this.status = status;
		this.code = code;
	}
}

function authEndpoint(baseUrl, route) {
	const base = new URL(baseUrl);
	if (base.protocol !== 'https:' && base.hostname !== 'localhost' && base.hostname !== '127.0.0.1') {
		throw new Error('NEON_AUTH_URL must use HTTPS outside local development');
	}
	if (base.username || base.password) throw new Error('NEON_AUTH_URL must not contain credentials');
	base.pathname = `${base.pathname.replace(/\/$/, '')}/${String(route).replace(/^\//, '')}`;
	base.search = '';
	base.hash = '';
	return base;
}

function upstreamCookie(token) {
	return `${NEON_SESSION_COOKIE}=${token}`;
}

export function sessionTokenFromSetCookie(header) {
	const value = String(header ?? '');
	const marker = `${NEON_SESSION_COOKIE}=`;
	const start = value.indexOf(marker);
	if (start < 0) return null;
	const tokenStart = start + marker.length;
	const tokenEnd = value.indexOf(';', tokenStart);
	return value.slice(tokenStart, tokenEnd < 0 ? value.length : tokenEnd) || null;
}

export function sessionMaxAgeFromSetCookie(header, fallback = 7 * 24 * 60 * 60) {
	const match = String(header ?? '').match(/(?:^|;)\s*Max-Age=(\d+)/i);
	const maxAge = Number(match?.[1]);
	return Number.isFinite(maxAge) && maxAge > 0 ? maxAge : fallback;
}

async function responseBody(response) {
	const contentType = response.headers.get('content-type') ?? '';
	if (!contentType.includes('application/json')) return null;
	return response.json().catch(() => null);
}

export function createNeonAuthClient({ baseUrl, origin, token = null, fetchImpl = fetch }) {
	if (!baseUrl) throw new Error('NEON_AUTH_URL is unavailable');
	if (!origin) throw new Error('Application origin is unavailable');

	const request = async (route, { method = 'GET', body, sessionToken = token } = {}) => {
		const headers = new Headers({ Accept: 'application/json', Origin: origin });
		if (body !== undefined) headers.set('Content-Type', 'application/json');
		if (sessionToken) headers.set('Cookie', upstreamCookie(sessionToken));
		let response;
		try {
			response = await fetchImpl(authEndpoint(baseUrl, route), {
				method,
				headers,
				body: body === undefined ? undefined : JSON.stringify(body),
				redirect: 'manual'
			});
		} catch (error) {
			throw new NeonAuthApiError(503, 'Neon Auth service is unavailable', 'AUTH_UNAVAILABLE', { cause: error });
		}
		const data = await responseBody(response);
		if (!response.ok) {
			throw new NeonAuthApiError(
				response.status,
				data?.message ?? data?.error?.message ?? 'Neon Auth request failed',
				data?.code ?? data?.error?.code ?? null
			);
		}
		const setCookie = response.headers.get('set-cookie');
		return {
			data,
			token: sessionTokenFromSetCookie(setCookie) ?? data?.token ?? sessionToken ?? null,
			maxAge: sessionMaxAgeFromSetCookie(setCookie)
		};
	};

	return {
		request,
		async signIn(email, password) {
			return request('/sign-in/email', {
				method: 'POST',
				body: { email, password, rememberMe: true },
				sessionToken: null
			});
		},
		async getSession() {
			if (!token) return { data: null, token: null, maxAge: 0 };
			return request('/get-session');
		},
		async signOut() {
			if (!token) return { data: { success: true }, token: null, maxAge: 0 };
			return request('/sign-out', { method: 'POST', body: {} });
		}
	};
}
