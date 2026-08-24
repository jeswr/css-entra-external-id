# @jeswr/css-entra-external-id

Microsoft Entra External ID login for the
[Community Solid Server](https://github.com/CommunitySolidServer/CommunitySolidServer) (CSS).

Entra authenticates the person, while CSS remains the Solid-OIDC provider and issues tokens
containing the user's WebID. Accounts are bound to the verified `(issuer, subject)` pair rather
than mutable email claims.

## Install

```shell
npm install @solid/community-server @jeswr/css-entra-external-id
```

## Entra registration

Create a web application in an Entra External ID external tenant and register this redirect URI,
using the public CSS base URL:

```text
https://solid.example/.account/login/entra-external-id/callback/
```

For production, configure a certificate credential. A client secret is supported as a fallback,
but the package rejects configurations that supply both credential types.

## Configure

Import the package configuration from your CSS configuration:

```json
{
  "@context": "https://linkedsoftwaredependencies.org/bundles/npm/@solid/community-server/^8.0.0/components/context.jsonld",
  "import": [
    "entra:config/default.json"
  ]
}
```

The configuration adds these CSS command-line options:

| Option | Required | Purpose |
| --- | --- | --- |
| `--entraAuthority` | yes | External tenant authority, such as `https://contoso.ciamlogin.com/`. |
| `--entraClientId` | yes | Entra application client ID. |
| `--entraExpectedIssuer` | yes | Exact issuer published by the tenant discovery document. |
| `--entraClientCertificateThumbprint` | conditional | SHA-256 certificate thumbprint. |
| `--entraClientCertificatePrivateKey` | conditional | PEM-encoded certificate private key. |
| `--entraClientSecret` | conditional | Client-secret fallback. |
| `--entraAutoProvision` | no | Create a CSS account on first login; defaults to `true`. |

The authorization-code flow uses PKCE, nonce, state, one-time expiring records, and a
browser-held finalization nonce. ID-token issuer, audience, nonce, and subject are checked after
MSAL verification.

Set `--no-entraAutoProvision` if identities must be linked through a separate administrative
workflow. This package does not provide that administration interface.

## Scaling and logout

First-login provisioning uses CSS's configured `ReadWriteLocker`. Multi-replica deployments need
a distributed locker. CSS logout invalidates the CSS session but does not sign the browser out of
the upstream Entra tenant.

## Development

```shell
npm install
npm run verify
```

## Licence

MIT © Jesse Wright
