import { withBase } from './app-paths';
import type { DataRow, EntityConfig } from './data-admin';

type ListOptions = {
	page: number;
	pageSize: number;
	sortKey: string;
	sortDirection: 'asc' | 'desc';
	search: string;
};

type ApiErrorBody = { message?: string; details?: string; hint?: string; code?: string };

export class NeonDataApi {
	#url: string;
	#token: string | null = null;

	constructor(url: string) {
		const parsed = new URL(url);
		if (parsed.protocol !== 'https:') throw new Error('Neon Data API 必须使用 HTTPS');
		this.#url = parsed.toString().replace(/\/$/, '');
	}

	async #getToken(force = false) {
		if (this.#token && !force) return this.#token;
		const response = await fetch(withBase('/data/token'), { headers: { Accept: 'application/json' }, cache: 'no-store' });
		if (!response.ok) throw new Error(response.status === 401 ? '登录已失效，请重新登录' : '无法取得数据后台访问令牌');
		const body = await response.json() as { token?: string };
		if (!body.token) throw new Error('Neon Data API 令牌为空');
		this.#token = body.token;
		return body.token;
	}

	async #request(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
		const token = await this.#getToken();
		const headers = new Headers(init.headers);
		headers.set('Authorization', `Bearer ${token}`);
		headers.set('Accept', 'application/json');
		headers.set('Accept-Profile', 'financing');
		headers.set('Content-Profile', 'financing');
		if (init.body !== undefined) headers.set('Content-Type', 'application/json');
		const response = await fetch(`${this.#url}/${path}`, { ...init, headers });
		if (response.status === 401 && retry) {
			await this.#getToken(true);
			return this.#request(path, init, false);
		}
		if (!response.ok) {
			const body = await response.json().catch(() => ({})) as ApiErrorBody;
			const details = [body.message, body.details, body.hint].filter(Boolean).join('；');
			throw new Error(details || `Neon Data API 请求失败（${response.status}）`);
		}
		return response;
	}

	async list(config: EntityConfig, options: ListOptions) {
		const selected = config.fields.map((field) => field.key).join(',');
		const params = new URLSearchParams({
			select: selected,
			order: `${options.sortKey}.${options.sortDirection}`,
			limit: String(options.pageSize),
			offset: String(options.page * options.pageSize)
		});
		const search = options.search.trim().replace(/[,*()]/g, ' ');
		if (search && config.searchFields.length) {
			params.set('or', `(${config.searchFields.map((field) => `${field}.ilike.*${search}*`).join(',')})`);
		}
		const response = await this.#request(`${config.tableName}?${params}`, { headers: { Prefer: 'count=exact' } });
		const rows = await response.json() as DataRow[];
		const totalPart = response.headers.get('content-range')?.split('/')[1];
		return { rows, total: totalPart && totalPart !== '*' ? Number(totalPart) : rows.length };
	}

	#rowFilter(config: EntityConfig, row: DataRow, includeVersion = true) {
		const params = new URLSearchParams();
		for (const key of config.primaryKeys) params.set(key, `eq.${String(row[key])}`);
		if (includeVersion && row.updated_at) params.set('updated_at', `eq.${String(row.updated_at)}`);
		return params;
	}

	async insert(config: EntityConfig, row: DataRow) {
		const tableName = config.insertTable?.(row) ?? config.tableName;
		const response = await this.#request(tableName, {
			method: 'POST',
			headers: { Prefer: 'return=representation' },
			body: JSON.stringify(row)
		});
		return await response.json() as DataRow[];
	}

	async update(config: EntityConfig, original: DataRow, changes: DataRow) {
		const params = this.#rowFilter(config, original);
		const response = await this.#request(`${config.tableName}?${params}`, {
			method: 'PATCH',
			headers: { Prefer: 'return=representation' },
			body: JSON.stringify(changes)
		});
		const rows = await response.json() as DataRow[];
		if (!rows.length) throw new Error('记录已被其他人修改，请刷新后重试');
		return rows;
	}

	async delete(config: EntityConfig, row: DataRow) {
		const params = this.#rowFilter(config, row);
		const response = await this.#request(`${config.tableName}?${params}`, {
			method: 'DELETE',
			headers: { Prefer: 'return=representation' }
		});
		const rows = await response.json() as DataRow[];
		if (!rows.length) throw new Error('记录已被其他人修改或已经删除');
	}
}
