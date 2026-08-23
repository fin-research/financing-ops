import type { PageServerLoad } from './$types';
import { getDataApiUrl } from '$lib/server/data-api.js';

export const load: PageServerLoad = async () => ({
	dataApiUrl: getDataApiUrl()
});
