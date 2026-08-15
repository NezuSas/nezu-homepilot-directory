import jwt from 'jsonwebtoken';
import { AuthenticationError } from '../domain/entities.js';
export interface DirectorySession { accountId: string; }
export class DirectorySessionService {
  constructor(private readonly secret: string) { if (secret.length < 32) throw new Error('DIRECTORY_JWT_SECRET must be at least 32 characters'); }
  issue(accountId: string): string { return jwt.sign({sub:accountId},this.secret,{algorithm:'HS256',expiresIn:'12h',issuer:'nezu-homepilot-directory',audience:'directory-client'}); }
  verify(token: string): DirectorySession { try { const payload=jwt.verify(token,this.secret,{algorithms:['HS256'],issuer:'nezu-homepilot-directory',audience:'directory-client'}); if(typeof payload==='string'||typeof payload.sub!=='string') throw new Error(); return {accountId:payload.sub}; } catch { throw new AuthenticationError('SESSION_INVALID'); } }
}
