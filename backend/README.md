# Aesthetic Clean: autenticación y panel privado

La aplicación utiliza Node.js y PostgreSQL. Las solicitudes, los registros financieros y las fotos adjuntas se guardan en PostgreSQL. No se asigna ningún rol desde el formulario público: el registro crea únicamente cuentas de cliente.

## Preparación

1. Instala Node.js 20 o posterior y prepara una instancia PostgreSQL accesible desde el servidor.
2. Desde esta carpeta, instala las dependencias con `npm install`.
3. Copia `.env.example` a `.env` y configura `DATABASE_URL`. En producción, guarda estos valores como secretos del proveedor, no en el repositorio.
4. Crea la primera cuenta de administrador con `ADMIN_EMAIL`, `ADMIN_PASSWORD` (mínimo 12 caracteres) y, opcionalmente, `ADMIN_NAME` en el entorno, y ejecuta `npm run create-admin`.
5. Inicia el servidor con `npm start`. La aplicación estará en `http://localhost:3000`; el mismo servidor entrega las páginas y la API.

El esquema de tablas se crea automáticamente al iniciar el servidor. Para publicar la aplicación, sirve todo el tráfico por HTTPS y usa una base PostgreSQL persistente. Configura `DATABASE_SSL=true` si tu proveedor requiere TLS y confía en el certificado predeterminado del servidor; si el proveedor requiere una CA específica, configúrala en el entorno del despliegue. Configura también `NODE_ENV=production` para habilitar cookies seguras y confianza en el proxy HTTPS.

## Publicar en Render

1. Sube el proyecto a un repositorio Git.
2. Crea primero una base PostgreSQL persistente en Render. Elige el plan y revisa su precio y condiciones antes de crearla; el Blueprint no crea bases de datos ni activa costos automáticamente.
3. Usa la misma región para el servicio y la base de datos. En el panel de la base copia la **Internal Database URL**.
4. Crea un Blueprint en Render seleccionando el repositorio; Render detectará `render.yaml`. Cuando solicite `DATABASE_URL`, pega la URL interna de PostgreSQL.
5. Espera a que el despliegue pase la comprobación `/api/health`. Crea el primer administrador una sola vez. Si el servicio permite Shell, configura temporalmente `ADMIN_EMAIL`, `ADMIN_PASSWORD` (mínimo 12 caracteres) y `ADMIN_NAME` como variables privadas y ejecuta `npm run create-admin` en Shell; luego quita esas variables. El plan web gratuito de Render no ofrece Shell. Como alternativa, ejecuta el script desde tu computadora con la URL **externa** de la base y TLS habilitado, usando `DATABASE_URL` y las tres variables `ADMIN_*` en esa sesión de PowerShell; sigue usando la URL **interna** como `DATABASE_URL` del servicio web. No escribas la URL ni la contraseña en el repositorio ni en el chat. Después visita `/login.html`.

El servicio web del Blueprint usa el plan gratuito; puede suspenderse cuando no recibe tráfico. La base queda fuera del Blueprint para que puedas elegir explícitamente un plan persistente. No compartas la URL de PostgreSQL ni las contraseñas en el repositorio o en el chat.

## Roles

- **Cliente:** crea su cuenta, envía solicitudes con foto opcional y consulta únicamente sus solicitudes.
- **Colaborador:** consulta solicitudes y las marca como «En proceso» o «Resuelta», con una nota de resolución opcional.
- **Administrador:** gestiona todas las solicitudes, registra ingresos por servicio y gastos (incluidas compras de equipos y químicos), ve totales y crea cuentas de colaboradores y otros administradores.

Las imágenes aceptadas son JPG, PNG y WebP, con un máximo de 5 MB. Se validan el tipo MIME y la firma del archivo en el servidor. Las sesiones aleatorias vencen en ocho horas, se guardan en la base como hashes y se revocan al cerrar sesión.
