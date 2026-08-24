import { timingSafeEqual } from 'node:crypto';
import { object, string } from 'yup';
import type {
  AccountStore,
  CookieStore,
  ExpiringStorage,
  InteractionRoute,
  JsonInteractionHandlerInput,
  JsonRepresentation,
  JsonView,
  LoginOutputType,
  ReadWriteLocker,
} from '@solid/community-server';
import {
  ForbiddenHttpError,
  NotFoundHttpError,
  parseSchema,
  ResolveLoginHandler,
  validateWithError,
} from '@solid/community-server';
import type { EntraExternalIdTicket } from './EntraExternalIdCallbackHandler';
import type { EntraExternalIdStore } from './util/EntraExternalIdStore';
import { getEntraExternalIdentityKey } from './util/EntraExternalIdStore';

const inSchema = object({ browserNonce: string().min(32).max(200).required() });
const routeSchema = object({ entraTicket: string().uuid().required() });

export interface EntraExternalIdFinalizeHandlerArgs {
  accountStore: AccountStore;
  autoProvision?: boolean;
  cookieStore: CookieStore;
  entraStore: EntraExternalIdStore;
  finalizeRoute: InteractionRoute<'entraTicket'>;
  locker: ReadWriteLocker;
  ticketStorage: ExpiringStorage<string, EntraExternalIdTicket>;
}

/** Consumes a one-time Entra ticket, resolves its CSS account, and completes CSS login. */
export class EntraExternalIdFinalizeHandler extends ResolveLoginHandler implements JsonView {
  private readonly autoProvision: boolean;
  private readonly entraStore: EntraExternalIdStore;
  private readonly finalizeRoute: InteractionRoute<'entraTicket'>;
  private readonly locker: ReadWriteLocker;
  private readonly ticketStorage: ExpiringStorage<string, EntraExternalIdTicket>;

  public constructor(args: EntraExternalIdFinalizeHandlerArgs) {
    super(args.accountStore, args.cookieStore);
    this.autoProvision = args.autoProvision ?? true;
    this.entraStore = args.entraStore;
    this.finalizeRoute = args.finalizeRoute;
    this.locker = args.locker;
    this.ticketStorage = args.ticketStorage;
  }

  public async getView(): Promise<JsonRepresentation> {
    return { json: parseSchema(inSchema) };
  }

  public async login(input: JsonInteractionHandlerInput): Promise<JsonRepresentation<LoginOutputType>> {
    const parameters = this.finalizeRoute.matchPath(input.target.path);
    if (!parameters) {
      throw new NotFoundHttpError();
    }
    const { entraTicket: ticketId } = await validateWithError(routeSchema, parameters);
    const ticket = await this.ticketStorage.get(ticketId);
    if (!ticket) {
      throw new ForbiddenHttpError('The external identity login ticket is invalid or has expired.');
    }
    const { browserNonce } = await validateWithError(inSchema, input.json);
    if (!this.matchesNonce(browserNonce, ticket.browserNonce)) {
      throw new ForbiddenHttpError('The external identity login ticket does not belong to this browser.');
    }
    await this.ticketStorage.delete(ticketId);

    const identityKey = getEntraExternalIdentityKey(ticket);
    const accountId = await this.locker.withWriteLock(
      { path: `urn:solid-server:entra-external-id:${identityKey}` },
      async(): Promise<string> => {
        const existing = await this.entraStore.findByIdentity(ticket);
        if (existing) {
          return existing.accountId;
        }
        if (!this.autoProvision) {
          throw new ForbiddenHttpError('This external identity is not linked to a CSS account.');
        }
        const newAccountId = await this.accountStore.create();
        await this.entraStore.create(ticket, newAccountId);
        return newAccountId;
      },
    );
    return { json: { accountId, remember: ticket.remember }};
  }

  private matchesNonce(actual: string, expected: string): boolean {
    const actualBuffer = Buffer.from(actual);
    const expectedBuffer = Buffer.from(expected);
    return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
  }
}
