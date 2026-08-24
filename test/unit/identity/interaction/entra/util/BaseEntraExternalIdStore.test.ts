import type { AccountLoginStorage } from '@solid/community-server';
import { ACCOUNT_TYPE, InternalServerError } from '@solid/community-server';
import {
  BaseEntraExternalIdStore,
  ENTRA_EXTERNAL_ID_STORAGE_DESCRIPTION,
  ENTRA_EXTERNAL_ID_STORAGE_TYPE,
} from '../../../../../../src/identity/interaction/entra/util/BaseEntraExternalIdStore';
import {
  getEntraExternalIdentityKey,
} from '../../../../../../src/identity/interaction/entra/util/EntraExternalIdStore';

describe('A BaseEntraExternalIdStore', (): void => {
  const identity = {
    email: 'alice@example.com',
    issuer: 'https://tenant.ciamlogin.com/tenant-id/v2.0/',
    name: 'Alice',
    subject: 'pairwise-subject',
  };
  const accountId = 'account-id';
  const id = 'login-id';
  let storage: jest.Mocked<AccountLoginStorage<any>>;
  let store: BaseEntraExternalIdStore;

  beforeEach((): void => {
    storage = {
      create: jest.fn().mockResolvedValue({ id, accountId, ...identity }),
      createIndex: jest.fn(),
      defineType: jest.fn(),
      delete: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
    } satisfies Partial<AccountLoginStorage<any>> as any;
    store = new BaseEntraExternalIdStore(storage);
  });

  it('defines the login type and indexes once.', async(): Promise<void> => {
    await store.handle();
    await store.handle();
    expect(storage.defineType).toHaveBeenCalledTimes(1);
    expect(storage.defineType).toHaveBeenCalledWith(
      ENTRA_EXTERNAL_ID_STORAGE_TYPE,
      ENTRA_EXTERNAL_ID_STORAGE_DESCRIPTION,
      true,
    );
    expect(storage.createIndex).toHaveBeenCalledWith(ENTRA_EXTERNAL_ID_STORAGE_TYPE, 'accountId');
    expect(storage.createIndex).toHaveBeenCalledWith(ENTRA_EXTERNAL_ID_STORAGE_TYPE, 'identityKey');
  });

  it('wraps storage initialization errors.', async(): Promise<void> => {
    storage.defineType.mockRejectedValueOnce(new Error('storage failed'));
    await expect(store.handle()).rejects.toThrow('storage failed');
  });

  it('creates a stable issuer and subject binding.', async(): Promise<void> => {
    await expect(store.create(identity, accountId)).resolves.toBe(id);
    expect(storage.create).toHaveBeenCalledWith(ENTRA_EXTERNAL_ID_STORAGE_TYPE, {
      accountId,
      email: identity.email,
      identityKey: getEntraExternalIdentityKey(identity),
      issuer: identity.issuer,
      name: identity.name,
      subject: identity.subject,
    });
  });

  it('does not use mutable profile claims as the identity key.', (): void => {
    const changedIdentity = {
      ...identity,
      email: 'changed@example.com',
      name: 'Changed',
    };
    expect(getEntraExternalIdentityKey(identity)).toBe(getEntraExternalIdentityKey(changedIdentity));
  });

  it('rejects duplicate bindings.', async(): Promise<void> => {
    storage.find.mockResolvedValueOnce([{ id, accountId, ...identity }]);
    await expect(store.create(identity, accountId)).rejects.toThrow('already linked');
    expect(storage.create).not.toHaveBeenCalled();
  });

  it('fails closed when an identity is linked to multiple accounts.', async(): Promise<void> => {
    storage.find.mockResolvedValueOnce([
      { id, accountId, ...identity },
      { id: 'other', accountId: 'other', ...identity },
    ]);
    await expect(store.findByIdentity(identity)).rejects.toThrow(InternalServerError);
  });

  it('uses a login type that references the account type.', (): void => {
    expect(ENTRA_EXTERNAL_ID_STORAGE_DESCRIPTION.accountId).toBe(`id:${ACCOUNT_TYPE}`);
  });

  it('finds bindings by account and deletes them.', async(): Promise<void> => {
    storage.find.mockResolvedValueOnce([{ id, accountId, ...identity }]);
    await expect(store.findByAccount(accountId)).resolves.toEqual([{ id, accountId, ...identity }]);
    expect(storage.find).toHaveBeenCalledWith(ENTRA_EXTERNAL_ID_STORAGE_TYPE, { accountId });
    await expect(store.delete(id)).resolves.toBeUndefined();
    expect(storage.delete).toHaveBeenCalledWith(ENTRA_EXTERNAL_ID_STORAGE_TYPE, id);
  });
});
