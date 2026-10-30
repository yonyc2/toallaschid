# Control de Toallas (versión web, sin servidor)

Aplicación hecha solo con HTML, CSS y JavaScript. No hay que instalar ni descargar nada:
no usa Node, npm ni librerías externas.

## Cómo usarla
1. Descomprime la carpeta.
2. Abre `index.html` con doble clic (recomendado: **Chrome o Edge**).
3. Entra con un usuario (ver abajo).

## Usuarios iniciales
| Usuario | Contraseña | Rol |
|---|---|---|
| admin | admin123 | Administrador |
| recepcion | recepcion123 | Recepción |
| toallero | toallero123 | Toallero |

La pantalla de administración muestra un aviso mientras sigan activos con esas contraseñas.
Crea usuarios nuevos y desactiva los iniciales.

## Estructura
```
index.html        entrada: manda a cada rol a su pantalla
login.html        inicio de sesión
recepcion.html    altas, búsqueda, edición y check-out de huéspedes
toallero.html     escaneo de tarjeta y entrega/devolución de toallas
admin.html        usuarios, historial, exportar a Excel, respaldos
css/app.css       estilos y animaciones
js/storage.js     almacenamiento en el navegador, sesión, contraseñas, bloqueo por intentos
js/backend.js     reglas de negocio (antes en server.js) y rutas /api/...
js/xlsx.js        generador de Excel (.xlsx) sin librerías
js/backup.js      respaldos automáticos en carpeta, respaldo manual y restauración
js/common.js      utilidades compartidas, protección de páginas, actualización entre pestañas
js/login.js, recepcion.js, toallero.js, admin.js   lógica de cada pantalla
```

## Importante: dónde se guardan los datos
Los datos se guardan **en el navegador de esa computadora** (localStorage), no en un servidor.
- Recepción y toallero deben usar **el mismo navegador de la misma computadora** (puedes abrir varias pestañas: se actualizan solas).
- Otra computadora o teléfono verá una base distinta y vacía.
- Si borras los datos del navegador se pierde todo: haz respaldos (ver MANUAL.md).
- Funciona en Chrome y Edge. En Firefox cada archivo local se trata como un sitio distinto y las pantallas no comparten datos.
- El inicio de sesión organiza quién hace qué; no es una barrera de seguridad real, porque todo corre en el navegador.
