import { getLoggerFor } from 'global-logger-factory';
import {
  ACCOUNT_TYPE,
  BadRequestHttpError,
  createErrorMessage,
  Initializer,
  InternalServerError,
} from '@solid/community-server';
import type { EntraExternalIdentity } from '../EntraExternalIdClient';
import type { EntraExternalIdLogin, EntraExternalIdStore } from './EntraExternalIdStore';
import { getEntraExternalIdentityKey } from './EntraExternalIdStore';

export const ENTRA_EXTERNAL_ID_STORAGE_TYPE = 'entraExternalId';
export const ENTRA_EXTERNAL_ID_STORAGE_DESCRIPTION = {
  accountId: `id:${ACCOUNT_TYPE}`,
  email: 'string?',
  identityKey: 'string',
  issuer: 'string',
  name: 'string?',
  subject: 'string',
} as const;

interface EntraExternalIdStorageValue extends EntraExternalIdentity {
  accountId: string;
  identityKey: string;
}

interface EntraExternalIdStorageRecord extends EntraExternalIdStorageValue {
  id: string;
}

interface EntraExternalIdStorageQuery {
  accountId?: string;
  identityKey?: string;
}

/** The AccountLoginStorage operations used by the Entra identity binding store. */
interface EntraExternalIdAccountStorage {
  create: (
    type: string,
    value: EntraExternalIdStorageValue,
  ) => Promise<EntraExternalIdStorageRecord>;
  createIndex: (type: string, key: string) => Promise<void>;
  defineType: (
    type: string,
    description: typeof ENTRA_EXTERNAL_ID_STORAGE_DESCRIPTION,
    isLogin: boolean,
  ) => Promise<void>;
  delete: (type: string, id: string) => Promise<void>;
  find: (type: string, query: EntraExternalIdStorageQuery) => Promise<EntraExternalIdStorageRecord[]>;
}

/** Indexed storage for verified Entra identity bindings. */
export class BaseEntraExternalIdStore extends Initializer implements EntraExternalIdStore {
  private readonly logger = getLoggerFor(this);

  private readonly storage: EntraExternalIdAccountStorage;

  private initialized = false;

  // Keep the public DI range unbounded so Components.js does not need to interpret CSS's generic LoginStorage type.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public constructor(storage: any) {
    super();
    this.storage = storage as EntraExternalIdAccountStorage;
  }

  public async handle(): Promise<void> {
    if (this.initialized) {
      return;
    }
    try {
      await this.storage.defineType(
        ENTRA_EXTERNAL_ID_STORAGE_TYPE,
        ENTRA_EXTERNAL_ID_STORAGE_DESCRIPTION,
        true,
      );
      await this.storage.createIndex(ENTRA_EXTERNAL_ID_STORAGE_TYPE, 'accountId');
      await this.storage.createIndex(ENTRA_EXTERNAL_ID_STORAGE_TYPE, 'identityKey');
      this.initialized = true;
    } catch (cause: unknown) {
      throw new InternalServerError(
        `Error defining Entra External ID login storage: ${createErrorMessage(cause)}`,
        { cause },
      );
    }
  }

  public async create(identity: EntraExternalIdentity, accountId: string): Promise<string> {
    const identityKey = getEntraExternalIdentityKey(identity);
    if (await this.findByIdentity(identity)) {
      this.logger.warn(`Trying to create a duplicate Entra External ID login for ${identityKey}`);
      throw new BadRequestHttpError('This external identity is already linked to an account.');
    }
    const result = await this.storage.create(ENTRA_EXTERNAL_ID_STORAGE_TYPE, {
      accountId,
      email: identity.email,
      identityKey,
      issuer: identity.issuer,
      name: identity.name,
      subject: identity.subject,
    });
    return result.id;
  }

  public async findByIdentity(identity: EntraExternalIdentity): Promise<EntraExternalIdLogin | undefined> {
    const matches = await this.storage.find(ENTRA_EXTERNAL_ID_STORAGE_TYPE, {
      identityKey: getEntraExternalIdentityKey(identity),
    });
    if (matches.length > 1) {
      throw new InternalServerError('An Entra external identity is linked to multiple CSS accounts.');
    }
    return matches[0];
  }

  public async findByAccount(accountId: string): Promise<EntraExternalIdLogin[]> {
    return this.storage.find(ENTRA_EXTERNAL_ID_STORAGE_TYPE, { accountId });
  }

  public async delete(id: string): Promise<void> {
    return this.storage.delete(ENTRA_EXTERNAL_ID_STORAGE_TYPE, id);
  }
}
