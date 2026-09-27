# Directorio HomePilot

Servicio cloud independiente que registra cuentas globales, casas/Edges y membresías. No contiene dispositivos, cámaras, credenciales ni datos operativos de HomePilot Edge.

## Arquitectura

- **Desarrollo y pruebas:** SQLite mediante `DIRECTORY_DB_PATH`.
- **Producción:** PostgreSQL mediante `DATABASE_URL`; Docker Compose crea y persiste un PostgreSQL propio.
- **Navegación de casas:** el selector usa rutas internas `/homes/:homeId` del mismo dominio y opera mediante el Gateway; no muestra ni solicita hostnames de Edge.

## Desarrollo

Requiere Node.js 20 o superior.

```powershell
npm install
$env:DIRECTORY_JWT_SECRET = 'una-clave-local-de-al-menos-32-caracteres'
npm run dev
```

Abre `http://localhost:3100`.

## Producción local con Docker

```powershell
Copy-Item .env.example .env
# Reemplaza ambos valores en .env por secretos únicos.
docker compose up --build -d
```

El servicio queda en `http://localhost:3100` y PostgreSQL se conserva en el volumen `directory-postgres`.`n`n`DIRECTORY_AUTH_RATE_LIMIT_MAX` limita por IP los intentos de registro e inicio de sesión por minuto; su valor predeterminado es `10`.

## API

- `POST /directory/accounts`
- `POST /directory/session`
- `GET|POST /directory/homes`
- `GET|PATCH|DELETE /directory/homes/:homeId`
- `GET /directory/homes/:homeId/memberships`
- `POST /directory/homes/:homeId/invitations`
- `POST /directory/invitations/:token/accept`
- `POST /directory/invitations/:token/reject`
- `DELETE /directory/homes/:homeId/memberships/:accountId`
- `GET /directory/homes/:homeId/audit`

Las invitaciones se aceptan o rechazan autenticado como su destinatario. El token se entrega por un canal seguro; la especificación no define proveedor de correo.

## Correo transaccional y seguridad de cuenta

El Directorio usa `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` y `SMTP_FROM` para enviar los enlaces de verificacion, invitacion y recuperacion. `PUBLIC_APP_URL` debe ser la URL publica real del Directorio: los enlaces se construyen exclusivamente con esa variable. En desarrollo, sin variables SMTP, se utiliza un emisor no-op para no enviar correo real.

Una cuenta nueva queda sin verificar; puede iniciar sesion, pero la interfaz comunica que debe verificar su correo. Los tokens se generan criptograficamente, se guarda solamente su hash, son de un solo uso y vencen a la hora. Los tokens de recuperacion actualizan la contrasena; los JWT ya emitidos siguen vigentes hasta su expiracion normal de 12 horas, porque no existe aun una lista de revocacion de sesiones.

Si SMTP falla, la invitacion o token ya persistido no se revierte: se conserva valido y puede reenviarse mediante un flujo operativo posterior. Esta decision evita dejar una invitacion creada parcialmente.

## Despliegue con dominio propio

1. Copia `.env.example` a `.env` y reemplaza todos los valores de ejemplo con secretos reales.
2. Configura `PUBLIC_APP_URL` con el hostname publico real del Directorio.
3. Ejecuta `docker compose up --build -d`.
4. Expone el puerto local `3100` mediante un reverse proxy o un Cloudflare Tunnel configurado por un administrador. El proxy/tunel debe dirigir HTTPS publico al servicio `http://localhost:3100` y conservar ese hostname en `PUBLIC_APP_URL`.
5. Comprueba `https://tu-hostname/health` y revisa los logs con `docker compose logs -f homepilot-directory`.

No se registran dominios, tunnels ni cuentas de proveedores desde este repositorio.

## Backup de produccion

El estado persistente del Directorio es PostgreSQL en el volumen `directory-postgres`. Realiza un backup diario y antes de cualquier actualizacion:

```bash
docker compose exec -T postgres pg_dump -U homepilot_directory -d homepilot_directory > directory-$(date +%F).sql
```

Guarda el archivo fuera de la MiniPC y verifica periodicamente una restauracion en un entorno aislado. Un backup coherente requiere conservar tambien el archivo `.env` de forma segura; sin sus secretos no puede restaurarse la configuracion de produccion.

## SSO con HomePilot Edge

