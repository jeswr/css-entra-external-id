import { ConfidentialClientApplication, CryptoProvider, ResponseMode } from '@azure/msal-node';
import { ForbiddenHttpError } from '@solid/community-server';
import {
  getEntraClientCredential,
  MsalEntraExternalIdClient,
  validateEntraIdTokenClaims,
} from '../../../../../src/identity/interaction/entra/MsalEntraExternalIdClient';

describe('getEntraClientCredential', (): void => {
  it('uses a certificate when a SHA-256 thumbprint and private key are configured.', (): void => {
    expect(getEntraClientCredential({
      clientCertificatePrivateKey: 'private-key',
      clientCertificateThumbprint: 'thumbprint',
    })).toEqual({
      clientCertificate: {
        privateKey: 'private-key',
        thumbprintSha256: 'thumbprint',
      },
    });
  });

  it('supports a client secret as a fallback.', (): void => {
    expect(getEntraClientCredential({ clientSecret: 'secret' })).toEqual({ clientSecret: 'secret' });
  });

  it('requires exactly one complete client credential.', (): void => {
    expect((): unknown => getEntraClientCredential({})).toThrow('certificate or client secret');
    expect((): unknown => getEntraClientCredential({
      clientCertificatePrivateKey: '',
      clientCertificateThumbprint: '',
      clientSecret: '',
    })).toThrow('certificate or client secret');
    expect((): unknown => getEntraClientCredential({ clientCertificateThumbprint: 'thumbprint' }))
      .toThrow('both a SHA-256 thumbprint and private key');
    expect((): unknown => getEntraClientCredential({
      clientCertificatePrivateKey: 'private-key',
      clientCertificateThumbprint: 'thumbprint',
      clientSecret: 'secret',
    })).toThrow('not both');
  });
});

describe('An MsalEntraExternalIdClient', (): void => {
  const clientId = 'client-id';
  const expectedIssuer = 'https://tenant.ciamlogin.com/tenant-id/v2.0/';
  const nonce = 'nonce';
  let client: MsalEntraExternalIdClient;

  beforeEach((): void => {
    jest.restoreAllMocks();
    client = new MsalEntraExternalIdClient({
      authority: 'https://tenant.ciamlogin.com/',
      callbackRoute: { getPath: jest.fn().mockReturnValue('https://example.com/callback') } as any,
      clientId,
      clientSecret: 'secret',
      expectedIssuer,
    });
  });

  it('creates an authorization-code request with state, nonce, and PKCE.', async(): Promise<void> => {
    jest.spyOn(CryptoProvider.prototype, 'createNewGuid')
      .mockReturnValueOnce('state')
      .mockReturnValueOnce(nonce);
    jest.spyOn(CryptoProvider.prototype, 'generatePkceCodes').mockResolvedValue({
      challenge: 'challenge',
      verifier: 'verifier',
    });
    const getAuthCodeUrl = jest.spyOn(ConfidentialClientApplication.prototype, 'getAuthCodeUrl')
      .mockResolvedValue('https://tenant.ciamlogin.com/authorize');

    await expect(client.createAuthorizationRequest()).resolves.toEqual({
      codeVerifier: 'verifier',
      location: 'https://tenant.ciamlogin.com/authorize',
      nonce,
      state: 'state',
    });
    expect(getAuthCodeUrl).toHaveBeenCalledWith({
      codeChallenge: 'challenge',
      codeChallengeMethod: 'S256',
      nonce,
      redirectUri: 'https://example.com/callback',
      responseMode: ResponseMode.FORM_POST,
      scopes: [ 'openid', 'profile', 'email' ],
      state: 'state',
    });
  });

  it('exchanges a code and validates the verified ID-token claims.', async(): Promise<void> => {
    jest.spyOn(ConfidentialClientApplication.prototype, 'acquireTokenByCode').mockResolvedValue({
      idTokenClaims: { aud: clientId, iss: expectedIssuer, nonce, sub: 'subject' },
    } as any);

    await expect(client.authenticate('code', { codeVerifier: 'verifier', nonce })).resolves.toEqual({
      issuer: expectedIssuer,
      subject: 'subject',
    });
  });

  it('preserves trust-policy failures and wraps MSAL failures.', async(): Promise<void> => {
    const acquire = jest.spyOn(ConfidentialClientApplication.prototype, 'acquireTokenByCode');
    acquire.mockResolvedValueOnce({
      idTokenClaims: { aud: clientId, iss: 'https://attacker.example/', nonce, sub: 'subject' },
    } as any);
    await expect(client.authenticate('code', { codeVerifier: 'verifier', nonce }))
      .rejects.toThrow('unexpected tenant');

    acquire.mockRejectedValueOnce(new Error('MSAL failure'));
    await expect(client.authenticate('code', { codeVerifier: 'verifier', nonce }))
      .rejects.toThrow('could not be verified');
  });
});

describe('validateEntraIdTokenClaims', (): void => {
  const clientId = 'client-id';
  const issuer = 'https://tenant.ciamlogin.com/tenant-id/v2.0/';
  const nonce = 'nonce';
  const validClaims = {
    aud: clientId,
    emails: [ 'alice@example.com' ],
    iss: issuer,
    name: 'Alice',
    nonce,
    sub: 'pairwise-subject',
  };

  it('returns the stable identity and optional profile claims.', (): void => {
    expect(validateEntraIdTokenClaims(validClaims, clientId, issuer, nonce)).toEqual({
      email: 'alice@example.com',
      issuer,
      name: 'Alice',
      subject: 'pairwise-subject',
    });
  });

  it('uses preferred_username when there is no emails claim.', (): void => {
    expect(validateEntraIdTokenClaims({
      ...validClaims,
      emails: undefined,
      name: undefined,
      preferred_username: 'alice@example.com',
    }, clientId, issuer, nonce)).toEqual({
      email: 'alice@example.com',
      issuer,
      name: undefined,
      subject: 'pairwise-subject',
    });
  });

  it.each([
    [ 'issuer', { ...validClaims, iss: 'https://attacker.example/' }],
    [ 'audience', { ...validClaims, aud: 'other-client' }],
    [ 'nonce', { ...validClaims, nonce: 'other-nonce' }],
    [ 'subject', { ...validClaims, sub: undefined }],
  ])('rejects an invalid %s.', (label, claims): void => {
    void label;
    expect((): unknown => validateEntraIdTokenClaims(claims, clientId, issuer, nonce))
      .toThrow(ForbiddenHttpError);
  });
});
