import type { ExpiringStorage } from '@solid/community-server';
import type { EntraExternalIdClient } from '../../../../../src/identity/interaction/entra/EntraExternalIdClient';
import { EntraExternalIdLoginHandler } from '../../../../../src/identity/interaction/entra/EntraExternalIdLoginHandler';

describe('An EntraExternalIdLoginHandler', (): void => {
  const browserNonce = '01234567-89ab-cdef-0123-456789abcdef';
  let client: jest.Mocked<EntraExternalIdClient>;
  let storage: jest.Mocked<ExpiringStorage<string, any>>;
  let handler: EntraExternalIdLoginHandler;

  beforeEach((): void => {
    client = {
      authenticate: jest.fn(),
      createAuthorizationRequest: jest.fn().mockResolvedValue({
        codeVerifier: 'verifier',
        location: 'https://tenant.ciamlogin.com/authorize',
        nonce: 'nonce',
        state: 'state',
      }),
    };
    storage = {
      delete: jest.fn(),
      entries: jest.fn(),
      get: jest.fn(),
      has: jest.fn(),
      set: jest.fn().mockResolvedValue(undefined),
    } as any;
    handler = new EntraExternalIdLoginHandler({ client, stateStorage: storage });
  });

  it('stores a short-lived authorization state and returns the Entra URL.', async(): Promise<void> => {
    await expect(handler.handle({ json: { browserNonce, remember: true }} as any)).resolves.toEqual({
      json: { location: 'https://tenant.ciamlogin.com/authorize' },
    });
    expect(storage.set).toHaveBeenCalledWith('state', {
      browserNonce,
      codeVerifier: 'verifier',
      nonce: 'nonce',
      remember: true,
    }, 10 * 60 * 1000);
  });

  it('describes its JSON input and supports a custom state lifetime.', async(): Promise<void> => {
    handler = new EntraExternalIdLoginHandler({ client, stateStorage: storage, stateTtl: 30 });
    await expect(handler.getView()).resolves.toEqual({
      json: {
        fields: {
          browserNonce: { required: true, type: 'string' },
          remember: { required: false, type: 'boolean' },
        },
      },
    });
    await handler.handle({ json: { browserNonce }} as any);
    expect(storage.set).toHaveBeenCalledWith('state', expect.anything(), 30_000);
  });

  it('rejects a missing or low-entropy browser nonce.', async(): Promise<void> => {
    await expect(handler.handle({ json: { remember: true }} as any)).rejects.toThrow('browserNonce');
    await expect(handler.handle({ json: { browserNonce: 'short' }} as any)).rejects.toThrow('32');
    expect(client.createAuthorizationRequest).not.toHaveBeenCalled();
  });
});
