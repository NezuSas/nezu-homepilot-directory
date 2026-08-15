# Directorio HomePilot

Servicio cloud independiente que registra cuentas globales, casas/Edges y membresías. No contiene dispositivos, cámaras, credenciales ni datos operativos de HomePilot Edge.

## Requisitos

Node.js 20 o superior.

## Configuración

```bash
npm install
set DIRECTORY_JWT_SECRET=una-clave-de-produccion-de-al-menos-32-caracteres
set DIRECTORY_DB_PATH=./data/directory.db
npm run dev
```

Abre `http://localhost:3100`. Para producción:

```bash
npm run build
npm start
```

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

La aceptación se realiza autenticado como el destinatario de la invitación. El token se entrega por un canal seguro; la implementación de proveedor de correo no está definida por la especificación.
