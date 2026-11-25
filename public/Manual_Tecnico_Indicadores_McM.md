# MANUAL TÉCNICO Y DE OPERACIÓN — INDICADORES MCM
**Sistema de Cartera, Comisiones e Indicadores**

---

## 1. RESUMEN EJECUTIVO Y ARQUITECTURA
El sistema **Indicadores McM** es una aplicación web empresarial de alto rendimiento diseñada para la gestión, control y auditoría de la cartera de créditos, cálculo de comisiones e indicadores operativos de la organización.

* **Frontend:** React 19 con TypeScript y Tailwind CSS (diseño responsivo y adaptado para dispositivos móviles y de escritorio).
* **Backend:** Node.js con Express (`server.ts`) ejecutado en entorno de servidor seguro.
* **Persistencia y Datos:** Conexión en tiempo real con hojas de cálculo maestras en Google Drive / Google Sheets (`McM_Datos_DashBoard`), respaldo local en caché de servidor y sincronización automática de metas y bitácoras.

---

## 2. MÓDULOS PRINCIPALES DEL SISTEMA

### A. Módulo de Indicadores
* **Estructura jerárquica y Ranking:** Visualización de la cartera distribuida por Territorios, Regiones, Agencias, Coordinadores y Ejecutivos.
* **Filtros avanzados:** Selector de cortes semanales, filtrado por Región, Agencia, Estatus y buscador inteligente de personal.
* **Cálculo de metas (`H + I`):** Las metas mensuales de colocación se calculan sumando las columnas H e I (evitando duplicidades con la columna J).
* **Semaforización:** Indicadores visuales de normalidad de cartera y cumplimiento de metas.

### B. Módulo de Comisiones
* **Comisiones por Esquema:** Detalle de cobranza total, comisión por cobranza, modelo tradicional, apoyo familiar, bonos de excelencia y cartera heredada.
* **Directorio de Colaboradores:** Visualización individualizada de percepciones y deducciones (multas, préstamos de capital humano y caja de ahorros, retenciones y total a cobrar).
* **Exportación profesional:** Generación de reportes limpios y formateados en Excel, CSV y PDF.

### C. Indicadores Diarios y Reportes Mensuales (Normalidad)
* **Seguimiento diario:** Monitoreo de la evolución de lunes a viernes del período activo.
* **Reportes mensuales:** Análisis histórico de normalidad y cobranza por mes.

### D. Administración y Seguridad (Perfil Administrador)
* **Control de Usuarios (`USUARIOS`):** Alta, autorización de pendientes, restablecimiento de contraseñas y gestión de estados (activo / inactivo).
* **Vista / Rol (Simulación):** Permite al Administrador comprobar en tiempo real la vista exacta de cualquier Regional, Gerente o Coordinador, aplicando estrictamente los permisos y alcances jerárquicos correspondientes.
* **Bitácora de Operaciones (`LOG_ACTUALIZACIONES`):** Registro detallado de cargas semanales, publicaciones y modificaciones administrativas.
* **Bitácora de Accesos (`LOG_ACCESOS`):** Auditoría en tiempo real de cada inicio de sesión.

---

## 3. GESTIÓN Y AUDITORÍA DE ACCESOS

### Registro de Ingresos
Cada vez que un usuario inicia sesión (mediante usuario/contraseña de la hoja `USUARIOS` o a través de Google Workspace), el sistema registra automáticamente:
1. **Fecha y Hora exacta** (Zona horaria de la Ciudad de México).
2. **Nombre y Usuario** del colaborador.
3. **Rol asignado** (Ejecutivo, Coordinador, Gerente, Regional, Directivo o Administrador).
4. **Método de acceso** y **Dirección IP** de origen.

### Almacenamiento Dual (Servidor y Google Sheets)
* **Caché local:** Los registros se guardan de forma inmediata en el servidor (`.cache/access-logs.json`).
* **Sincronización con Google Sheets:** El sistema crea y actualiza automáticamente una pestaña dedicada llamada **`LOG_ACCESOS`** en la hoja maestra de Google Drive.
* **Consulta y Exportación:** Desde **Administración → Accesos**, el Administrador puede filtrar los ingresos por rango de tiempo (Hoy, 7 días, Todos), realizar búsquedas por nombre/rol y exportar la bitácora completa a **Excel** o **CSV**.

---

## 4. ESTIMACIÓN DE CAPACIDAD Y SOPORTE DE USUARIOS

### Capacidad Operativa y Rendimiento
* **Usuarios concurrentes:** La arquitectura del servidor maneja sin latencia percepciones simultáneas de decenas de usuarios.
* **Capacidad total recomendada:** El sistema soporta cómodamente **hasta 500 a 800 usuarios registrados** en la hoja `USUARIOS` y un uso activo de **150 a 300 usuarios diarios**.

### Comportamiento con 130 a 200 Usuarios
* **Uso no simultáneo:** Como los colaboradores no ingresan todos exactamente al mismo segundo (el tráfico se distribuye entre las horas hábiles de operación), el rendimiento del servidor se mantiene óptimo y fluido.
* **Caché inteligente de datos:** Para evitar llamadas excesivas y saturar Google Sheets, el servidor implementa caché de datos con vigencia optimizada, garantizando respuestas instantáneas en las consultas de indicadores y comisiones.

---

## 5. CUMPLIMIENTO Y DIRECTRICES DE GOOGLE CLOUD / WORKSPACE

* **Nivel de Uso (*Standard Tier*):** El proyecto opera dentro de las cuotas gratuitas y estándar de Google Cloud. No se generan cargos por el volumen de consultas de la base de usuarios actual ni proyectada.
* **Uso de Agentes de IA:** La aplicación es un sistema web tradicional (React + Node.js) que interactúa con Google Sheets mediante llamadas REST estándar, por lo que **no requiere** la adopción de Model Context Protocol (MCP) ni modificaciones técnicas adicionales de cara a las políticas de Google para 2027.
* **Continuidad:** El sistema está garantizado para operar de forma indefinida y segura bajo los parámetros actuales.
