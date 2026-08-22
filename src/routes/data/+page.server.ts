import type { PageServerLoad } from './$types';
import { getDataManagementData } from '$lib/server/queries.js';
import { getDataApiUrl } from '$lib/server/data-api.js';

export const load: PageServerLoad = async () => ({
	dataManagement: await getDataManagementData(),
	dataApiUrl: getDataApiUrl()
});
