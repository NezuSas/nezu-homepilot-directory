# Especificación: Directorio de cuentas y hogares multi-Edge v1

## Propósito

El Directorio es un servicio cloud independiente de HomePilot Edge. Mantiene cuentas globales, casas registradas por su URL pública Cloudflare y membresías. No contiene dispositivos, cámaras, automatizaciones, credenciales ni sesiones del Edge.

## Criterios de aceptación

1. Una persona puede crear e iniciar sesión con una cuenta global.
2. Una persona autenticada puede registrar una casa y el Edge queda representado solo por nombre y hostname HTTPS.
3. El propietario puede invitar una cuenta existente; la membresía permanece pendiente hasta aceptarla o rechazarla.
4. Cada cuenta lista exclusivamente sus membresías activas y no puede consultar hogares ajenos.
5. El selector navega mediante `window.location.assign(edgeHostname)`; no hay SSO ni envío de token al Edge.
6. Solo el propietario puede modificar, revocar accesos o eliminar el registro de una casa.
7. Revocar o borrar no genera llamadas de red al Edge; si el Directorio cae, el Edge sigue siendo autónomo.
8. Los cambios de casa y membresía se auditan sin secretos operativos.

## Persistencia

El runtime de producción usa PostgreSQL mediante `DATABASE_URL`. SQLite solo se emplea en desarrollo y pruebas.

## Restricciones

- El alcance termina en el Directorio; HomePilot Edge no se modifica ni se consulta.
- Las invitaciones se entregan por un canal seguro. No se integra proveedor de correo porque no fue especificado.
- Rechazar una invitación se representa como membresía revocada y auditada; no queda visible en el selector.
