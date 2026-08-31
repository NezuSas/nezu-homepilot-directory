# SPEC: Identidad global y cambio fluido entre hogares V2

**Issue:** NezuSas/nezu-homepilot-directory#1  
**Estado:** En desarrollo  
**Fecha:** 2026-08-31

## Propósito

Una persona con una cuenta Directory debe seleccionar cualquiera de sus hogares
autorizados y llegar al HomePilot Edge correspondiente sin repetir una contraseña
local. Directory administra únicamente identidad, membresía y el registro de un
Edge; cada Edge conserva de forma local dispositivos, automatizaciones, cámaras,
sesiones locales y secretos operativos.

## Problema y punto de partida

La V1 abrió un selector de hogares y la integración SSO V1 añadió un token firmado,
pero el primer acceso a cada Edge exige vincular una cuenta Directory a un usuario
local. Además, el token contiene `homeId` sin que el Edge confirme que pertenece a
su propia instalación. La V2 elimina esa fricción sin convertir Directory en plano
de datos ni en controlador de dispositivos.

## Principios no negociables

- Un acceso global se emite para un único `homeId` y únicamente es válido en el
  Edge emparejado con ese hogar.
- No se copian ni sincronizan contraseñas, dispositivos, cámaras, topología,
  automatizaciones, sesiones locales ni secretos entre Directory y un Edge.
- El acceso local existente sigue funcionando aun si Directory no está disponible.
- Una URL del Edge escrita manualmente no basta para confiar en una instalación.
- Ningún token, código de acceso, llave privada o URL sensible aparece en UI,
  logs, Issues ni auditoría.

## Alcance V2

1. **Cuenta global y selector.** Directory lista solo hogares con membresía activa
   y permite cambiar de hogar desde un selector consistente.
2. **Emparejamiento de instalador.** El instalador registra un Edge mediante un
   código de un solo uso mostrado localmente; Directory conserva un identificador
   opaco del Edge, hostname HTTPS validado y clave pública/versionada. El usuario
   final no registra una URL a mano.
3. **Autorización de hogar.** Directory emite una credencial de acceso de un solo
   uso, corta duración y con `issuer`, `audience`, `homeId`, `edgeId`, `accountId`,
   `membershipId`, rol solicitado, `iat`, `exp` y `jti`.
4. **Sesión Edge.** El Edge valida firma, emisor, audiencia, expiración, replay y
   coincidencia con su `homeId`/`edgeId` configurados antes de crear una sesión
   local limitada para Directory.
5. **Invitaciones.** Una invitación se puede enviar a una persona que aún no tiene
   cuenta; al completar registro/verificación vuelve al flujo de aceptación. El
   secreto de invitación jamás se renderiza como texto recuperable en la consola.
6. **Revocación.** Revocar una membresía impide emitir nuevos accesos. Las sesiones
   originadas por Directory deben tener TTL corto y renovarse solo después de una
   comprobación de membresía; una instalación offline mantiene su operación local,
   pero no puede conceder una nueva sesión global sin evidencia válida.

## Roles y mínimo privilegio

Directory distingue propiedad de membresía, no sustituye los roles operativos de
HomePilot. Para acceso gestionado debe existir una asignación explícita por hogar:

| Membresía Directory | Rol Edge permitido | Regla |
| --- | --- | --- |
| owner | `admin` | Solo tras completar el emparejamiento y confirmar el propietario local. |
| member | `parent`, `child`, `guest` u `operator` | El propietario elige el rol al invitar o editar; nunca se infiere ni se eleva. |

Las membresías y enlaces SSO V1 existentes continúan en modo de compatibilidad: no
obtienen acceso gestionado V2 ni cambian permisos por una migración de datos.

## Flujo de acceso

1. La persona inicia sesión en Directory y elige un hogar activo.
2. Directory comprueba membresía, estado del Edge y asignación explícita de rol.
3. Directory emite una credencial de un uso para ese hogar y redirige el navegador.
4. El Edge comprueba firma, `iss`, `aud`, `homeId`, `edgeId`, vigencia y `jti`.
5. Solo entonces crea una sesión Directory de alcance y TTL acotados; la consola
   carga la instancia local del hogar seleccionado.
6. Si la validación falla, se muestra un error seguro y se conserva disponible el
   login local normal, sin revelar el motivo interno ni el token.

## Migración y reversión

- V2 se activa por hogar después de emparejar su Edge; los hogares V1 permanecen
  en el flujo actual.
- Se añaden tablas/campos de forma aditiva y migraciones idempotentes en SQLite y
  PostgreSQL. No se borran `directory_account_links`, usuarios ni sesiones.
- Un interruptor local desactiva acceso Directory V2 para un Edge sin afectar el
  login local. Revertir la versión mantiene los datos nuevos inertes y los datos
  anteriores intactos.
- La rotación de claves admite `kid` y una ventana de claves públicas activas; no
  se aceptan claves desconocidas ni se descarga una clave durante una autenticación.

## Criterios de aceptación

- [ ] AC1: una cuenta con membresía activa cambia entre dos hogares emparejados sin
  ingresar una contraseña local adicional.
- [ ] AC2: un acceso emitido para hogar A es rechazado por el Edge de hogar B,
  incluso si fue firmado por Directory y no expiró.
- [ ] AC3: el rol Edge se asigna explícitamente por hogar; ningún miembro recibe
  `admin` ni un rol superior por defecto.
- [ ] AC4: una invitación a correo no registrado permite registro, verificación y
  aceptación sin exponer el secreto de invitación en la UI.
- [ ] AC5: tras revocar membresía no se emiten nuevos accesos; una sesión global
  existente caduca dentro de la ventana definida y las sesiones locales no cambian.
- [ ] AC6: login, control y datos locales continúan operativos si Directory queda
  inalcanzable.
- [ ] AC7: migrar un hogar V1 no altera sus usuarios, enlaces ni roles existentes.
- [ ] AC8: pruebas cubren firma inválida, audiencia errónea, hogar/Edge erróneo,
  expiración, replay, revocación, rol no asignado y compatibilidad V1.

## Observabilidad y privacidad

Se auditan solo identificadores opacos, evento, resultado, hogar y marca temporal.
Los eventos nunca contienen credenciales, token, código de emparejamiento, correo,
dirección completa ni datos de dispositivos. Los errores públicos usan códigos
estables y mensajes no enumerables.

## Fuera de alcance

- Centralizar telemetría, dispositivos, cámaras o automatizaciones.
- Hacer que Directory ejecute comandos en un hogar.
- Eliminar usuarios locales o forzar una migración de contraseñas.
- Soporte de acceso remoto cuando el Edge no es alcanzable por la ruta autorizada.
