// @ts-nocheck

export function createSqliteD1Adapter(sqlite) {
	function prepared(sql, bound = []) {
		return {
			bind(...values) {
				return prepared(sql, values);
			},
			async all(...values) {
				return sqlite.prepare(sql).all(...(values.length ? values : bound));
			},
			async get(...values) {
				return sqlite.prepare(sql).get(...(values.length ? values : bound));
			},
			async run(...values) {
				const result = sqlite.prepare(sql).run(...(values.length ? values : bound));
				return {
					meta: {
						changes: result.changes,
						rows_written: result.changes,
						last_row_id: Number(result.lastInsertRowid)
					}
				};
			},
			_runBound() {
				const result = sqlite.prepare(sql).run(...bound);
				return {
					meta: {
						changes: result.changes,
						rows_written: result.changes,
						last_row_id: Number(result.lastInsertRowid)
					}
				};
			}
		};
	}

	return {
		prepare(sql) {
			return prepared(sql);
		},
		async batch(statements) {
			return sqlite.transaction(() => statements.map((statement) => statement._runBound()))();
		}
	};
}
