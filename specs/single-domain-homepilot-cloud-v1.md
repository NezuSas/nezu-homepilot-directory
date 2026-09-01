# SPEC: HomePilot Cloud de dominio único V1

**Issue:** NezuSas/nezu-homepilot-directory#1  
**Estado:** Borrador  
**Fecha:** 2026-08-31

## Propósito

HomePilot Cloud es la única entrada pública para usuarios. Una persona inicia sesión
una vez en el dominio oficial, selecciona una casa en la misma aplicación y controla
el Edge elegido sin ver hostnames, túneles ni credenciales de cada MiniPC.

## Arquitectura objetivo

```text
usuario → app.homepilot.<dominio> → Cloud Gateway → conexión saliente del Edge
                                                   → API y datos locales HomePilot
```

Directory evoluciona a HomePilot Cloud para identidad, membresías, selector y
gateway. No almacena dispositivos, cámaras, automatizaciones, telemetría completa,
contraseñas locales ni secretos de Home Assistant. El Edge conserva el plano de
datos y control local, incluida la operación sin Internet.

## Requisitos funcionales

- **REQ-1:** El navegador solo navega dentro del dominio único, con contexto de
  hogar en `/homes/:homeId`; no redirige a `edgeHostname`.
- **REQ-2:** Un instalador empareja cada MiniPC mediante código de un solo uso. El
  Edge crea una conexión saliente autenticada; Cloud nunca abre una conexión de
  administración hacia la LAN del cliente.
- **REQ-3:** Cloud autoriza una operación mediante membresía activa y rol explícito
  del hogar, y la enruta únicamente al Edge emparejado y conectado.
- **REQ-4:** El Gateway transporta solicitudes/respuestas y eventos sanitizados,
  conservando correlación, expiración, límite de tamaño y timeout. No inspecciona
  ni persiste contenido operativo.
- **REQ-5:** Desconectar un Edge presenta estado no disponible sin mezclar datos de
  otro hogar; el control local continúa en la MiniPC.
- **REQ-6:** Revocar una membresía bloquea nuevas sesiones Gateway de ese hogar y
  cancela solicitudes en curso que aún no lleguen al Edge.

## Límites de confianza

| Límite | Regla |
| --- | --- |
| Navegador → Cloud | Sesión global HttpOnly, CSRF y autorización por hogar. |
| Cloud → Edge | Canal saliente mutuamente autenticado, identidad de Edge y hogar fijadas. |
| Edge → HomePilot local | Adaptador local con token de servicio de alcance mínimo; no acepta tráfico remoto arbitrario. |
| Cloud → datos de hogar | Solo relay efímero; sin SQLite, cámaras, automatizaciones ni logs de payload. |

## Transporte y disponibilidad

El canal preferido es WebSocket seguro persistente iniciado por el Edge, con
reconexión exponencial, heartbeats y límites de backpressure. El protocolo se
versiona y soporta `request`, `response`, `event`, `heartbeat` y `close`; cada
mensaje incluye `protocolVersion`, `homeId`, `edgeId`, `requestId`, vencimiento y
tipo permitido. La primera implementación puede usar transporte de sondeo largo
solo si conserva el mismo contrato y las garantías de autenticación.

Cuando el canal no existe, Cloud devuelve `EDGE_OFFLINE`; no reintenta comandos de
control ni encola acciones físicas. El usuario puede seguir usando la consola local
en la red de su hogar. Ninguna caída de Cloud detiene automatizaciones locales.

## Migración

1. Mantener `edgeHostname` únicamente como dato de compatibilidad de instalaciones existentes; las nuevas casas no lo solicitan ni exponen en la UI.
2. Instalar el conector saliente y emparejar el Edge sin activar el gateway para
   usuarios finales.
3. Activar el hogar en Cloud, importar membresías con rol explícito y validar
   aislamiento/latencia.
4. Activar la ruta de dominio único por hogar mediante bandera reversible.
5. Retirar la navegación directa solo cuando exista evidencia de migración y plan
   de reversión; nunca borrar usuarios o accesos locales automáticamente.

## Criterios de aceptación

- [ ] AC1: el selector y las rutas de usuario permanecen en un único dominio.
- [ ] AC2: cambiar entre dos hogares autorizados no pide otra contraseña ni expone
  hostname del Edge.
- [ ] AC3: un mensaje de hogar A no llega al Edge de hogar B, aun con un `edgeId`
  válido o una sesión global válida.
- [ ] AC4: solo el Edge con secreto/certificado de emparejamiento vigente puede
  conectar para un hogar; replay y suplantación se rechazan.
- [ ] AC5: Edge offline no encola ni ejecuta órdenes tardías; muestra estado seguro.
- [ ] AC6: revocar membresía impide nuevas solicitudes Gateway sin afectar usuarios
  ni automatizaciones locales.
- [ ] AC7: el Gateway no persiste payloads de dispositivos ni secretos, y auditoría
  solo registra IDs opacos, resultado y tiempo.
- [ ] AC8: una desconexión de Cloud no afecta el acceso/funcionamiento local.
