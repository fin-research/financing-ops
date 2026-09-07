import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

export function management(method, path, body) {
  const result = spawnSync('auth0', ['api', method, path, '--tenant', 'hasbai.eu.auth0.com', '--no-input', ...(method === 'delete' ? ['--force'] : [])], {
    input: body === undefined ? undefined : JSON.stringify(body), encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
  });
  let data;
  try { data = result.stdout.trim() ? JSON.parse(result.stdout) : null; } catch { throw new Error(`Auth0 ${method} ${path.split('?')[0]} returned invalid JSON`); }
  if (result.status !== 0 || data?.statusCode >= 400 || (!data && method === 'get')) {
    throw new Error(`Auth0 ${method} ${path.split('?')[0]} failed (check management authorization)`);
  }
  return data;
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const directory = process.env.AUTH0_MIGRATION_DIR;
  if (!directory) throw new Error('Set AUTH0_MIGRATION_DIR to a restricted directory outside the repository');
  const apply = process.argv.includes('--apply');
  const clientId = '16vMxoYpr5AdPRiW1PkwIiHuRWszii6m';
  const domain = 'hasbai.eu.auth0.com';
  const audience = 'https://eastmoney.hasbai.xyz/financing';
  const matrix = JSON.parse(await readFile(resolve(directory, 'role-permissions.json'), 'utf8'));
  const permissions = [...new Set(Object.values(matrix).flat())];
  let apis = management('get', 'resource-servers');
  let roles = management('get', 'roles?per_page=100');
  const clients = management('get', 'clients?fields=client_id,name,app_type&include_fields=true&per_page=100');
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'plan', tenant: domain, application: clientId, roles: Object.keys(matrix), permissionCount: permissions.length }));
  if (!apply) process.exit(0);
  let api = apis.find((item) => item.identifier === audience);
  if (!api) api = management('post', 'resource-servers', { name: 'eastmoney financing', identifier: audience,
    signing_alg: 'RS256', enforce_policies: true, token_dialect: 'access_token_authz',
    scopes: permissions.map((value) => ({ value, description: value })) });
  const roleIds = {};
  for (const [name, codes] of Object.entries(matrix)) {
    let role = roles.find((item) => item.name === `financing:${name}`);
    if (!role) role = management('post', 'roles', { name: `financing:${name}`, description: `融资工作台 ${name}` });
    roleIds[name] = role.id;
    const existing = management('get', `roles/${role.id}/permissions?per_page=100`);
    const missing = codes.filter((code) => !existing.some((item) => item.permission_name === code && item.resource_server_identifier === audience));
    if (missing.length) management('post', `roles/${role.id}/permissions`, { permissions: missing.map((permission_name) => ({ permission_name, resource_server_identifier: audience })) });
  }
  let manager = clients.find((item) => item.name === 'eastmoney identity management');
  if (!manager) manager = management('post', 'clients', { name: 'eastmoney identity management', app_type: 'non_interactive', grant_types: ['client_credentials'], token_endpoint_auth_method: 'client_secret_post' });
  else manager = management('get', `clients/${manager.client_id}`);
  const grants = management('get', `client-grants?client_id=${encodeURIComponent(manager.client_id)}`);
  if (!grants.some((item) => item.audience === `https://${domain}/api/v2/`)) management('post', 'client-grants', {
    client_id: manager.client_id, audience: `https://${domain}/api/v2/`,
    scope: ['read:users', 'create:users', 'update:users', 'read:roles', 'update:roles'],
  });
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(resolve(directory, 'management.json'), JSON.stringify({ domain, client_id: manager.client_id, client_secret: manager.client_secret, role_ids: roleIds, resource_server_id: api.id }), { mode: 0o600 });
  console.log(JSON.stringify({ configured: true, roleIds, managementClientId: manager.client_id, resourceServerId: api.id }));
}
