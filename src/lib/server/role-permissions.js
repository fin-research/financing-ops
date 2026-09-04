// @ts-nocheck
import { getDatabase } from './db.js';

export async function getRolePermissionCodes(role, database = getDatabase()) {
	if (!role) return [];
	const rows = await database.prepare(`
		SELECT permission_code AS permissionCode
		FROM role_permissions
		WHERE role = ? AND granted = TRUE
		ORDER BY permission_code
	`).all(role);
	return rows.map(({ permissionCode }) => permissionCode);
}

export async function getRolePermissionMatrix(database = getDatabase()) {
	const rows = await database.prepare(`
		SELECT role, permission_code AS permissionCode
		FROM role_permissions
		WHERE granted = TRUE
		ORDER BY role, permission_code
	`).all();
	return rows.reduce((matrix, { role, permissionCode }) => {
		(matrix[role] ??= []).push(permissionCode);
		return matrix;
	}, { admin: [], handler: [], reviewer: [] });
}
