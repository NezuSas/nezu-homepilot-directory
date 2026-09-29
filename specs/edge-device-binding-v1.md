# Edge device binding v1

## Modelo

Las conexiones Edge históricas migran a `device_binding_state = unbound` y conservan la emisión legacy de service tokens. Una conexión activa puede pasar una sola vez a `bound`, con `device_key_id`, `device_public_key` (SPKI PEM P-256), `device_key_algorithm = ES256` y `device_bound_at`. Directory no guarda la clave privada ni atributos físicos de la MiniPC. No existe operación de retorno a `unbound` ni rebinding en v1.

## Enrollment

`POST /directory/edge-device/enroll` requiere `Authorization: Bearer <Edge credential>` y un objeto JSON exacto:

```json
{ "keyId": "device-key-1", "algorithm": "ES256", "publicKey": "-----BEGIN PUBLIC KEY-----..." }
```

Directory acepta únicamente una clave pública ECDSA P-256 y vincula la identidad derivada de la credencial activa con compare-and-swap, siempre que la conexión aún esté `unbound` y su hash de credencial no haya cambiado. Devuelve `201 { "edgeId": "...", "keyId": "...", "algorithm": "ES256", "boundAt": "<ISO 8601>" }`. Un segundo enrollment devuelve `409 DEVICE_ALREADY_BOUND`. La respuesta usa `Cache-Control: no-store`.

## Challenge

`POST /directory/edge-device/challenge` requiere la misma credencial de un Edge `bound`. Acepta el mismo objeto de scope opcional que el endpoint de service token: sin body o `{}` significa `homepilot.manifest.read`; `{ "scope": "homepilot.command.execute" }` solicita ejecución. Devuelve `{ "challengeId": "<uuid>", "nonce": "<32 bytes base64url>", "scope": "<scope>", "expiresIn": 60 }` con `Cache-Control: no-store`. El registro persistido liga el challenge a un solo `homeId`, `edgeId` y scope, caduca a los 60 segundos y se consume una sola vez. No se almacena ningún token ni firma.

## Proof canónico

Para un Edge bound, `POST /directory/edge-service-token` exige el body `{ "scope": "<scope>", "deviceProof": { "challengeId": "<uuid>", "keyId": "<id registrado>", "signature": "<base64url>" } }`. Si se omite `scope`, se aplica `homepilot.manifest.read`. La firma `signature` es ES256 en formato IEEE P1363 (`r || s`, 64 bytes), codificada base64url sin padding. Se firma SHA-256 sobre los bytes UTF-8 generados por `canonicalDeviceProofPayload()`:

```text
homepilot.edge-device-proof.v1\n<homeId>\n<edgeId>\n<challengeId>\n<nonce>\n<scopes ordenados y separados por coma>\n
```

La línea anterior representa **seis líneas**, cada una terminada por un único byte LF (`0A`), incluida la última; los símbolos `\n` muestran esos bytes y no forman parte literal del mensaje. En v1 hay exactamente un scope permitido por challenge y token. Los valores `homeId`, `edgeId`, `challengeId` y `nonce` son los almacenados o derivados por Directory, no los del cliente.

Directory verifica identidad, key ID, firma, scope y vencimiento; luego consume el challenge con una actualización condicional atómica. Dos solicitudes concurrentes con el mismo challenge no pueden emitir dos tokens. Un Edge bound sin proof recibe `DEVICE_PROOF_REQUIRED`; proof incorrecto, `DEVICE_PROOF_INVALID`; challenge vencido, `DEVICE_CHALLENGE_EXPIRED`; challenge usado, `DEVICE_CHALLENGE_CONSUMED`.

Después del consumo, Directory emite el mismo `homepilot.edge-service-token.v1` Ed25519 de 120 segundos, con el mismo tipo, audiencia, emisor, clave y claims vigentes. IntentFlow no necesita cambiar el formato del service token.

## Límites

El enrollment inicial usa la credencial Edge existente como autoridad; por ello es un registro de primera clave confiable. Un atacante que obtenga esa credencial antes del enrollment podría registrar otra clave primero. La protección frente a copia de configuración después del binding depende de que la clave privada P-256 permanezca fuera de esa configuración y no sea exportable en el dispositivo; esa garantía corresponde a HomePilot. El reemplazo autorizado de MiniPC y el rebinding administrativo quedan para una operación NEZU posterior.
