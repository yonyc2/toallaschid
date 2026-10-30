# Manual de uso

## Roles
- **Administrador**: administración (usuarios, historial, exportar, respaldos) y recepción.
- **Recepción**: registrar y editar huéspedes, check-out.
- **Toallero**: escanear tarjeta, entregar y devolver toallas.

Después de 5 intentos fallidos con un usuario (o 30 en el navegador) el acceso se bloquea 15 minutos.
La sesión dura 8 horas y se renueva con el uso.

## Recepción
1. **Registrar huésped**: nombre, habitación, código de tarjeta (4 a 20 dígitos), tarjetas, límite de toallas, toallas iniciales y comentario.
   - Una habitación o un código solo puede estar activo con un huésped a la vez; tras el check-out se pueden reutilizar.
   - Las toallas iniciales no pueden superar el límite.
2. **Buscar** por nombre, habitación o código; "Mostrar todos" incluye a quienes ya salieron.
3. **Detalle**: editar límite (no menor a las toallas que ya tiene), tarjetas y comentario.
4. **Check-out**: solo cuando el huésped tiene 0 toallas.

## Toallero
Escanea el código de la tarjeta (o escríbelo y presiona Enter). Se muestran los datos del huésped y los últimos movimientos.
- **Entregar**: no puede superar el límite.
- **Devolver**: no puede dejar la cuenta en negativo.

## Administración
- **Crear usuario**: usuario de 3 a 32 caracteres (letras, números, punto, guion), contraseña de 8 o más con letras y números.
- **Activar/desactivar** usuarios (no puedes desactivarte a ti mismo).
- **Historial**: filtros por texto y acción, y cantidad de registros.
- **Exportar base de datos**:
  1. Guarda un respaldo `.json` (en la carpeta de respaldos, o lo descarga).
  2. Descarga un Excel con 4 hojas: Usuarios, Huespedes (activos y con check-out, con todos sus datos), Movimientos e Historial. No incluye contraseñas.
  3. **Borra el historial**. Usuarios, huéspedes y movimientos se conservan.
  El navegador puede pedir permiso para descargar varios archivos.

## Respaldos (muy importante)
- **Elegir carpeta de respaldos automáticos** (Chrome/Edge): al abrir la administración se guarda un respaldo por día y se conservan los últimos 14. El navegador puede pedir permiso otra vez en cada sesión; "Respaldar ahora" lo reactiva.
- **Respaldar ahora**: guarda un `.json` en la carpeta elegida o lo descarga.
- **Restaurar respaldo…**: reemplaza todos los datos por los del archivo `.json` y cierra la sesión.
- Guarda copias en otro lugar (USB, nube, otra computadora).
