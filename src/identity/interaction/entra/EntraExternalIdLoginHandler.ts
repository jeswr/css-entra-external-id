import { boolean, object, string } from 'yup';
import type {
  ExpiringStorage,
  JsonInteractionHandlerInput,
  JsonRepresentation,
  JsonView,
} from '@solid/community-server';
import { JsonInteractionHandler, parseSchema, validateWithError } from '@solid/community-server';
import type { EntraExternalIdClient } from './EntraExternalIdClient';

const inSchema = object({
  browserNonce: string().min(32).max(200).required(),
  remember: boolean().default(false),
});

export interface EntraExternalIdLoginState {
  browserNonce: string;
  codeVerifier: string;
  nonce: string;
  remember: boolean;
}

export interface EntraExternalIdLoginHandlerArgs {
  client: EntraExternalIdClient;
  stateStorage: ExpiringStorage<string, EntraExternalIdLoginState>;
  /** Login-state lifetime in seconds. */
  stateTtl?: number;
}

/** Starts an Entra External ID authorization-code flow. */
export class EntraExternalIdLoginHandler extends JsonInteractionHandler implements JsonView {
  private readonly client: EntraExternalIdClient;
  private readonly stateStorage: ExpiringStorage<string, EntraExternalIdLoginState>;
  private readonly stateTtl: number;

  public constructor(args: EntraExternalIdLoginHandlerArgs) {
    super();
    this.client = args.client;
    this.stateStorage = args.stateStorage;
    this.stateTtl = (args.stateTtl ?? 10 * 60) * 1000;
  }

  public async getView(): Promise<JsonRepresentation> {
    return { json: parseSchema(inSchema) };
  }

  public async handle({ json }: JsonInteractionHandlerInput): Promise<JsonRepresentation> {
    const { browserNonce, remember } = await validateWithError(inSchema, json);
    const request = await this.client.createAuthorizationRequest();
    await this.stateStorage.set(request.state, {
      browserNonce,
      codeVerifier: request.codeVerifier,
      nonce: request.nonce,
      remember,
    }, this.stateTtl);
    return { json: { location: request.location }};
  }
}
