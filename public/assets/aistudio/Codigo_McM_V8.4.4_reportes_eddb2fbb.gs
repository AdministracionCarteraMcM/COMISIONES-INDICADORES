/**
 * CAMBIOS 2026-11 (sobre V8.4.3-DIARIOS-SCOPE-CONTROL; API_VERSION NO cambia a propósito,
 * porque el portal la valida para publicar indicadores diarios):
 *  1) REPORTES MENSUALES: acciones report_list, report_get (todos menos ejecutivo) y
 *     report_save, report_delete (solo admin). Se guardan en la hoja oculta REPORTES.
 *  2) VELOCIDAD (sin cambiar resultados): getSS_() reutiliza el libro dentro de la misma
 *     ejecución, el directorio de comisiones ya no se calcula para perfiles que no lo usan,
 *     y existe un caché OPCIONAL de las hojas grandes (DATA_CACHE_ENABLED, apagado por defecto).
 */

/**
 * McM Dashboard - PARALELO / Administración semanal V1
 * Destino: McM_Datos_DashBoard - Paralelo
 * ID: 1UnWSSYLEHfrdmX21NipwdjcRJ9xWr-vo1GfM-o2QqeE
 * Actualización 14/10/2026: scopes al guardar rol, revocación de sesiones y equivalencias de regiones.
 *
 * V6 administra la SEMANA COMPLETA:
 * - Login y lectura del dashboard.
 * - Agregar/reemplazar/eliminar INDICADORES.
 * - Agregar/reemplazar/eliminar comisiones EJECUTIVO.
 * - Agregar/reemplazar/eliminar COORDINADOR, GERENTE y GERENTE_REGIONAL.
 * - Respaldo automático antes de modificar.
 * - LOG_ACTUALIZACIONES.
 *
 * USUARIOS se administra solo desde el módulo administrativo.
 * SCOPE_EJECUTIVO y SCOPE_COORDINADOR se sincronizan incrementalmente al publicar.
 */

const SPREADSHEET_ID = '1UnWSSYLEHfrdmX21NipwdjcRJ9xWr-vo1GfM-o2QqeE';
const API_VERSION = 'MCM-NUEVA-CUENTA-2026-09-11-ADMIN-V8.4.3-DIARIOS-SCOPE-CONTROL';
const SESSION_TTL = 21600; // 6 horas

const SHEETS = {
  CORTES: 'CORTES',
  EJECUTIVO: 'EJECUTIVO',
  INDICADORES: 'INDICADORES',
  COORDINADOR: 'COORDINADOR',
  GERENTE: 'GERENTE',
  REGIONAL: 'GERENTE_REGIONAL',
  USUARIOS: 'USUARIOS',
  SCOPE_EJECUTIVO: 'SCOPE_EJECUTIVO',
  SCOPE_COORDINADOR: 'SCOPE_COORDINADOR',
  SCOPE_GERENTE: 'SCOPE_GERENTE',
  SCOPE_REGIONAL: 'SCOPE_REGIONAL',
  LOG: 'LOG_ACTUALIZACIONES',
  DIARIOS: 'INDICADORES_DIARIOS',
  REPORTES: 'REPORTES',
  NORMALIDAD: 'NORMALIDAD'
};

// ---- Caché opcional de hojas grandes (velocidad de inicio de sesión) ----
// false = comportamiento original. true = guarda EJECUTIVO, INDICADORES y el directorio de comisiones
// comprimidos en CacheService; se invalida solo al publicar/eliminar desde el portal y, por seguridad, caduca a los 5 min.
const DATA_CACHE_ENABLED = false;
const DATA_CACHE_TTL = 300;

let SS_MEMO_ = null;
function getSS_() { return SS_MEMO_ || (SS_MEMO_ = SpreadsheetApp.openById(SPREADSHEET_ID)); }

function doGet() {
  return json_({
    ok:true,
    service:'McM Dashboard Paralelo',
    api_version:API_VERSION,
    spreadsheet_id:SPREADSHEET_ID,
    capabilities:['daily_begin','daily_chunk','daily_commit','daily_abort','daily_status','scope_diagnostics','daily_history','session_check','report_list','report_get','report_diagnose','report_save','report_publish','report_delete']
  });
}

function doPost(e) {
  try {
    const payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const action = String(payload.action || 'login').trim().toLowerCase();

    if (action === 'login') {
      return json_(loginObject_(
        String(payload.username || '').trim().toLowerCase(),
        String(payload.password || '')
      ));
    }

    const session = requireSession_(String(payload.session_token || ''));
    if (action === 'session_check') return json_({ok:true,role:session.role,nombre:session.nombre});

    if (action === 'daily_dates') return json_(dailyDates_(session));
    if (action === 'daily_data') return json_(dailyData_(session,payload));
    if (action === 'refresh_data') {
      return json_(dataPayload_(session));
    }
    if (action === 'report_list' || action === 'report_get' || action === 'report_diagnose') return json_(reportsRead_(action, payload, session));

    requireAdmin_(session);
    const MUTATING = {daily_commit:1,publish_week:1,delete_week:1,publish_indicadores:1,delete_indicadores:1,approve_users:1,update_user:1,reset_password:1};
    try {
    if (action === 'report_save' || action === 'report_publish' || action === 'report_delete') return json_(reportsWrite_(action, payload, session));
    if (action === 'daily_status') return json_(dailyStatus_(payload,session));
    if (action === 'daily_begin') return json_(dailyBegin_(payload,session));
    if (action === 'daily_chunk') return json_(dailyChunk_(payload,session));
    if (action === 'daily_commit') return json_(dailyCommit_(payload,session));
    if (action === 'daily_abort') return json_(dailyAbort_(payload,session));
    if (action === 'scope_diagnostics') return json_(scopeDiagnostics_(session));

    if (action === 'publish_week') {
      return json_(publishCompleteWeek_(payload, session));
    }

    if (action === 'delete_week') {
      return json_(deleteCompleteWeek_(payload, session));
    }

    // Compatibilidad V5
    if (action === 'publish_indicadores') {
      return json_(publishIndicadores_(payload, session));
    }

    if (action === 'delete_indicadores') {
      return json_(deleteIndicadores_(payload, session));
    }
    if (action === 'admin_users') return json_(adminUsers_(session));
    if (action === 'approve_users') return json_(approveUsers_(payload, session));
    if (action === 'reset_password') return json_(resetPassword_(payload, session));
    if (action === 'update_user') return json_(updateUser_(payload, session));
    if (action === 'list_backups') return json_(listBackups_(session));
    if (action === 'delete_backups') return json_(deleteBackups_(payload, session));

    return json_({ ok:false, error:'Acción no reconocida: '+action, api_version:API_VERSION });
    } finally { if (MUTATING[action]) bumpDataCache_(); }
  } catch (err) {
    return json_({ ok:false, error:String(err && err.message ? err.message : err), api_version:API_VERSION });
  }
}

/* ========================= SESIÓN / LOGIN ========================= */
function loginObject_(username,password){
 username=lower_(username);
 if(!username||!password)return {ok:false,error:'Usuario y contraseña requeridos'};
 const user=readObjects_(SHEETS.USUARIOS).find(r=>lower_(r.username)===username&&String(r.password||'')===String(password)&&lower_(r.estado||'activo')!=='inactivo');
 if(!user)return {ok:false,error:'Usuario o contraseña incorrectos'};
 const session={username:username,role:lower_(user.role),nombre:upper_(user.nombre),revision:mcmSessionRevision_(username)};
 const token=Utilities.getUuid()+Utilities.getUuid();
 CacheService.getScriptCache().put('sess:'+token,JSON.stringify(session),SESSION_TTL);
 const out=dataPayload_(session);out.session_token=token;return out;
}

function requireSession_(token){
 if(!token)throw new Error('SESSION_REVOKED: Vuelve a iniciar sesión.');
 const raw=CacheService.getScriptCache().get('sess:'+token);
 if(!raw)throw new Error('SESSION_REVOKED: La sesión expiró. Vuelve a iniciar sesión.');
 const session=JSON.parse(raw);
 if((session.revision||'')!==mcmSessionRevision_(session.username))throw new Error('SESSION_REVOKED: Tus permisos cambiaron. Vuelve a iniciar sesión.');
 const user=readObjects_(SHEETS.USUARIOS).find(r=>lower_(r.username)===lower_(session.username));
 if(!user||lower_(user.estado||'activo')==='inactivo'||lower_(user.role)!==lower_(session.role)||personKey_(user.nombre)!==personKey_(session.nombre))throw new Error('SESSION_REVOKED: Tu cuenta cambió o fue desactivada. Vuelve a iniciar sesión.');
 return session;
}

function requireAdmin_(session) {
  if (lower_(session.role) !== 'admin') {
    throw new Error('Solo el perfil Administrador puede realizar operaciones administrativas.');
  }
}

function dataPayload_(session) {
  const role = lower_(session.role);
  const nombre = upper_(session.nombre);

  const cortes = readObjects_(SHEETS.CORTES)
    .map(r => ({MES:num_(r.MES), SEMANA:num_(r.SEMANA), CORTE:num_(r.CORTE), PERIODO:r.PERIODO||''}))
    .filter(r => r.CORTE != null)
    .sort((a,b) => a.CORTE-b.CORTE);

  let ejecutivoCom = cachedRead_('EJECUTIVO', () => normalizeNumericRows_(readObjects_(SHEETS.EJECUTIVO)));
  let indicadores = cachedRead_('INDICADORES', () => normalizeIndicadoresRows_(readObjects_(SHEETS.INDICADORES)));
  ejecutivoCom = scopeRows_(ejecutivoCom, role, nombre);
  indicadores = scopeRows_(indicadores, role, nombre);

  return {
    ok:true,
    username:session.username,
    role:role,
    nombre:nombre,
    cortes:cortes,
    ejecutivo_comisiones:ejecutivoCom,
    ejecutivo_indicadores:indicadores,
    nivel_propio:getNivelPropio_(role,nombre),
    directorio_comisiones:getDirectorioComisiones_(role,nombre),
    api_version:API_VERSION,
    spreadsheet_id:SPREADSHEET_ID
  };
}


/* ========================= SEMANA COMPLETA V6 ========================= */
function publishCompleteWeek_(payload, session) {
  const mode = lower_(payload.mode);
  const week = integerWeek_(payload.week);
  const fileName = String(payload.file_name || '').trim();
  if (!['add','replace'].includes(mode)) throw new Error('Modo inválido. Usa add o replace.');

  const datasets = [
    {key:'indicadores', sheet:SHEETS.INDICADORES, rows:Array.isArray(payload.indicadores_rows)?payload.indicadores_rows:[], by:'corte', required:true},
    {key:'ejecutivo', sheet:SHEETS.EJECUTIVO, rows:Array.isArray(payload.ejecutivo_rows)?payload.ejecutivo_rows:[], by:'semana', required:true},
    {key:'coordinador', sheet:SHEETS.COORDINADOR, rows:Array.isArray(payload.coordinador_rows)?payload.coordinador_rows:[], by:'semana', required:false},
    {key:'gerente', sheet:SHEETS.GERENTE, rows:Array.isArray(payload.gerente_rows)?payload.gerente_rows:[], by:'semana', required:false},
    {key:'regional', sheet:SHEETS.REGIONAL, rows:Array.isArray(payload.regional_rows)?payload.regional_rows:[], by:'semana', required:false}
  ];
  datasets.forEach(d=>{ if(d.required && !d.rows.length) throw new Error('Faltan datos de '+d.sheet+' para Semana '+week+'.'); });
  validateIndicatorRows_(datasets[0].rows, week);
  datasets.slice(1).forEach(d=>validateWeeklyRows_(d.rows, week, d.sheet));

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  const snapshots = [];
  try {
    const ss = getSS_();
    const corteInfo = ensureCorteForWeek_(ss, week);
    const corte = corteInfo.corte;
    const periodo = corteInfo.periodo;
    const mes = corteInfo.mes;

    // Preparar y validar estado de cada hoja antes de escribir nada.
    datasets.forEach(d=>{
      const sh = mustSheet_(ss,d.sheet);
      const matrix = sh.getDataRange().getValues();
      if(!matrix.length) throw new Error(d.sheet+' no tiene encabezados.');
      const headers = matrix[0].map(h=>String(h||'').trim());
      let targetIx;
      if(d.by==='corte') targetIx=findHeader_(headers,['corte','CORTE']);
      else targetIx=findHeader_(headers,['semana','SEMANA']);
      const targetValue = d.by==='corte'?corte:week;
      const oldRows = matrix.slice(1).filter(r=>sameNum_(r[targetIx],targetValue));
      const keep = matrix.slice(1).filter(r=>!sameNum_(r[targetIx],targetValue));
      snapshots.push({
        d,sh,matrix,headers,targetIx,targetValue,oldRows,keep,
        keepDigest:digestMatrix_(keep), keepCount:keep.length
      });
    });

    const anyExisting = snapshots.some(x=>x.oldRows.length>0);
    if(mode==='add' && anyExisting) throw new Error('La Semana '+week+' ya existe en al menos una hoja. Usa Reemplazar semana.');
    if(mode==='replace' && !anyExisting) throw new Error('La Semana '+week+' no existe. Usa Agregar semana.');

    snapshots.forEach(x=>{
      if(x.oldRows.length) backupRows_(ss,x.d.sheet,week,x.headers,x.oldRows);
    });
    if(corteInfo.created) backupCortesCurrent_(ss,week);

    // Escribir todas las hojas de la semana.
    snapshots.forEach(x=>{
      const incoming = x.d.rows.map(obj=>{
        const o=Object.assign({},obj,{semana:week,corte:corte,periodo:periodo});
        if(mes!=null) o.mes=mes;
        return x.headers.map(h=>valueForHeader_(o,h));
      });
      x.incoming=incoming;
      rewriteSheet_(x.sh,x.headers,x.keep.concat(incoming));
    });

    // Validación de integridad hoja por hoja.
    const details = {};
    for(const x of snapshots){
      const verify=x.sh.getDataRange().getValues();
      const vh=verify[0].map(h=>String(h||'').trim());
      const vix=x.d.by==='corte'?findHeader_(vh,['corte','CORTE']):findHeader_(vh,['semana','SEMANA']);
      const vk=verify.slice(1).filter(r=>!sameNum_(r[vix],x.targetValue));
      const vt=verify.slice(1).filter(r=>sameNum_(r[vix],x.targetValue));
      const ok=x.keepCount===vk.length && x.keepDigest===digestMatrix_(vk) && vt.length===x.incoming.length;
      details[x.d.key]={antes:x.oldRows.length,nuevos:x.incoming.length,integridad:ok};
      if(!ok) throw new Error('VALIDACIÓN DE INTEGRIDAD FALLÓ en '+x.d.sheet+'.');
    }

    const scopeSync = syncAllScopesSafe_(ss, datasets[0].rows);
    logOperation_(ss,{
      usuario:session.username,
      accion:mode==='add'?'AGREGAR_SEMANA_COMPLETA':'REEMPLAZAR_SEMANA_COMPLETA',
      semana:week,corte:corte,periodo:periodo,archivo:fileName,
      registros_antes:snapshots.reduce((s,x)=>s+x.oldRows.length,0),
      registros_nuevos:snapshots.reduce((s,x)=>s+x.incoming.length,0),
      resultado:'OK',
      detalle:'INDICADORES '+details.indicadores.nuevos+
        ' · EJECUTIVO '+details.ejecutivo.nuevos+
        ' · COORDINADOR '+details.coordinador.nuevos+
        ' · GERENTE '+details.gerente.nuevos+
        ' · REGIONAL '+details.regional.nuevos+
        ' · scopes nuevos '+scopeSync.total,
      id_operacion:Utilities.getUuid()
    });

    return {
      ok:true,week,corte,periodo,
      integridad_otras_semanas:true,
      detalles:details,
      api_version:API_VERSION
    };
  } catch(err) {
    // Rollback de todas las hojas que ya pudieran haberse escrito.
    try{
      snapshots.forEach(x=>{
        if(x.sh && x.headers && x.matrix) rewriteSheet_(x.sh,x.headers,x.matrix.slice(1));
      });
    }catch(_){}
    try { logFailure_(session,'PUBLICAR_SEMANA_COMPLETA',week,fileName,err); } catch(_){}
    throw err;
  } finally {
    lock.releaseLock();
  }
}

