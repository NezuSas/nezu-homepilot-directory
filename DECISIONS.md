# Decisiones de arquitectura

- **Runtime:** Node.js 20 + TypeScript + Fastify. Mantiene un servicio HTTP pequeño, con tipado estricto y sin dependencia del Edge.
- **Persistencia:** SQLite queda limitado a desarrollo y pruebas. Producción utiliza el adaptador PostgreSQL mediante `DATABASE_URL`, con su propio esquema y sin ningún acoplamiento a HomePilot Edge.
- **Contraseñas:** bcryptjs con coste 12. No se almacenan ni se transmiten credenciales de ningún Edge.
- **Sesión:** JWT HS256 de 12 horas firmado por el Directorio. La sesión solo identifica una cuenta del Directorio; no otorga acceso al Edge. La autorización de casas se vuelve a comprobar en cada ruta.
- **Invitaciones:** se guarda exclusivamente SHA-256 del token aleatorio de 256 bits. El token se devuelve una vez al propietario para su entrega por un canal seguro; el envío de correo queda fuera de alcance porque la spec no define proveedor de correo.
- **Navegación:** el selector utiliza `window.location.assign(edgeHostname)`. No adjunta token, cabeceras ni credenciales del Directorio, por lo que no constituye SSO.

- **Privacidad de invitaciones:** el flujo actual requiere que la persona ya tenga una cuenta para emitir un token. Por tanto, una respuesta INVITEE_NOT_FOUND revela la ausencia de esa cuenta al propietario autenticado. Se documenta como limitación; no se cambia el flujo porque la especificación no define invitaciones previas al registro ni proveedor de correo.

- **Correo transaccional:** `EmailSender` es un puerto; SMTP se configura por entorno y los tests usan un emisor en memoria. La persistencia de invitaciones y tokens precede al envio: un fallo SMTP no revierte la operacion, evitando inconsistencias. La cuenta puede iniciar sesion sin correo verificado, con aviso de UI, para no bloquear el flujo de alta mientras se completa la verificación.
- **Recuperacion de contrasena:** los tokens se guardan solo como SHA-256, expiran en una hora y se consumen atómicamente. El endpoint de solicitud responde igual si el correo existe o no, evitando enumeracion.
- **Revocacion de sesion:** cambiar contrasena no invalida JWT ya emitidos; estos expiran en 12 horas. Se documenta esta limitacion para no introducir un sistema de revocacion fuera del alcance actual.
- **Email verificado para acceso real:** el login y las operaciones de consulta/administracion no se bloquean. Crear una casa u obtener acceso a una casa aceptando una invitacion exige `emailVerified`; asi un correo falso no puede crear ni obtener acceso real a una casa sin friccionar el resto del uso de la cuenta.
