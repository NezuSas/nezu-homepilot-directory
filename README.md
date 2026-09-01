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
