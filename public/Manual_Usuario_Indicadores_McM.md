# Manual de Usuario — Indicadores McM
**Sistema Integral de Cartera, Comisiones e Indicadores Operativos**

---

## 1. Introducción y Configuración Inicial

### ¿Qué es Indicadores McM?
**Indicadores McM** es la plataforma corporativa centralizada para el monitoreo de la cartera de créditos, cálculo de comisiones por esquema, seguimiento de indicadores diarios y reportes mensuales de normalidad. El sistema opera conectado en tiempo real con las bases de datos maestras de Google Sheets y Google Drive, garantizando seguridad, rapidez y control jerárquico estricto.

### Configuración y Acceso Inicial
Para ingresar al sistema por primera vez:
1. Abra el enlace de la aplicación proporcionado por su administrador.
2. Elija su método de autenticación en la pantalla de bienvenida:
   * **Acceso por Rol (Usuario y Contraseña):** Ingrese las credenciales corporativas asignadas en la hoja `USUARIOS`.
   * **Inicio de sesión con Google / Conexión directa:** Para administradores y cuentas autorizadas de Google Workspace con acceso a las hojas maestras.
3. Una vez autenticado, el sistema le dirigirá automáticamente a su módulo correspondiente según los permisos de su perfil.

---

## 2. Descripción de Roles y Permisos

El sistema aplica seguridad basada en roles (RBAC), garantizando que cada colaborador visualice exclusivamente la información bajo su alcance jerárquico:

* **Ejecutivo (Asesor):** 
  * Acceso exclusivo a sus propios indicadores semanales, comisiones, montos colocados y resumen personal.
  * No visualiza información de otros asesores ni filtros jerárquicos superiores.
* **Coordinador:** 
  * Visualiza los indicadores y comisiones de los ejecutivos asignados a su sucursal o agencia bajo su supervisión directa.
* **Gerente (de Sucursal / Agencia):** 
  * Consulta el desempeño consolidado de las agencias a su cargo, supervisando a coordinadores y ejecutivos de su región geográfica.
* **Regional (Gerente Regional):** 
  * Alcance total sobre todas las agencias y sucursales dentro de su territorio o región asignada.
* **Director (Directivo / Dirección):** 
  * Acceso global a nivel gerencial, incluyendo reportes mensuales de normalidad y comparativos ejecutivos.
* **Administrador:** 
  * Control total del sistema. Permite la gestión de usuarios, carga de archivos semanales y diarios, sincronización de metas, consulta de bitácoras de operaciones y de accesos (`LOG_ACCESOS`), y la herramienta de simulación **"Vista / Rol"**.

---

## 3. Guía de Navegación por Módulos

### A. Módulo de Indicadores
* **Barra de Filtros:** Permite seleccionar el corte semanal vigente, filtrar por Región, Agencia, Estatus (activo/baja) y realizar búsquedas predictivas por nombre de colaborador.
* **Tarjetas KPI:** Muestran el consolidado de colocación, saldo total, clientes vigentes, mora y superávit.
* **Secciones:**
  * **Estructura:** Árbol jerárquico de rendimiento por territorio y agencia.
  * **Ranking:** Listado ordenado de ejecutivos según cumplimiento.
  * **Tabla detallada:** Indicadores de pagos esperados, recibidos, porcentaje de normalidad y semaforización.

### B. Módulo de Comisiones
* **Cálculo por Esquema:** Detalle de cobranza, comisiones por cobranza, modelo tradicional, apoyos familiares y bonos.
* **Directorio de Colaboradores:** Consulta individual de percepciones, descuentos (multas, préstamos de caja de ahorro/capital humano) y el **Total a Cobrar**.
* **Exportación:** Botones dedicados para descargar reportes limpios en formato Excel (`.xlsx`), CSV o PDF con diseño profesional.

### C. Módulo de Indicadores Diarios
* Permite dar seguimiento puntual a la evolución operativa de lunes a viernes del período seleccionado.

### D. Reportes Mensuales (Normalidad)
* Exclusivo para perfiles de Dirección y Administración. Muestra el consolidado histórico de normalidad y cobranza agrupado por mes.

### E. Módulo de Administración (Solo Administrador)
* **Carga Semanal:** Interfaz para publicar nuevos archivos de Excel/XLSB (`.xlsb`, `.xlsx`) asegurando respaldos automáticos previos.
* **Indicadores Diarios y Reportes Mensuales:** Carga y actualización de flujos operativos.
* **Usuarios:** Autorización de registros pendientes detectados en las hojas de datos y restablecimiento de contraseñas.
* **Bitácora (`LOG_ACTUALIZACIONES` y `LOG_ACCESOS`):** Auditoría en tiempo real de operaciones y registro detallado de cada inicio de sesión (nombre, rol, método, hora CDMX e IP).

---

## 4. Preguntas Frecuentes (FAQ)

**1. ¿Qué hago si olvidé mi contraseña o mi cuenta aparece inactiva?**
> Debe solicitar al Administrador del sistema que verifique su estatus en la hoja `USUARIOS` y ejecute un restablecimiento de contraseña desde el panel de Administración.

**2. ¿Cómo funciona la simulación de vistas para el Administrador?**
> Desde el menú lateral en **"Vista / Rol"**, el Administrador puede buscar a cualquier colaborador y activar el modo simulación para verificar exactamente qué visualiza dicho usuario en su pantalla.

**3. ¿Cuántos usuarios soporta la plataforma y qué impacto tiene el aviso reciente de Google Workspace?**
> El sistema está optimizado para soportar cómodamente **hasta 200+ usuarios concurrentes** y cientos de registros sin ningún problema de rendimiento. Dado que los ingresos se distribuyen a lo largo de las horas operativas y el servidor gestiona caché inteligente, **no se requiere ninguna actualización técnica ni migración inmediata** tras el aviso reciente de Google Workspace sobre APIs y agentes de IA. La plataforma opera dentro de los estándares gratuitos y estables de Google Cloud sin requerir cambios en su infraestructura.

**4. ¿Dónde se registran los accesos de los usuarios?**
> Cada inicio de sesión se almacena de forma segura en el servidor y se sincroniza automáticamente en una pestaña dedicada llamada **`LOG_ACCESOS`** dentro de la hoja maestra de Google Sheets, consultable en la sección **Administración → Accesos**.
