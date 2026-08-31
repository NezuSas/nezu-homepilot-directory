# Tareas — HomePilot Cloud de dominio único V1

**Base:** `specs/single-domain-homepilot-cloud-v1.md`  
**Issue:** NezuSas/nezu-homepilot-directory#1.

## 1. Cloud Gateway y pairing

- [ ] Modelar Edge, conexión, credencial hashada, rotación y estado de presencia.
- [ ] Implementar claim de instalador y auditoría sanitizada.
- [ ] Implementar registro WebSocket/sondeo y el contrato versionado del relay.

## 2. Identidad y selector

- [ ] Convertir el selector a rutas internas `/homes/:homeId` de dominio único.
- [ ] Aplicar membresía y rol por hogar en cada solicitud gateway.
- [ ] Eliminar de UI la edición/exposición de hostname de Edge para nuevos hogares.

## 3. Seguridad y calidad

- [ ] Pruebas de aislamiento hogar/Edge, impersonación, replay, revocación y Edge offline.
- [ ] Pruebas E2E de login único, selector y mensajes relay permitidos.
- [ ] Documentar despliegue, observabilidad, rotación y reversión por hogar.