function deleteCompleteWeek_(payload, session) {
  const week=integerWeek_(payload.week);
  const lock=LockService.getScriptLock();
  lock.waitLock(30000);
  const snapshots=[];
  try{
    const ss=getSS_();
    const corteInfo=getCorteForWeek_(ss,week);
    if(!corteInfo) throw new Error('No encontré Semana '+week+' en CORTES.');
    const corte=corteInfo.corte;
    const defs=[
      {sheet:SHEETS.INDICADORES,by:'corte',value:corte},
      {sheet:SHEETS.EJECUTIVO,by:'semana',value:week},
      {sheet:SHEETS.COORDINADOR,by:'semana',value:week},
      {sheet:SHEETS.GERENTE,by:'semana',value:week},
      {sheet:SHEETS.REGIONAL,by:'semana',value:week}
    ];
    defs.forEach(d=>{
      const sh=mustSheet_(ss,d.sheet), matrix=sh.getDataRange().getValues();
      const headers=matrix[0].map(h=>String(h||'').trim());
      const ix=d.by==='corte'?findHeader_(headers,['corte','CORTE']):findHeader_(headers,['semana','SEMANA']);
      const oldRows=matrix.slice(1).filter(r=>sameNum_(r[ix],d.value));
      const keep=matrix.slice(1).filter(r=>!sameNum_(r[ix],d.value));
      snapshots.push({d,sh,matrix,headers,ix,oldRows,keep,digest:digestMatrix_(keep),count:keep.length});
    });
    if(!snapshots.some(x=>x.oldRows.length)) throw new Error('Semana '+week+' no tiene información para eliminar.');

    snapshots.forEach(x=>{if(x.oldRows.length)backupRows_(ss,x.d.sheet,week,x.headers,x.oldRows);});
    snapshots.forEach(x=>rewriteSheet_(x.sh,x.headers,x.keep));

    snapshots.forEach(x=>{
      const v=x.sh.getDataRange().getValues(), h=v[0].map(z=>String(z||'').trim());
      const ix=x.d.by==='corte'?findHeader_(h,['corte','CORTE']):findHeader_(h,['semana','SEMANA']);
      const keep=v.slice(1).filter(r=>!sameNum_(r[ix],x.d.value));
      const target=v.slice(1).filter(r=>sameNum_(r[ix],x.d.value));
      if(keep.length!==x.count || digestMatrix_(keep)!==x.digest || target.length!==0)
        throw new Error('VALIDACIÓN DE ELIMINACIÓN FALLÓ en '+x.d.sheet+'.');
    });

    removeWeekFromCortes_(ss,week);
    logOperation_(ss,{
      usuario:session.username,accion:'ELIMINAR_SEMANA_COMPLETA',semana:week,corte,
      periodo:corteInfo.periodo,archivo:'',
      registros_antes:snapshots.reduce((s,x)=>s+x.oldRows.length,0),registros_nuevos:0,
      resultado:'OK',
      detalle:snapshots.map(x=>x.d.sheet+' '+x.oldRows.length).join(' · '),
      id_operacion:Utilities.getUuid()
    });
    return {
      ok:true,week,corte,integridad_otras_semanas:true,
      eliminados:Object.fromEntries(snapshots.map(x=>[x.d.sheet,x.oldRows.length])),
      api_version:API_VERSION
    };
  }catch(err){
    try{snapshots.forEach(x=>rewriteSheet_(x.sh,x.headers,x.matrix.slice(1)));}catch(_){}
    try{logFailure_(session,'ELIMINAR_SEMANA_COMPLETA',week,'',err);}catch(_){}
    throw err;
  }finally{lock.releaseLock();}
}

function validateWeeklyRows_(rows,week,sheetName){
  rows.forEach((r,i)=>{
    const w=Number(r.semana);
    if(Number.isFinite(w) && Math.round(w)!==week) throw new Error(sheetName+' fila '+(i+1)+': semana distinta a '+week+'.');
  });
}


/* ========================= PUBLICAR INDICADORES ========================= */
function publishIndicadores_(payload, session) {
  const mode = lower_(payload.mode);
  const week = integerWeek_(payload.week);
  const fileName = String(payload.file_name || '').trim();
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  if (!['add','replace'].includes(mode)) throw new Error('Modo inválido. Usa add o replace.');
  if (!rows.length) throw new Error('No se recibieron filas procesadas para publicar.');
  if (rows.length > 1000) throw new Error('Se recibieron demasiadas filas. La carga debe contener una sola semana resumida por ejecutivo.');

  validateIndicatorRows_(rows, week);

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = getSS_();
    const corteInfo = ensureCorteForWeek_(ss, week);
    const corte = corteInfo.corte;
    const sh = mustSheet_(ss, SHEETS.INDICADORES);
    const matrix = sh.getDataRange().getValues();
    if (!matrix.length) throw new Error('INDICADORES no tiene encabezados.');
    const headers = matrix[0].map(h=>String(h||'').trim());
    const corteIx = findHeader_(headers, ['corte','CORTE']);
    const oldRows = matrix.slice(1).filter(r => sameNum_(r[corteIx], corte));

    if (mode === 'add' && oldRows.length) throw new Error('La semana '+week+' ya existe en INDICADORES. Usa Reemplazar.');
    if (mode === 'replace' && !oldRows.length) throw new Error('La semana '+week+' no existe en INDICADORES. Usa Agregar.');

    if (oldRows.length) backupRows_(ss, 'INDICADORES', week, headers, oldRows);
    if (corteInfo.created) backupCortesCurrent_(ss, week);

    const keep = matrix.slice(1).filter(r => !sameNum_(r[corteIx], corte));
    const keepDigestBefore = digestMatrix_(keep);
    const keepCountBefore = keep.length;
    const incoming = rows.map(obj => {
      const o = Object.assign({}, obj, {corte:corte});
      return headers.map(h => valueForHeader_(o, h));
    });
    const finalRows = keep.concat(incoming);
    rewriteSheet_(sh, headers, finalRows);

    // VALIDACIÓN CRÍTICA: después de reescribir, todas las filas que NO son
    // de la semana objetivo deben ser exactamente las mismas que antes.
    const verifyMatrix = sh.getDataRange().getValues();
    const verifyHeaders = verifyMatrix[0].map(h=>String(h||'').trim());
    const verifyCorteIx = findHeader_(verifyHeaders, ['corte','CORTE']);
    const verifyKeep = verifyMatrix.slice(1).filter(r => !sameNum_(r[verifyCorteIx], corte));
    const verifyTarget = verifyMatrix.slice(1).filter(r => sameNum_(r[verifyCorteIx], corte));
    const keepDigestAfter = digestMatrix_(verifyKeep);
    const integrityOk = keepCountBefore === verifyKeep.length && keepDigestBefore === keepDigestAfter && verifyTarget.length === incoming.length;

    if (!integrityOk) {
      // Rollback inmediato al estado completo anterior si cualquier otra semana cambió
      // o si la cantidad de la semana publicada no coincide.
      rewriteSheet_(sh, headers, matrix.slice(1));
      throw new Error('VALIDACIÓN DE INTEGRIDAD FALLÓ. Se revirtió automáticamente la operación; ninguna semana fue modificada.');
    }

    const scopeSync = syncAllScopesSafe_(ss, rows);

    logOperation_(ss, {
      usuario:session.username, accion:mode==='add'?'AGREGAR_INDICADORES':'REEMPLAZAR_INDICADORES',
      semana:week, corte:corte, periodo:corteInfo.periodo, archivo:fileName,
      registros_antes:oldRows.length, registros_nuevos:incoming.length,
      resultado:'OK', detalle:'Publicación semanal desde Dashboard paralelo · scopes nuevos: '+scopeSync.total, id_operacion:Utilities.getUuid()
    });

    return {ok:true,week:week,corte:corte,periodo:corteInfo.periodo,registros_antes:oldRows.length,registros_nuevos:incoming.length,corte_creado:corteInfo.created,integridad_otras_semanas:true,filas_otras_semanas:verifyKeep.length,api_version:API_VERSION};
  } catch (err) {
    try { logFailure_(session, 'PUBLICAR_INDICADORES', week, fileName, err); } catch (_) {}
    throw err;
  } finally {
    lock.releaseLock();
  }
}

function deleteIndicadores_(payload, session) {
  const week = integerWeek_(payload.week);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = getSS_();
    const corteInfo = getCorteForWeek_(ss, week);
    if (!corteInfo) throw new Error('No encontré Semana '+week+' en CORTES.');
    const corte = corteInfo.corte;
    const sh = mustSheet_(ss, SHEETS.INDICADORES);
    const matrix = sh.getDataRange().getValues();
    const headers = matrix[0].map(h=>String(h||'').trim());
    const corteIx = findHeader_(headers,['corte','CORTE']);
    const oldRows = matrix.slice(1).filter(r=>sameNum_(r[corteIx],corte));
    if (!oldRows.length) throw new Error('Semana '+week+' no tiene registros en INDICADORES.');

    backupRows_(ss,'INDICADORES',week,headers,oldRows);
    const keep = matrix.slice(1).filter(r=>!sameNum_(r[corteIx],corte));
    rewriteSheet_(sh,headers,keep);

    // Regla heredada: CORTES solo se elimina si EJECUTIVO no conserva la semana.
    const ejecutivoHasWeek = sheetHasWeek_(ss,SHEETS.EJECUTIVO,week);
    let cortesConservado = true;
    if (!ejecutivoHasWeek) {
      removeWeekFromCortes_(ss,week);
      cortesConservado = false;
    }

    logOperation_(ss, {
      usuario:session.username, accion:'ELIMINAR_INDICADORES', semana:week, corte:corte,
      periodo:corteInfo.periodo, archivo:'', registros_antes:oldRows.length, registros_nuevos:0,
      resultado:'OK', detalle:cortesConservado?'CORTES conservado porque EJECUTIVO mantiene la semana':'CORTES eliminado; EJECUTIVO no tenía la semana', id_operacion:Utilities.getUuid()
    });

    return {ok:true,week:week,corte:corte,registros_antes:oldRows.length,registros_nuevos:0,cortes_conservado:cortesConservado,api_version:API_VERSION};
  } catch (err) {
    try { logFailure_(session,'ELIMINAR_INDICADORES',week,'',err); } catch (_) {}
    throw err;
  } finally {
    lock.releaseLock();
  }
}

/* ========================= VALIDACIONES ========================= */
function validateIndicatorRows_(rows, week) {
  const seen = new Set();
  rows.forEach((r,i)=>{
    const name = upper_(r.ejecutivo);
    if (!name) throw new Error('Fila '+(i+1)+': ejecutivo vacío.');
    if (seen.has(name)) throw new Error('Ejecutivo duplicado en carga: '+name);
    seen.add(name);
    const mc = numOrZero_(r.monto_colocacion_semanal);
    const sum = numOrZero_(r.monto_nuevos)+numOrZero_(r.monto_renovaciones);
    if (Math.abs(mc-sum)>1) throw new Error(name+': monto colocación no coincide con Nuevos + Renovaciones.');
    const cc = numOrZero_(r.colocacion_semanal);
    const cs = numOrZero_(r.clientes_nuevos)+numOrZero_(r.renovaciones);
    if (Math.abs(cc-cs)>0.001) throw new Error(name+': número de colocaciones no coincide con Nuevos + Renovaciones.');
  });
}

/* ========================= CORTES ========================= */
function getCorteForWeek_(ss, week) {
  const sh = mustSheet_(ss,SHEETS.CORTES);
  const vals = sh.getDataRange().getValues();
  if (vals.length<2) return null;
  const h=vals[0].map(x=>String(x||'').trim());
  const iM=findHeader_(h,['MES','mes']), iW=findHeader_(h,['SEMANA','semana']), iC=findHeader_(h,['CORTE','corte']), iP=findHeader_(h,['PERIODO','periodo']);
  const found=vals.slice(1).filter(r=>sameNum_(r[iW],week));
  if (!found.length) return null;
  const cortes=[...new Set(found.map(r=>num_(r[iC])).filter(v=>v!=null))];
  if (cortes.length!==1) throw new Error('Semana '+week+' tiene más de un CORTE en CORTES: '+cortes.join(', '));
  return {corte:cortes[0],periodo:String(found[found.length-1][iP]||''),mes:(iM>=0?num_(found[found.length-1][iM]):null),created:false};
}

