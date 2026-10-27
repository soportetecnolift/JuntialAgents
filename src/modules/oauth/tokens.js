/**
 * Tokens OAuth de las apps de IA (Claude, ChatGPT…) que usan el MCP de JuntialAgents.
 * Los emite Juntial Center (servidor de autorización); aquí solo se validan preguntándole a Center (RFC 7662,
 * 60 s de caché) y se traducen a los permisos de la API v1: lectura = todos los «:read»; escritura = todo.
 */
import { Router } from 'express';
import { env } from '../../config/env.js';
import { center } from '../../lib/center.js';
import { CLIENT_SCOPES } from '../../api/scopes.js';

export function expandScopes(scopes = []) {
  const extra = ['workers:read', 'approvals:read', 'center:read'];
  if (scopes.includes('juntial:write')) return [...Object.keys(CLIENT_SCOPES), 'workers:write', 'approvals:write', 'center:write', ...extra];
  return [...Object.keys(CLIENT_SCOPES).filter((s) => s.endsWith(':read')), ...extra];
}
export async function verifyOAuthToken(raw) {
  const r = await center.introspect(raw).catch(() => null);
  if (!r?.active || !r.user?.tenantId) return null;
  return { keyId: `oauth:${r.grantId}`, kind: 'oauth', grantId: r.grantId, scopes: expandScopes(r.oauthScopes), oauthScopes: r.oauthScopes, ip: [], rpm: 600, user: { id: r.user.id, role: 'client', tenantId: r.user.tenantId, email: r.user.email } };
}

/** Metadatos del recurso protegido (RFC 9728): el MCP está aquí; el servidor de autorización es Juntial Center. */
export const protectedResource = Router();
const meta = (_req, res) => res.json({ resource: `${env.PUBLIC_API_URL.replace(/\/$/, '')}/mcp`, authorization_servers: [env.CENTER_URL.replace(/\/$/, '')], scopes_supported: ['juntial:read', 'juntial:write'], bearer_methods_supported: ['header'], resource_name: 'JuntialAgents', resource_documentation: `${env.PUBLIC_API_URL.replace(/\/$/, '')}/docs` });
protectedResource.get('/.well-known/oauth-protected-resource', meta);
protectedResource.get('/.well-known/oauth-protected-resource/mcp', meta);
