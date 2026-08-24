import type {
  AccountStore,
  CookieStore,
  ExpiringStorage,
  InteractionRoute,
  ReadWriteLocker,
} from '@solid/community-server';
import { ForbiddenHttpError, NotFoundHttpError } from '@solid/community-server';
import type { EntraExternalIdStore } from '../../../../../src/identity/interaction/entra/util/EntraExternalIdStore';
import {
  EntraExternalIdFinalizeHandler,
} from '../../../../../src/identity/interaction/entra/EntraExternalIdFinalizeHandler';
import type {
  EntraExternalIdFinalizeHandlerArgs,
} from '../../../../../src/identity/interaction/entra/EntraExternalIdFinalizeHandler';

describe('An EntraExternalIdFinalizeHandler', (): void => {
  const ticketId = '123e4567-e89b-42d3-a456-426614174000';
  const path = `https://example.com/finalize/${ticketId}/`;
  const browserNonce = '01234567-89ab-cdef-0123-456789abcdef';
  const ticket = {
    browserNonce,
    email: 'alice@example.com',
    issuer: 'https://tenant.ciamlogin.com/tenant-id/v2.0/',
    remember: true,
    subject: 'subject',
  };
  let accountStore: jest.Mocked<AccountStore>;
  let entraStore: jest.Mocked<EntraExternalIdStore>;
  let ticketStorage: jest.Mocked<ExpiringStorage<string, any>>;
  let locker: jest.Mocked<ReadWriteLocker>;
  let args: EntraExternalIdFinalizeHandlerArgs;
  let handler: EntraExternalIdFinalizeHandler;

  beforeEach((): void => {
    accountStore = {
      create: jest.fn().mockResolvedValue('new-account'),
      getSetting: jest.fn(),
      updateSetting: jest.fn(),
    };
    entraStore = {
      create: jest.fn().mockResolvedValue('login-id'),
      delete: jest.fn(),
      findByAccount: jest.fn(),
      findByIdentity: jest.fn().mockResolvedValue({ ...ticket, accountId: 'account-id', id: 'login-id' }),
    };
    ticketStorage = {
      delete: jest.fn(),
      get: jest.fn().mockResolvedValue(ticket),
    } as any;
    locker = {
      withReadLock: jest.fn(),
      withWriteLock: jest.fn(async(_identifier, whileLocked): Promise<any> => whileLocked()),
    };
    const finalizeRoute: InteractionRoute<'entraTicket'> = {
      getPath: jest.fn(),
      matchPath: jest.fn().mockReturnValue({ entraTicket: ticketId }),
    };
    args = {
      accountStore,
      cookieStore: {} as CookieStore,
      entraStore,
      finalizeRoute,
      locker,
      ticketStorage,
    };
    handler = new EntraExternalIdFinalizeHandler(args);
  });

  it('logs in to an account already bound to the stable external identity.', async(): Promise<void> => {
    await expect(handler.login({ target: { path }, json: { browserNonce }} as any)).resolves.toEqual({
      json: { accountId: 'account-id', remember: true },
    });
    expect(ticketStorage.delete).toHaveBeenCalledWith(ticketId);
    expect(locker.withWriteLock).toHaveBeenCalledWith(
      expect.objectContaining({ path: expect.stringMatching(/^urn:solid-server:entra-external-id:/u) }),
      expect.any(Function),
    );
    expect(accountStore.create).not.toHaveBeenCalled();
  });

  it('describes its JSON input.', async(): Promise<void> => {
    await expect(handler.getView()).resolves.toEqual({
      json: { fields: { browserNonce: { required: true, type: 'string' }}},
    });
  });

  it('auto-provisions one account for a new Entra identity.', async(): Promise<void> => {
    entraStore.findByIdentity.mockResolvedValueOnce(undefined);
    await expect(handler.login({ target: { path }, json: { browserNonce }} as any))
      .resolves.toHaveProperty('json.accountId', 'new-account');
    expect(accountStore.create).toHaveBeenCalledTimes(1);
    expect(entraStore.create).toHaveBeenCalledWith(ticket, 'new-account');
  });

  it('can require identities to be pre-linked.', async(): Promise<void> => {
    handler = new EntraExternalIdFinalizeHandler({ ...args, autoProvision: false });
    entraStore.findByIdentity.mockResolvedValueOnce(undefined);
    await expect(handler.login({ target: { path }, json: { browserNonce }} as any))
      .rejects.toThrow('not linked');
    expect(accountStore.create).not.toHaveBeenCalled();
  });

  it('rejects expired and replayed tickets.', async(): Promise<void> => {
    ticketStorage.get.mockResolvedValueOnce(undefined);
    await expect(handler.login({ target: { path }, json: { browserNonce }} as any))
      .rejects.toThrow(ForbiddenHttpError);
  });

  it('rejects an invalid ticket identifier before accessing storage.', async(): Promise<void> => {
    jest.mocked(args.finalizeRoute.matchPath).mockReturnValueOnce({ entraTicket: '../account' });
    await expect(handler.login({ target: { path }, json: { browserNonce }} as any))
      .rejects.toThrow('valid UUID');
    expect(ticketStorage.get).not.toHaveBeenCalled();
  });

  it('rejects a path outside the finalization route.', async(): Promise<void> => {
    jest.mocked(args.finalizeRoute.matchPath).mockReturnValueOnce(undefined);
    await expect(handler.login({ target: { path }, json: { browserNonce }} as any))
      .rejects.toThrow(NotFoundHttpError);
    expect(ticketStorage.get).not.toHaveBeenCalled();
  });

  it('binds the ticket to the browser that started the login.', async(): Promise<void> => {
    await expect(handler.login({
      target: { path },
      json: { browserNonce: 'fedcba98-7654-3210-fedc-ba9876543210' },
    } as any)).rejects.toThrow('does not belong to this browser');
    expect(ticketStorage.delete).not.toHaveBeenCalled();
    expect(entraStore.findByIdentity).not.toHaveBeenCalled();
  });
});