function ensureCorteForWeek_(ss, week) {
  const existing=getCorteForWeek_(ss,week);
  if (existing) return existing;
  const sh=mustSheet_(ss,SHEETS.CORTES), vals=sh.getDataRange().getValues();
  const h=vals[0].map(x=>String(x||'').trim());
  const iM=findHeader_(h,['MES']), iW=findHeader_(h,['SEMANA']), iC=findHeader_(h,['CORTE']), iP=findHeader_(h,['PERIODO']);
  const prior=vals.slice(1).map(r=>({week:num_(r[iW]),corte:num_(r[iC])})).filter(x=>x.week!=null&&x.corte!=null&&x.week<week).sort((a,b)=>a.week-b.week);
  if (!prior.length) throw new Error('No existe una semana previa para calcular el corte de Semana '+week+'.');
  const p=prior[prior.length-1], corte=p.corte+7*(week-p.week), friday=serialToDate_(corte), mes=lastDayMonth_(friday), periodo=formatPeriodo_(friday);
  const row=new Array(h.length).fill(''); row[iM]=dateToSerial_(mes); row[iW]=week; row[iC]=corte; row[iP]=periodo;
  sh.appendRow(row);
  return {corte:corte,periodo:periodo,mes:dateToSerial_(mes),created:true};
}

function removeWeekFromCortes_(ss,week) {
  const sh=mustSheet_(ss,SHEETS.CORTES), vals=sh.getDataRange().getValues();
  const h=vals[0].map(x=>String(x||'').trim()), iW=findHeader_(h,['SEMANA']);
  const removed=vals.slice(1).filter(r=>sameNum_(r[iW],week));
  if (removed.length) backupRows_(ss,'CORTES',week,h,removed);
  rewriteSheet_(sh,h,vals.slice(1).filter(r=>!sameNum_(r[iW],week)));
}

function backupCortesCurrent_(ss,week) {
  const sh=mustSheet_(ss,SHEETS.CORTES), vals=sh.getDataRange().getValues();
  if(vals.length>1) backupRows_(ss,'CORTES_PREV',week,vals[0].map(String),vals.slice(1));
}

/* ========================= RESPALDOS / ESCRITURA / LOG ========================= */
function backupRows_(ss, source, week, headers, rows) {
  if (!rows || !rows.length) return;
  const tz=Session.getScriptTimeZone()||'America/Mexico_City';
  const stamp=Utilities.formatDate(new Date(),tz,'yyyyMMdd_HHmmss');
  let name=('BK_ADMIN_'+source+'_S'+week+'_'+stamp).slice(0,100);
  if(ss.getSheetByName(name)) name=(name.slice(0,94)+'_'+Math.floor(Math.random()*99999)).slice(0,100);
  const sh=ss.insertSheet(name);
  const values=[headers].concat(rows);
  sh.getRange(1,1,values.length,headers.length).setValues(values);
  sh.setFrozenRows(1);
}

function digestMatrix_(rows) {
  const text = JSON.stringify(rows || []);
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return bytes.map(b => ('0' + ((b < 0 ? b + 256 : b).toString(16))).slice(-2)).join('');
}

function rewriteSheet_(sh, headers, rows) {
  const needed=Math.max(1,rows.length+1);
  if(sh.getMaxRows()<needed) sh.insertRowsAfter(sh.getMaxRows(),needed-sh.getMaxRows());
  if(sh.getMaxColumns()<headers.length) sh.insertColumnsAfter(sh.getMaxColumns(),headers.length-sh.getMaxColumns());
  sh.getRange(1,1,sh.getMaxRows(),headers.length).clearContent();
  sh.getRange(1,1,1,headers.length).setValues([headers]);
  if(rows.length) sh.getRange(2,1,rows.length,headers.length).setValues(rows);
  sh.setFrozenRows(1);
}

function logOperation_(ss, x) {
  let sh=ss.getSheetByName(SHEETS.LOG);
  if(!sh){
    sh=ss.insertSheet(SHEETS.LOG);
    sh.appendRow(['fecha_hora','usuario','accion','semana','corte','periodo','archivo','registros_antes','registros_nuevos','resultado','detalle','id_operacion']);
    sh.setFrozenRows(1);
  }
  sh.appendRow([new Date(),x.usuario||'',x.accion||'',x.semana||'',x.corte||'',x.periodo||'',x.archivo||'',x.registros_antes||0,x.registros_nuevos||0,x.resultado||'',x.detalle||'',x.id_operacion||Utilities.getUuid()]);
}
function logFailure_(session, action, week, fileName, err){
  logOperation_(getSS_(),{usuario:session.username,accion:action,semana:week||'',corte:'',periodo:'',archivo:fileName||'',registros_antes:0,registros_nuevos:0,resultado:'ERROR',detalle:String(err&&err.message?err.message:err),id_operacion:Utilities.getUuid()});
}


/* ========================= ADMINISTRACIÓN DE RESPALDOS ========================= */
function backupInfoFromSheet_(sh) {
  const name=String(sh.getName()||'');
  if(!/^BK_ADMIN_/.test(name)) return null;
  const m=name.match(/^BK_ADMIN_(.+)_S(\d+)_(\d{8})_(\d{6})(?:_.+)?$/);
  let source='', week='', stamp='', created='';
  if(m){
    source=m[1]; week=Number(m[2]); stamp=m[3]+'_'+m[4];
    const d=m[3], t=m[4];
    created=d.slice(6,8)+'/'+d.slice(4,6)+'/'+d.slice(0,4)+' '+t.slice(0,2)+':'+t.slice(2,4)+':'+t.slice(4,6);
  }else if(/^BK_ADMIN_DIARIOS_(\d{8})_(\d{6})(?:_.+)?$/.test(name)){
    const dm=name.match(/^BK_ADMIN_DIARIOS_(\d{8})_(\d{6})/);
    source='DIARIOS'; stamp=dm[1]+'_'+dm[2];
    created=dm[1].slice(6,8)+'/'+dm[1].slice(4,6)+'/'+dm[1].slice(0,4)+' '+dm[2].slice(0,2)+':'+dm[2].slice(2,4)+':'+dm[2].slice(4,6);
  }else{
    const wm=name.match(/_S(\d+)_/); week=wm?Number(wm[1]):'';
    source=name.replace(/^BK_ADMIN_/,'').replace(/_S\d+_.+$/,'');
  }
  return {
    name:name,
    source:source,
    week:week,
    created:created,
    rows:Math.max(0,sh.getLastRow()-1),
    columns:sh.getLastColumn()
  };
}
function listBackups_(session){
  requireAdmin_(session);
  const ss=getSS_();
  const backups=ss.getSheets().map(backupInfoFromSheet_).filter(Boolean);
  backups.sort((a,b)=>{
    const wa=Number(a.week)||0, wb=Number(b.week)||0;
    if(wb!==wa) return wb-wa;
    return String(b.name).localeCompare(String(a.name));
  });
  const weeks=[...new Set(backups.map(x=>Number(x.week)).filter(Number.isFinite))].sort((a,b)=>b-a);
  return {ok:true,backups:backups,weeks:weeks,total:backups.length,api_version:API_VERSION};
}
function deleteBackups_(payload,session){
  requireAdmin_(session);
  const names=Array.isArray(payload.names)?payload.names.map(x=>String(x||'').trim()).filter(Boolean):[];
  if(!names.length) throw new Error('Selecciona al menos un respaldo para eliminar.');
  if(names.length>200) throw new Error('Demasiados respaldos seleccionados en una sola operación.');

  const lock=LockService.getScriptLock();
  lock.waitLock(30000);
  try{
    const ss=getSS_();
    const deleted=[], missing=[];
    names.forEach(name=>{
      if(!/^BK_ADMIN_/.test(name)) throw new Error('Hoja no permitida: '+name);
      const sh=ss.getSheetByName(name);
      if(!sh){ missing.push(name); return; }
      const info=backupInfoFromSheet_(sh);
      if(!info) throw new Error('La hoja seleccionada no es un respaldo administrativo: '+name);
      ss.deleteSheet(sh);
      deleted.push(info);
    });
    logOperation_(ss,{
      usuario:session.username,
      accion:'ELIMINAR_RESPALDOS',
      semana:'',
      resultado:'OK',
      registros_antes:deleted.length,
      registros_nuevos:0,
      detalle:'Respaldos eliminados: '+deleted.map(x=>x.name).join(' | ')+(missing.length?' · No encontrados: '+missing.join(' | '):''),
      id_operacion:Utilities.getUuid()
    });
    return {ok:true,deleted:deleted,missing:missing,total_deleted:deleted.length,api_version:API_VERSION};
  } finally {
    lock.releaseLock();
  }
}

