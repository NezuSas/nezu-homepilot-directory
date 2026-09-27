import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import rateLimit from '@fastify/rate-limit';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { AuthenticationError, ConflictError, DomainError, ForbiddenError, NotFoundError, UNPAIRED_EDGE_HOSTNAME, ValidationError } from './domain/entities.js';
import { DirectoryService, type DirectoryStore } from './application/DirectoryService.js';
import { DirectorySsoIssuer } from './application/DirectorySsoIssuer.js';
import { EdgeAttestationIssuer, EDGE_ATTESTATION_KEY_ID, EDGE_ATTESTATION_TTL_SECONDS, EDGE_ATTESTATION_TYPE, validateEdgeAttestationChallenge } from './application/EdgeAttestationIssuer.js';
import { EdgeServiceTokenIssuer, EDGE_SERVICE_TOKEN_KEY_ID, EDGE_SERVICE_TOKEN_TTL_SECONDS, EDGE_SERVICE_TOKEN_TYPE } from './application/EdgeServiceTokenIssuer.js';
import { DirectorySessionService } from './application/DirectorySessionService.js';
import { SqliteDirectoryDatabase } from './infrastructure/SqliteDirectoryDatabase.js';
import { createEmailSenderFromEnvironment } from './infrastructure/EmailSenderFactory.js';
import type { EmailSender } from './application/EmailSender.js';
import { PostgresDirectoryDatabase } from './infrastructure/PostgresDirectoryDatabase.js';
import { CloudGatewayRegistry, CloudGatewayRegistryError } from './application/CloudGatewayRegistry.js';
import { CloudGatewaySocketServer } from './infrastructure/CloudGatewaySocketServer.js';

