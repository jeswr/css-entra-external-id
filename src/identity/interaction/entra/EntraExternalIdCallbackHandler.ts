import { randomUUID } from 'node:crypto';
import { object, string } from 'yup';
import type {
  ExpiringStorage,
  InteractionHandlerInput,
  InteractionRoute,
  Representation,
  RepresentationConverter,
} from '@solid/community-server';
import {
  APPLICATION_JSON,
  BadRequestHttpError,
  InteractionHandler,
  MethodNotAllowedHttpError,
  NotFoundHttpError,
  readJsonStream,
  RedirectHttpError,
  validateWithError,
} from '@solid/community-server';
import type { EntraExternalIdClient, EntraExternalIdentity } from './EntraExternalIdClient';
import type { EntraExternalIdLoginState } from './EntraExternalIdLoginHandler';

const callbackSchema = object({ code: string(), error: string(), state: string().uuid().required() });

export interface EntraExternalIdTicket extends EntraExternalIdentity {
  browserNonce: string;
  remember: boolean;
}

export interface EntraExternalIdCallbackHandlerArgs {
  callbackRoute: InteractionRoute;
  client: EntraExternalIdClient;
  converter: RepresentationConverter;
  finalizeRoute: InteractionRoute<'entraTicket'>;
  stateStorage: ExpiringStorage<string, EntraExternalIdLoginState>;
  ticketStorage: ExpiringStorage<string, EntraExternalIdTicket>;
  /** One-time finalization-ticket lifetime in seconds. */
  ticketTtl?: number;
}

/** Handles Entra's cross-site form_post response and redirects to a same-site finalization route. */
export class EntraExternalIdCallbackHandler extends InteractionHandler {
  private readonly callbackRoute: InteractionRoute;
  private readonly client: EntraExternalIdClient;
  private readonly converter: RepresentationConverter;
  private readonly finalizeRoute: InteractionRoute<'entraTicket'>;
  private readonly stateStorage: ExpiringStorage<string, EntraExternalIdLoginState>;
  private readonly ticketStorage: ExpiringStorage<string, EntraExternalIdTicket>;
  private readonly ticketTtl: number;

  public constructor(args: EntraExternalIdCallbackHandlerArgs) {
    super();
    this.callbackRoute = args.callbackRoute;
    this.client = args.client;
    this.converter = args.converter;
    this.finalizeRoute = args.finalizeRoute;
    this.stateStorage = args.stateStorage;
    this.ticketStorage = args.ticketStorage;
    this.ticketTtl = (args.ticketTtl ?? 2 * 60) * 1000;
  }

  public override async canHandle({ operation }: InteractionHandlerInput): Promise<void> {
    if (!this.callbackRoute.matchPath(operation.target.path)) {
      throw new NotFoundHttpError();
    }
    if (operation.method !== 'POST') {
      throw new MethodNotAllowedHttpError([ operation.method ], 'The Entra callback only supports POST.');
    }
    await this.converter.canHandle({
      identifier: operation.target,
      preferences: { type: { [APPLICATION_JSON]: 1 }},
      representation: operation.body,
    });
  }

  public async handle({ operation }: InteractionHandlerInput): Promise<Representation> {
    const converted = await this.converter.handle({
      identifier: operation.target,
      preferences: { type: { [APPLICATION_JSON]: 1 }},
      representation: operation.body,
    });
    const body = await validateWithError(callbackSchema, await readJsonStream(converted.data));
    const state = await this.stateStorage.get(body.state);
    if (!state) {
      throw new BadRequestHttpError('The Entra login state is invalid or has expired.');
    }
    await this.stateStorage.delete(body.state);
    if (body.error || !body.code) {
      throw new BadRequestHttpError('External identity authentication did not complete.');
    }

    const identity = await this.client.authenticate(body.code, state);
    const ticket = randomUUID();
    await this.ticketStorage.set(ticket, {
      ...identity,
      browserNonce: state.browserNonce,
      remember: state.remember,
    }, this.ticketTtl);
    throw new RedirectHttpError(
      303,
      'SeeOtherHttpError',
      this.finalizeRoute.getPath({ entraTicket: ticket }),
    );
  }
}
