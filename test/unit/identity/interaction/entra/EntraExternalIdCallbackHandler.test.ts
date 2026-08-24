import type { ExpiringStorage, InteractionRoute, RepresentationConverter } from '@solid/community-server';
import {
  APPLICATION_JSON,
  APPLICATION_X_WWW_FORM_URLENCODED,
  BadRequestHttpError,
  BasicRepresentation,
  NotFoundHttpError,
  RedirectHttpError,
} from '@solid/community-server';
import {
  EntraExternalIdCallbackHandler,
} from '../../../../../src/identity/interaction/entra/EntraExternalIdCallbackHandler';
import type { EntraExternalIdClient } from '../../../../../src/identity/interaction/entra/EntraExternalIdClient';

describe('An EntraExternalIdCallbackHandler', (): void => {
  const callbackPath = 'https://example.com/.account/login/entra-external-id/callback/';
  const browserNonce = '01234567-89ab-cdef-0123-456789abcdef';
  const stateId = '123e4567-e89b-42d3-a456-426614174000';
  const state = { browserNonce, codeVerifier: 'verifier', nonce: 'nonce', remember: true };
  let client: jest.Mocked<EntraExternalIdClient>;
  let converter: jest.Mocked<RepresentationConverter>;
  let stateStorage: jest.Mocked<ExpiringStorage<string, any>>;
  let ticketStorage: jest.Mocked<ExpiringStorage<string, any>>;
  let handler: EntraExternalIdCallbackHandler;

  beforeEach((): void => {
    client = {
      authenticate: jest.fn().mockResolvedValue({
        email: 'alice@example.com',
        issuer: 'https://tenant.ciamlogin.com/tenant-id/v2.0/',
        subject: 'subject',
      }),
      createAuthorizationRequest: jest.fn(),
    };
    converter = {
      canHandle: jest.fn(),
      handle: jest.fn().mockResolvedValue(new BasicRepresentation(
        JSON.stringify({ code: 'code', state: stateId }),
        APPLICATION_JSON,
      )),
    } as any;
    stateStorage = {
      delete: jest.fn(),
      get: jest.fn().mockResolvedValue(state),
    } as any;
    ticketStorage = { set: jest.fn() } as any;
    const callbackRoute: InteractionRoute = {
      getPath: jest.fn().mockReturnValue(callbackPath),
      matchPath: jest.fn((path: string): Record<never, string> | undefined =>
        path === callbackPath ? {} : undefined),
    };
    const finalizeRoute: InteractionRoute<'entraTicket'> = {
      getPath: jest.fn((parameters): string =>
        `https://example.com/finalize/${parameters!.entraTicket}/`),
      matchPath: jest.fn(),
    };
    handler = new EntraExternalIdCallbackHandler({
      callbackRoute,
      client,
      converter,
      finalizeRoute,
      stateStorage,
      ticketStorage,
    });
  });

  it('only accepts POST requests on the configured callback route.', async(): Promise<void> => {
    await expect(handler.canHandle({ operation: { method: 'GET', target: { path: callbackPath }} as any }))
      .rejects.toThrow('only supports POST');
    await expect(handler.canHandle({
      operation: { method: 'POST', target: { path: 'https://example.com/other' }} as any,
    })).rejects.toThrow(NotFoundHttpError);
  });

  it('accepts form data that can be converted to JSON.', async(): Promise<void> => {
    const body = new BasicRepresentation(`code=code&state=${stateId}`, APPLICATION_X_WWW_FORM_URLENCODED);
    await expect(handler.canHandle({
      operation: { body, method: 'POST', target: { path: callbackPath }} as any,
    })).resolves.toBeUndefined();
    expect(converter.canHandle).toHaveBeenCalledWith(expect.objectContaining({ representation: body }));
  });

  it('consumes state, verifies the code, stores a short-lived ticket, and redirects.', async(): Promise<void> => {
    const body = new BasicRepresentation(`code=code&state=${stateId}`, APPLICATION_X_WWW_FORM_URLENCODED);
    const result = handler.handle({
      operation: { body, method: 'POST', target: { path: callbackPath }} as any,
    });
    await expect(result).rejects.toThrow(RedirectHttpError);
    await expect(result).rejects.toHaveProperty('statusCode', 303);
    await expect(result).rejects.toHaveProperty('location', expect.stringMatching('/finalize/.+/$'));
    expect(stateStorage.delete).toHaveBeenCalledWith(stateId);
    expect(client.authenticate).toHaveBeenCalledWith('code', state);
    expect(ticketStorage.set).toHaveBeenCalledWith(expect.any(String), {
      browserNonce,
      email: 'alice@example.com',
      issuer: 'https://tenant.ciamlogin.com/tenant-id/v2.0/',
      remember: true,
      subject: 'subject',
    }, 2 * 60 * 1000);
  });

  it('rejects expired and replayed state.', async(): Promise<void> => {
    stateStorage.get.mockResolvedValueOnce(undefined);
    await expect(handler.handle({ operation: { body: {}, target: { path: callbackPath }} as any }))
      .rejects.toThrow(BadRequestHttpError);
    expect(client.authenticate).not.toHaveBeenCalled();
  });

  it('rejects an invalid state before accessing storage.', async(): Promise<void> => {
    converter.handle.mockResolvedValueOnce(new BasicRepresentation(
      JSON.stringify({ code: 'code', state: '../account' }),
      APPLICATION_JSON,
    ));
    await expect(handler.handle({ operation: { body: {}, target: { path: callbackPath }} as any }))
      .rejects.toThrow('valid UUID');
    expect(stateStorage.get).not.toHaveBeenCalled();
  });

  it('consumes valid state before handling an Entra error response.', async(): Promise<void> => {
    converter.handle.mockResolvedValueOnce(new BasicRepresentation(
      JSON.stringify({ error: 'access_denied', state: stateId }),
      APPLICATION_JSON,
    ));
    await expect(handler.handle({ operation: { body: {}, target: { path: callbackPath }} as any }))
      .rejects.toThrow('did not complete');
    expect(stateStorage.delete).toHaveBeenCalledWith(stateId);
    expect(client.authenticate).not.toHaveBeenCalled();
  });
});