/* ========================= ADMINISTRACIÓN DE USUARIOS ========================= */
function ensureUserHeaders_(sh) {
  const vals=sh.getDataRange().getValues();
  let h=vals.length ? vals[0].map(x=>String(x||'').trim()) : [];
  const required=['username','password','role','nombre','estado'];
  required.forEach(x=>{ if(!h.includes(x)){ h.push(x); sh.getRange(1,h.length).setValue(x); } });
  return h;
}
function readObjectsFromSS_(ss, sheetName){
  const sh=mustSheet_(ss,sheetName);
  const lastRow=sh.getLastRow(), lastCol=sh.getLastColumn();
  if(lastRow<1 || lastCol<1) return [];
  const values=sh.getRange(1,1,lastRow,lastCol).getValues();
  const headers=values[0].map(h=>String(h||'').trim());
  return values.slice(1).filter(row=>row.some(v=>v!==''&&v!=null)).map(row=>{
    const o={}; headers.forEach((h,i)=>{if(h)o[h]=normalizeCell_(row[i]);}); return o;
  });
}
function userRowsRaw_(ss){
  const sh=mustSheet_(ss,SHEETS.USUARIOS);
  ensureUserHeaders_(sh);
  return readObjectsFromSS_(ss,SHEETS.USUARIOS);
}
function personKey_(v){
  return upper_(v)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'')
    .replace(/[^A-Z0-9]/g,'');
}
function isCurrentStaffRow_(r){
  const est=upper_(r.estatus || r.ESTATUS || 'ACTIVO');
  return !['BAJA','INACTIVO','INACTIVA'].includes(est);
}
function latestWeek_(ss){
  const cortes=readObjectsFromSS_(ss,SHEETS.CORTES);
  const weeks=cortes.map(r=>Number(r.SEMANA!=null?r.SEMANA:r.semana)).filter(Number.isFinite);
  if(weeks.length) return Math.max.apply(null,weeks);

  const all=[];
  [SHEETS.EJECUTIVO,SHEETS.COORDINADOR,SHEETS.GERENTE,SHEETS.REGIONAL].forEach(sn=>{
    readObjectsFromSS_(ss,sn).forEach(r=>{
      const w=Number(r.semana!=null?r.semana:r.SEMANA);
      if(Number.isFinite(w)) all.push(w);
    });
  });
  if(!all.length) return 1;
  return Math.max.apply(null,all);
}
function latestWeekCandidates_(ss){
  const week=latestWeek_(ss);
  const out=[];
  const add=(role,nombre,region,agencia)=>{
    nombre=upper_(nombre);
    if(!nombre || nombre==='-') return;
    out.push({role:role,nombre:nombre,region:upper_(region),agencia:upper_(agencia),semana:week});
  };
  const sameWeek=r=>Number(r.semana!=null?r.semana:r.SEMANA)===week;

  readObjectsFromSS_(ss,SHEETS.EJECUTIVO)
    .filter(r=>sameWeek(r) && isCurrentStaffRow_(r))
    .forEach(r=>add('ejecutivo',r.ejecutivo,r.region,r.agencia));

  readObjectsFromSS_(ss,SHEETS.COORDINADOR)
    .filter(r=>sameWeek(r) && isCurrentStaffRow_(r))
    .forEach(r=>add('coordinador',r.empleado,r.region,r.agencia));

  readObjectsFromSS_(ss,SHEETS.GERENTE)
    .filter(r=>sameWeek(r) && isCurrentStaffRow_(r))
    .forEach(r=>add('gerente',r.empleado,r.region,r.agencia));

  readObjectsFromSS_(ss,SHEETS.REGIONAL)
    .filter(r=>sameWeek(r) && isCurrentStaffRow_(r))
    .forEach(r=>add('regional',r.empleado,r.region,''));

  const seen=new Set();
  const rows=out.filter(x=>{
    const k=x.role+'|'+personKey_(x.nombre)+'|'+x.region+'|'+x.agencia;
    if(seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return {week:week,rows:rows};
}
function adminUsers_(session){
  const started = Date.now();
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  const ush = ss.getSheetByName('USUARIOS');
  if (!ush) throw new Error('No existe la hoja USUARIOS en el spreadsheet configurado.');

  const lastRow = ush.getLastRow();
  const lastCol = Math.max(5, ush.getLastColumn());
  const values = lastRow >= 1 ? ush.getRange(1,1,lastRow,lastCol).getValues() : [];
  const headers = values.length ? values[0].map(x=>String(x||'').trim().toLowerCase()) : [];
  const ui = headers.indexOf('username');
  const ri = headers.indexOf('role');
  const ni = headers.indexOf('nombre');
  const ei = headers.indexOf('estado');

  if (ui < 0 || ri < 0 || ni < 0) {
    throw new Error('USUARIOS debe contener al menos username, role y nombre.');
  }

  const users = values.slice(1)
    .filter(r => String(r[ui]||'').trim() !== '')
    .map(r => ({
      username: String(r[ui]||'').trim(),
      role: lower_(r[ri]),
      nombre: upper_(r[ni]),
      estado: ei >= 0 ? lower_(r[ei]||'activo') : 'activo'
    }))
    .sort((a,b)=>a.nombre.localeCompare(b.nombre));

  // El pendiente se calcula contra la ÚLTIMA SEMANA cargada, no contra los SCOPE históricos.
  // Se compara por ROL + NOMBRE normalizado para soportar promociones/cambios de rol y diferencias de acentos.
  const existingRolePerson = new Set(
    users.map(u=>lower_(u.role)+'|'+personKey_(u.nombre)).filter(k=>k.indexOf('|')>0)
  );
  const current = mergeDailyCandidates_(ss,latestWeekCandidates_(ss));
  const byPerson = {};

  current.rows.forEach(c=>{
    const kRolePerson=c.role+'|'+personKey_(c.nombre);
    if(existingRolePerson.has(kRolePerson)) return;
    if(!byPerson[kRolePerson]) byPerson[kRolePerson]={role:c.role,nombre:c.nombre,scopes:[],semana:current.week};
    const sk=c.region+'|'+c.agencia;
    if(!byPerson[kRolePerson]._scopeKeys) byPerson[kRolePerson]._scopeKeys={};
    if(!byPerson[kRolePerson]._scopeKeys[sk]){
      byPerson[kRolePerson]._scopeKeys[sk]=true;
      byPerson[kRolePerson].scopes.push({region:c.region,agencia:c.agencia});
    }
  });

  const pending=Object.values(byPerson).map(x=>{
    delete x._scopeKeys;
    return x;
  }).sort((a,b)=>a.nombre.localeCompare(b.nombre));

  const counts={ejecutivo:0,coordinador:0,gerente:0,regional:0};
  pending.forEach(p=>{if(counts[p.role]!=null) counts[p.role]++;});

  return {
    ok:true,
    pending:pending,
    users:users,
    diagnostics:{
      spreadsheet_id:SPREADSHEET_ID,
      semana_actual:current.week,
      usuarios_detectados:users.length,
      candidatos_semana_actual:current.rows.length,
      pendientes_detectados:pending.length,
      pendientes_por_rol:counts,
      elapsed_ms:Date.now()-started
    },
    api_version:API_VERSION
  };
}
function generateUsername_(nombre, existing){
  const parts=upper_(nombre).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z ]/g,'').split(/\s+/).filter(Boolean);
  let base=((parts[0]||'u')[0]||'u')+(parts[parts.length-1]||'usuario'); base=base.slice(0,18);
  let x=base,n=1; while(existing.has(x)){x=base+n;n++;} existing.add(x); return x;
}
function generatePassword_(){ return 'mcm'+String(Math.floor(100000+Math.random()*900000)); }
function appendScopeIfMissing_(ss, role, nombre, region, agencia){
  const map={ejecutivo:[SHEETS.SCOPE_EJECUTIVO,'ejecutivo'],coordinador:[SHEETS.SCOPE_COORDINADOR,'coordinador'],gerente:[SHEETS.SCOPE_GERENTE,'gerente'],regional:[SHEETS.SCOPE_REGIONAL,'regional']};
  const cfg=map[role]; if(!cfg)return false; const sh=mustSheet_(ss,cfg[0]); const vals=sh.getDataRange().getValues(); const h=vals[0].map(x=>String(x||'').trim());
  const ni=findHeader_(h,[cfg[1]]), ri=findHeader_(h,['region']), ai=role==='regional'?-1:findHeader_(h,['agencia']);
  const exists=vals.slice(1).some(r=>upper_(r[ni])===upper_(nombre)&&upper_(r[ri])===upper_(region)&&(ai<0||upper_(r[ai])===upper_(agencia)));
  if(exists)return false; const row=h.map(()=> ''); row[ni]=upper_(nombre);row[ri]=upper_(region);if(ai>=0)row[ai]=upper_(agencia); sh.appendRow(row); return true;
}
function approveUsers_(payload, session){
  const items=Array.isArray(payload.users)?payload.users:[]; if(!items.length)throw new Error('Selecciona al menos un usuario pendiente.');
  const ss=getSS_(), sh=mustSheet_(ss,SHEETS.USUARIOS), h=ensureUserHeaders_(sh), existingRows=userRowsRaw_(ss), existingNames=new Set(existingRows.map(u=>upper_(u.nombre))), usernames=new Set(existingRows.map(u=>lower_(u.username)));
  const created=[];
  items.forEach(it=>{ const role=lower_(it.role), nombre=upper_(it.nombre); if(!['ejecutivo','coordinador','gerente','regional'].includes(role)||!nombre||existingNames.has(nombre))return;
    const username=generateUsername_(nombre,usernames), password=generatePassword_(); const row=h.map(()=> '');
    row[h.indexOf('username')]=username;row[h.indexOf('password')]=password;row[h.indexOf('role')]=role;row[h.indexOf('nombre')]=nombre;row[h.indexOf('estado')]='activo'; sh.appendRow(row); existingNames.add(nombre);
    (Array.isArray(it.scopes)?it.scopes:[]).forEach(sc=>appendScopeIfMissing_(ss,role,nombre,sc.region||'',sc.agencia||'')); created.push({username,password,role,nombre});
  });
  logOperation_(ss,{usuario:session.username,accion:'ALTA_USUARIOS',resultado:'OK',detalle:'Usuarios autorizados: '+created.length,id_operacion:Utilities.getUuid()});
  return {ok:true,created:created};
}
function resetPassword_(payload, session){
  const username=lower_(payload.username); if(!username)throw new Error('Usuario requerido.'); const ss=getSS_(), sh=mustSheet_(ss,SHEETS.USUARIOS), h=ensureUserHeaders_(sh), vals=sh.getDataRange().getValues();
  const ui=h.indexOf('username'), pi=h.indexOf('password'); let row=-1; for(let i=1;i<vals.length;i++)if(lower_(vals[i][ui])===username){row=i+1;break;} if(row<0)throw new Error('Usuario no encontrado.');
  const pw=String(payload.password||'').trim()||generatePassword_(); if(pw.length<6)throw new Error('La contraseña debe tener al menos 6 caracteres.'); sh.getRange(row,pi+1).setValue(pw);
  logOperation_(ss,{usuario:session.username,accion:'RESET_PASSWORD',resultado:'OK',detalle:'Usuario: '+username,id_operacion:Utilities.getUuid()}); return {ok:true,username:username,password:pw};
}
function updateUser_(payload,session){
 requireAdmin_(session);
 const username=lower_(payload.username),role=lower_(payload.role),estado=lower_(payload.estado||'activo');
 if(!username)throw new Error('Usuario requerido.');
 if(!['ejecutivo','coordinador','gerente','regional','directivo','direccion','admin'].includes(role))throw new Error('Rol inválido.');
 if(!['activo','inactivo'].includes(estado))throw new Error('Estado inválido.');
 const lock=LockService.getScriptLock();lock.waitLock(30000);
 try{
   const ss=getSS_(),sh=mustSheet_(ss,SHEETS.USUARIOS),h=ensureUserHeaders_(sh),vals=sh.getDataRange().getValues();
   const ui=h.indexOf('username'),ri=h.indexOf('role'),ei=h.indexOf('estado'),ni=h.indexOf('nombre');
   const ix=vals.findIndex((r,i)=>i>0&&lower_(r[ui])===username);if(ix<0)throw new Error('Usuario no encontrado.');
   const nombre=upper_(vals[ix][ni]);
   const users=vals.slice(1).map(r=>({username:r[ui],role:r[ri],estado:r[ei],nombre:r[ni]}));
   const cfg={ejecutivo:SHEETS.SCOPE_EJECUTIVO,coordinador:SHEETS.SCOPE_COORDINADOR,gerente:SHEETS.SCOPE_GERENTE,regional:SHEETS.SCOPE_REGIONAL};
   const tables={},sheets={};Object.keys(cfg).forEach(r=>{sheets[r]=mustSheet_(ss,cfg[r]);tables[r]=sheets[r].getDataRange().getValues();});
   const candidates=estado==='activo'&&['ejecutivo','coordinador','gerente','regional'].includes(role)?latestWeekCandidates_(ss).rows:[];
   const plan=mcmRoleScopePlan_(tables,users,username,nombre,role,estado,candidates);
   // Revocar antes de escribir: las sesiones no reutilizan permisos mientras
   // se aplica el cambio. Incluye otras cuentas de la misma persona.
   const revokedUsernames=users.filter(u=>personKey_(u.nombre)===personKey_(nombre)).map(u=>lower_(u.username));
   const properties=PropertiesService.getScriptProperties();
   revokedUsernames.forEach(u=>properties.setProperty('MCM_USER_REV:'+u,Utilities.getUuid()));
   const write=(s,data)=>{s.getDataRange().clearContent();s.getRange(1,1,data.length,data[0].length).setValues(data);};
   const oldRole=vals[ix][ri],oldEstado=vals[ix][ei];
   try{
     Object.keys(cfg).forEach(r=>write(sheets[r],plan.tables[r]));
     sh.getRange(ix+1,ri+1).setValue(role);sh.getRange(ix+1,ei+1).setValue(estado);
     SpreadsheetApp.flush();
   }catch(err){
     const recovery=[];
     Object.keys(cfg).forEach(r=>{try{write(sheets[r],tables[r]);}catch(e){recovery.push(cfg[r]);}});
     try{sh.getRange(ix+1,ri+1).setValue(oldRole);sh.getRange(ix+1,ei+1).setValue(oldEstado);SpreadsheetApp.flush();}catch(e){recovery.push('USUARIOS');}
     if(recovery.length)throw new Error('No se pudo completar el cambio ni restaurar '+recovery.join(', ')+'. Revisar respaldo. '+err.message);
     throw new Error('Cambio cancelado; se restauraron usuario y scopes. '+err.message);
   }
   let auditWarning='';
   try{logOperation_(ss,{usuario:session.username,accion:'MODIFICAR_USUARIO',resultado:'OK',detalle:username+' · '+role+' · '+estado+' · scopes vigentes: '+plan.scopes,id_operacion:Utilities.getUuid()});}catch(e){auditWarning=' No se pudo escribir la bitácora.';}
   return {ok:true,scopes_updated:true,scope_count:plan.scopes,session_revoked:true,revoked_usernames:revokedUsernames,shared_roles:plan.shared_roles,message:'Rol, estado y scopes actualizados. El usuario debe ingresar de nuevo.'+(plan.shared_roles.length?' Hay otras cuentas activas de esta persona; se conservaron los permisos que necesitan.':'')+auditWarning};
 }finally{lock.releaseLock();}
}

function batchAppendScopes_(ss, role, candidates){
  const map={
    ejecutivo:[SHEETS.SCOPE_EJECUTIVO,'ejecutivo'],
    coordinador:[SHEETS.SCOPE_COORDINADOR,'coordinador'],
    gerente:[SHEETS.SCOPE_GERENTE,'gerente'],
    regional:[SHEETS.SCOPE_REGIONAL,'regional']
  };
  const cfg=map[role];
  if(!cfg) return 0;

  const sh=mustSheet_(ss,cfg[0]);
  const vals=sh.getDataRange().getValues();
  if(!vals.length) return 0;

  const h=vals[0].map(x=>String(x||'').trim());
  const ni=findHeader_(h,[cfg[1]]);
  const ri=findHeader_(h,['region']);
  const ai=role==='regional' ? -1 : findHeader_(h,['agencia']);

  if(ni<0 || ri<0 || (role!=='regional' && ai<0)){
    throw new Error('Encabezados inválidos en '+cfg[0]);
  }

  const keyOf=(nombre,region,agencia)=>
    upper_(nombre)+'|'+upper_(region)+'|'+(ai<0?'':upper_(agencia));

  const existing=new Set(
    vals.slice(1)
      .filter(r=>String(r[ni]||'').trim())
      .map(r=>keyOf(r[ni],r[ri],ai<0?'':r[ai]))
  );

  const pending=[];
  const pendingKeys=new Set();

  (candidates||[]).forEach(c=>{
    const nombre=upper_(c.nombre);
    const region=upper_(c.region);
    const agencia=ai<0?'':upper_(c.agencia);
    if(!nombre || nombre==='-') return;

    const k=keyOf(nombre,region,agencia);
    if(existing.has(k) || pendingKeys.has(k)) return;

    const row=h.map(()=> '');
    row[ni]=nombre;
    row[ri]=region;
    if(ai>=0) row[ai]=agencia;
    pending.push(row);
    pendingKeys.add(k);
  });

  if(pending.length){
    sh.getRange(sh.getLastRow()+1,1,pending.length,h.length).setValues(pending);
  }
  return pending.length;
}

function syncScopesFromIndicatorRows_(ss, rows){
  const ejecutivos=[];
  const coordinadores=[];

  (rows||[]).forEach(r=>{
    if(r.ejecutivo){
      ejecutivos.push({nombre:r.ejecutivo,region:r.region,agencia:r.agencia});
    }
    if(r.coordinador && r.coordinador!=='-'){
      coordinadores.push({nombre:r.coordinador,region:r.region,agencia:r.agencia});
    }
  });

  const e=batchAppendScopes_(ss,'ejecutivo',ejecutivos);
  const c=batchAppendScopes_(ss,'coordinador',coordinadores);
  return {ejecutivo:e,coordinador:c,total:e+c};
}

function sheetObjects_(sh){
  const m=sh.getDataRange().getValues();
  if(!m.length)return [];
  const h=m[0].map(x=>String(x||'').trim());
  return m.slice(1).filter(r=>r.some(v=>v!==''&&v!=null)).map(r=>{
    const o={}; h.forEach((k,i)=>o[lower_(k)]=r[i]); return o;
  });
}

function syncAllScopesSafe_(ss, weekRows){
  // Sincronización ADITIVA EN BLOQUE: no elimina scopes históricos/manuales.
  const out={ejecutivo:0,coordinador:0,gerente:0,regional:0,total:0};

  const base=syncScopesFromIndicatorRows_(ss,weekRows||[]);
  const latest=latestWeek_(ss);
  const fresh=readObjectsFromSS_(ss,SHEETS.EJECUTIVO).filter(r=>Number(r.semana)===latest && isCurrentStaffRow_(r));
  base.ejecutivo+=batchAppendScopes_(ss,'ejecutivo',fresh.map(r=>({nombre:r.ejecutivo,region:r.region,agencia:r.agencia})));
  const freshCoord=readObjectsFromSS_(ss,SHEETS.COORDINADOR).filter(r=>Number(r.semana)===latest && isCurrentStaffRow_(r));
  base.coordinador+=batchAppendScopes_(ss,'coordinador',freshCoord.map(r=>({nombre:r.empleado,region:r.region,agencia:r.agencia})));
  out.ejecutivo=Number(base.ejecutivo||0);
  out.coordinador=Number(base.coordinador||0);

  const gerentes=sheetObjects_(mustSheet_(ss,SHEETS.GERENTE)).filter(r=>Number(r.semana)===latest && isCurrentStaffRow_(r)).map(r=>({
    nombre:r.empleado||r.gerente||'',
    region:r.region||'',
    agencia:r.agencia||''
  }));
  const regionales=sheetObjects_(mustSheet_(ss,SHEETS.REGIONAL)).filter(r=>Number(r.semana)===latest && isCurrentStaffRow_(r)).map(r=>({
    nombre:r.empleado||r.regional||'',
    region:r.region||'',
    agencia:''
  }));

  out.gerente=batchAppendScopes_(ss,'gerente',gerentes);
  out.regional=batchAppendScopes_(ss,'regional',regionales);
  out.total=out.ejecutivo+out.coordinador+out.gerente+out.regional;
  return out;
}


/* ========================= SCOPES / LECTURA DASHBOARD ========================= */
function scopeRows_(rows, role, nombre) {
  if (role==='directivo'||role==='direccion'||role==='admin') return rows;
  if (role==='ejecutivo') return rows.filter(r=>upper_(r.ejecutivo)===nombre);
  if (role==='coordinador') {
    const scope=readObjects_(SHEETS.SCOPE_COORDINADOR).filter(r=>upper_(r.coordinador)===nombre);
    const allowed=new Set(scope.map(r=>upper_(r.region)+'|'+upper_(r.agencia)));
    return rows.filter(r=>allowed.has(upper_(r.region)+'|'+upper_(r.agencia)));
  }
  if (role==='gerente') {
    const scope=readObjects_(SHEETS.SCOPE_GERENTE).filter(r=>upper_(r.gerente)===nombre);
    const allowed=new Set(scope.map(r=>upper_(r.region)+'|'+upper_(r.agencia)));
    return rows.filter(r=>allowed.has(upper_(r.region)+'|'+upper_(r.agencia)));
  }
  if (role==='regional') {
    const scope=readObjects_(SHEETS.SCOPE_REGIONAL).filter(r=>upper_(r.regional)===nombre);
    const allowed=new Set(scope.map(r=>upper_(r.region)));
    return rows.filter(r=>allowed.has(upper_(r.region)));
  }
  return [];
}

function getDirectorioComisiones_(role,nombre){
  // Equivale exactamente al 'return []' que esta función ya devolvía al final para el resto de roles (p. ej. ejecutivo,
  // que ve sus datos desde la hoja EJECUTIVO). Si algún día el ejecutivo debe recibir filas del directorio, quitar esta línea.
  if(['admin','directivo','direccion','regional','gerente','coordinador'].indexOf(role)<0) return [];
  const ss=getSS_();
  let out=[];
  const pushRows=(sheetName, rolPersona)=>{
    normalizeNumericRows_(readObjectsFromSS_(ss,sheetName)).forEach(r=>{
      out.push({
        corte:num_(r.corte),
        region:r.region||'',
        agencia:r.agencia||'',
        empleado:r.empleado||r.ejecutivo||'',
        estatus:r.estatus||'',
        puesto:r.puesto||'',
        rol_persona:rolPersona,
        pagos_esperados:num_(r.pagos_esperados)||0,
        pagos_recibidos:num_(r.pagos_recibidos)||0,
        pct_normalidad:num_(r.pct_normalidad)||0,
        comision_cobranza:num_(r.comision_cobranza)||0,
        num_ejecutivos:num_(r.num_ejecutivos)||0,
        ejecutivos_productivos:num_(r.ejecutivos_productivos)||0,
        pct_productividad_equipo:num_(r.pct_productividad_equipo)||0,
        pct_comision_productividad:num_(r.pct_comision_productividad)||0,
        comision_productividad:num_(r.comision_productividad)||0,
        apoyo_familiar:num_(r.apoyo_familiar)||0,
        comision_modelo_tradicional:num_(r.comision_modelo_tradicional)||0,
        apoyo_economico:num_(r.apoyo_economico)||0,
        bono_mensual:num_(r.bono_mensual)||0,
        comision_mayor:num_(r.comision_mayor)||0,
        multas:num_(r.multas)||0,
        prestamo_capital_humano:num_(r.prestamo_capital_humano)||0,
        prestamo_caja_ahorro:num_(r.prestamo_caja_ahorro)||0,
        descuentos_prestamos:num_(r.descuentos_prestamos)||0,
        incentivo_final:num_(r.incentivo_final)||0,
        retencion_caja_ahorro:num_(r.retencion_caja_ahorro)||0,
        retroactivos_otros_apoyos:num_(r.retroactivos_otros_apoyos)||0,
        total_a_cobrar:num_(r.total_a_cobrar)||0
      });
    });
  };
  out=cachedRead_('DIRECTORIO', () => {
    pushRows(SHEETS.COORDINADOR,'coordinador');
    pushRows(SHEETS.GERENTE,'gerente');
    pushRows(SHEETS.REGIONAL,'regional');
    return out;
  });

  if(role==='admin'||role==='directivo'||role==='direccion') return out;
  nombre=upper_(nombre);
  if(role==='regional'){
    const allowed=new Set(readObjectsFromSS_(ss,SHEETS.SCOPE_REGIONAL).filter(r=>upper_(r.regional)===nombre).map(r=>upper_(r.region)));
    return out.filter(r=>allowed.has(upper_(r.region)));
  }
  if(role==='gerente'){
    const allowed=new Set(readObjectsFromSS_(ss,SHEETS.SCOPE_GERENTE).filter(r=>upper_(r.gerente)===nombre).map(r=>upper_(r.region)+'|'+upper_(r.agencia)));
    return out.filter(r=>allowed.has(upper_(r.region)+'|'+upper_(r.agencia)) || (r.rol_persona==='regional' && allowed.has(upper_(r.region)+'|')));
  }
  if(role==='coordinador'){
    const allowed=new Set(readObjectsFromSS_(ss,SHEETS.SCOPE_COORDINADOR).filter(r=>upper_(r.coordinador)===nombre).map(r=>upper_(r.region)+'|'+upper_(r.agencia)));
    return out.filter(r=>allowed.has(upper_(r.region)+'|'+upper_(r.agencia)));
  }
  return [];
}

function getNivelPropio_(role,nombre){
  let sheetName=null;
  if(role==='coordinador')sheetName=SHEETS.COORDINADOR;
  if(role==='gerente')sheetName=SHEETS.GERENTE;
  if(role==='regional')sheetName=SHEETS.REGIONAL;
  if(!sheetName)return [];
  return normalizeNumericRows_(readObjects_(sheetName)).filter(r=>upper_(r.empleado)===nombre).sort((a,b)=>(a.corte||0)-(b.corte||0));
}

function readObjects_(sheetName){
  const sh=mustSheet_(getSS_(),sheetName), values=sh.getDataRange().getValues();
  if(!values.length)return [];
  const headers=values[0].map(h=>String(h||'').trim());
  return values.slice(1).filter(row=>row.some(v=>v!==''&&v!=null)).map(row=>{const o={};headers.forEach((h,i)=>{if(h)o[h]=normalizeCell_(row[i]);});return o;});
}
function normalizeCell_(v){return v instanceof Date?serialDate_(v):v;}
function serialDate_(d){return Math.floor((Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())-Date.UTC(1899,11,30))/86400000);}

