import type { Configuration } from '@azure/msal-node';
import { ConfidentialClientApplication, CryptoProvider, ResponseMode } from '@azure/msal-node';
import { ForbiddenHttpError } from '@solid/community-server';
import type { InteractionRoute } from '@solid/community-server';
import type {
  EntraAuthorizationRequest,
  EntraAuthorizationState,
  EntraExternalIdClient,
  EntraExternalIdentity,
} from './EntraExternalIdClient';

interface EntraIdTokenClaims {
  aud?: unknown;
  emails?: unknown;
  iss?: unknown;
  name?: unknown;
  nonce?: unknown;
  // Claim name is defined by OpenID Connect.
  // eslint-disable-next-line @typescript-eslint/naming-convention
  preferred_username?: unknown;
  sub?: unknown;
}

export interface MsalEntraExternalIdClientArgs {
  /** Entra application (client) ID. */
  clientId: string;
  /** Entra application client secret. Prefer a certificate for production deployments. */
  clientSecret?: string;
  /** SHA-256 thumbprint of the Entra application certificate. */
  clientCertificateThumbprint?: string;
  /** PEM-encoded private key of the Entra application certificate. */
  clientCertificatePrivateKey?: string;
  /** External tenant authority, for example https://contoso.ciamlogin.com/. */
  authority: string;
  /** Exact issuer value expected in verified ID tokens. */
  expectedIssuer: string;
  /** CSS callback route registered as the web redirect URI in Entra. */
  callbackRoute: InteractionRoute;
}

/** Entra External ID client based on MSAL Node's confidential-client authorization-code flow. */
export class MsalEntraExternalIdClient implements EntraExternalIdClient {
  private readonly client: ConfidentialClientApplication;
  private readonly clientId: string;
  private readonly crypto: CryptoProvider;
  private readonly expectedIssuer: string;
  private readonly redirectUri: string;

  public constructor(args: MsalEntraExternalIdClientArgs) {
    const authority = new URL(args.authority);
    const configuration: Configuration = {
      auth: {
        authority: authority.href,
        clientId: args.clientId,
        ...getEntraClientCredential(args),
        knownAuthorities: [ authority.host ],
      },
    };
    this.client = new ConfidentialClientApplication(configuration);
    this.clientId = args.clientId;
    this.crypto = new CryptoProvider();
    this.expectedIssuer = args.expectedIssuer;
    this.redirectUri = args.callbackRoute.getPath();
  }

  public async createAuthorizationRequest(): Promise<EntraAuthorizationRequest> {
    const state = this.crypto.createNewGuid();
    const nonce = this.crypto.createNewGuid();
    const { challenge: codeChallenge, verifier: codeVerifier } = await this.crypto.generatePkceCodes();
    const location = await this.client.getAuthCodeUrl({
      codeChallenge,
      codeChallengeMethod: 'S256',
      nonce,
      redirectUri: this.redirectUri,
      responseMode: ResponseMode.FORM_POST,
      scopes: [ 'openid', 'profile', 'email' ],
      state,
    });
    return { codeVerifier, location, nonce, state };
  }

  public async authenticate(code: string, state: EntraAuthorizationState): Promise<EntraExternalIdentity> {
    try {
      const result = await this.client.acquireTokenByCode({
        code,
        codeVerifier: state.codeVerifier,
        nonce: state.nonce,
        redirectUri: this.redirectUri,
        scopes: [ 'openid', 'profile', 'email' ],
      });
      return validateEntraIdTokenClaims(
        result.idTokenClaims,
        this.clientId,
        this.expectedIssuer,
        state.nonce,
      );
    } catch (cause: unknown) {
      if (ForbiddenHttpError.isInstance(cause)) {
        throw cause;
      }
      throw new ForbiddenHttpError('The external identity could not be verified.', { cause });
    }
  }
}

/** Resolves the single confidential-client credential accepted by MSAL. */
export function getEntraClientCredential(
  args: Pick<
    MsalEntraExternalIdClientArgs,
    'clientCertificatePrivateKey' | 'clientCertificateThumbprint' | 'clientSecret'
  >,
): Pick<Configuration['auth'], 'clientCertificate' | 'clientSecret'> {
  const clientSecret = args.clientSecret === '' ? undefined : args.clientSecret;
  const privateKey = args.clientCertificatePrivateKey === '' ? undefined : args.clientCertificatePrivateKey;
  const thumbprintSha256 = args.clientCertificateThumbprint === '' ?
    undefined :
    args.clientCertificateThumbprint;
  if (clientSecret && (privateKey || thumbprintSha256)) {
    throw new Error('Configure either an Entra client secret or client certificate, not both.');
  }
  if (privateKey || thumbprintSha256) {
    if (!privateKey || !thumbprintSha256) {
      throw new Error('The Entra client certificate requires both a SHA-256 thumbprint and private key.');
    }
    return { clientCertificate: { privateKey, thumbprintSha256 }};
  }
  if (clientSecret) {
    return { clientSecret };
  }
  throw new Error('Configure an Entra client certificate or client secret.');
}

/** Applies the CSS-specific trust policy after MSAL has cryptographically verified the ID token. */
export function validateEntraIdTokenClaims(
  claims: EntraIdTokenClaims,
  clientId: string,
  expectedIssuer: string,
  expectedNonce: string,
): EntraExternalIdentity {
  if (claims.iss !== expectedIssuer) {
    throw new ForbiddenHttpError('The Entra ID token was issued by an unexpected tenant.');
  }
  if (claims.aud !== clientId) {
    throw new ForbiddenHttpError('The Entra ID token has an unexpected audience.');
  }
  if (claims.nonce !== expectedNonce) {
    throw new ForbiddenHttpError('The Entra ID token nonce does not match the login request.');
  }
  if (typeof claims.sub !== 'string' || claims.sub.length === 0) {
    throw new ForbiddenHttpError('The Entra ID token does not contain a subject.');
  }

  let firstEmail: string | undefined;
  if (Array.isArray(claims.emails)) {
    firstEmail = claims.emails.find((value): value is string => typeof value === 'string');
  }
  const preferredUsernameClaim = claims.preferred_username;
  const preferredUsername = typeof preferredUsernameClaim === 'string' ?
    preferredUsernameClaim :
    undefined;
  return {
    email: firstEmail ?? preferredUsername,
    issuer: claims.iss,
    name: typeof claims.name === 'string' ? claims.name : undefined,
    subject: claims.sub,
  };
}
