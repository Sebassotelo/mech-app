# AGENTS.md

## Contexto real del proyecto

Este repo hoy no es una web corporativa pública.

Es una aplicación interna de gestión para mecánica y puntos de venta. La app permite:

- iniciar sesión con Firebase Auth
- montar un layout global con `Loader`, `Toaster` y metadatos básicos
- cargar estado global desde Firestore mediante un `Context` compartido
- operar un panel con vistas de ventas, caja, inventario, stock e historial
- operar un módulo de taller con clientes, trabajos, presupuestos y vista de mecánicos
- administrar usuarios y permisos desde el panel
- crear usuarios de Auth desde un endpoint server-side
- integrar cobros con Mercado Pago mediante endpoints server-side

## Mapa real del código

- `src/pages/_app.js`: entrada global, monta `Context` y `Layout`
- `src/componentes/Layout.jsx`: layout base, `Head`, `Loader` y `Toaster`
- `src/pages/index.js`: login y entrada principal
- `src/componentes/Login.jsx`: UI de acceso, logout y reset de contraseña
- `src/pages/panel/index.jsx`: shell principal del panel, navegación, permisos y vistas
- `src/servicios/context.js`: estado global, sesión, RT de Firestore y helpers compartidos
- `src/servicios/contextGeneral.js`: contexto React
- `src/servicios/firebase.js`: inicialización client-side de Firebase
- `src/servicios/firebaseAdmin.js`: inicialización server-side de Firebase Admin
- `src/componentes/panel/*.jsx`: módulos de ventas, stock, inventario, caja, cuentas e indicadores
- `src/componentes/taller/*.jsx`: módulos de clientes, trabajos, presupuestos y mecánicos
- `src/pages/api/admin/createAuthUser.js`: endpoint server-side para alta de usuarios Auth
- `src/pages/api/mp/create-order.js`: endpoint server-side para cargar órdenes al POS fijo de Mercado Pago
- `src/pages/api/mp/create-preference.js`: endpoint actualmente deshabilitado
- `src/pages/api/mp/webhook.js`: webhook de Mercado Pago
- `src/styles/globals.css`: Tailwind v4 y estilos globales mínimos

## Stack actual

Este proyecto trabaja hoy con:

- Next.js 15.5.7
- React 19.1.0
- Pages Router
- Tailwind CSS v4
- Firebase Web SDK
- Firebase Admin SDK
- Sonner
- `xlsx`
- `exceljs`
- `qrcode.react`
- `react-icons`

No asumir App Router, route handlers, chatbot OpenAI, Framer Motion ni una web institucional si no aparecen explícitamente en el código real.

## Arquitectura importante

### 1 Entrada global

- `src/pages/_app.js` envuelve toda la app con `Context` y `Layout`
- cualquier cambio ahí impacta login, panel y APIs consumidas desde cliente
- no romper el orden `Context -> Layout -> Component`

### 2 Layout global

- `src/componentes/Layout.jsx` monta `Head`, `Loader` y `Toaster`
- si cambiás fuentes, metadatos o loaders, afecta toda la app
- no eliminar `Toaster` ni el gate visual del loader sin pedido explícito

### 3 Auth, sesión y permisos

El flujo actual es:

- `src/componentes/Login.jsx` usa Firebase Auth desde cliente
- `src/servicios/context.js` escucha `onAuthStateChanged`
- si el usuario no existe en `usuarios/{email}`, lo crea o actualiza
- los permisos salen de Firestore y controlan el acceso a sedes y módulos
- `src/pages/panel/index.jsx` aplica guards de sesión y de permisos

Esto implica reglas concretas:

- no mover lógica de Auth Admin al cliente
- no asumir que `auth.currentUser` o `ctx.user` están listos antes de `authReady` y `loader === false`
- no romper la semántica actual de permisos `1`, `2`, `3`, `4`
- no cambiar el significado de permisos sin revisar login, panel, cuentas y cualquier guard visual

### 4 Estado global y RT de Firestore

`src/servicios/context.js` concentra gran parte de la app:

