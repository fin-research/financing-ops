import { readFile, writeFile } from 'node:fs/promises';

const directory = process.env.AUTH0_MIGRATION_DIR;
const token = process.env.CLOUDFLARE_ACCESS_API_TOKEN;
if (!directory || !token) throw new Error('Set AUTH0_MIGRATION_DIR and CLOUDFLARE_ACCESS_API_TOKEN');
const app = JSON.parse(await readFile(`${directory}/app.json`, 'utf8'));
const accountId = '5cecc63c78acf8f5473f8745f4244448';
const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/access`;
async function api(path, method = 'GET', body) {
  const response = await fetch(`${base}/${path}`, { method, signal: AbortSignal.timeout(20000),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(`Access ${method} ${path} failed (${response.status}; ${result.errors?.map((error) => error.code).join(',')})`);
  return result.result;
}
const organization = await api('organizations');
const idps = await api('identity_providers');
const applications = await api('apps');
const current = applications.find((item) => item.name === 'eastmoney');
const currentIdp = idps.find((item) => item.name === 'eastmoney Auth0');
console.log(JSON.stringify({ mode: process.argv.includes('--apply') ? 'apply' : 'plan', teamDomain: organization.auth_domain,
  existingApp: current?.id ?? null, existingIdp: currentIdp?.id ?? null, initialPath: 'eastmoney.hasbai.xyz/auth/login' }));
if (!process.argv.includes('--apply')) process.exit(0);
const oidc = {
  name: 'eastmoney Auth0', type: 'oidc', config: {
    client_id: app.client_id, client_secret: app.client_secret,
    auth_url: `https://${app.domain}/authorize`, token_url: `https://${app.domain}/oauth/token`,
    certs_url: `https://${app.domain}/.well-known/jwks.json`,
    scopes: ['openid', 'profile', 'email'], claims: ['eastmoney_user_id'], pkce_enabled: true,
  },
};
const idp = currentIdp ? await api(`identity_providers/${currentIdp.id}`, 'PUT', oidc) : await api('identity_providers', 'POST', oidc);
// Start on the login path only. Application cutover adds business destinations later.
const application = current ?? await api('apps', 'POST', {
  name: 'eastmoney', type: 'self_hosted',
  destinations: [{ type: 'public', uri: 'eastmoney.hasbai.xyz/auth/login' }],
  allowed_idps: [idp.id], auto_redirect_to_identity: true, session_duration: '1h',
  http_only_cookie_attribute: true, same_site_cookie_attribute: 'lax', app_launcher_visible: false,
});
const policies = await api(`apps/${application.id}/policies`);
if (!policies.some((policy) => policy.name === '18.cn users via Auth0')) await api(`apps/${application.id}/policies`, 'POST', {
  name: '18.cn users via Auth0', decision: 'allow', precedence: 1,
  include: [{ email_domain: { domain: '18.cn' } }], require: [{ login_method: { id: idp.id } }],
});
const verified = await api(`apps/${application.id}`);
const receipt = { team_domain: organization.auth_domain, idp_id: idp.id, application_id: application.id, audience: verified.aud,
  callback: `https://${organization.auth_domain}/cdn-cgi/access/callback`, destinations: verified.destinations };
await writeFile(`${directory}/access.json`, JSON.stringify(receipt), { mode: 0o600 });
console.log(JSON.stringify(receipt));
