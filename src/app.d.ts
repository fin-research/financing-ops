// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			database: import('$lib/server/db.js').PostgresDatabase | null;
			dataApiJwt: string | null;
			authCacheStatus: 'hit' | 'miss' | 'bypass';
			user: {
				id: string;
				email: string | null;
				role: 'admin' | 'handler' | 'reviewer';
				personId: string;
				personName: string;
				hasAvatar: boolean;
				avatarVersion: string;
			} | null;
		}
		interface PageData {
			user?: App.Locals['user'];
		}
		// interface PageState {}
		interface Platform {
			env: Env;
			context: ExecutionContext;
			caches: CacheStorage & { default: Cache };
		}
	}
}

export {};