Genera el par de claves una sola vez fuera del repositorio con `npm run generate:sso-keys`. Conserva `DIRECTORY_SSO_PRIVATE_KEY` exclusivamente como secreto del Directorio. Para aprovisionar un Edge, obtiene su llave publica desde el Directorio ya desplegado:

```bash
curl https://accounts.nezuecuador.com/directory/sso/public-key
```

Configura el PEM devuelto como `DIRECTORY_SSO_PUBLIC_KEY` en ese Edge y reinicialo. El Directorio no contacta ningun Edge: el navegador transporta el token firmado, que vence a los 60 segundos.

## Edge Attestation v1

Directory firma una prueba de que un Edge activo y autenticado presentó un challenge para vincular una `HomePilotInstallation` en IntentFlow. Esta capacidad usa una clave Ed25519 independiente de `DIRECTORY_SSO_PRIVATE_KEY`. Genera un par nuevo con `npm run generate:edge-attestation-keys` y configura el PEM privado como `DIRECTORY_EDGE_ATTESTATION_PRIVATE_KEY` exclusivamente en Directory. No incluyas claves reales en el repositorio. Directory puede arrancar sin esta variable; los dos endpoints de attestation responden `503 EDGE_ATTESTATION_NOT_CONFIGURED` hasta configurarla.

`POST /directory/edge-attestation` requiere `Authorization: Bearer <edge credential>` y exactamente `{ "installationId": "<uuid>", "challengeId": "<uuid>", "nonce": "<base64url>" }`. El nonce debe ser la codificación base64url sin padding de 32 bytes (43 caracteres). La respuesta es `{ "attestation": "<payload64>.<signature64>", "expiresIn": 90 }`. Directory valida la credencial mediante `authenticateEdgeCredential`; `directoryHomeId` y `directoryEdgeId` provienen únicamente de esa identidad. Una credencial revocada no puede emitir attestations. La emisión se limita a 10 por minuto por Edge y se audita como `edge.attestation.issued` asociado al homeId, sin guardar nonce, firma ni jti.

El payload JSON firmado contiene exactamente `type: "homepilot.edge-attestation.v1"`, `issuer: "homepilot-directory"`, `audience: "intentflow"`, `keyId: "edge-attestation-v1"`, `installationId`, `challengeId`, `nonce`, `directoryHomeId`, `directoryEdgeId`, `iat`, `exp` y `jti`. `iat` y `exp` son segundos Unix; `exp = iat + 90`; `jti` es un UUID criptográficamente aleatorio. La firma Ed25519 cubre los bytes ASCII de `payload64`. `GET /directory/edge-attestation/public-key` publica `{ type, algorithm: "Ed25519", keyId, publicKey }` con el PEM público.

Cada Home admite como máximo un Edge activo (`revoked_at IS NULL`), impuesto por un índice único parcial en SQLite y PostgreSQL. Los Edges revocados permanecen como historial; el re-pairing revoca el anterior antes de crear el nuevo. Una migración con varios Edges activos para el mismo Home falla y requiere resolver esos datos antes de continuar.

Directory comprueba la sintaxis del challenge y firma el contexto que presentó el Edge autenticado. IntentFlow deberá comprobar posteriormente que el challenge existe, pertenece a la instalación, no expiró, coincide con el nonce, y se consume una sola vez; también deberá verificar firma, audiencia, emisor, clave, identidad Edge y plazo de la attestation.

El límite de 10 emisiones por minuto usa memoria del proceso Directory. Una instalación con varias réplicas necesita un limitador compartido para conservar ese máximo global. La prueba de PostgreSQL se habilita con `DIRECTORY_TEST_DATABASE_URL` apuntando a una base aislada para pruebas.

## Edge Service Token v1

Un Edge activo puede solicitar `POST /directory/edge-service-token` con su Edge credential en `Authorization: Bearer` y sin cuerpo para recibir `{ "token": "<payload64>.<signature64>", "expiresIn": 120 }`. La respuesta incluye `Cache-Control: no-store`. El token Ed25519 solo autentica al Edge ante IntentFlow para `homepilot.manifest.read`; no representa a un usuario ni sustituye Edge Attestation. `GET /directory/edge-service-token/public-key` publica la clave pública. Configura una tercera clave privada Ed25519 PEM independiente en `DIRECTORY_EDGE_SERVICE_PRIVATE_KEY`; sin ella ambos endpoints responden `503 EDGE_SERVICE_TOKEN_NOT_CONFIGURED`. El contrato y los límites se detallan en `specs/edge-service-token-v1.md`.