function normalizeNumericRows_(rows){
  const numeric=new Set(['mes','semana','corte','pagos_esperados','pagos_recibidos','pct_normalidad','monto_esperado','monto_recibido','monto_recibido_esperado','monto_recibido_no_esperado','cobranza_total','comision_cobranza','bono_excelencia','cobranza_credito_adicional','comision_cobranza_adicional','comision_cartera_heredada','recuperacion_cartera_heredada','clientes_nuevos','clientes_en_tiempo','clientes_tardias','total_clientes','monto_nuevos','monto_en_tiempo','monto_tardias','monto_renovaciones','total_colocado','comision_colocacion_total','comision_colocacion_nuevos','comision_colocacion_tiempo','comision_colocacion_tardias','comision_apoyo_familiar','comision_modelo_tradicional','apoyo_economico','comision_modelo_ej_nuevo','bono_mensual','campanas','bono_crecimiento_neto','multas','penalizacion_traspaso','penalizacion_decremento','prestamo_capital_humano','prestamo_caja_ahorro','descuentos_prestamos','comision_final','retencion_caja_ahorro','retroactivos_otros_apoyos','total_a_cobrar','num_creditos','cartera_meta','pagare','pct_productividad','productivo','clientes_vigentes','saldo_capital','saldo_total','mora_capital','mora_total','dias_mora_prom','desembolso','colocacion_semanal','monto_colocacion_semanal','renovaciones','renov_tiempo','renov_tardia','num_ejecutivos','ejecutivos_productivos','pct_productividad_equipo','pct_comision_productividad','comision_productividad','incentivo_final','comision_mayor']);
  return rows.map(r=>{const o={};Object.keys(r).forEach(k=>{let v=r[k];if(numeric.has(String(k).trim())&&v!==''&&v!=null)v=num_(v);o[String(k).trim()]=v;});return o;});
}
function normalizeIndicadoresRows_(rows){return normalizeNumericRows_(rows).map(r=>{r.monto_nuevos=numOrZero_(r.monto_nuevos);r.monto_renovaciones=numOrZero_(r.monto_renovaciones);r.monto_nuevos_dashboard=r.monto_nuevos;r.monto_renovaciones_dashboard=r.monto_renovaciones;r.clientes_nuevos=numOrZero_(r.clientes_nuevos);r.renovaciones=numOrZero_(r.renovaciones);return r;});}

/* ========================= CACHÉ OPCIONAL DE HOJAS GRANDES ========================= */
function dataCacheVersion_(){ return CacheService.getScriptCache().get('dcver') || '0'; }
function bumpDataCache_(){ try{ CacheService.getScriptCache().put('dcver', String(Date.now()), 21600); }catch(_){} }
function cachedRead_(name, loader){
  if(!DATA_CACHE_ENABLED) return loader();
  const cache = CacheService.getScriptCache(), base = 'dc:'+name+':'+dataCacheVersion_();
  try{
    const n = Number(cache.get(base+':n')||0);
    if(n>0){
      const keys=[]; for(let i=0;i<n;i++) keys.push(base+':'+i);
      const got = cache.getAll(keys), parts=[];
      for(let i=0;i<n;i++){ const p=got[base+':'+i]; if(p==null){ parts.length=0; break; } parts.push(p); }
      if(parts.length===n) return JSON.parse(Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(parts.join('')),'application/x-gzip')).getDataAsString());
    }
  }catch(_){}
  const rows = loader();
  try{
    const b64 = Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(JSON.stringify(rows),'application/json')).getBytes());
    const CH=90000, n=Math.ceil(b64.length/CH), put={};
    for(let i=0;i<n;i++) put[base+':'+i]=b64.substr(i*CH,CH);
    put[base+':n']=String(n);
    cache.putAll(put, DATA_CACHE_TTL);
  }catch(_){}
  return rows;
}

/* ========================= REPORTES MENSUALES ========================= */
const REPORTES_VALIDOS = ['cobranza_mensual'];   // agregar aquí los ids de reportes futuros
// Quién puede CONSULTAR reportes. Por ahora solo dirección y administración (ven todo). Para que gerentes,
// coordinadores o regionales los vean, primero hay que definir qué parte de cada reporte le toca a cada rol.
const REPORTES_ROLES_CONSULTA = ['admin','directivo','direccion'];
const REPORTES_TROZO = 45000;                    // una celda admite ~50,000 caracteres
const REPORTES_MAX_TROZOS = 20;

