import type { PageServerLoad } from './$types';
import { getWorkbenchData } from '$lib/server/queries.js';

export const load: PageServerLoad = () => ({ workbench: getWorkbenchData() });
