import { randomUUID } from 'node:crypto';

export type MembershipRole = 'owner' | 'member';
export type MembershipStatus = 'pending' | 'active' | 'revoked';

export interface DirectoryAccount { id: string; email: string; passwordHash: string; displayName: string; createdAt: string; }
export interface DirectoryHome { id: string; name: string; edgeHostname: string; ownerAccountId: string; createdAt: string; updatedAt: string; }
export interface DirectoryHomeMembership { id: string; homeId: string; accountId: string; role: MembershipRole; status: MembershipStatus; invitedByAccountId: string | null; invitationTokenHash: string | null; invitationExpiresAt: string | null; createdAt: string; updatedAt: string; }
export interface AuditEvent { id: string; actorAccountId: string; homeId: string | null; membershipId: string | null; action: string; createdAt: string; }

export const clockNow = (): string => new Date().toISOString();
export function normalizeEmail(value: string): string { const email = value.trim().toLowerCase(); if (!/^\S+@\S+\.\S+$/.test(email)) throw new ValidationError('EMAIL_INVALID'); return email; }
export function normalizeName(value: string, code: string): string { const name = value.trim(); if (!name || name.length > 120) throw new ValidationError(code); return name; }
export function normalizeEdgeHostname(value: string): string { let url: URL; try { url = new URL(value.trim()); } catch { throw new ValidationError('EDGE_HOSTNAME_INVALID'); } if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.search || url.hash) throw new ValidationError('EDGE_HOSTNAME_INVALID'); return url.origin; }
export function createHome(name: string, edgeHostname: string, ownerAccountId: string, now = clockNow()): DirectoryHome { return { id: randomUUID(), name: normalizeName(name, 'HOME_NAME_INVALID'), edgeHostname: normalizeEdgeHostname(edgeHostname), ownerAccountId, createdAt: now, updatedAt: now }; }
export function createMembership(input: { homeId: string; accountId: string; invitedByAccountId: string | null; role: MembershipRole; invitationTokenHash?: string; invitationExpiresAt?: string }, now = clockNow()): DirectoryHomeMembership { const owner = input.role === 'owner'; return { id: randomUUID(), homeId: input.homeId, accountId: input.accountId, role: input.role, status: owner ? 'active' : 'pending', invitedByAccountId: input.invitedByAccountId, invitationTokenHash: owner ? null : input.invitationTokenHash ?? null, invitationExpiresAt: owner ? null : input.invitationExpiresAt ?? null, createdAt: now, updatedAt: now }; }
export class DomainError extends Error { constructor(public readonly code: string) { super(code); } }
export class ValidationError extends DomainError { constructor(code: string) { super(code); } }
export class NotFoundError extends DomainError { constructor(code = 'NOT_FOUND') { super(code); } }
export class ForbiddenError extends DomainError { constructor(code = 'FORBIDDEN') { super(code); } }
export class ConflictError extends DomainError { constructor(code: string) { super(code); } }
export class AuthenticationError extends DomainError { constructor(code = 'AUTHENTICATION_FAILED') { super(code); } }
