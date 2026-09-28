# Edge Service Token v1

## Propósito y autoridad

Un HomePilot Edge ya provisionado puede autenticarse ante Directory con su Edge credential y obtener un token efímero para IntentFlow. Este token autentica al Edge ante IntentFlow; no representa a un usuario. No reemplaza Installation Attestation ni cambia el Cloud Gateway. Cada token contiene exactamente uno de dos scopes: `homepilot.manifest.read` para lectura de manifests o `homepilot.command.execute` para ejecución de comandos. El primero no concede ejecución. IntentFlow aplicará esta separación por endpoint.

Directory es autoridad sobre `directoryHomeId` y `directoryEdgeId`, que obtiene exclusivamente de `DirectoryService.authenticateEdgeCredential()`. Directory no acepta esos valores ni ningún otro claim del cliente. El token no contiene identificadores propios de IntentFlow, como `installationId`, `boardId` o `deviceId`.

## Clave y formato

La firma usa una tercera clave privada Ed25519 PEM configurada como `DIRECTORY_EDGE_SERVICE_PRIVATE_KEY`, independiente de `DIRECTORY_SSO_PRIVATE_KEY` y `DIRECTORY_EDGE_ATTESTATION_PRIVATE_KEY`. La clave pública se publica mediante `GET /directory/edge-service-token/public-key`. La clave privada no se devuelve ni se registra.

El token compacto es `base64url(payload-json).base64url(ed25519-signature)`. Se firma exactamente la representación ASCII del primer segmento. El JSON contiene exactamente:

```json
{
  "type": "homepilot.edge-service-token.v1",
  "issuer": "homepilot-directory",
  "audience": "intentflow",
  "keyId": "edge-service-v1",
  "scope": "homepilot.manifest.read",
  "directoryHomeId": "<homeId autenticado>",
  "directoryEdgeId": "<edgeId autenticado>",
  "iat": 0,
  "exp": 0,
  "jti": "<uuid>"
}
```

El ejemplo muestra el scope predeterminado; para ejecución, el valor de ese único campo es `homepilot.command.execute`. No hay wildcard ni scopes compuestos. `iat` y `exp` son segundos Unix, `exp = iat + 120`, y `jti` es un UUID generado criptográficamente. Directory no persiste el token ni el `jti`.

## API

`POST /directory/edge-service-token` requiere `Authorization: Bearer <edge credential>`. Sin body, mantiene el contrato anterior y emite `homepilot.manifest.read`. Un body JSON opcional debe ser un objeto con solo `scope`: `{}` y `{ "scope": "homepilot.manifest.read" }` emiten el scope de lectura; `{ "scope": "homepilot.command.execute" }` emite el scope de ejecución. Ningún otro valor, tipo, lista, combinación de scopes, wildcard o campo adicional se acepta; JSON malformado y cuerpos inválidos reciben `400 EDGE_SERVICE_TOKEN_INVALID_REQUEST`. La credencial debe pertenecer a un Edge activo. La respuesta sigue siendo exactamente `{ "token": "<compact-token>", "expiresIn": 120 }` con `Cache-Control: no-store`. Una credencial ausente, inválida o revocada recibe `401 EDGE_CREDENTIAL_INVALID`. Si falta la clave privada, recibe `503 EDGE_SERVICE_TOKEN_NOT_CONFIGURED`. El endpoint limita la emisión a 10 tokens por minuto por Edge mediante memoria del proceso y registra `edge.service_token.issued` vinculado al Home y al Edge, sin registrar credenciales ni tokens.

`GET /directory/edge-service-token/public-key` devuelve `{ "type": "homepilot.edge-service-token.v1", "algorithm": "Ed25519", "keyId": "edge-service-v1", "publicKey": "<PEM>" }`; sin la clave configurada devuelve `503 EDGE_SERVICE_TOKEN_NOT_CONFIGURED`.

IntentFlow deberá verificar la firma, los claims fijos, el scope exacto, la identidad del Edge y la vigencia del token antes de autorizar la operación correspondiente. `homepilot.manifest.read` solo autoriza lectura de manifests y `homepilot.command.execute` solo ejecución de comandos; la separación efectiva por endpoint se implementará en IntentFlow. En despliegues con varias réplicas de Directory hará falta un limitador compartido para mantener el máximo global de emisiones.
