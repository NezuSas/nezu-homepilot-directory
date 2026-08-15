# Directorio HomePilot

Servicio cloud independiente que registra cuentas globales, casas/Edges y membresías. No contiene dispositivos, cámaras, credenciales ni datos operativos de HomePilot Edge.

## Arquitectura

- **Desarrollo y pruebas:** SQLite mediante `DIRECTORY_DB_PATH`.
- **Producción:** PostgreSQL mediante `DATABASE_URL`; Docker Compose crea y persiste un PostgreSQL propio.
- **Navegación de casas:** el selector redirige el navegador a `edgeHostname`; nunca entrega el token del Directorio ni implementa SSO contra HomePilot Edge.

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

El servicio queda en `http://localhost:3100` y PostgreSQL se conserva en el volumen `directory-postgres`.

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
