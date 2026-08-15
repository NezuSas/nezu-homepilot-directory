import { createPrivateKey, createPublicKey, randomUUID, sign } from 'node:crypto';

export interface DirectorySsoPayload {
  directoryAccountId: string;
  homeId: string;
  iat: number;
  exp: number;
  jti: string;
}

export class DirectorySsoIssuer {
  private constructor(private readonly privateKeyPem: string) {}

  static fromEnvironment(): DirectorySsoIssuer | null {
    const privateKey = process.env.DIRECTORY_SSO_PRIVATE_KEY;
    return privateKey ? new DirectorySsoIssuer(privateKey.replace(/\\n/g, '\n')) : null;
  }

  publicKey(): string {
    return createPublicKey(createPrivateKey(this.privateKeyPem)).export({ type: 'spki', format: 'pem' }).toString();
  }

  issue(directoryAccountId: string, homeId: string, now = Math.floor(Date.now() / 1000)): string {
    const payload: DirectorySsoPayload = { directoryAccountId, homeId, iat: now, exp: now + 60, jti: randomUUID() };
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = sign(null, Buffer.from(encodedPayload), createPrivateKey(this.privateKeyPem)).toString('base64url');
    return `${encodedPayload}.${signature}`;
  }
}