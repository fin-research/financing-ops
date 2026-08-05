// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			user: {
				id: string;
				username: string;
				role: 'admin' | 'handler' | 'reviewer';
				personId: string;
				personName: string;
				avatarDataUrl: string | null;
			} | null;
		}
		interface PageData {
			user?: App.Locals['user'];
		}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
