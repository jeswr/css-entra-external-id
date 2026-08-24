import { createHash } from 'node:crypto';
import type { EntraExternalIdentity } from '../EntraExternalIdClient';

export interface EntraExternalIdLogin extends EntraExternalIdentity {
  accountId: string;
  id: string;
}

/** Stores the stable Entra identity-to-CSS account binding. */
export interface EntraExternalIdStore {
  create: (identity: EntraExternalIdentity, accountId: string) => Promise<string>;
  findByIdentity: (identity: EntraExternalIdentity) => Promise<EntraExternalIdLogin | undefined>;
  findByAccount: (accountId: string) => Promise<EntraExternalIdLogin[]>;
  delete: (id: string) => Promise<void>;
}

/** Generates a non-reversible stable key from the issuer and pairwise subject. */
export function getEntraExternalIdentityKey(identity: Pick<EntraExternalIdentity, 'issuer' | 'subject'>): string {
  return createHash('sha256')
    .update(identity.issuer)
    .update('\0')
    .update(identity.subject)
    .digest('base64url');
}
