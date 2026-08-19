// @ts-nocheck
import { getRequestEvent } from '$app/server';

function databaseBinding() {
	const binding = getRequestEvent().platform?.env?.DB;
	if (!binding) {
		throw new Error('D1 binding DB is unavailable. Run the app through Wrangler or deploy it to Cloudflare.');
	}
	return binding;
}

function normaliseValue(value) {
	return value === undefined ? null : value;
}

function compileNamedParameters(sql, args) {
	if (args.length === 1 && Array.isArray(args[0])) {
		return { sql, values: args[0].map(normaliseValue) };
	}
	if (args.length !== 1 || !args[0] || typeof args[0] !== 'object') {
		return { sql, values: args.map(normaliseValue) };
	}

	const parameters = args[0];
	const values = [];
	const compiledSql = sql.replace(/[@:$]([A-Za-z_][A-Za-z0-9_]*)/g, (placeholder, name) => {
		if (!(name in parameters)) return placeholder;
		values.push(normaliseValue(parameters[name]));
		return '?';
	});
	return { sql: compiledSql, values };
}

function preparedStatement(binding, sql) {
	const bind = (args) => {
		const compiled = compileNamedParameters(sql, args);
		return compiled.values.length
			? binding.prepare(compiled.sql).bind(...compiled.values)
			: binding.prepare(compiled.sql);
	};

	return {
		async all(...args) {
			const result = await bind(args).all();
			return result.results ?? [];
		},
		async get(...args) {
			return (await bind(args).first()) ?? undefined;
		},
		async run(...args) {
			return bind(args).run();
		},
		bind(...args) {
			return bind(args);
		}
	};
}

export function getDatabase() {
	const binding = databaseBinding();
	return {
		prepare(sql) {
			return preparedStatement(binding, sql);
		},
		batch(statements) {
			return binding.batch(statements);
		},
		exec(sql) {
			return binding.exec(sql);
		}
	};
}