function reportsSheet_(ss){
  let sh = ss.getSheetByName(SHEETS.REPORTES);
  if(!sh){
    sh = ss.insertSheet(SHEETS.REPORTES);
    sh.appendRow(['reporte','clave','etiqueta','actualizado','usuario','json (trozos en las columnas siguientes)']);
    // Todo como TEXTO: evita que Sheets convierta '2026-10' en fecha o un trozo que empiece con = o - en fórmula/número.
    sh.getRange(1,1,sh.getMaxRows(),sh.getMaxColumns()).setNumberFormat('@');
    sh.setFrozenRows(1);
    sh.hideSheet();
  }
  return sh;
}
function reportsCheckId_(payload){
  const id = String(payload.report||'').trim();
  if(REPORTES_VALIDOS.indexOf(id)<0) throw new Error('Reporte no reconocido: '+id);
  return id;
}
function reportsKey_(v){ return v instanceof Date ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM') : String(v==null?'':v); }
function reportsRows_(ss){
  const sh = reportsSheet_(ss), v = sh.getDataRange().getValues();
  return v.slice(1).map((r,i)=>({fila:i+2, vals:r})).filter(x=>x.vals[0]);
}
function reportsRead_(action, payload, session){
  const role = lower_(session.role);
  if(REPORTES_ROLES_CONSULTA.indexOf(role)<0) throw new Error('Tu perfil no tiene acceso a reportes.');
  const id = reportsCheckId_(payload), ss = getSS_();
  if(id==='cobranza_mensual') return action==='report_list' ? nrmList_(ss) : (action==='report_diagnose' ? nrmDiagnose_(ss) : nrmGet_(ss, payload));
  const rows = reportsRows_(ss).filter(x=>String(x.vals[0])===id);
  if(action==='report_list'){
    const items = rows.map(x=>({key:reportsKey_(x.vals[1]), label:String(x.vals[2]||reportsKey_(x.vals[1])), updated:x.vals[3] instanceof Date ? x.vals[3].toISOString() : String(x.vals[3]||'')}))
      .sort((a,b)=>b.key.localeCompare(a.key));
    return {ok:true, items:items, api_version:API_VERSION};
  }
  const key = String(payload.key||'').trim();
  const hit = rows.filter(x=>reportsKey_(x.vals[1])===key)[0];
  if(!hit) throw new Error('No existe el reporte de ese mes.');
  // cada trozo se guarda con el prefijo '|' (ver reportsWrite_) y se ignoran las celdas vacías
  const json = hit.vals.slice(5).map(v=>String(v==null?'':v)).filter(v=>v!=='').map(v=>v.charAt(0)==='|'?v.slice(1):v).join('');
  return {ok:true, key:key, data:JSON.parse(json), api_version:API_VERSION};
}
function reportsWrite_(action, payload, session){
  const id = reportsCheckId_(payload), key = String(payload.key||'').trim();
  if(id==='cobranza_mensual'){
    // El reporte de cobranza vive en la hoja NORMALIDAD (concentrado por ejecutivo y corte), no en REPORTES.
    if(action==='report_save') throw new Error('Para cobranza usa report_publish (escribe en la hoja NORMALIDAD).');
    return nrmWrite_(action, key, payload, session);
  }
  if(action==='report_publish') throw new Error('Este reporte no usa report_publish.');
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(key)) throw new Error('Clave de mes inválida (AAAA-MM).');
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try{
    const ss = getSS_(), sh = reportsSheet_(ss);
    const hit = reportsRows_(ss).filter(x=>String(x.vals[0])===id && reportsKey_(x.vals[1])===key)[0];
    if(action==='report_delete'){
      if(hit) sh.deleteRow(hit.fila);
      logOperation_(ss,{usuario:session.username,accion:'REPORT_DELETE',archivo:id+' '+key,resultado:'OK',detalle:hit?'eliminado':'no existía'});
      return {ok:true, deleted:!!hit, api_version:API_VERSION};
    }
    const d = payload.data;
    // Estructura del reporte de cobranza: un mes completo { month, regions[], agencies[], weeks[], weeklyRegion[], weeklyAgency[], total }
    if(!d || !Array.isArray(d.agencies) || !Array.isArray(d.regions) || !d.agencies.length || !d.regions.length) throw new Error('El reporte no trae agencias y regiones.');
    if(String(d.month||'')!==key) throw new Error('El mes del reporte ('+d.month+') no coincide con la clave '+key+'.');
    const text = JSON.stringify(d), trozos=[];
    for(let i=0;i<text.length;i+=REPORTES_TROZO) trozos.push(text.substr(i,REPORTES_TROZO));
    if(trozos.length>REPORTES_MAX_TROZOS) throw new Error('El reporte es demasiado grande.');
    const rec = [id, key, String(payload.label||key), new Date().toISOString(), String(session.username||'')].concat(trozos.map(t=>'|'+t));
    if(hit){
      sh.getRange(hit.fila,1,1,Math.max(sh.getMaxColumns(),rec.length)).clearContent();
      if(sh.getMaxColumns()<rec.length) sh.insertColumnsAfter(sh.getMaxColumns(), rec.length-sh.getMaxColumns());
      sh.getRange(hit.fila,1,1,rec.length).setValues([rec]);
    }else{
      if(sh.getMaxColumns()<rec.length) sh.insertColumnsAfter(sh.getMaxColumns(), rec.length-sh.getMaxColumns());
      sh.appendRow(rec);
    }
    logOperation_(ss,{usuario:session.username,accion:'REPORT_SAVE',archivo:id+' '+key,registros_antes:hit?1:0,registros_nuevos:Number(d.rows)||(d.agencies.length+d.regions.length),resultado:'OK',detalle:(hit?'reemplazado':'nuevo')+' · '+text.length+' caracteres'});
    return {ok:true, key:key, replaced:!!hit, api_version:API_VERSION};
  } finally { lock.releaseLock(); }
}


/* ========================= NORMALIDAD: reporte "Cobranza por pago mensual" ========================= */
// La hoja NORMALIDAD es el concentrado: una fila por ejecutivo y corte semanal. Puede traer DOS columnas de fecha:
//   · CORTE SEMANAL (una fecha por semana: 4 o 5 por mes)  -> es la que mueve las gráficas semanales
//   · CORTE MES / CORTE (una sola fecha por mes, p. ej. 26-sep) -> dice a qué mes pertenece la fila
// Si solo hay una columna de fecha, el mes se deduce de la semana (miércoles de esa semana).
// Al publicar un mes se REEMPLAZAN solo las filas de ese mes (las anteriores se respaldan en BK_ADMIN_NORMALIDAD_...).
// Las columnas se ubican por el nombre del encabezado, no por posición.
const NRM_COLS = {region:'REGION', agency:'AGENCIA', ejecutivo:'EJECUTIVO', esp:'ESPERADO', rec:'RECIBIDO', pct:'%',
  amtE:'$ ESPERADA', amtR:'$ RECIBIDA', amtER:'$ ESPERADA RECIBIDA', amtNE:'$ RECIBIDA NO ESPERADA'};
const NRM_REQUIRED = ['region','agency','ejecutivo','esp','rec','amtE','amtER','amtNE'];
const NRM_MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

function nrmCanon_(v){ return String(v==null?'':v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/\s+/g,' ').trim(); }
// Mes al que pertenece un corte semanal cuando NO hay columna de corte mensual: el mes del miércoles de esa semana.
function nrmMonthKey_(iso){
  const d=new Date(iso+'T00:00:00Z'); const dow=(d.getUTCDay()+6)%7;   // lunes=0
  d.setUTCDate(d.getUTCDate()-dow+2);
  return d.toISOString().slice(0,7);
}
function nrmISO_(v, tz){
  if(v instanceof Date && !isNaN(v)) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  if(typeof v==='number' && v>20000 && v<80000) return new Date(Math.round((v-25569)*864e5)).toISOString().slice(0,10);
  if(typeof v==='string'){
    const a=/^(\d{4})-(\d{2})-(\d{2})/.exec(v.trim()); if(a) return a[1]+'-'+a[2]+'-'+a[3];
    const b=/^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(v.trim()); if(b) return b[3]+'-'+('0'+b[2]).slice(-2)+'-'+('0'+b[1]).slice(-2);
  }
  return '';
}
function nrmAddDays_(iso, n){ const d=new Date(iso+'T00:00:00Z'); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10); }

function nrmLoad_(ss){
  const sh=ss.getSheetByName(SHEETS.NORMALIDAD); if(!sh) throw new Error('No existe la hoja NORMALIDAD.');
  const lastRow=sh.getLastRow(), lastCol=sh.getLastColumn(); if(lastRow<1||lastCol<1) throw new Error('La hoja NORMALIDAD está vacía.');
  const range=sh.getRange(1,1,lastRow,lastCol), values=range.getValues(), formulas=range.getFormulas();
  let hdr=-1, col={};
  for(let i=0;i<Math.min(values.length,30);i++){
    const m={}; values[i].forEach((h,j)=>{ const c=nrmCanon_(h); if(c && m[c]==null) m[c]=j; });
    if(m['REGION']!=null && m['AGENCIA']!=null && m['EJECUTIVO']!=null){ hdr=i; col=m; break; }
  }
  if(hdr<0) throw new Error('No encontré los encabezados REGION / AGENCIA / EJECUTIVO en la hoja NORMALIDAD.');
  const idx={}, missing=[];
  Object.keys(NRM_COLS).forEach(k=>{ const j=col[NRM_COLS[k]]; if(j==null){ if(NRM_REQUIRED.indexOf(k)>=0) missing.push(NRM_COLS[k]); } else idx[k]=j; });
  if(missing.length) throw new Error('Faltan columnas en NORMALIDAD: '+missing.join(', '));
  const tz=ss.getSpreadsheetTimeZone();
  // Columnas de fecha: encabezados tipo CORTE / SEMANA / FECHA / MES con fechas válidas en casi todas sus filas
  const cands=[];
  values[hdr].forEach((h,j)=>{ const c=nrmCanon_(h); if(c && /CORTE|SEMAN|\bSEM\b|FECHA|\bMES\b|MENSUAL/.test(c)) cands.push({header:String(h).trim(), c:c, j:j, set:{}, valid:0, total:0}); });
  for(let i=hdr+1;i<values.length;i++){
    const r=values[i], reg=r[idx.region], ej=r[idx.ejecutivo];
    if(typeof reg!=='string' || !reg.trim() || typeof ej!=='string' || !ej.trim()) continue;
    cands.forEach(cd=>{ const v=r[cd.j]; if(v===''||v==null) return; cd.total++; const d=nrmISO_(v, tz); if(d){ cd.valid++; cd.set[d]=1; } });
  }
  const dateCols=cands.filter(cd=>cd.valid>0 && cd.valid>=0.8*cd.total).map(cd=>{ cd.dates=Object.keys(cd.set).sort(); cd.n=cd.dates.length; return cd; });
  // SEMANAL: la que dice "semana/semanal"; si ninguna, la que tiene más fechas distintas (4 o 5 por mes)
  let weekly=dateCols.filter(cd=>/SEMAN|\bSEM\b/.test(cd.c)).sort((a,b)=>b.n-a.n)[0] || null;
  // Columna "semanal" que existe pero está VACÍA (p. ej. filas que dejó una versión anterior): se usa para escribir, y se lee el corte mensual como semana
  if(!weekly && dateCols.length){ const blank=cands.filter(cd=>cd.total===0 && /SEMAN|\bSEM\b/.test(cd.c))[0]; if(blank){ blank.dates=[]; blank.n=0; weekly=blank; } }
  if(!weekly){ dateCols.forEach(cd=>{ if(!weekly || cd.n>weekly.n || (cd.n===weekly.n && cd.c==='CORTE')) weekly=cd; }); }
  // MENSUAL: otra columna de fecha llamada MES / MENSUAL / CORTE
  let monthly=dateCols.filter(cd=>cd!==weekly && /\bMES\b|MENSUAL/.test(cd.c))[0] || dateCols.filter(cd=>cd!==weekly && cd.c==='CORTE')[0] || null;
  if(!weekly) throw new Error('No encontré una columna con fechas de corte semanal en NORMALIDAD.');
  idx.week=weekly.j; idx.month=monthly?monthly.j:null; idx.date=weekly.j;
  return {sh, values, formulas, hdr, idx, lastRow, lastCol, tz, dateCols, weekly:weekly.header, monthly:monthly?monthly.header:''};
}
// Fila de datos válida (región y ejecutivo) con fecha: devuelve {week:'AAAA-MM-DD', key:'AAAA-MM', cut:'AAAA-MM-DD'|''} o null
function nrmRow_(info, r){
  const reg=r[info.idx.region], ej=r[info.idx.ejecutivo];
  if(typeof reg!=='string' || !reg.trim() || typeof ej!=='string' || !ej.trim()) return null;
  const cut = info.idx.month!=null ? nrmISO_(r[info.idx.month], info.tz) : '';
  let week = nrmISO_(r[info.idx.week], info.tz); const hadWeek = !!week;
  if(!week) week = cut;                         // si la fila no trae corte semanal, se usa el mensual como única semana
  if(!week) return null;
  return {week:week, cut:cut, hadWeek:hadWeek, key: cut ? cut.slice(0,7) : nrmMonthKey_(week)};
}
function nrmDiagnose_(ss){
  const info=nrmLoad_(ss), cuts={}, rows={}; let total=0;
  for(let i=info.hdr+1;i<info.values.length;i++){
    const o=nrmRow_(info, info.values[i]); if(!o) continue;
    total++; rows[o.key]=(rows[o.key]||0)+1; (cuts[o.key]=cuts[o.key]||{})[o.week]=1;
  }
  return {ok:true, rows:total, header_row:info.hdr+1,
    headers:info.values[info.hdr].map(h=>String(h==null?'':h).trim()).filter(h=>h),
    date_columns:info.dateCols.map(c=>({header:c.header, distinct:c.n, first:c.dates[0], last:c.dates[c.n-1]})),
    chosen:info.weekly, weekly_column:info.weekly, monthly_column:info.monthly,
    months:Object.keys(rows).sort().reverse().map(k=>({key:k, rows:rows[k], cuts:Object.keys(cuts[k]).sort()})),
    api_version:API_VERSION};
}
function nrmList_(ss){
  const info=nrmLoad_(ss), count={};
  for(let i=info.hdr+1;i<info.values.length;i++){ const o=nrmRow_(info, info.values[i]); if(o) count[o.key]=(count[o.key]||0)+1; }
  const items=Object.keys(count).sort().reverse().map(k=>({key:k, label:NRM_MESES[+k.slice(5,7)-1]+' '+k.slice(0,4), rows:count[k]}));
  return {ok:true, items:items, api_version:API_VERSION};
}
function nrmGet_(ss, payload){
  const key=String(payload.key||'').trim();
  if(!/^\d{4}-\d{2}$/.test(key)) throw new Error('Clave de mes inválida (AAAA-MM).');
  const info=nrmLoad_(ss), x=info.idx, rows=[];
  const n=v=>{ const t=Number(v); return isFinite(t)?t:0; };
  for(let i=info.hdr+1;i<info.values.length;i++){
    const r=info.values[i], o=nrmRow_(info, r); if(!o || o.key!==key) continue;
    rows.push([String(r[x.region]).trim(), String(r[x.agency]==null?'':r[x.agency]).trim(), o.week, n(r[x.esp]), n(r[x.rec]), n(r[x.amtE]), n(r[x.amtER]), n(r[x.amtNE])]);
  }
  if(!rows.length) throw new Error('No hay filas de ese mes en la hoja NORMALIDAD.');
  return {ok:true, key:key, data:{month:key, cols:['region','agency','date','esp','rec','amtE','amtER','amtNE'], rows:rows}, api_version:API_VERSION};
}
function nrmWrite_(action, key, payload, session){
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(key)) throw new Error('Clave de mes inválida (AAAA-MM).');
  const lock=LockService.getScriptLock(); lock.waitLock(30000);
  try{
    const ss=getSS_(), info=nrmLoad_(ss), W=info.lastCol, x=info.idx;
    let clean=[];
    if(action==='report_publish'){
      const rows=payload.rows;
      if(!Array.isArray(rows) || !rows.length) throw new Error('No se recibieron filas para '+key+'.');
      if(rows.length>5000) throw new Error('Demasiadas filas en una sola publicación (máx. 5,000 por mes).');
      clean=rows.map((o,i)=>{
        const d=nrmISO_(o.date, info.tz);
        if(!d || nrmMonthKey_(d)!==key) throw new Error('La fila '+(i+1)+' no pertenece a '+key+' (el corte '+o.date+' cuenta para '+(d?nrmMonthKey_(d):'—')+').');
        const reg=String(o.region||'').trim(), ej=String(o.ejecutivo||'').trim();
        if(!reg || !ej) throw new Error('La fila '+(i+1)+' no trae región o ejecutivo.');
        const n=v=>{ const t=Number(v); return isFinite(t)?t:0; };
        return {region:reg, agency:String(o.agency||'').trim(), ejecutivo:ej, date:d, esp:n(o.esp), rec:n(o.rec), amtE:n(o.amtE), amtR:n(o.amtR), amtER:n(o.amtER), amtNE:n(o.amtNE)};
      });
    }
    // 1) separar lo que se conserva y lo que se reemplaza (las fórmulas existentes se conservan)
    const keep=[], removed=[], cutCount={}; let lastValid=-1, insertAt=-1;
    for(let i=info.hdr+1;i<info.lastRow;i++){
      const r=info.values[i], o=nrmRow_(info, r);
      if(o && o.key===key){ removed.push(r); if(o.cut && o.hadWeek) cutCount[o.cut]=(cutCount[o.cut]||0)+1; continue; }
      keep.push(r.map((v,j)=>info.formulas[i][j] || v));
      if(o){ lastValid=keep.length-1; if(insertAt<0 && o.key>key) insertAt=keep.length-1; }
    }
    if(action==='report_delete' && !removed.length) throw new Error('No hay filas de '+key+' en la hoja NORMALIDAD.');
    if(insertAt<0) insertAt=lastValid>=0 ? lastValid+1 : keep.length;
    // Corte mensual para las filas nuevas: el que ya usaba ese mes; si no existía, el día siguiente al último corte semanal del mes natural
    let monthCut='';
    if(info.idx.month!=null && clean.length){
      const prev=Object.keys(cutCount).sort((a,b)=>cutCount[b]-cutCount[a])[0];
      if(prev) monthCut=prev;
      else{
        const inMonth=clean.map(o=>o.date).filter(d=>d.slice(0,7)===key).sort();
        monthCut=inMonth.length ? nrmAddDays_(inMonth[inMonth.length-1],1) : key+'-28';
        if(monthCut.slice(0,7)!==key) monthCut=inMonth[inMonth.length-1];
      }
    }
    const newRows=clean.map(o=>{
      const r=new Array(W).fill('');
      r[x.region]=o.region; r[x.agency]=o.agency; r[x.ejecutivo]=o.ejecutivo; r[x.week]=Utilities.parseDate(o.date, info.tz, 'yyyy-MM-dd');
      if(info.idx.month!=null) r[info.idx.month]=Utilities.parseDate(monthCut, info.tz, 'yyyy-MM-dd');
      r[x.esp]=o.esp; r[x.rec]=o.rec; r[x.amtE]=o.amtE; r[x.amtER]=o.amtER; r[x.amtNE]=o.amtNE;
      if(x.amtR!=null) r[x.amtR]=o.amtR;
      if(x.pct!=null) r[x.pct]=o.esp>0 ? o.rec/o.esp : 0;
      return r;
    });
    const out=keep.slice(0,insertAt).concat(newRows, keep.slice(insertAt));
    // 2) respaldo de lo que se va a reemplazar o quitar (aparece en la lista de respaldos del portal)
    let backup='';
    if(removed.length){ backupRows_(ss,'NORMALIDAD',Number(key.replace('-','')),info.values[info.hdr].map(String),removed); backup='BK_ADMIN_NORMALIDAD_S'+key.replace('-','')+'_…'; }
    // 3) escritura: solo la zona de datos (debajo del encabezado)
    const sh=info.sh, start=info.hdr+2;
    if(sh.getMaxRows()<start+out.length-1) sh.insertRowsAfter(sh.getMaxRows(), start+out.length-1-sh.getMaxRows());
    if(info.lastRow>=start) sh.getRange(start,1,info.lastRow-start+1,W).clearContent();
    if(out.length) sh.getRange(start,1,out.length,W).setValues(out);
    if(newRows.length){ try{
      const tpl=Math.max(0, insertAt-1)+start; sh.getRange(tpl,1,1,W).copyTo(sh.getRange(start+insertAt,1,newRows.length,W), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    }catch(_){ } }
    logOperation_(ss,{usuario:session.username,accion:action==='report_delete'?'NORMALIDAD_QUITAR_MES':'NORMALIDAD_PUBLICAR_MES',archivo:key,registros_antes:removed.length,registros_nuevos:newRows.length,resultado:'OK',detalle:'reemplazo de mes en NORMALIDAD'+(monthCut?' · corte mes '+monthCut:'')});
    return {ok:true, key:key, removed:removed.length, added:newRows.length, backup:backup, month_cut:monthCut, api_version:API_VERSION};
  } finally { lock.releaseLock(); }
}

