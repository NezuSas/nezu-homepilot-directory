import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AccountRepository, AuditRepository, HomeMembershipRepository, HomeRepository } from '../domain/repositories.js';
import type { AuditEvent, DirectoryAccount, DirectoryHome, DirectoryHomeMembership, MembershipStatus } from '../domain/entities.js';

export class SqliteDirectoryDatabase {
  readonly db: Database.Database;
  constructor(path: string) { if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true }); this.db = new Database(path); this.db.pragma('foreign_keys = ON'); this.migrate(); }
  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS directory_accounts (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, display_name TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS directory_homes (id TEXT PRIMARY KEY, name TEXT NOT NULL, edge_hostname TEXT NOT NULL, owner_account_id TEXT NOT NULL REFERENCES directory_accounts(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS directory_home_memberships (id TEXT PRIMARY KEY, home_id TEXT NOT NULL REFERENCES directory_homes(id) ON DELETE CASCADE, account_id TEXT NOT NULL REFERENCES directory_accounts(id), role TEXT NOT NULL CHECK(role IN ('owner','member')), status TEXT NOT NULL CHECK(status IN ('pending','active','revoked')), invited_by_account_id TEXT REFERENCES directory_accounts(id), invitation_token_hash TEXT UNIQUE, invitation_expires_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(home_id, account_id));
      CREATE INDEX IF NOT EXISTS idx_memberships_account_active ON directory_home_memberships(account_id, status);
      CREATE TABLE IF NOT EXISTS directory_audit_events (id TEXT PRIMARY KEY, actor_account_id TEXT NOT NULL, home_id TEXT, membership_id TEXT, action TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_audit_home_created ON directory_audit_events(home_id, created_at DESC);
    `);
  }
  async createAccount(account: DirectoryAccount): Promise<void> { this.db.prepare('INSERT INTO directory_accounts VALUES (?, ?, ?, ?, ?)').run(account.id, account.email, account.passwordHash, account.displayName, account.createdAt); }
  async findAccountByEmail(email: string): Promise<DirectoryAccount | null> { const row = this.db.prepare('SELECT * FROM directory_accounts WHERE email = ?').get(email) as AccountRow | undefined; return row ? account(row) : null; }
  async findAccountById(id: string): Promise<DirectoryAccount | null> { const row = this.db.prepare('SELECT * FROM directory_accounts WHERE id = ?').get(id) as AccountRow | undefined; return row ? account(row) : null; }
  async createHome(home: DirectoryHome): Promise<void> { this.db.prepare('INSERT INTO directory_homes VALUES (?, ?, ?, ?, ?, ?)').run(home.id, home.name, home.edgeHostname, home.ownerAccountId, home.createdAt, home.updatedAt); }
  async findHomeById(id: string): Promise<DirectoryHome | null> { const row = this.db.prepare('SELECT * FROM directory_homes WHERE id = ?').get(id) as HomeRow | undefined; return row ? home(row) : null; }
  async updateHome(homeValue: DirectoryHome): Promise<void> { this.db.prepare('UPDATE directory_homes SET name=?, edge_hostname=?, owner_account_id=?, updated_at=? WHERE id=?').run(homeValue.name, homeValue.edgeHostname, homeValue.ownerAccountId, homeValue.updatedAt, homeValue.id); }
  async deleteById(id: string): Promise<void> { this.db.prepare('DELETE FROM directory_homes WHERE id = ?').run(id); }
  async createMembership(m: DirectoryHomeMembership): Promise<void> { this.db.prepare('INSERT INTO directory_home_memberships VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(m.id,m.homeId,m.accountId,m.role,m.status,m.invitedByAccountId,m.invitationTokenHash,m.invitationExpiresAt,m.createdAt,m.updatedAt); }
  async findByHomeAndAccount(homeId: string, accountId: string): Promise<DirectoryHomeMembership | null> { const row=this.db.prepare('SELECT * FROM directory_home_memberships WHERE home_id=? AND account_id=?').get(homeId,accountId) as MembershipRow|undefined; return row ? membership(row):null; }
  async findByInvitationTokenHash(hash: string): Promise<DirectoryHomeMembership | null> { const row=this.db.prepare('SELECT * FROM directory_home_memberships WHERE invitation_token_hash=?').get(hash) as MembershipRow|undefined; return row ? membership(row):null; }
  async listByHome(homeId: string): Promise<DirectoryHomeMembership[]> { return (this.db.prepare('SELECT * FROM directory_home_memberships WHERE home_id=? ORDER BY created_at').all(homeId) as MembershipRow[]).map(membership); }
  async listActiveHomesForAccount(accountId: string): Promise<Array<{ home: DirectoryHome; membership: DirectoryHomeMembership }>> { const rows=this.db.prepare(`SELECT h.id h_id,h.name h_name,h.edge_hostname h_edge_hostname,h.owner_account_id h_owner_account_id,h.created_at h_created_at,h.updated_at h_updated_at,m.id m_id,m.home_id m_home_id,m.account_id m_account_id,m.role m_role,m.status m_status,m.invited_by_account_id m_invited_by_account_id,m.invitation_token_hash m_invitation_token_hash,m.invitation_expires_at m_invitation_expires_at,m.created_at m_created_at,m.updated_at m_updated_at FROM directory_home_memberships m JOIN directory_homes h ON h.id=m.home_id WHERE m.account_id=? AND m.status='active' ORDER BY h.name COLLATE NOCASE`).all(accountId) as JoinRow[]; return rows.map(row=>({home:{id:row.h_id,name:row.h_name,edgeHostname:row.h_edge_hostname,ownerAccountId:row.h_owner_account_id,createdAt:row.h_created_at,updatedAt:row.h_updated_at},membership:{id:row.m_id,homeId:row.m_home_id,accountId:row.m_account_id,role:row.m_role as 'owner'|'member',status:row.m_status as MembershipStatus,invitedByAccountId:row.m_invited_by_account_id,invitationTokenHash:row.m_invitation_token_hash,invitationExpiresAt:row.m_invitation_expires_at,createdAt:row.m_created_at,updatedAt:row.m_updated_at}})); }
  async updateMembership(m: DirectoryHomeMembership): Promise<void> { this.db.prepare('UPDATE directory_home_memberships SET role=?,status=?,invited_by_account_id=?,invitation_token_hash=?,invitation_expires_at=?,updated_at=? WHERE id=?').run(m.role,m.status,m.invitedByAccountId,m.invitationTokenHash,m.invitationExpiresAt,m.updatedAt,m.id); }
  async updateStatus(id: string,status: MembershipStatus,updatedAt: string): Promise<void> { this.db.prepare('UPDATE directory_home_memberships SET status=?,updated_at=? WHERE id=?').run(status,updatedAt,id); }
  async append(e: AuditEvent): Promise<void> { this.db.prepare('INSERT INTO directory_audit_events VALUES (?, ?, ?, ?, ?, ?)').run(e.id,e.actorAccountId,e.homeId,e.membershipId,e.action,e.createdAt); }
  async listForHome(homeId: string): Promise<AuditEvent[]> { return (this.db.prepare('SELECT * FROM directory_audit_events WHERE home_id=? ORDER BY created_at DESC').all(homeId) as AuditRow[]).map(row=>({id:row.id,actorAccountId:row.actor_account_id,homeId:row.home_id,membershipId:row.membership_id,action:row.action,createdAt:row.created_at})); }
  close(): void { this.db.close(); }
}
interface AccountRow { id:string; email:string; password_hash:string; display_name:string; created_at:string; }
interface HomeRow { id:string; name:string; edge_hostname:string; owner_account_id:string; created_at:string; updated_at:string; }
interface MembershipRow { id:string; home_id:string; account_id:string; role:string; status:string; invited_by_account_id:string|null; invitation_token_hash:string|null; invitation_expires_at:string|null; created_at:string; updated_at:string; }
interface JoinRow { h_id:string;h_name:string;h_edge_hostname:string;h_owner_account_id:string;h_created_at:string;h_updated_at:string;m_id:string;m_home_id:string;m_account_id:string;m_role:string;m_status:string;m_invited_by_account_id:string|null;m_invitation_token_hash:string|null;m_invitation_expires_at:string|null;m_created_at:string;m_updated_at:string; }
interface AuditRow { id:string;actor_account_id:string;home_id:string|null;membership_id:string|null;action:string;created_at:string; }
const account=(r:AccountRow):DirectoryAccount=>({id:r.id,email:r.email,passwordHash:r.password_hash,displayName:r.display_name,createdAt:r.created_at});
const home=(r:HomeRow):DirectoryHome=>({id:r.id,name:r.name,edgeHostname:r.edge_hostname,ownerAccountId:r.owner_account_id,createdAt:r.created_at,updatedAt:r.updated_at});
const membership=(r:MembershipRow):DirectoryHomeMembership=>({id:r.id,homeId:r.home_id,accountId:r.account_id,role:r.role as 'owner'|'member',status:r.status as MembershipStatus,invitedByAccountId:r.invited_by_account_id,invitationTokenHash:r.invitation_token_hash,invitationExpiresAt:r.invitation_expires_at,createdAt:r.created_at,updatedAt:r.updated_at});
