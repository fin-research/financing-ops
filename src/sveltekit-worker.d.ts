declare module 'sveltekit-worker' {
	const worker: import('@cloudflare/workers-types').ExportedHandler<
		import('./worker-types.js').FinancingWorkerEnv
	>;
	export default worker;
}
