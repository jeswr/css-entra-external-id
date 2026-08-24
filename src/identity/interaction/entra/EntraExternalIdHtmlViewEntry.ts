import { resolve } from 'node:path';
import { HtmlViewEntry } from '@solid/community-server';
import type { InteractionRoute } from '@solid/community-server';

function templatePath(name: 'finalize' | 'login'): string {
  return resolve(__dirname, '../../../../templates/identity/entra-external-id', `${name}.html.ejs`);
}

/** Adds the package-owned Entra login template to CSS's HTML view handler. */
export class EntraExternalIdLoginHtmlViewEntry extends HtmlViewEntry {
  public constructor(route: InteractionRoute) {
    super(route, templatePath('login'));
  }
}

/** Adds the package-owned Entra login-finalization template to CSS's HTML view handler. */
export class EntraExternalIdFinalizeHtmlViewEntry extends HtmlViewEntry {
  public constructor(route: InteractionRoute) {
    super(route, templatePath('finalize'));
  }
}
