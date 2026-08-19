// @ts-nocheck
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { createSchema } from './schema.js';

const databasePath = process.env.FINANCING_WORKBENCH_DB_PATH ?? path.resolve('database', 'financing-workbench.sqlite');
let database;

export function getLocalDatabase() {
	if (database) return database;
	fs.mkdirSync(path.dirname(databasePath), { recursive: true });
	database = new Database(databasePath);
	database.pragma('foreign_keys = ON');
	createSchema(database);
	return database;
}

export function closeLocalDatabase() {
	if (database) database.close();
	database = undefined;
}

export { databasePath };
