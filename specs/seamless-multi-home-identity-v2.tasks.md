# Tareas — Identidad global y cambio fluido entre hogares V2

**Base:** `specs/seamless-multi-home-identity-v2.md`  
**Issue:** NezuSas/nezu-homepilot-directory#1, coordinada con NezuSas/homepilot#7.

## 1. Dominio y persistencia (Directory)

- [ ] Añadir `DirectoryEdgeConnection` y la asignación explícita de rol Edge a la
  membresía, con migraciones aditivas para SQLite y PostgreSQL.
- [ ] Implementar código de emparejamiento de un solo uso, hashado y con expiración.
- [ ] Mantener la compatibilidad de hogares/membresías V1 sin asignación gestionada.

## 2. Emisión y revocación (Directory)

- [ ] Emitir credenciales firmadas con `iss`, `aud`, `homeId`, `edgeId`, `kid`,
  `jti`, rol y vigencia corta; no usar tokens en logs ni respuestas persistidas.
- [ ] Bloquear emisión sin membresía activa, conexión emparejada o rol Edge explícito.
- [ ] Ajustar invitaciones para cuentas nuevas y eliminar la visualización de tokens.
- [ ] Auditar emisión, rechazo, emparejamiento y revocación con datos sanitizados.

## 3. Interfaz (Directory)

- [ ] Convertir el alta de hogar en flujo de emparejamiento de instalador.
- [ ] Diseñar selector accesible con estados de hogar no emparejado, acceso revocado
  y Edge no disponible, sin filtrar información sensible.
- [ ] Permitir al propietario definir el rol Edge de cada miembro antes de activar
  su acceso gestionado.

## 4. Contrato con HomePilot Edge

- [ ] Versionar el contrato de credencial y pruebas de contrato con HomePilot #7.
- [ ] Documentar distribución/rotación de claves públicas y configuración por Edge.
- [ ] Documentar TTL, comportamiento offline y procedimiento de reversión.

## 5. Calidad

- [ ] Pruebas unitarias de membresía, rol, pairing, invitación y emisión.
- [ ] Pruebas de integración SQLite/PostgreSQL y contrato Edge.
- [ ] Pruebas E2E de selector, cambio de hogar, revocación y flujo V1 compatible.
- [ ] Ejecutar `npm test`, `npm run typecheck` y `npm run build` antes de QA.
