export interface EntraAuthorizationRequest {
  codeVerifier: string;
  location: string;
  nonce: string;
  state: string;
}

export interface EntraAuthorizationState {
  codeVerifier: string;
  nonce: string;
}

/** Stable identity information extracted from a verified Entra ID token. */
export interface EntraExternalIdentity {
  email?: string;
  issuer: string;
  name?: string;
  subject: string;
}

/** Executes the Entra External ID authorization-code flow. */
export interface EntraExternalIdClient {
  createAuthorizationRequest: () => Promise<EntraAuthorizationRequest>;
  authenticate: (code: string, state: EntraAuthorizationState) => Promise<EntraExternalIdentity>;
}