/* ========================= HELPERS ========================= */
function mustSheet_(ss,name){const sh=ss.getSheetByName(name);if(!sh)throw new Error('No existe la hoja: '+name);return sh;}
function findHeader_(headers,names){const clean=headers.map(x=>upper_(x));for(const n of names){const i=clean.indexOf(upper_(n));if(i>=0)return i;}throw new Error('No encontré columna: '+names.join(' / '));}
function valueForHeader_(obj,header){const key=String(header||'').trim();if(Object.prototype.hasOwnProperty.call(obj,key))return safeSheetValue_(obj[key]);const low=lower_(key);if(Object.prototype.hasOwnProperty.call(obj,low))return safeSheetValue_(obj[low]);return '';}
function safeSheetValue_(v){if(v===undefined||v===null||Number.isNaN(v))return '';return v;}
function sheetHasWeek_(ss,name,week){const sh=ss.getSheetByName(name);if(!sh)return false;const v=sh.getDataRange().getValues();if(v.length<2)return false;const h=v[0].map(x=>String(x||'').trim());let ix;try{ix=findHeader_(h,['SEMANA','semana']);}catch(_){return false;}return v.slice(1).some(r=>sameNum_(r[ix],week));}
function integerWeek_(v){const n=Math.round(Number(v));if(!Number.isFinite(n)||n<1||n>53)throw new Error('Semana inválida.');return n;}
function sameNum_(a,b){return Number.isFinite(Number(a))&&Number.isFinite(Number(b))&&Math.abs(Number(a)-Number(b))<0.0001;}
function numOrZero_(v){const n=Number(v);return Number.isFinite(n)?n:0;}
function num_(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function upper_(v){return String(v||'').trim().toUpperCase();}
function lower_(v){return String(v||'').trim().toLowerCase();}
function json_(obj){return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);}

function serialToDate_(serial){return new Date(Date.UTC(1899,11,30)+Number(serial)*86400000);}
function dateToSerial_(d){return Math.floor((Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate())-Date.UTC(1899,11,30))/86400000);}
function lastDayMonth_(d){return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0));}
function formatPeriodo_(friday){
  const monday=new Date(friday.getTime()-4*86400000), meses=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const f=x=>String(x).padStart(2,'0');
  return f(monday.getUTCDate())+' '+meses[monday.getUTCMonth()]+' '+monday.getUTCFullYear()+' - '+f(friday.getUTCDate())+' '+meses[friday.getUTCMonth()]+' '+friday.getUTCFullYear();
}


/* ================== V8.4 · INDICADORES DIARIOS ==================
 * La carga es exclusiva de administrador, en bloques ordenados.
 * La hoja temporal nunca es visible al dashboard. La publicación
 * conmuta hojas y conserva la versión anterior como BK_ADMIN_.
 */
