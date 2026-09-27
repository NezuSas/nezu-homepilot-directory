# Edge Credential Rotation V1

## Motivo e identidad estable

Un HomePilot Edge ya provisionado puede reemplazar su secreto sin repetir el pairing. `edgeId` es la identidad estable que usan HomePilot e IntentFlow, y permanece idéntico junto con `homeId`, el ID de la conexión, `createdAt` y el hostname. La rotación no crea otra `DirectoryEdgeConnection` ni revoca la conexión activa.

## Contrato HTTP

`POST /directory/edge-credential/rotate` requiere `Authorization: Bearer <current-edge-credential>` y no acepta cuerpo. Directory autentica esa credencial exclusivamente mediante `DirectoryService.authenticateEdgeCredential()`; ninguna identidad puede venir del cliente. Una credencial ausente, inválida o revocada recibe `401 EDGE_CREDENTIAL_INVALID`. Cualquier cuerpo recibe `400 EDGE_CREDENTIAL_ROTATION_BODY_NOT_ALLOWED`.

Una rotación exitosa responde `200` con exactamente `{ "token": "<new-edge-credential>", "homeId": "<same-home-id>", "edgeId": "<same-edge-id>" }`. Todas las respuestas del endpoint llevan `Cache-Control: no-store`. El token nuevo se devuelve una sola vez y no se persiste en claro.

## Compare-and-swap y seguridad

El nuevo token tiene formato `<same-edgeId>.<secret>`, donde `secret` se genera con `randomBytes(32).toString('base64url')`. Directory guarda solo su hash SHA-256, como con el token previo. La actualización atómica en SQLite y PostgreSQL exige `edge_id` coincidente, `revoked_at IS NULL` y `credential_hash` igual al hash de la credencial recién autenticada. Se cambia únicamente `credential_hash`. Si otra rotación ganó o la conexión fue revocada, el compare-and-swap devuelve `409 EDGE_CREDENTIAL_ROTATION_CONFLICT` y no entrega el token candidato.

Después de la actualización, la credencial anterior queda inválida inmediatamente y la nueva autentica con el mismo `homeId` y `edgeId`. Solo si el CAS cambia la fila se inserta `edge.credential.rotated` con actor `edge:<edgeId>` y el Home correspondiente. La actualización y la inserción del evento comparten una transacción: si la auditoría falla, tampoco cambia la credencial. Auditoría y logs no contienen credenciales ni hashes. El endpoint limita a 10 intentos de rotación por minuto por Edge en memoria del proceso.

## Límites V1

La rotación es explícita: no hay rotación automática, UI, cambios de pairing, cambios de `edgeId`, modificaciones de IntentFlow ni almacenamiento de credenciales en claro. En varias réplicas de Directory, un limitador compartido sería necesario para imponer el máximo global de 10 intentos por minuto.