- carga colecciones en tiempo real
- expone arrays normalizados a los componentes
- controla el loader global
- resuelve joins de equivalencias

Colecciones observadas hoy:

- `usuarios`
- `categorias`
- `productos`
- `equivalencias`
- `ventas`
- `presupuestos`
- `presupuestosTaller`
- `caja`
- `clientesTaller`
- `trabajosTaller`

No romper esta centralización salvo pedido explícito. Si tocás shape de datos o nombres de colección, revisar `context.js` completo y todos los módulos consumidores.

### 5 Documentos chunked y claves dinámicas

Parte importante del modelo usa documentos con claves dinámicas:

- productos con prefijo `p_`
- equivalencias con prefijo `e_`
- ventas con prefijo `v_`
- presupuestos con prefijo `b_`
- clientes taller con prefijo `c_`
- trabajos taller con prefijo `t_`

Esto implica:

- no asumir un documento = un registro
- no refactorizar a otro modelo sin revisar importación, exportación, RT, helpers y transacciones
- si cambiás nombres de campos o prefijos, revisar todas las lecturas y escrituras relacionadas
- al tocar transacciones, cuidar integridad entre `chunkDoc`, `id` y claves dinámicas

### 6 Panel y navegación

`src/pages/panel/index.jsx` hoy controla:

- sede activa: `pv1`, `pv2`, `taller`
- vista activa según permisos
- persistencia en `localStorage`
- guard de acceso por usuario autenticado

Reglas:

- no romper redirección al login si no hay sesión
- no romper la persistencia de `mx.active` y `mx.location`
- si cambiás IDs de vistas o sedes, revisar labels, títulos, subtítulos y defaults
- mantener consistencia visual actual azul oscuro con acentos naranja, rojo y verde

### 7 Cuentas y alta de usuarios

El flujo actual es:

- `src/componentes/panel/Cuentas.jsx` consume `/api/admin/createAuthUser`
- el endpoint verifica el bearer token del caller
- el endpoint chequea permiso `4` en Firestore
- luego crea u obtiene el usuario de Firebase Auth
- el documento `usuarios/{email}` se completa desde cliente

Esto implica:

- no exponer credenciales de Admin SDK al cliente
- no saltear la verificación de permiso `4`
- preservar el contrato del endpoint salvo que actualices cliente y servidor juntos
- no asumir que crear un usuario Auth alcanza; hoy Firestore y Auth se completan en dos pasos

### 8 Mercado Pago

La integración actual relevante está en:

- `src/pages/api/mp/create-order.js`
- `src/pages/api/mp/webhook.js`

Reglas:

- no mover secretos de MP a cliente
- no usar `NEXT_PUBLIC_*` para credenciales privadas
- si cambiás `ventaKey`, `chunkDocId`, `payments[]` o estados de pago, revisar ambos endpoints y las vistas que los consumen
- `create-preference.js` hoy está deshabilitado; no asumir que el flujo activo usa preferencias checkout

## Reglas de trabajo obligatorias

### 9 Antes de tocar cualquier cosa

El proceso de trabajo obligatorio es:

- explicarte qué entendí
- decirte qué voy a hacer
- decirte qué archivos voy a tocar
- decirte qué no voy a tocar
- decirte si afecta UI, datos, auth, APIs, Firestore, pagos o build
- decirte cuál es el riesgo principal
- decirte cómo se va a verificar
- esperar siempre tu confirmación explícita antes de cualquier edición

### 10 Cambios mínimos y seguros

- hacer cambios chicos
- no refactorizar módulos enteros para resolver un detalle puntual
- no cambiar nombres de colecciones, shapes o prefijos sin necesidad real
- no cambiar copy visible, navegación o estructura del panel sin necesidad
- respetar la arquitectura actual antes que imponer una nueva
- si el archivo ya usa Tailwind, seguir ese patrón
- si el archivo ya está muy cargado, preferir una extracción puntual antes que reescritura total
- no introducir mojibake, texto roto ni secuencias inválidas de encoding
- todo archivo editado debe quedar en UTF-8 válido
- si aparece texto como `Ã`, `Â`, `â€¦`, `ðŸ` o `�`, corregirlo antes de cerrar la tarea