const DAILY_REQUIRED_V84=['FECHACORTE','COD_ASESOR','ASESOR','COD_REGIONAL','REGIONAL','COD_SUCURSAL','SUCURSAL','COMISION_FINAL','TOTAL_A_COBRAR'];
const DAILY_LIMIT_V84=50000;
function dailySheet_(ss){return ss.getSheetByName(SHEETS.DIARIOS);}
function dailyDateKey_(v) {
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return '';
    return Utilities.formatDate(v, 'America/Mexico_City', 'yyyy-MM-dd');
  }

  const text = String(v == null ? '' : v).trim();
  if (!text) return '';

  // Mismo origen que serialDate_ y los seriales modernos de Excel/Sheets.
  if (typeof v === 'number' || /^\d+(?:\.\d+)?$/.test(text)) {
    const serial = Number(v);
    if (!Number.isFinite(serial) || serial < 1 || serial >= 2958466) return '';
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000);
    return date.getUTCFullYear() + '-' +
      String(date.getUTCMonth() + 1).padStart(2, '0') + '-' +
      String(date.getUTCDate()).padStart(2, '0');
  }

  let year, month, day;
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T|\s)/);
  const local = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (iso) {
    year = Number(iso[1]); month = Number(iso[2]); day = Number(iso[3]);
  } else if (local) {
    year = Number(local[3]); month = Number(local[2]); day = Number(local[1]);
  } else {
    return '';
  }
  if (year < 100 || year > 9999) return '';
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
  return year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
}
function dailyHeaders_(ss){const sh=dailySheet_(ss); return sh?sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(String):[];}
function dailyDates_(session){
 const ss=getSS_(),sh=dailySheet_(ss); if(!sh||sh.getLastRow()<2)return {ok:true,dates:[],total:0};
 const h=dailyHeaders_(ss),ix=h.indexOf('FECHACORTE'); if(ix<0)throw new Error('INDICADORES_DIARIOS carece de FECHACORTE');
 const a=sh.getRange(2,ix+1,sh.getLastRow()-1,1).getValues();
 const count={};a.forEach(r=>{const d=dailyDateKey_(r[0]);if(d)count[d]=(count[d]||0)+1;});
 return {ok:true,dates:Object.keys(count).sort(),counts:count,total:a.length};
}
function dailyRoleRows_(rows,session,ss){
 const role=lower_(session.role),person=personKey_(session.nombre);
 if(['admin','directivo','direccion'].includes(role))return rows;
 if(role==='ejecutivo')return rows.filter(r=>personKey_(r.ASESOR)===person);
 const map={coordinador:[SHEETS.SCOPE_COORDINADOR,'coordinador'],gerente:[SHEETS.SCOPE_GERENTE,'gerente'],regional:[SHEETS.SCOPE_REGIONAL,'regional']};
 const cfg=map[role];if(!cfg)return [];
 const manually=readObjectsFromSS_(ss,cfg[0]).filter(r=>personKey_(r[cfg[1]])===person);
 const manual=new Set(manually.map(r=>dailyRegionScopeKey_(r.region)+'|'+(role==='regional'?'':upper_(r.agencia))));
 // El SCOPE histórico por sí solo no concede datos diarios. Debe existir
 // también una relación vigente en el último archivo diario disponible.
 const newest=rows.reduce((m,r)=>dailyDateKey_(r.FECHACORTE)>m?dailyDateKey_(r.FECHACORTE):m,'');
 const latest=rows.filter(r=>dailyDateKey_(r.FECHACORTE)===newest);
 let current=new Set();
 if(role==='coordinador') latest.filter(r=>personKey_(r.COORDINADOR)===person).forEach(r=>current.add(dailyRegionScopeKey_(r.REGIONAL)+'|'+upper_(r.SUCURSAL)));
 // Para gerentes y regionales, la tabla de comisiones de la semana más reciente es referencia operativa.
 if(role==='gerente'||role==='regional'){
   const shName=role==='gerente'?SHEETS.GERENTE:SHEETS.REGIONAL;
   const src=readObjectsFromSS_(ss,shName);
   const max=src.reduce((m,r)=>Math.max(m,Number(r.semana)||0),0);
   src.filter(r=>Number(r.semana)===max && personKey_(r.empleado)===person && isCurrentStaffRow_(r)).forEach(r=>current.add(dailyRegionScopeKey_(r.region)+'|'+(role==='regional'?'':upper_(r.agencia))));
 }
 const allowed=new Set([...manual].filter(k=>current.has(k)));
 return rows.filter(r=>allowed.has(dailyRegionScopeKey_(r.REGIONAL)+'|'+(role==='regional'?'':upper_(r.SUCURSAL))));
}
function dailyData_(session,payload){
 const date=dailyDateKey_(payload.date);if(!date)throw new Error('Selecciona una fecha válida');
 const ss=getSS_(),sh=dailySheet_(ss);if(!sh||sh.getLastRow()<2)return {ok:true,date,rows:[]};
 const h=dailyHeaders_(ss),all=readObjectsFromSS_(ss,SHEETS.DIARIOS);
 // Filtrar por permiso ANTES de enviar datos al navegador.
 const authorized=dailyRoleRows_(all,session,ss);
 const allowed=authorized.filter(r=>dailyDateKey_(r.FECHACORTE)===date);
 const normalize=r=>Object.assign({},r,{FECHACORTE:dailyDateKey_(r.FECHACORTE)});
 const result={ok:true,date,headers:h,rows:allowed.map(normalize)};
 if(payload.include_history===true){
  // Historia del mismo ejecutivo/período. Se autoriza antes de enviarla.
  const person=r=>String(r.COD_ASESOR||'').trim()||personKey_(r.ASESOR);
  const period=r=>String(r.ID_PERIODO||r.PERIODO||'').trim();
  const contexts=new Set(allowed.map(r=>person(r)+'|'+period(r)));
  result.history=authorized.filter(r=>{
   const d=dailyDateKey_(r.FECHACORTE);
   return d&&d<=date&&contexts.has(person(r)+'|'+period(r))&&(period(r)||d===date);
  }).map(normalize);
 }
 return result;
}
function dailyStage_(id,session){
 const key='daily-v84-'+String(id||''); const raw=PropertiesService.getScriptProperties().getProperty(key);
 if(!raw)throw new Error('Carga temporal inexistente o finalizada'); const v=JSON.parse(raw);
 if(v.owner!==session.username)throw new Error('La carga pertenece a otro administrador');return {key,meta:v};
}
function dailyBegin_(payload,session){
 const headers=(payload.headers||[]).map(x=>String(x||'').trim().toUpperCase());
 if(headers.length<DAILY_REQUIRED_V84.length||headers.length>150||new Set(headers).size!==headers.length)throw new Error('Encabezados duplicados o inválidos');
 DAILY_REQUIRED_V84.forEach(x=>{if(!headers.includes(x))throw new Error('Falta columna '+x);});
 const expected=Number(payload.total);if(!Number.isInteger(expected)||expected<1||expected>DAILY_LIMIT_V84)throw new Error('Cantidad de filas inválida');
 const id=Utilities.getUuid().replace(/-/g,'').slice(0,20),name='TMP_DIA_'+id;
 const lock=LockService.getScriptLock();lock.waitLock(30000);
 try{const props=PropertiesService.getScriptProperties();
 const stored=props.getProperties();Object.keys(stored).filter(k=>k.startsWith('daily-v84-')).forEach(k=>{try{const v=JSON.parse(stored[k]);if(v.committed&&Date.now()-v.finished>86400000)props.deleteProperty(k);}catch(_){}});
 const ss=getSS_(),sh=ss.insertSheet(name);
 if(sh.getMaxColumns()<headers.length)sh.insertColumnsAfter(sh.getMaxColumns(),headers.length-sh.getMaxColumns());
 sh.getRange(1,1,1,headers.length).setValues([headers]);
 const meta={owner:session.username,name,headers,expected,received:0,file:String(payload.file_name||'').slice(0,120),started:Date.now()};
 PropertiesService.getScriptProperties().setProperty('daily-v84-'+id,JSON.stringify(meta));return {ok:true,id,received:0};}
 finally{lock.releaseLock();}
}
function dailyChunk_(payload,session){
 const obj=dailyStage_(payload.id,session),v=obj.meta,rows=payload.rows||[];
 if(!Array.isArray(rows)||rows.length<1||rows.length>150)throw new Error('Bloque inválido (máximo 150 filas)');
 if(Number(payload.offset)!==v.received)throw new Error('Bloque fuera de secuencia');
 if(v.received+rows.length>v.expected)throw new Error('Bloque excede la cantidad declarada');
 const lock=LockService.getScriptLock();lock.waitLock(30000);
 try{const x=dailyStage_(payload.id,session),m=x.meta,sh=mustSheet_(getSS_(),m.name);
 if(m.committed)throw new Error('Carga ya publicada');
 if(Number(payload.offset)!==m.received)throw new Error('Bloque repetido');
 const data=rows.map((r,i)=>{
  if(!Array.isArray(r)||r.length!==m.headers.length)throw new Error('Columnas distintas en fila '+(m.received+i+1));
  const d=dailyDateKey_(r[m.headers.indexOf('FECHACORTE')]);
  if(!d)throw new Error('FECHACORTE inválida en fila '+(m.received+i+1));
  if(!String(r[m.headers.indexOf('ASESOR')]||'').trim())throw new Error('ASESOR vacío en fila '+(m.received+i+1));
  return r.map((z,j)=>j===m.headers.indexOf('FECHACORTE')?d:(z==null?'':z));
 });
 const needed=m.received+data.length+1;
 if(sh.getMaxRows()<needed)sh.insertRowsAfter(sh.getMaxRows(),needed-sh.getMaxRows());
 sh.getRange(m.received+2,1,data.length,m.headers.length).setValues(data);
 m.received+=data.length;PropertiesService.getScriptProperties().setProperty(x.key,JSON.stringify(m));
 return {ok:true,received:m.received,total:m.expected};}
 finally{lock.releaseLock();}
}
function dailyCommit_(payload,session){
 const lock=LockService.getScriptLock();lock.waitLock(30000);
 let old=null,stage=null,backup='';
 try{const o=dailyStage_(payload.id,session),m=o.meta,ss=getSS_();
 if(m.committed)return m.result;
 if(m.received!==m.expected)throw new Error('Carga incompleta '+m.received+'/'+m.expected);
 stage=mustSheet_(ss,m.name);
 if(stage.getLastRow()!==m.expected+1)throw new Error('Filas en staging no coinciden');
 const h=stage.getRange(1,1,1,m.headers.length).getValues()[0];if(h.join('|')!==m.headers.join('|'))throw new Error('Encabezados alterados');
 const ix=m.headers.indexOf('FECHACORTE'),dates=stage.getRange(2,ix+1,m.expected,1).getValues().map(r=>dailyDateKey_(r[0]));
 if(dates.some(x=>!x))throw new Error('Fechas sin validar');
 const last=new Set();const codes=stage.getRange(2,m.headers.indexOf('COD_ASESOR')+1,m.expected,1).getValues();
 for(let i=0;i<m.expected;i++){const k=dates[i]+'|'+upper_(codes[i][0]);if(!upper_(codes[i][0]))throw new Error('Código de asesor vacío en fila '+(i+2));if(last.has(k))throw new Error('Duplicado fecha+asesor: '+k);last.add(k);}
 stage.setFrozenRows(1);
 old=dailySheet_(ss); const prior=old?Math.max(0,old.getLastRow()-1):0;
 if(old){const stamp=Utilities.formatDate(new Date(),'America/Mexico_City','yyyyMMdd_HHmmss');backup=('BK_ADMIN_DIARIOS_'+stamp).slice(0,90);while(ss.getSheetByName(backup))backup='BK_ADMIN_DIARIOS_'+stamp+'_'+Utilities.getUuid().slice(0,8);old.setName(backup);}
 try{stage.setName(SHEETS.DIARIOS);}catch(err){if(old)old.setName(SHEETS.DIARIOS);throw err;}
 // Conservar comprobante para resolver una respuesta perdida del commit.
 const result={ok:true,rows:m.expected,from:dates.slice().sort()[0],to:dates.slice().sort().pop(),backup,scope_ejecutivo:0,scope_coordinador:0,scope_warning:''};
 m.committed=true;m.result=result;m.finished=Date.now();
 PropertiesService.getScriptProperties().setProperty(o.key,JSON.stringify(m));
 // SCOPE se sincroniza como histórico (sin revocar); la lectura diaria aplica vigencia adicional.
 const max=result.to;
 let se=0,sc=0,scopeWarning='';
 try{const ro=readObjectsFromSS_(ss,SHEETS.DIARIOS);
 const fresh=ro.filter(r=>dailyDateKey_(r.FECHACORTE)===max && isCurrentStaffRow_(r));
 se=batchAppendScopes_(ss,'ejecutivo',fresh.map(r=>({nombre:r.ASESOR,region:r.REGIONAL,agencia:r.SUCURSAL})));
 sc=batchAppendScopes_(ss,'coordinador',fresh.map(r=>({nombre:r.COORDINADOR,region:r.REGIONAL,agencia:r.SUCURSAL})));}
 catch(syncErr){scopeWarning=String(syncErr.message||syncErr);}
 try{logOperation_(ss,{usuario:session.username,accion:'REEMPLAZAR_INDICADORES_DIARIOS',archivo:m.file,registros_antes:prior,registros_nuevos:m.expected,resultado:'OK',detalle:'Fechas '+dates.slice().sort()[0]+' a '+max+' · backup '+backup+' · SCOPE ejecutivo '+se+' coordinador '+sc+(scopeWarning?' · ADVERTENCIA '+scopeWarning:''),id_operacion:Utilities.getUuid()});}catch(err){scopeWarning+=(scopeWarning?' · ':'')+'No se pudo registrar LOG: '+String(err.message||err);}
 Object.assign(result,{scope_ejecutivo:se,scope_coordinador:sc,scope_warning:scopeWarning});
 m.result=result;PropertiesService.getScriptProperties().setProperty(o.key,JSON.stringify(m));
 return result;}
 finally{lock.releaseLock();}
}
function dailyStatus_(payload,session){
 const lock=LockService.getScriptLock();lock.waitLock(30000);
 try{const raw=PropertiesService.getScriptProperties().getProperty('daily-v84-'+String(payload.id||''));
 if(!raw)return {ok:true,state:'unknown'};
 const m=JSON.parse(raw);if(m.owner!==session.username)throw new Error('La carga pertenece a otro administrador');
 return {ok:true,state:m.committed?'committed':'staging',received:m.received,total:m.expected,result:m.result||null};
 }finally{lock.releaseLock();}
}
function dailyAbort_(payload,session){
 const lock=LockService.getScriptLock();lock.waitLock(30000);
 try{const o=dailyStage_(payload.id,session);
 if(o.meta.committed)return {ok:true,state:'committed',result:o.meta.result};
 const ss=getSS_(),sh=ss.getSheetByName(o.meta.name);
 if(!/^TMP_DIA_/.test(o.meta.name))throw new Error('Hoja temporal inválida');
 if(sh)ss.deleteSheet(sh);PropertiesService.getScriptProperties().deleteProperty(o.key);return {ok:true,state:'aborted'};
 }finally{lock.releaseLock();}
}
function mergeDailyCandidates_(ss,weekly){
 const sh=dailySheet_(ss);if(!sh||sh.getLastRow()<2)return weekly;
 const rows=readObjectsFromSS_(ss,SHEETS.DIARIOS);let latest='';rows.forEach(r=>{const d=dailyDateKey_(r.FECHACORTE);if(d>latest)latest=d;});
 const candidates=weekly.rows.slice();const seen=new Set(candidates.map(r=>r.role+'|'+personKey_(r.nombre)+'|'+r.region+'|'+r.agencia));
 rows.filter(r=>dailyDateKey_(r.FECHACORTE)===latest&&isCurrentStaffRow_(r)).forEach(r=>{
  [['ejecutivo',r.ASESOR],['coordinador',r.COORDINADOR]].forEach(x=>{
   const name=upper_(x[1]);if(!name||name==='-')return;const entry={role:x[0],nombre:name,region:upper_(r.REGIONAL),agencia:upper_(r.SUCURSAL),semana:weekly.week};
   const key=entry.role+'|'+personKey_(name)+'|'+entry.region+'|'+entry.agencia;if(!seen.has(key)){seen.add(key);candidates.push(entry);}
  });
 });return {week:weekly.week,rows:candidates};
}
function scopeDiagnostics_(session){
 const ss=getSS_(),users=userRowsRaw_(ss),sources=mergeDailyCandidates_(ss,latestWeekCandidates_(ss)).rows;
 const indexed=new Map();users.forEach(u=>indexed.set(lower_(u.role)+'|'+personKey_(u.nombre),u));
 const missing=[],inactive=[],missingScope=[];
 const unique=new Set();
 sources.forEach(p=>{const k=p.role+'|'+personKey_(p.nombre);if(!indexed.has(k)){if(!unique.has(k))unique.add(k);return;} // Ya aparece en Usuarios pendientes de autorización.
  const u=indexed.get(k);if(u && lower_(u.estado)==='inactivo'&&!inactive.some(x=>x.nombre===p.nombre&&x.role===p.role))inactive.push({nombre:p.nombre,role:p.role});
  const cfg={ejecutivo:[SHEETS.SCOPE_EJECUTIVO,'ejecutivo'],coordinador:[SHEETS.SCOPE_COORDINADOR,'coordinador'],gerente:[SHEETS.SCOPE_GERENTE,'gerente'],regional:[SHEETS.SCOPE_REGIONAL,'regional']}[p.role];if(!cfg)return;
  const ok=readObjectsFromSS_(ss,cfg[0]).some(r=>personKey_(r[cfg[1]])===personKey_(p.nombre)&&upper_(r.region)===p.region&&(p.role==='regional'||upper_(r.agencia)===p.agencia));
  if(!ok)missingScope.push({role:p.role,nombre:p.nombre,region:p.region,agencia:p.agencia});
 });
 return {ok:true,missing_users:missing,inactive_users:inactive,missing_scopes:missingScope,checked:sources.length,pending_omitted:unique.size,nota:'Usuarios pendientes se consultan únicamente en Usuarios pendientes de autorización. SCOPE históricos permanecen; no se revocan automáticamente.'};
}


function mcmSessionRevision_(username){
 return PropertiesService.getScriptProperties().getProperty('MCM_USER_REV:'+lower_(username))||'';
}

function mcmRoleScopePlan_(tables,users,username,nombre,role,estado,candidates){
 const nameKey=personKey_(nombre);
 const shared=new Set(users.filter(u=>lower_(u.username)!==lower_(username)&&personKey_(u.nombre)===nameKey&&lower_(u.estado||'activo')!=='inactivo').map(u=>lower_(u.role)));
 const roles=['ejecutivo','coordinador','gerente','regional'];
 const restricted=roles.includes(role);
 const fresh=(candidates||[]).filter(c=>c.role===role&&personKey_(c.nombre)===nameKey&&c.region&&(role==='regional'||c.agencia));
 if(estado==='activo'&&restricted&&!fresh.length)throw new Error('Sin asignación vigente para '+nombre+' como '+role+'. Carga la semana vigente con su región/sucursal antes de guardar. No se modificaron el usuario ni sus scopes.');
 const plan={};
 roles.forEach(r=>{
   const input=tables[r],h=input[0],ni=h.indexOf(r),ri=h.indexOf('region'),ai=h.indexOf('agencia');
   if(ni<0||ri<0||(r!=='regional'&&ai<0))throw new Error('Encabezados inválidos en SCOPE_'+r.toUpperCase());
   const keepShared=shared.has(r)&&r!==role;
   const kept=input.slice(1).filter(row=>personKey_(row[ni])!==nameKey||keepShared);
   if(r===role&&estado==='activo'){
     const seen=new Set();
     fresh.forEach(c=>{
       const k=dailyRegionScopeKey_(c.region)+'|'+(r==='regional'?'':upper_(c.agencia));
       if(seen.has(k))return;seen.add(k);
       const row=h.map(()=> '');row[ni]=upper_(nombre);row[ri]=upper_(c.region);if(r!=='regional')row[ai]=upper_(c.agencia);kept.push(row);
     });
   }else if(r===role&&estado!=='activo'&&shared.has(r)){
     input.slice(1).filter(row=>personKey_(row[ni])===nameKey).forEach(row=>kept.push(row));
   }
   plan[r]=[h,...kept];
 });
 return {tables:plan,scopes:fresh.length,shared_roles:[...shared]};
}

function dailyRegionScopeKey_(value){
 const region=upper_(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Z0-9]/g,'');
 if(region==='VOLCANESORIENTE')return 'VOLCANES';
 if(region==='EDOMEX'||region==='ESTADODEMEXICO')return 'EDOMEXICO';
 return region;
}
