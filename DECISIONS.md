# Decisiones de arquitectura

- **Runtime:** Node.js 20 + TypeScript + Fastify. Mantiene un servicio HTTP pequeño, con tipado estricto y sin dependencia del Edge.
- **Persistencia:** SQLite para desarrollo y pruebas. La interfaz de `DirectoryStore` mantiene el caso de uso aislado del motor; producción puede sustituirse por PostgreSQL sin acoplarse a HomePilot Edge.
- **Contraseñas:** bcryptjs con coste 12. No se almacenan ni se transmiten credenciales de ningún Edge.
- **Sesión:** JWT HS256 de 12 horas firmado por el Directorio. La sesión solo identifica una cuenta del Directorio; no otorga acceso al Edge. La autorización de casas se vuelve a comprobar en cada ruta.
- **Invitaciones:** se guarda exclusivamente SHA-256 del token aleatorio de 256 bits. El token se devuelve una vez al propietario para su entrega por un canal seguro; el envío de correo queda fuera de alcance porque la spec no define proveedor de correo.
- **Navegación:** el selector utiliza `window.location.assign(edgeHostname)`. No adjunta token, cabeceras ni credenciales del Directorio, por lo que no constituye SSO.
