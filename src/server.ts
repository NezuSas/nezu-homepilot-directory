import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { AuthenticationError, ConflictError, DomainError, ForbiddenError, NotFoundError, ValidationError } from './domain/entities.js';
import { DirectoryService } from './application/DirectoryService.js';
import { DirectorySessionService } from './application/DirectorySessionService.js';
import { SqliteDirectoryDatabase } from './infrastructure/SqliteDirectoryDatabase.js';

export interface DirectoryServerOptions { databasePath?: string; jwtSecret?: string; invitationTtlMs?: number; serveWeb?: boolean; }
type AuthenticatedRequest = FastifyRequest & { accountId: string };
export function buildServer(options: DirectoryServerOptions = {}): FastifyInstance {
  const database = new SqliteDirectoryDatabase(options.databasePath ?? process.env.DIRECTORY_DB_PATH ?? './data/directory.db');
  const sessions = new DirectorySessionService(options.jwtSecret ?? process.env.DIRECTORY_JWT_SECRET ?? 'development-only-secret-must-be-replaced');
  const directory = new DirectoryService(database, options.invitationTtlMs);
  const app = Fastify({logger:false});
  app.register(cors,{origin:false});
  app.addHook('onClose',async()=>database.close());
  const authenticated = async (request: FastifyRequest): Promise<void> => { const raw=request.headers.authorization; if(!raw?.startsWith('Bearer ')) throw new AuthenticationError('SESSION_REQUIRED'); (request as AuthenticatedRequest).accountId=sessions.verify(raw.slice(7)).accountId; };
  app.setErrorHandler((error, _request, reply) => { const status=error instanceof AuthenticationError?401:error instanceof ForbiddenError?403:error instanceof NotFoundError?404:error instanceof ConflictError?409:error instanceof ValidationError?400:500; reply.code(status).send({error:error instanceof DomainError?error.code:'INTERNAL_ERROR'}); });
  app.get('/health',async()=>({status:'ok'}));
  app.post('/directory/accounts',async(request,reply)=>{const body=request.body as {email?:unknown;displayName?:unknown;password?:unknown};if(typeof body?.email!=='string'||typeof body.displayName!=='string'||typeof body.password!=='string')throw new ValidationError('INVALID_BODY');const account=await directory.registerAccount({email:body.email,displayName:body.displayName,password:body.password});reply.code(201).send({id:account.id,email:account.email,displayName:account.displayName});});
  app.post('/directory/session',async(request)=>{const body=request.body as {email?:unknown;password?:unknown};if(typeof body?.email!=='string'||typeof body.password!=='string')throw new ValidationError('INVALID_BODY');const account=await directory.authenticate({email:body.email,password:body.password});return {token:sessions.issue(account.id),account:{id:account.id,email:account.email,displayName:account.displayName}};});
  app.get('/directory/homes',{preHandler:authenticated},async(request)=>directory.listHomes((request as AuthenticatedRequest).accountId));
  app.post('/directory/homes',{preHandler:authenticated},async(request,reply)=>{const body=request.body as {name?:unknown;edgeHostname?:unknown};if(typeof body?.name!=='string'||typeof body.edgeHostname!=='string')throw new ValidationError('INVALID_BODY');const home=await directory.registerHome((request as AuthenticatedRequest).accountId,{name:body.name,edgeHostname:body.edgeHostname});reply.code(201).send(home);});
  app.get('/directory/homes/:homeId',{preHandler:authenticated},async(request)=>directory.getHome((request as AuthenticatedRequest).accountId,(request.params as {homeId:string}).homeId));
  app.patch('/directory/homes/:homeId',{preHandler:authenticated},async(request)=>{const body=request.body as {name?:unknown;edgeHostname?:unknown};if(body.name!==undefined&&typeof body.name!=='string'||body.edgeHostname!==undefined&&typeof body.edgeHostname!=='string')throw new ValidationError('INVALID_BODY');return directory.updateHome((request as AuthenticatedRequest).accountId,(request.params as {homeId:string}).homeId,{name:body.name as string | undefined,edgeHostname:body.edgeHostname as string | undefined});});
  app.delete('/directory/homes/:homeId',{preHandler:authenticated},async(request,reply)=>{await directory.deleteHome((request as AuthenticatedRequest).accountId,(request.params as {homeId:string}).homeId);reply.code(204).send();});
  app.get('/directory/homes/:homeId/memberships',{preHandler:authenticated},async(request)=>directory.listMembers((request as AuthenticatedRequest).accountId,(request.params as {homeId:string}).homeId));
  app.post('/directory/homes/:homeId/invitations',{preHandler:authenticated},async(request,reply)=>{const body=request.body as {email?:unknown};if(typeof body?.email!=='string')throw new ValidationError('INVALID_BODY');const invitation=await directory.invite((request as AuthenticatedRequest).accountId,(request.params as {homeId:string}).homeId,body.email);reply.code(201).send(invitation);});
  app.post('/directory/invitations/:token/accept',{preHandler:authenticated},async(request)=>directory.acceptInvitation((request as AuthenticatedRequest).accountId,(request.params as {token:string}).token));
  app.post('/directory/invitations/:token/reject',{preHandler:authenticated},async(request)=>directory.rejectInvitation((request as AuthenticatedRequest).accountId,(request.params as {token:string}).token));
  app.delete('/directory/homes/:homeId/memberships/:accountId',{preHandler:authenticated},async(request,reply)=>{const params=request.params as {homeId:string;accountId:string};await directory.revokeMembership((request as AuthenticatedRequest).accountId,params.homeId,params.accountId);reply.code(204).send();});
  app.get('/directory/homes/:homeId/audit',{preHandler:authenticated},async(request)=>directory.listAudit((request as AuthenticatedRequest).accountId,(request.params as {homeId:string}).homeId));
  if(options.serveWeb!==false){ const here=dirname(fileURLToPath(import.meta.url)); app.register(fastifyStatic,{root:join(here,'web'),prefix:'/'}); app.get('/',async(_request,reply)=>reply.sendFile('index.html')); }
  return app;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const app=buildServer();app.listen({host:'0.0.0.0',port:Number(process.env.PORT??3100)}).then(()=>undefined);}
