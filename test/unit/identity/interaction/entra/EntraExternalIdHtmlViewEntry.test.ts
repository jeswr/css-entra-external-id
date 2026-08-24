import type { InteractionRoute } from '@solid/community-server';
import {
  EntraExternalIdFinalizeHtmlViewEntry,
  EntraExternalIdLoginHtmlViewEntry,
} from '../../../../../src/identity/interaction/entra/EntraExternalIdHtmlViewEntry';

describe('EntraExternalIdHtmlViewEntry', (): void => {
  const route = {} as InteractionRoute;

  it('resolves the package-owned login template.', (): void => {
    const entry = new EntraExternalIdLoginHtmlViewEntry(route);
    expect(entry.route).toBe(route);
    expect(entry.filePath).toMatch(/templates[/\\]identity[/\\]entra-external-id[/\\]login\.html\.ejs$/u);
  });

  it('resolves the package-owned finalization template.', (): void => {
    const entry = new EntraExternalIdFinalizeHtmlViewEntry(route);
    expect(entry.route).toBe(route);
    expect(entry.filePath).toMatch(/templates[/\\]identity[/\\]entra-external-id[/\\]finalize\.html\.ejs$/u);
  });
});