export interface DirectoryServerOptions { databasePath?: string; jwtSecret?: string; invitationTtlMs?: number; serveWeb?: boolean; emailSender?: EmailSender; publicAppUrl?: string; store?: DirectoryStore & { close?: () => void | Promise<void> }; }
type AuthenticatedRequest = FastifyRequest & { accountId: string };
type EdgeCredentialRequest = FastifyRequest & { edgeIdentity: { homeId: string; edgeId: string } };
export function buildServer(options: DirectoryServerOptions = {}): FastifyInstance {
  const database = options.store ?? new SqliteDirectoryDatabase(options.databasePath ?? process.env.DIRECTORY_DB_PATH ?? './data/directory.db');
  const jwtSecret = options.jwtSecret ?? process.env.DIRECTORY_JWT_SECRET;
  if (!jwtSecret) throw new Error('DIRECTORY_JWT_SECRET is required to start the Directory server.');
  const sessions = new DirectorySessionService(jwtSecret);
  const authRateLimitMax = parsePositiveInteger(process.env.DIRECTORY_AUTH_RATE_LIMIT_MAX, 10);
  const directory = new DirectoryService(database, options.invitationTtlMs, options.emailSender ?? createEmailSenderFromEnvironment(), options.publicAppUrl ?? process.env.PUBLIC_APP_URL ?? 'http://localhost:3100');
  const ssoIssuer = DirectorySsoIssuer.fromEnvironment();
  const edgeAttestationIssuer = EdgeAttestationIssuer.fromEnvironment();
  const edgeAttestationAttempts = new Map<string, number[]>();
  const edgeServiceTokenIssuer = EdgeServiceTokenIssuer.fromEnvironment();
  const edgeServiceTokenAttempts = new Map<string, number[]>();
  const edgeCredentialRotationAttempts = new Map<string, number[]>();
  const app = Fastify({logger:false});
  const gatewayRegistry = new CloudGatewayRegistry();
  const cloudGateway = new CloudGatewaySocketServer(gatewayRegistry, {
    authenticate: (token) => directory.authenticateEdgeCredential(token),
  });
  cloudGateway.install(app.server);
  app.register(cors,{origin:false});
  app.addHook('onClose', async () => { await database.close?.(); });
  const authenticated = async (request: FastifyRequest): Promise<void> => { const raw=request.headers.authorization; if(!raw?.startsWith('Bearer ')) throw new AuthenticationError('SESSION_REQUIRED'); (request as AuthenticatedRequest).accountId=sessions.verify(raw.slice(7)).accountId; };
  app.setErrorHandler((error, _request, reply) => {
    const frameworkStatus = typeof (error as { statusCode?: unknown }).statusCode === 'number' ? (error as { statusCode: number }).statusCode : undefined;
    const gatewayStatus = error instanceof CloudGatewayRegistryError ? (error.code === 'EDGE_OFFLINE' ? 503 : error.code === 'GATEWAY_REQUEST_EXPIRED' ? 504 : 409) : undefined;
    const status = error instanceof AuthenticationError ? 401 : error instanceof ForbiddenError ? 403 : error instanceof NotFoundError ? 404 : error instanceof ConflictError ? 409 : error instanceof ValidationError ? 400 : gatewayStatus ?? frameworkStatus ?? 500;
    reply.code(status).send({ error: error instanceof DomainError ? error.code : error instanceof CloudGatewayRegistryError ? error.code : status === 429 ? 'RATE_LIMIT_EXCEEDED' : status === 415 ? 'UNSUPPORTED_MEDIA_TYPE' : 'INTERNAL_ERROR' });
  });
  app.get('/health',async()=>({status:'ok'}));
  app.get('/directory/sso/public-key', async (_request, reply) => { if (!ssoIssuer) return reply.code(503).send({ error: 'SSO_NOT_CONFIGURED' }); return { publicKey: ssoIssuer.publicKey() }; });
  app.get('/directory/edge-attestation/public-key', async (_request, reply) => {
    if (!edgeAttestationIssuer) return reply.code(503).send({ error: 'EDGE_ATTESTATION_NOT_CONFIGURED' });
    return { type: EDGE_ATTESTATION_TYPE, algorithm: 'Ed25519', keyId: EDGE_ATTESTATION_KEY_ID, publicKey: edgeAttestationIssuer.publicKey() };
  });
  app.post('/directory/edge-attestation', async (request, reply) => {
    const authorization = request.headers.authorization;
    const credential = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
    const identity = credential ? await directory.authenticateEdgeCredential(credential) : null;
    if (!identity) throw new AuthenticationError('EDGE_CREDENTIAL_INVALID');
    const challenge = validateEdgeAttestationChallenge(request.body);
    if (!edgeAttestationIssuer) return reply.code(503).send({ error: 'EDGE_ATTESTATION_NOT_CONFIGURED' });
    const now = Date.now();
    for (const [edgeId, attempts] of edgeAttestationAttempts) {
      const active = attempts.filter(timestamp => timestamp > now - 60_000);
      if (active.length) edgeAttestationAttempts.set(edgeId, active);
      else edgeAttestationAttempts.delete(edgeId);
    }
    const attempts = edgeAttestationAttempts.get(identity.edgeId) ?? [];
    if (attempts.length >= 10) return reply.code(429).send({ error: 'RATE_LIMIT_EXCEEDED' });
    attempts.push(now);
    edgeAttestationAttempts.set(identity.edgeId, attempts);
    const attestation = edgeAttestationIssuer.issue(challenge, identity);
    await directory.auditEdgeAttestation(identity.homeId, identity.edgeId);
    return { attestation, expiresIn: EDGE_ATTESTATION_TTL_SECONDS };
  });
  app.get('/directory/edge-service-token/public-key', async (_request, reply) => {
    if (!edgeServiceTokenIssuer) return reply.code(503).send({ error: 'EDGE_SERVICE_TOKEN_NOT_CONFIGURED' });
    return { type: EDGE_SERVICE_TOKEN_TYPE, algorithm: 'Ed25519', keyId: EDGE_SERVICE_TOKEN_KEY_ID, publicKey: edgeServiceTokenIssuer.publicKey() };
  });
  app.post('/directory/edge-service-token', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const authorization = request.headers.authorization;
    const credential = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
    const identity = credential ? await directory.authenticateEdgeCredential(credential) : null;
    if (!identity) throw new AuthenticationError('EDGE_CREDENTIAL_INVALID');
    if (request.body !== undefined) throw new ValidationError('EDGE_SERVICE_TOKEN_BODY_NOT_ALLOWED');
    if (!edgeServiceTokenIssuer) return reply.code(503).send({ error: 'EDGE_SERVICE_TOKEN_NOT_CONFIGURED' });
    const now = Date.now();
    for (const [edgeId, attempts] of edgeServiceTokenAttempts) {
      const active = attempts.filter(timestamp => timestamp > now - 60_000);
      if (active.length) edgeServiceTokenAttempts.set(edgeId, active);
      else edgeServiceTokenAttempts.delete(edgeId);
    }
    const attempts = edgeServiceTokenAttempts.get(identity.edgeId) ?? [];
    if (attempts.length >= 10) return reply.code(429).send({ error: 'RATE_LIMIT_EXCEEDED' });
    attempts.push(now);
    edgeServiceTokenAttempts.set(identity.edgeId, attempts);
    const token = edgeServiceTokenIssuer.issue(identity);
    await directory.auditEdgeServiceToken(identity.homeId, identity.edgeId);
    return { token, expiresIn: EDGE_SERVICE_TOKEN_TTL_SECONDS };
  });
  app.post('/directory/edge-credential/rotate', { onRequest: async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const authorization = request.headers.authorization;
    const credential = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
    const identity = credential ? await directory.authenticateEdgeCredential(credential) : null;
    if (!identity) throw new AuthenticationError('EDGE_CREDENTIAL_INVALID');
    (request as EdgeCredentialRequest).edgeIdentity = identity;
    if (Number(request.headers['content-length'] ?? 0) > 0 || request.headers['transfer-encoding'] !== undefined) throw new ValidationError('EDGE_CREDENTIAL_ROTATION_BODY_NOT_ALLOWED');
  } }, async (request, reply) => {
    const identity = (request as EdgeCredentialRequest).edgeIdentity;
    const credential = request.headers.authorization!.slice(7);
    if (request.body !== undefined) throw new ValidationError('EDGE_CREDENTIAL_ROTATION_BODY_NOT_ALLOWED');
    const now = Date.now();
    for (const [edgeId, attempts] of edgeCredentialRotationAttempts) {
      const active = attempts.filter(timestamp => timestamp > now - 60_000);
      if (active.length) edgeCredentialRotationAttempts.set(edgeId, active);
      else edgeCredentialRotationAttempts.delete(edgeId);
    }
    const attempts = edgeCredentialRotationAttempts.get(identity.edgeId) ?? [];
    if (attempts.length >= 10) return reply.code(429).send({ error: 'RATE_LIMIT_EXCEEDED' });
    attempts.push(now);
    edgeCredentialRotationAttempts.set(identity.edgeId, attempts);
    return directory.rotateEdgeCredential(credential, identity);
  });
  app.register(async authRoutes => {
    await authRoutes.register(rateLimit, { max: authRateLimitMax, timeWindow: '1 minute' });
    authRoutes.post('/directory/accounts', async (request, reply) => {
      const body = request.body as { email?: unknown; displayName?: unknown; password?: unknown };
      if (typeof body?.email !== 'string' || typeof body.displayName !== 'string' || typeof body.password !== 'string') throw new ValidationError('INVALID_BODY');
      const account = await directory.registerAccount({ email: body.email, displayName: body.displayName, password: body.password });
      reply.code(201).send({ id: account.id, email: account.email, displayName: account.displayName });
    });
    authRoutes.post('/directory/session', async request => {
      const body = request.body as { email?: unknown; password?: unknown };
      if (typeof body?.email !== 'string' || typeof body.password !== 'string') throw new ValidationError('INVALID_BODY');
      const account = await directory.authenticate({ email: body.email, password: body.password });
      return { token: sessions.issue(account.id), account: { id: account.id, email: account.email, displayName: account.displayName } };
    });
  });
  app.post('/directory/password-reset/request', async (request, reply) => { const body = request.body as { email?: unknown }; if (typeof body?.email !== 'string') throw new ValidationError('INVALID_BODY'); await directory.requestPasswordReset(body.email); reply.code(202).send({ status: 'accepted' }); });
  app.post('/directory/password-reset/:token/confirm', async request => { const body = request.body as { password?: unknown }; if (typeof body?.password !== 'string') throw new ValidationError('INVALID_BODY'); await directory.confirmPasswordReset((request.params as { token: string }).token, body.password); return { status: 'confirmed' }; });
  app.post('/directory/accounts/verify-email/:token', async request => { await directory.verifyEmail((request.params as { token: string }).token); return { status: 'verified' }; });  app.post('/directory/homes/:homeId/sso-token', { preHandler: authenticated }, async (request, reply) => { if (!ssoIssuer) return reply.code(503).send({ error: 'SSO_NOT_CONFIGURED' }); const accountId = (request as AuthenticatedRequest).accountId; const homeId = (request.params as { homeId: string }).homeId; const home = await directory.getHome(accountId, homeId); if (home.edgeHostname === UNPAIRED_EDGE_HOSTNAME) throw new ConflictError('EDGE_NOT_PAIRED'); return { token: ssoIssuer.issue(accountId, homeId) }; });
  app.get('/directory/homes',{preHandler:authenticated},async(request)=>directory.listHomes((request as AuthenticatedRequest).accountId));
  const edgeGatewayIdentity = async (request: FastifyRequest): Promise<import('./application/CloudGatewayProtocol.js').RelayIdentity> => {
    const token = request.headers.authorization?.startsWith('Bearer ') ? request.headers.authorization.slice(7).trim() : '';
    const identity = token ? await directory.authenticateEdgeCredential(token) : null;
    const body = request.body as { homeId?: unknown; edgeId?: unknown };
    if (!identity || body?.homeId !== identity.homeId || body?.edgeId !== identity.edgeId) throw new AuthenticationError('EDGE_CREDENTIAL_INVALID');
    return identity;
  };
  app.post('/gateway/edge/poll', { bodyLimit: 64 * 1024 }, async (request) => {
    const identity = await edgeGatewayIdentity(request);
    return gatewayRegistry.poll(identity);
  });
  app.post('/gateway/edge/response', { bodyLimit: 64 * 1024 }, async (request, reply) => {
    const identity = await edgeGatewayIdentity(request);
    gatewayRegistry.receive(identity.edgeId, request.body);
    reply.code(204).send();
  });
  app.post('/directory/homes/:homeId/edge-pairing-code',{preHandler:authenticated},async(request, reply)=>{ const pairing=await directory.createPairingCode((request as AuthenticatedRequest).accountId,(request.params as {homeId:string}).homeId); reply.code(201).send(pairing); });
  app.register(async pairingRoutes => { await pairingRoutes.register(rateLimit,{max:5,timeWindow:'1 minute'}); pairingRoutes.post('/directory/edge-pairing/claim',async(request,reply)=>{const body=request.body as {code?:unknown;edgeHostname?:unknown};if(typeof body?.code!=='string'||typeof body.edgeHostname!=='string')throw new ValidationError('INVALID_BODY');const edge=await directory.claimPairingCode(body.code,body.edgeHostname);reply.code(201).send({...edge,gatewayUrl:(process.env.PUBLIC_APP_URL ?? 'https://accounts.nezuecuador.com').replace(/^https:/,'wss:') + '/gateway/edge'});}); });
  app.post('/directory/homes',{preHandler:authenticated},async(request,reply)=>{const body=request.body as {name?:unknown;edgeHostname?:unknown};if(typeof body?.name!=='string'||body.edgeHostname!==undefined&&typeof body.edgeHostname!=='string')throw new ValidationError('INVALID_BODY');const home=await directory.registerHome((request as AuthenticatedRequest).accountId,{name:body.name,edgeHostname:body.edgeHostname});reply.code(201).send(home);});
  app.get('/directory/homes/:homeId',{preHandler:authenticated},async(request)=>directory.getHome((request as AuthenticatedRequest).accountId,(request.params as {homeId:string}).homeId));
  app.patch('/directory/homes/:homeId',{preHandler:authenticated},async(request)=>{const body=request.body as {name?:unknown;edgeHostname?:unknown};if(body.name!==undefined&&typeof body.name!=='string'||body.edgeHostname!==undefined&&typeof body.edgeHostname!=='string')throw new ValidationError('INVALID_BODY');return directory.updateHome((request as AuthenticatedRequest).accountId,(request.params as {homeId:string}).homeId,{name:body.name as string | undefined,edgeHostname:body.edgeHostname as string | undefined});});
  app.delete('/directory/homes/:homeId',{preHandler:authenticated},async(request,reply)=>{await directory.deleteHome((request as AuthenticatedRequest).accountId,(request.params as {homeId:string}).homeId);reply.code(204).send();});
  app.get('/directory/homes/:homeId/memberships',{preHandler:authenticated},async(request)=>directory.listMembers((request as AuthenticatedRequest).accountId,(request.params as {homeId:string}).homeId));
  app.post('/directory/homes/:homeId/invitations',{preHandler:authenticated},async(request,reply)=>{const body=request.body as {email?:unknown};if(typeof body?.email!=='string')throw new ValidationError('INVALID_BODY');const invitation=await directory.invite((request as AuthenticatedRequest).accountId,(request.params as {homeId:string}).homeId,body.email);reply.code(201).send(invitation);});
  app.post('/directory/invitations/:token/accept',{preHandler:authenticated},async(request)=>directory.acceptInvitation((request as AuthenticatedRequest).accountId,(request.params as {token:string}).token));
  app.post('/directory/invitations/:token/reject',{preHandler:authenticated},async(request)=>directory.rejectInvitation((request as AuthenticatedRequest).accountId,(request.params as {token:string}).token));
  app.delete('/directory/homes/:homeId/memberships/:accountId',{preHandler:authenticated},async(request,reply)=>{const params=request.params as {homeId:string;accountId:string};await directory.revokeMembership((request as AuthenticatedRequest).accountId,params.homeId,params.accountId);reply.code(204).send();});
  app.get('/directory/homes/:homeId/audit',{preHandler:authenticated},async(request)=>directory.listAudit((request as AuthenticatedRequest).accountId,(request.params as {homeId:string}).homeId));
  if(options.serveWeb!==false){ const here=dirname(fileURLToPath(import.meta.url)); app.register(fastifyStatic,{root:join(here,'web'),prefix:'/'}); app.get('/',async(_request,reply)=>reply.sendFile('index.html')); app.get('/homes/:homeId',async(_request,reply)=>reply.sendFile('index.html')); }
  return app;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error('DIRECTORY_AUTH_RATE_LIMIT_MAX must be a positive integer.');
  return parsed;
}
export async function buildServerFromEnvironment(): Promise<FastifyInstance> {
  if (process.env.DATABASE_URL) {
    const database = new PostgresDirectoryDatabase(process.env.DATABASE_URL);
    await database.migrate();
    return buildServer({ store: database });
  }
  return buildServer();
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  buildServerFromEnvironment().then(app => app.listen({ host: '0.0.0.0', port: Number(process.env.PORT ?? 3100) }));
}
