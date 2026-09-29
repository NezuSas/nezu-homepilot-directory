import { createPublicKey, verify } from 'node:crypto';
import { ValidationError } from '../domain/entities.js';
import { EDGE_SERVICE_COMMAND_SCOPE, EDGE_SERVICE_TOKEN_SCOPE, parseEdgeServiceTokenScope, type EdgeServiceTokenScope } from './EdgeServiceTokenIssuer.js';

export const DEVICE_CHALLENGE_TTL_SECONDS = 60;
export const DEVICE_PROOF_VERSION = 'homepilot.edge-device-proof.v1';

export interface DeviceEnrollment { keyId: string; algorithm: 'ES256'; publicKey: string }
export interface DeviceProof { challengeId: string; keyId: string; signature: string }

export function parseDeviceEnrollment(body: unknown): DeviceEnrollment {
  if (!plainObject(body) || !exactKeys(body, ['algorithm', 'keyId', 'publicKey'])) throw new ValidationError('DEVICE_ENROLLMENT_INVALID');
  const { algorithm, keyId, publicKey } = body;
  if (algorithm !== 'ES256' || !validKeyId(keyId) || typeof publicKey !== 'string' || publicKey.length > 2048 || !publicKey.startsWith('-----BEGIN PUBLIC KEY-----')) throw new ValidationError('DEVICE_ENROLLMENT_INVALID');
  try {
    const key = createPublicKey(publicKey);
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw new Error('Wrong key type');
    return { algorithm, keyId, publicKey: key.export({ type: 'spki', format: 'pem' }).toString() };
  } catch { throw new ValidationError('DEVICE_ENROLLMENT_INVALID'); }
}

export function parseBoundTokenRequest(body: unknown): { scope: EdgeServiceTokenScope; proof: DeviceProof } {
  if (!plainObject(body)) throw new ValidationError('DEVICE_PROOF_REQUIRED');
  const fields = Object.keys(body);
  if (fields.some(field => field !== 'scope' && field !== 'deviceProof')) throw new ValidationError('EDGE_SERVICE_TOKEN_INVALID_REQUEST');
  const scope = parseEdgeServiceTokenScope('scope' in body ? { scope: body.scope } : undefined);
  if (!('deviceProof' in body)) throw new ValidationError('DEVICE_PROOF_REQUIRED');
  const proof = body.deviceProof;
  if (!plainObject(proof) || !exactKeys(proof, ['challengeId', 'keyId', 'signature']) ||
      !validUuid(proof.challengeId) || !validKeyId(proof.keyId) || typeof proof.signature !== 'string' ||
      !/^[A-Za-z0-9_-]{86}$/.test(proof.signature) || Buffer.from(proof.signature, 'base64url').length !== 64 ||
      Buffer.from(proof.signature, 'base64url').toString('base64url') !== proof.signature) {
    throw new ValidationError('DEVICE_PROOF_INVALID');
  }
  return { scope, proof: { challengeId: proof.challengeId, keyId: proof.keyId, signature: proof.signature } };
}

/** Exact UTF-8 bytes: six LF-terminated lines; scopes sorted by code point and comma-joined. */
export function canonicalDeviceProofPayload(input: { homeId: string; edgeId: string; challengeId: string; nonce: string; scopes: readonly EdgeServiceTokenScope[] }): Buffer {
  const scopes = [...input.scopes].sort();
  if (scopes.length !== 1 || (scopes[0] !== EDGE_SERVICE_TOKEN_SCOPE && scopes[0] !== EDGE_SERVICE_COMMAND_SCOPE)) throw new ValidationError('DEVICE_PROOF_INVALID');
  for (const value of [input.homeId, input.edgeId, input.challengeId, input.nonce]) {
    if (!value || /[\r\n,]/.test(value)) throw new ValidationError('DEVICE_PROOF_INVALID');
  }
  return Buffer.from(`${DEVICE_PROOF_VERSION}\n${input.homeId}\n${input.edgeId}\n${input.challengeId}\n${input.nonce}\n${scopes.join(',')}\n`, 'utf8');
}

export function verifyDeviceProof(publicKey: string, payload: Buffer, signature: string): boolean {
  try { return verify('sha256', payload, { key: createPublicKey(publicKey), dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url')); }
  catch { return false; }
}

function plainObject(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean { const actual = Object.keys(value); return actual.length === keys.length && actual.every(key => keys.includes(key)); }
function validKeyId(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value); }
function validUuid(value: unknown): value is string { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