### 11 Al terminar un cambio

Siempre resumir:

- qué se cambió
- qué impacto tiene
- qué debería probar el usuario
- qué riesgos o casos borde siguen abiertos
- si quedó deuda técnica pendiente

## Seguridad y secretos

### 12 Archivos y variables sensibles

No leer, imprimir, pegar ni modificar:

- `.env`
- `.env.*`
- `.env.local`

Tampoco exponer:

- tokens
- secrets
- claves privadas
- cookies
- valores concretos de variables de entorno

### 13 Regla crítica cliente vs servidor

- `firebaseAdmin` debe seguir sólo en server-side
- no importar `src/servicios/firebaseAdmin.js` desde componentes ni código cliente
- `firebase.js` es para cliente; `firebaseAdmin.js` es para `/pages/api/**`
- no agregar secretos nuevos en componentes client
- si una integración necesita credenciales privadas, moverla a API route server-side

## Datos, rutas y contratos

### 14 Rutas internas relevantes

Hoy las rutas visibles del repo son:

- `/`
- `/panel`
- `/api/hello`
- `/api/admin/createAuthUser`
- `/api/mp/create-order`
- `/api/mp/create-preference`
- `/api/mp/webhook`

Si agregás o cambiás rutas:

- actualizar navegación y redirecciones donde corresponda
- revisar guards de sesión
- revisar cualquier `fetch` cliente a endpoints internos

### 15 Contratos que no conviene romper

- `Login.jsx` espera Firebase Auth cliente operativo
- `Cuentas.jsx` espera `POST /api/admin/createAuthUser` con bearer token
- `create-order.js` espera `{ total, ventaKey, chunkDocId, lines }`
- las ventas guardan `payments[]` y estado de pago asociado
- `context.js` expone nombres de estado usados en muchos componentes

Si cambiás un contrato, actualizar todos los consumidores dentro del mismo cambio.

## Estilos y UX

### 16 UI y consistencia visual

- preferir Tailwind para estilos nuevos
- mantener la estética actual azul oscuro con gradientes naranja y rojo, y verde en taller
- cuidar desktop y mobile
- no agregar animaciones porque sí
- si un archivo ya usa componentes inline o helpers locales, mantener el estilo salvo que haya un motivo técnico fuerte

## Verificación mínima

Al cerrar una tarea, verificar lo que aplique:

- `npm run lint`
- `npm run build`
- prueba manual de login si tocaste `src/componentes/Login.jsx`, `src/servicios/context.js` o Firebase
- prueba manual del panel si tocaste `src/pages/panel/index.jsx`
- prueba manual de cuentas si tocaste `src/componentes/panel/Cuentas.jsx` o `src/pages/api/admin/createAuthUser.js`
- prueba manual de ventas/caja/inventario si tocaste módulos de panel
- prueba manual de taller si tocaste módulos de `src/componentes/taller`
- prueba manual de Mercado Pago si tocaste `src/pages/api/mp/*` o el flujo que consume pagos
- caso feliz y al menos un caso borde

Si una verificación no puede correrse o falla por un problema previo del proyecto, decirlo explícitamente.

## Qué evitar

- no tocar `.next` ni `node_modules`
- no editar `package-lock.json` salvo que cambien dependencias
- no inventar servicios o módulos que no existen
- no mezclar Firebase client con Firebase Admin
- no romper el modelo chunked de Firestore por accidente
- no hacer un rediseño completo cuando el pedido es funcional
- no asumir que el repo ya está desacoplado en capas; hoy mucho comportamiento vive en componentes grandes y en `context.js`

## Prioridades del agente

Cuando haya varias mejoras posibles, priorizar en este orden:

1. seguridad y separación cliente/servidor
2. bugs funcionales
3. integridad de Auth, permisos y guards
4. integridad de Firestore y documentos chunked
5. robustez de endpoints server-side
6. integridad del flujo de pagos
7. UX y feedback
8. performance razonable
9. limpieza técnica secundaria
