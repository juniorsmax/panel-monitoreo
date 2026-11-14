'use strict';
// Panel de monitoreo · Zervitecnics
// Si otra web intenta mostrar el panel dentro de la suya (para engañar al usuario), no se muestra.
if (window.top !== window.self) {
  document.documentElement.style.display = 'none';
  throw new Error('El panel no se puede mostrar dentro de otra web');
}
// La URL y la clave publishable de Supabase son públicas por diseño: lo que protege los datos
// son las reglas de acceso (RLS) de la base de datos. Aquí no hay ningún secreto.
const SUPABASE_URL = 'https://eyqyerspaqubfsckugyi.supabase.co';
const SUPABASE_KEY = 'sb_publishable_nAU8sK7zCIYQIqsIRyWfmA_rZ7j5qkx';
const LENTO_MS = 1500;
const REFRESCO_MS = 60_000;

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
const app = document.getElementById('app');
const NS = 'http://www.w3.org/2000/svg';

const estado = { orgs: [], org: null, datos: null, filtro: 'todo', timer: null, esAdmin: false, vista: 'panel', admin: null, fuentes: [], seguridad: null, estadisticas: null, adminSeg: null };

/* ---------- utilidades de DOM (nunca se inserta texto como HTML) ---------- */
// Como replaceChildren, pero ignora los huecos (null/false) igual que h(): si no, se pintaría el texto «null».
function pintarEn(el, ...hijos) { el.replaceChildren(...hijos.flat().filter((c) => c != null && c !== false)); }
function h(tag, attrs, ...hijos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v; // por CSSOM: la política CSP no permite el atributo style
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of hijos.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}
function svg(tag, attrs, ...hijos) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
  hijos.forEach((c) => el.append(c));
  return el;
}

/* ---------- tema claro / oscuro ---------- */
function temaActual() {
  let t = null;
  try { t = localStorage.getItem('tema'); } catch (_) { /* sin almacenamiento */ }
  if (t === 'claro' || t === 'oscuro') return t;
  return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'oscuro' : 'claro';
}
function aplicarTema(t, guardar) {
  document.documentElement.dataset.tema = t;
  if (guardar) { try { localStorage.setItem('tema', t); } catch (_) { /* sin almacenamiento */ } }
}
aplicarTema(temaActual(), false);

/* ---------- formato ---------- */
const fmtMs = (ms) => (ms == null ? 'Sin datos' : ms >= 1000 ? (ms / 1000).toFixed(1).replace('.', ',') + ' s' : ms + ' ms');
const fmtPct = (p) => (p == null ? 'Sin datos' : String(p).replace('.', ',') + ' %');
function hace(iso) {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 1) return 'Hace un momento';
  if (min < 60) return `Hace ${min} ${min === 1 ? 'minuto' : 'minutos'}`;
  const hh = Math.round(min / 60);
  if (hh < 24) return `Hace ${hh} ${hh === 1 ? 'hora' : 'horas'}`;
  const d = Math.round(hh / 24);
  return `Hace ${d} ${d === 1 ? 'día' : 'días'}`;
}
const hora = (iso) => new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
function saludo() {
  const hh = new Date().getHours();
  return hh < 6 ? 'Buenas noches' : hh < 13 ? 'Buenos días' : hh < 21 ? 'Buenas tardes' : 'Buenas noches';
}
function clase(o) {
  if (o.estado === 'caido') return 'down';
  if (o.estado === 'ok') return o.ultimo_ms != null && o.ultimo_ms > LENTO_MS ? 'slow' : 'ok';
  return 'none';
}
const ETIQUETA = { ok: 'Funciona', slow: 'Va lento', down: 'No responde', none: 'Sin datos' };

/* ---------- login ---------- */
function pantallaLogin(mensaje, tipo) {
  clearInterval(estado.timer);
  const email = h('input', { id: 'email', type: 'email', required: true, autocomplete: 'email', inputmode: 'email', placeholder: 'tu@correo.com' });
  const aviso = h('div', { class: 'msg' + (tipo ? ' ' + tipo : ''), role: 'status' }, mensaje || '');
  const form = h('form', {
    class: 'login',
    onsubmit: async (e) => {
      e.preventDefault();
      aviso.className = 'msg'; aviso.textContent = 'Enviando…';
      const { error } = await sb.auth.signInWithOtp({
        email: email.value.trim(),
        options: { shouldCreateUser: false, emailRedirectTo: location.origin + location.pathname },
      });
      if (error && error.status === 429) { aviso.className = 'msg err'; aviso.textContent = 'Demasiados intentos. Espera unos minutos.'; return; }
      // Respuesta idéntica exista o no el correo, para no revelar quién tiene acceso.
      aviso.className = 'msg okk';
      aviso.textContent = 'Si tu correo tiene acceso, te hemos enviado un enlace para entrar. Revisa tu bandeja.';
    },
  },
    h('div', { class: 'brand' }, h('div', { class: 'logo', 'aria-hidden': 'true' }, 'Z'),
      h('div', {}, h('b', {}, 'Zervitecnics'), h('span', {}, 'Panel de monitoreo'))),
    h('h1', {}, 'Entrar'),
    h('p', {}, 'Escribe tu correo y te enviamos un enlace para entrar, sin contraseña.'),
    h('label', { class: 'campo' }, 'Correo', email),
    h('button', { class: 'btn', type: 'submit' }, 'Enviar enlace'),
    aviso,
    h('p', { class: 'letra-chica' }, 'Al entrar se guarda tu dirección IP para evitar abusos. ',
      h('a', { href: 'legal.html#privacidad', target: '_blank', rel: 'noopener' }, 'Política de privacidad')),
  );
  pintarEn(app, form);
}

/* ---------- datos ---------- */
async function cargarOrgs() {
  const { data, error } = await sb.rpc('panel_mis_orgs');
  if (error) throw error;
  estado.orgs = data || [];
  let guardada = null;
  try { guardada = localStorage.getItem('org'); } catch (_) { /* nada */ }
  estado.org = estado.orgs.find((o) => o.org_id === guardada) || estado.orgs[0] || null;
}
async function cargarTablero() {
  if (!estado.org) return;
  const { data, error } = await sb.rpc('panel_tablero', { p_org: estado.org.org_id });
  if (error) throw error;
  estado.datos = data;
  // Las fuentes de datos son un extra: si fallan, el resto del panel sigue funcionando.
  try {
    const f = await sb.rpc('panel_fuentes', { p_org: estado.org.org_id });
    estado.fuentes = f.error ? [] : (f.data || []);
  } catch (_) { estado.fuentes = []; }
  // El diagnóstico de seguridad también es un extra: si no está disponible, la tarjeta no lo muestra.
  try {
    const g = await sb.rpc('panel_seguridad', { p_org: estado.org.org_id });
    estado.seguridad = g.error ? null : g.data;
  } catch (_) { estado.seguridad = null; }
}
async function cargarAdmin() {
  const { data, error } = await sb.rpc('panel_admin_resumen');
  if (error) throw error;
  estado.admin = data;
  const [e, s] = await Promise.all([
    sb.rpc('panel_estadisticas', { p_dias: 30 }).then((r) => (r.error ? null : r.data), () => null),
    sb.rpc('panel_admin_seguridad').then((r) => (r.error ? null : r.data), () => null),
  ]);
  estado.estadisticas = e; estado.adminSeg = s;
}
function repintar() {
  if (estado.vista === 'ayuda') pintarAyuda();
  else if (estado.vista === 'admin' && estado.esAdmin) pintarAdmin();
  else pintar();
}
async function refrescar() {
  if (estado.vista === 'ayuda') return; // no se repinta mientras se lee la ayuda
  try {
    if (estado.vista === 'admin' && estado.esAdmin) { await cargarAdmin(); pintarAdmin(); }
    else { await cargarTablero(); pintar(); }
  } catch (e) { console.error(e); registrarUso('error_carga', 'refresco'); }
}
// Registro de uso propio: solo tipo y un detalle corto; el servidor limita la frecuencia.
// Con cada evento va el tipo de dispositivo, el idioma y la zona horaria del navegador. La IP no se guarda aquí.
const CONTEXTO = (() => {
  const ancho = Math.min(window.screen?.width || Infinity, window.innerWidth || Infinity);
  let zona = null;
  try { zona = Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch (_) { /* nada */ }
  return { dispositivo: ancho < 600 ? 'movil' : ancho < 1024 ? 'tableta' : 'ordenador', idioma: navigator.language || null, zona };
})();
function registrarUso(tipo, detalle) {
  if (!estado.org) return;
  sb.rpc('panel_registrar_uso', { p_org: estado.org.org_id, p_tipo: tipo, p_detalle: detalle || null, p_contexto: CONTEXTO })
    .then(() => {}, () => {});
}
async function cambiarVista(v) {
  estado.vista = v;
  if (v === 'ayuda') { pintarAyuda(); window.scrollTo(0, 0); registrarUso('ver_ayuda', null); return; }
  if (v === 'admin') {
    try { await cargarAdmin(); registrarUso('vista_admin', null); } catch (e) { console.error(e); estado.vista = 'panel'; }
    estado.vista === 'admin' ? pintarAdmin() : pintar();
  } else pintar();
}

/* ---------- pantalla principal ---------- */
function sol() {
  const l = (x1, y1, x2, y2) => svg('line', { x1, y1, x2, y2 });
  return svg('svg', { class: 'sol', width: 220, height: 220, viewBox: '0 0 220 220', 'aria-hidden': 'true' },
    svg('circle', { cx: 110, cy: 110, r: 64, fill: '#FFB347' }),
    svg('g', { stroke: '#FFB347', 'stroke-width': 10, 'stroke-linecap': 'round' },
      l(110, 10, 110, 30), l(110, 190, 110, 210), l(10, 110, 30, 110), l(190, 110, 210, 110),
      l(39, 39, 53, 53), l(167, 167, 181, 181), l(181, 39, 167, 53), l(53, 167, 39, 181)));
}
function spark(o, cls) {
  const vals = (o.serie || []).map((v) => (v == null ? 0 : v));
  let pts = '';
  if (vals.length >= 2) {
    const max = Math.max(...vals), min = Math.min(...vals);
    pts = vals.map((v, i) => `${Math.round(i * (120 / (vals.length - 1)))},${Math.round(32 - ((v - min) / ((max - min) || 1)) * 28)}`).join(' ');
  } else pts = '0,18 120,18';
  const s = svg('svg', { class: 'spark ' + cls, viewBox: '0 0 120 36', preserveAspectRatio: 'none', role: 'img', 'aria-label': 'Respuesta de las últimas 24 horas' });
  s.append(svg('polyline', { points: pts }));
  return s;
}
function tarjeta(o, esAdmin) {
  const cls = clase(o);
  return h('article', { class: 'card' },
    h('div', { class: 'row' },
      h('div', {}, h('div', { class: 'nom' }, o.nombre), h('div', { class: 'url' }, o.url)),
      h('span', { class: 'chip ' + cls }, ETIQUETA[cls])),
    spark(o, cls),
    h('div', { class: 'meta' },
      h('span', {}, 'Responde en ', h('b', {}, fmtMs(o.ultimo_ms))),
      h('span', {}, 'Disponible 24 h ', h('b', {}, fmtPct(o.uptime_24h)))),
    lineaSeguridad(o),
    esAdmin && h('button', {
      class: 'link quitar', type: 'button',
      onclick: async () => {
        if (!confirm(`¿Dejar de vigilar «${o.nombre}»?`)) return;
        const { error } = await sb.rpc('panel_quitar_objetivo', { p_org: estado.org.org_id, p_objetivo: o.id });
        if (error) alert('No se ha podido quitar.'); else refrescar();
      },
    }, 'Dejar de vigilar'));
}
function dialogoAnadir() {
  const nombre = h('input', { type: 'text', required: true, maxlength: 60, placeholder: 'Mi web' });
  const url = h('input', { type: 'url', required: true, placeholder: 'https://ejemplo.com' });
  const tipo = h('select', {}, h('option', { value: 'web' }, 'Web'), h('option', { value: 'bot' }, 'Bot'), h('option', { value: 'app' }, 'App'));
  const err = h('div', { class: 'msg', role: 'alert' });
  const declaro = h('input', { type: 'checkbox', required: true });
  const dlg = h('dialog', { 'aria-labelledby': 'tit-dlg' },
    h('form', {
      method: 'dialog',
      onsubmit: async (e) => {
        e.preventDefault();
        err.className = 'msg'; err.textContent = '';
        const { data, error } = await sb.rpc('panel_crear_objetivo', {
          p_org: estado.org.org_id, p_nombre: nombre.value.trim(), p_url: url.value.trim(), p_tipo: tipo.value, p_declaro: declaro.checked,
        });
        if (error) { err.className = 'msg err'; err.textContent = error.message || 'No se ha podido añadir.'; return; }
        dlg.close(); dlg.remove(); refrescar(); registrarUso('anadir_web', tipo.value);
        // Primera revisión de seguridad: queda como punto de partida. Si falla, la web se añade igual.
        lanzarRevision(data, 'alta').then(() => refrescar(), () => {});
      },
    },
      h('h2', { id: 'tit-dlg' }, 'Añadir web o bot'),
      h('label', { class: 'campo' }, 'Nombre', nombre),
      h('label', { class: 'campo' }, 'Dirección (URL)', url),
      h('label', { class: 'campo' }, 'Tipo', tipo),
      h('label', { class: 'casilla' }, declaro,
        h('span', {}, 'Confirmo que es mío o que tengo permiso de su titular para revisarlo. ',
          h('a', { href: 'legal.html#condiciones', target: '_blank', rel: 'noopener' }, 'Condiciones de uso'))),
      err,
      h('div', { class: 'acciones' },
        h('button', { class: 'btn sec', type: 'button', onclick: () => { dlg.close(); dlg.remove(); } }, 'Cancelar'),
        h('button', { class: 'btn', type: 'submit' }, 'Añadir'))));
  document.body.append(dlg);
  dlg.showModal();
}

/* ---------- seguridad: diagnóstico básico ---------- */
const GRAVEDAD_TXT = { grave: 'Grave', media: 'Importante', baja: 'Leve' };
const fmtNota = (n) => String(n).replace('.', ',');
function claseNota(n) { return n >= 8 ? 'ok' : n >= 5 ? 'slow' : 'down'; }
function diagnosticoDe(o) { return estado.seguridad?.webs?.[o.id] || null; }

// Revisiones nuevas: secciones con su nota y dos notas globales (Seguridad y Visibilidad).
// Revisiones antiguas: solo los 10 puntos y una nota. Se pintan las dos formas.
const esAmpliado = (d) => Array.isArray(d?.secciones) && d.secciones.length > 0;
const fallosDe = (d) => esAmpliado(d)
  ? d.secciones.reduce((n, s) => n + s.hallazgos.filter((x) => x.estado === 'fallo' && x.gravedad).length, 0)
  : (d ? d.hallazgos.filter((x) => x.estado === 'fallo').length : 0);
const chipNota = (n) => (n === null || n === undefined)
  ? h('span', { class: 'chip none' }, '—')
  : h('span', { class: 'chip ' + claseNota(n) }, fmtNota(n) + ' / 10');

function lineaSeguridad(o) {
  if (!estado.seguridad) return null;
  const d = diagnosticoDe(o);
  const fallos = fallosDe(d);
  const mas = h('span', { class: 'seg-mas' }, d ? (fallos ? (fallos === 1 ? '1 cosa que mejorar' : fallos + ' cosas que mejorar') : 'Todo bien') : 'Revisar');
  if (esAmpliado(d)) {
    return h('button', { class: 'seg-linea', type: 'button', onclick: () => dialogoSeguridad(o) },
      h('span', {}, 'Seguridad'), chipNota(d.notas?.seguridad),
      h('span', {}, 'Visibilidad'), chipNota(d.notas?.visibilidad), mas);
  }
  return h('button', { class: 'seg-linea', type: 'button', onclick: () => dialogoSeguridad(o) },
    h('span', {}, 'Seguridad'),
    d ? h('span', { class: 'chip ' + claseNota(d.nota) }, fmtNota(d.nota) + ' / 10') : h('span', { class: 'chip none' }, 'Sin revisar'),
    mas);
}

async function lanzarRevision(objetivoId, origen) {
  const { data, error } = await sb.functions.invoke('seguridad', {
    body: { org_id: estado.org.org_id, objetivo_id: objetivoId, origen },
  });
  if (error) {
    let msg = 'No se ha podido revisar la web.';
    try { const j = await error.context.json(); if (j?.error) msg = j.error; } catch (_) { /* respuesta sin detalle */ }
    throw new Error(msg);
  }
  return data;
}

function hallazgo(x, veArreglos) {
  const fallo = x.estado === 'fallo';
  const requiere = x.estado === 'requiere';
  const recomendado = fallo && !x.gravedad; // recomendación: se muestra pero no resta nota
  const cls = x.estado === 'ok' ? 'ok' : fallo ? (x.gravedad === 'grave' ? 'down' : 'slow') : 'none';
  const etiqueta = x.estado === 'ok' ? 'Bien' : recomendado ? 'Recomendado' : fallo ? GRAVEDAD_TXT[x.gravedad] : requiere ? 'Requisito' : 'Sin comprobar';
  return h('li', { class: 'hall ' + (fallo ? 'fallo' : '') },
    h('div', { class: 'row' }, h('b', {}, x.titulo), h('span', { class: 'chip ' + cls }, etiqueta)),
    (fallo || requiere) && h('p', {}, x.explicacion),
    fallo && x.dato && h('p', { class: 'dato' }, 'Detectado: ', x.dato),
    requiere && x.dato && h('p', { class: 'dato' }, x.dato),
    x.estado === 'no_revisado' && x.codigo === 'SEG-09' && h('p', { class: 'dato' }, 'Se comprueba cuando demuestres que la web es tuya.'),
    x.estado === 'no_revisado' && x.codigo !== 'SEG-09' && x.dato && h('p', { class: 'dato' }, x.dato),
    fallo && (x.arreglo
      ? h('div', { class: 'arreglo' }, h('b', {}, 'Cómo arreglarlo'), h('span', {}, x.arreglo))
      : !veArreglos && h('div', { class: 'arreglo bloq' }, h('b', {}, 'Cómo arreglarlo'), h('span', {}, 'Disponible en el plan Pro.'))));
}

// Mejoras recomendadas (accesibilidad): no restan nota y no tienen gravedad.
function mejora(x, veArreglos) {
  const fallo = x.estado === 'fallo';
  const cls = x.estado === 'ok' ? 'ok' : fallo ? 'slow' : 'none';
  const etiqueta = x.estado === 'ok' ? 'Bien' : fallo ? 'Mejorable' : 'Sin comprobar';
  return h('li', { class: 'hall ' + (fallo ? 'fallo' : '') },
    h('div', { class: 'row' }, h('b', {}, x.titulo), h('span', { class: 'chip ' + cls }, etiqueta)),
    fallo && h('p', {}, x.explicacion),
    fallo && x.dato && h('p', { class: 'dato' }, 'Detectado: ', x.dato),
    x.estado === 'no_revisado' && h('p', { class: 'dato' }, 'No se puede comprobar en la revisión básica.'),
    fallo && (x.arreglo
      ? h('div', { class: 'arreglo' }, h('b', {}, 'Cómo arreglarlo'), h('span', {}, x.arreglo))
      : !veArreglos && h('div', { class: 'arreglo bloq' }, h('b', {}, 'Cómo arreglarlo'), h('span', {}, 'Disponible en el plan Pro.'))));
}

// Antes de pedir un arreglo hay que aceptar las condiciones del encargo (RGPD art. 28).
function dialogoEncargo(o, alAceptar) {
  const acepto = h('input', { type: 'checkbox', required: true });
  const err = h('div', { class: 'msg', role: 'alert' });
  const dlg = h('dialog', { 'aria-labelledby': 'tit-enc' },
    h('form', {
      method: 'dialog',
      onsubmit: async (e) => {
        e.preventDefault();
        const { error } = await sb.rpc('panel_solicitar_arreglo', { p_org: estado.org.org_id, p_objetivo: o.id, p_nota: null, p_acepto: acepto.checked });
        if (error) { err.className = 'msg err'; err.textContent = error.message || 'No se ha podido enviar.'; return; }
        dlg.close(); dlg.remove(); registrarUso('solicitar_arreglo', o.nombre); alAceptar();
      },
    },
      h('h2', { id: 'tit-enc' }, 'Pedir que lo arreglemos'),
      h('p', {}, 'Te contactamos con un presupuesto. Pedirlo no te obliga a nada.'),
      h('p', {}, 'Si lo aceptas, Zervitecnics accederá a tu web solo para hacer el arreglo, siguiendo tus instrucciones y guardando confidencialidad.'),
      h('label', { class: 'casilla' }, acepto,
        h('span', {}, 'Autorizo a Zervitecnics a contactarme y acepto las ',
          h('a', { href: 'legal.html#encargo', target: '_blank', rel: 'noopener' }, 'condiciones del encargo'), '.')),
      err,
      h('div', { class: 'acciones' },
        h('button', { class: 'btn sec', type: 'button', onclick: () => { dlg.close(); dlg.remove(); } }, 'Cancelar'),
        h('button', { class: 'btn', type: 'submit' }, 'Enviar solicitud'))));
  document.body.append(dlg);
  dlg.showModal();
}

// Demostrar que la web es tuya: con el código, de una de tres formas. Desbloquea las comprobaciones a fondo.
async function dialogoVerificar(o) {
  const { data, error } = await sb.rpc('panel_verificacion', { p_org: estado.org.org_id, p_objetivo: o.id });
  if (error) { alert(error.message || 'No se ha podido abrir.'); return; }
  const msg = h('div', { class: 'msg', role: 'status' });
  const cerrar = () => { dlg.close(); dlg.remove(); };
  const hecho = Boolean(data.verificada_en);
  const comprobar = h('button', { class: 'btn', type: 'button' }, 'Comprobar ahora');
  comprobar.onclick = async () => {
    comprobar.disabled = true; msg.className = 'msg'; msg.textContent = 'Comprobando…';
    const r = await sb.functions.invoke('seguridad', { body: { org_id: estado.org.org_id, objetivo_id: o.id, accion: 'verificar' } });
    let fallo = null;
    if (r.error) { fallo = 'No se ha podido comprobar.'; try { const j = await r.error.context.json(); if (j?.error) fallo = j.error; } catch (_) { /* sin detalle */ } }
    if (!fallo && r.data?.verificada) { registrarUso('verificar_web', o.nombre); cerrar(); await refrescar(); dialogoVerificar(o); return; }
    msg.className = 'msg err'; msg.textContent = fallo || 'Todavía no encontramos el código. Si lo acabas de poner en el DNS, puede tardar unos minutos.';
    comprobar.disabled = false;
  };
  const codigo = (t) => h('code', { class: 'codigo' }, t);
  const dlg = h('dialog', { class: 'dlg-seg', 'aria-labelledby': 'tit-ver' },
    h('div', { class: 'cuerpo' },
      h('div', {}, h('h2', { id: 'tit-ver' }, 'Demostrar que es tuya'), h('div', { class: 'url' }, o.url)),
      hecho
        ? h('div', { class: 'msg okk' }, 'Verificada ' + hace(data.verificada_en).replace(/^./, (c) => c.toLowerCase()) + '. Ya se pueden hacer las comprobaciones a fondo.')
        : [h('p', { class: 'resumen' }, 'Así sabemos que la web es tuya y podemos hacer comprobaciones más a fondo. Elige la forma que te resulte más fácil:'),
           h('ol', { class: 'pasos' },
             h('li', {}, h('b', {}, 'En el DNS del dominio. '), 'Añade un registro TXT con este valor:', codigo('zervitecnics-verificacion=' + data.token)),
             h('li', {}, h('b', {}, 'Con un archivo. '), 'Sube a tu web el archivo ', codigo('/.well-known/zervitecnics-verificacion.txt'), ' con este contenido:', codigo(data.token)),
             h('li', {}, h('b', {}, 'Con una etiqueta. '), 'Pega esto en la cabecera de la portada:', codigo('<meta name="zervitecnics-verificacion" content="' + data.token + '">')))],
      msg,
      h('div', { class: 'acciones' },
        h('button', { class: 'btn sec', type: 'button', onclick: cerrar }, 'Cerrar'),
        !hecho && comprobar)));
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  dlg.scrollTop = 0;
}

function dialogoSeguridad(o, sinContar) {
  if (!sinContar) registrarUso('abrir_diagnostico', o.nombre);
  const g = estado.seguridad;
  const d = diagnosticoDe(o);
  const quedan = Math.max(0, (g.max_revisiones_dia ?? 0) - (g.revisiones_hoy ?? 0));
  const msg = h('div', { class: 'msg', role: 'status' });
  const cerrar = () => { dlg.close(); dlg.remove(); };

  const revisar = h('button', { class: 'btn', type: 'button', disabled: !estado.esAdmin && quedan === 0 },
    estado.esAdmin ? 'Revisar ahora' : `Revisar ahora (${quedan === 1 ? 'te queda 1 hoy' : 'te quedan ' + quedan + ' hoy'})`);
  revisar.onclick = async () => {
    revisar.disabled = true; revisar.textContent = 'Revisando…';
    msg.className = 'msg'; msg.textContent = '';
    try {
      await lanzarRevision(o.id, d ? 'manual' : 'alta');
      registrarUso('revisar', o.nombre);
      await cargarTablero(); cerrar(); pintar(); dialogoSeguridad(o, true);
    } catch (e) {
      msg.className = 'msg err'; msg.textContent = e.message;
      revisar.disabled = false; revisar.textContent = 'Revisar ahora';
    }
  };

  const pedirArreglo = h('button', { class: 'btn sec', type: 'button' }, 'Quiero que me lo arreglen');
  pedirArreglo.onclick = () => dialogoEncargo(o, () => {
    msg.className = 'msg okk'; msg.textContent = 'Recibido. Te contactamos para arreglarlo.';
    pedirArreglo.textContent = 'Solicitud enviada'; pedirArreglo.disabled = true;
  });
  const puedeVerificar = estado.esAdmin || ['owner', 'admin'].includes(estado.org.rol);

  const fallos = fallosDe(d);
  const amp = esAmpliado(d);
  const NOMBRE_SECCION = { web: 'Web y conexión', correo: 'Correo y dominio', privacidad: 'Privacidad y datos personales', cumplimiento: 'Cumplimiento legal', seo: 'SEO · buscadores', aeo: 'AEO · respuestas de las IA' };
  const GRUPOS = [['Seguridad', ['web', 'correo', 'privacidad', 'cumplimiento'], 'seguridad'], ['Visibilidad', ['seo', 'aeo'], 'visibilidad']];
  const seccion = (s) => {
    const f = s.hallazgos.filter((x) => x.estado === 'fallo').length;
    return h('details', { class: 'seccion', ontoggle: (e) => { if (e.target.open) registrarUso('abrir_seccion', s.seccion); } },
      h('summary', {}, h('span', { class: 'sec-nom' }, NOMBRE_SECCION[s.seccion] || s.seccion), chipNota(s.nota),
        h('span', { class: 'seg-mas' }, f ? (f === 1 ? '1 punto' : f + ' puntos') : 'Todo bien')),
      h('ul', { class: 'halls' }, s.hallazgos.map((x) => hallazgo(x, g.ve_arreglos))));
  };
  const cuerpoAmpliado = () => GRUPOS.map(([titulo, claves, nota]) => {
    const secs = d.secciones.filter((s) => claves.includes(s.seccion));
    return secs.length > 0 && h('section', { class: 'grupo' },
      h('div', { class: 'grupo-cab' }, h('h3', {}, titulo), chipNota(d.notas?.[nota])),
      ...secs.map(seccion));
  });
  const dlg = h('dialog', { class: 'dlg-seg', 'aria-labelledby': 'tit-seg' },
    h('div', { class: 'cuerpo' },
      h('div', { class: 'seg-cab' },
        h('div', {}, h('h2', { id: 'tit-seg', tabindex: '-1', autofocus: true }, amp ? 'Diagnóstico de ' : 'Seguridad de ', o.nombre), h('div', { class: 'url' }, o.url)),
        d && !amp && h('div', { class: 'nota ' + claseNota(d.nota) }, h('b', {}, fmtNota(d.nota)), h('span', {}, 'de 10')),
        amp && h('div', { class: 'notas' },
          ...GRUPOS.map(([titulo, , nota]) => d.notas?.[nota] != null && h('div', { class: 'nota ' + claseNota(d.notas[nota]) },
            h('b', {}, fmtNota(d.notas[nota])), h('span', {}, titulo))))),
      d
        ? h('p', { class: 'resumen' }, fallos ? `Hemos encontrado ${fallos === 1 ? 'una cosa' : fallos + ' cosas'} que mejorar. ` : 'No hemos encontrado nada que mejorar. ',
            h('span', { class: 't' }, 'Revisado ' + hace(d.ts).replace(/^./, (c) => c.toLowerCase()) + '.'))
        : h('p', { class: 'resumen' }, 'Esta web todavía no tiene ninguna revisión de seguridad.'),
      d && !amp && h('ul', { class: 'halls' }, d.hallazgos.map((x) => hallazgo(x, g.ve_arreglos))),
      amp && cuerpoAmpliado(),
      d && d.mejoras?.length > 0 && h('section', { class: 'mejoras' },
        h('h3', {}, 'Mejoras recomendadas'),
        h('p', { class: 'sub' }, 'No restan nota.'),
        h('ul', { class: 'halls' }, d.mejoras.map((x) => mejora(x, g.ve_arreglos))),
        h('p', { class: 'letra-chica' }, 'Orientativo. La accesibilidad solo es obligatoria si la ley te alcanza (la Ley 11/2023 exime a las microempresas que prestan servicios, art. 3.3). Aun así, mejora tu web.')),
      d && !g.ve_arreglos && fallos > 0 && h('div', { class: 'aviso' }, h('b', {}, 'Plan Pro'),
        h('span', {}, 'Con el plan Pro ves cómo arreglar cada punto y puedes lanzar análisis más completos de tu web, app o bot.')),
      msg,
      h('div', { class: 'acciones' },
        h('button', { class: 'btn sec', type: 'button', onclick: cerrar }, 'Cerrar'),
        puedeVerificar && h('button', { class: 'btn sec', type: 'button', onclick: () => { cerrar(); dialogoVerificar(o); } }, 'Demostrar que es tuya'),
        d && fallos > 0 && pedirArreglo,
        revisar)));
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  dlg.scrollTop = 0; // que empiece por la nota y el resumen, no por los botones del final
}

/* ---------- fuentes de datos: búsquedas y visitas ---------- */
const NOMBRE_FUENTE = { search_console: 'Google', bing: 'Bing', cloudflare: 'Cloudflare' };
const ETIQ_FUENTE = {
  search_console: ['Clics desde Google', 'Apariciones en Google'],
  bing: ['Clics desde Bing', 'Apariciones en Bing'],
  cloudflare: ['Visitantes únicos', 'Peticiones'],
};
function variacion(ahora, antes) {
  if (!antes) return null;
  const p = Math.round(((ahora - antes) / antes) * 100);
  return (p > 0 ? '+' : '') + p + ' % frente a los 28 días anteriores';
}
function tarjetaFuente(f) {
  const [e1, e2] = ETIQ_FUENTE[f.tipo] || ['Visitas', 'Apariciones'];
  const fmt = (n) => Number(n || 0).toLocaleString('es-ES');
  const sinDatos = !f.dias_con_datos;
  const v = variacion(f.clics_28, f.clics_28_ant);
  return h('article', { class: 'card' },
    h('div', { class: 'row' },
      h('div', {}, h('div', { class: 'nom' }, f.nombre), h('div', { class: 'url' }, NOMBRE_FUENTE[f.tipo] || f.tipo)),
      h('span', { class: 'chip ' + (f.con_error ? 'down' : 'ok') }, f.con_error ? 'Sin conexión' : sinDatos ? 'Esperando datos' : 'Al día')),
    sinDatos ? h('p', { class: 'vacio' }, f.con_error ? 'No se han podido leer los datos todavía.' : 'Los primeros datos aparecen en cuanto se hace la primera lectura.')
      : [
        h('div', { class: 'meta' }, h('span', {}, e1, ' · 28 días'), h('b', {}, fmt(f.clics_28))),
        v && h('div', { class: 'meta' }, h('span', {}, v)),
        spark({ serie: f.serie }, 'ok'),
        h('div', { class: 'meta' }, h('span', {}, e2), h('b', {}, fmt(f.impr_28))),
        f.posicion_28 != null && h('div', { class: 'meta' }, h('span', {}, 'Posición media'), h('b', {}, String(f.posicion_28).replace('.', ','))),
      ],
    f.error && h('div', { class: 'meta' }, h('span', {}, f.error)));
}

/* ---------- conectar una fuente (solo administrador de la plataforma) ---------- */
function dialogoFuente(c) {
  const tipo = h('select', {},
    h('option', { value: 'search_console' }, 'Google Search Console'),
    h('option', { value: 'bing' }, 'Bing Webmaster'),
    h('option', { value: 'cloudflare' }, 'Cloudflare (analítica)'));
  const sitio = h('input', { type: 'text', required: true, maxlength: 200, placeholder: 'sc-domain:ejemplo.es', autocomplete: 'off' });
  const nombre = h('input', { type: 'text', required: true, maxlength: 80, placeholder: 'Nombre de la web' });
  const ayuda = h('div', { class: 'meta' });
  const AYUDAS = {
    search_console: ['sc-domain:ejemplo.es', 'La propiedad tal como sale en Search Console: «sc-domain:ejemplo.es» o la dirección completa con https:// y barra final.'],
    bing: ['https://ejemplo.es/', 'La dirección de la web tal como la diste de alta en Bing Webmaster.'],
    cloudflare: ['Identificador de zona', 'El «ID de zona» que sale en la página principal del dominio en Cloudflare.'],
  };
  const cambia = () => { const [ph, tx] = AYUDAS[tipo.value]; sitio.placeholder = ph; ayuda.replaceChildren(h('span', {}, tx)); };
  tipo.addEventListener('change', cambia); cambia();
  const err = h('div', { class: 'msg', role: 'alert' });
  const enviar = h('button', { class: 'btn', type: 'submit' }, 'Conectar');
  const dlg = h('dialog', { 'aria-labelledby': 'tit-fte' },
    h('form', {
      method: 'dialog',
      onsubmit: async (e) => {
        e.preventDefault();
        err.className = 'msg'; err.textContent = '';
        enviar.disabled = true;
        const { data, error } = await sb.functions.invoke('clientes', {
          body: { accion: 'fuente', org_id: c.org_id, tipo: tipo.value, sitio: sitio.value.trim(), nombre: nombre.value.trim() },
        });
        enviar.disabled = false;
        let msg = data && data.error;
        if (error && !msg) {
          try { msg = (await error.context.json()).error; } catch (_) { /* sin detalle */ }
          msg = msg || 'No se ha podido conectar.';
        }
        if (msg) { err.className = 'msg err'; err.textContent = msg; return; }
        dlg.close(); dlg.remove();
        alert('Fuente conectada. En unos segundos aparecerá en el panel de ese cliente.');
      },
    },
      h('h2', { id: 'tit-fte' }, `Conectar datos a ${c.nombre}`),
      h('label', { class: 'campo' }, 'Servicio', tipo),
      h('label', { class: 'campo' }, 'Sitio', sitio), ayuda,
      h('label', { class: 'campo' }, 'Nombre', nombre),
      err,
      h('div', { class: 'acciones' },
        h('button', { class: 'btn sec', type: 'button', onclick: () => { dlg.close(); dlg.remove(); } }, 'Cancelar'),
        enviar)));
  document.body.append(dlg);
  dlg.showModal();
}

function pintar() {
  const d = estado.datos;
  if (!estado.org) {
    pintarEn(app, cabecera(false), h('p', { class: 'vacio' }, 'Tu cuenta todavía no tiene acceso a ningún cliente. Pídele acceso a Junior.'));
    return;
  }
  const esAdmin = ['owner', 'admin'].includes(estado.org.rol);
  const objetivos = (d?.objetivos || []).filter((o) => {
    if (estado.filtro === 'todo') return true;
    return o.tipo === estado.filtro;
  });
  const r = d?.resumen || { total: 0, ok: 0, caidos: 0 };
  const caidos = (d?.objetivos || []).filter((o) => o.estado === 'caido');

  let titulo, texto;
  if (!r.total) { titulo = `${saludo()}. Empieza añadiendo tu primera web o bot.`; texto = 'En cuanto la añadas, la vigilamos cada pocos minutos y te avisamos si se cae.'; }
  else if (!caidos.length) { titulo = `${saludo()}. Todo funciona con normalidad.`; texto = `${r.ok} de ${r.total} en línea ahora.`; }
  else {
    titulo = `${saludo()}. Hay ${caidos.length === 1 ? 'una cosa' : caidos.length + ' cosas'} sin responder.`;
    texto = `${r.ok} de ${r.total} funcionan. ` + caidos.slice(0, 2).map((o) => `${o.nombre} no responde desde las ${hora(o.desde)}`).join('; ') + '.';
  }

  const stats = [
    [r.total ? `${r.ok} de ${r.total}` : '0', 'en línea ahora'],
    [fmtPct(r.uptime_30d), 'disponibilidad, 30 días'],
    [fmtMs(r.ms_medio_hoy), 'respuesta media hoy'],
  ];

  const tabs = [['todo', 'Todo'], ['web', 'Webs'], ['bot', 'Bots'], ['app', 'Apps']].map(([k, n]) =>
    h('button', { class: 'tab', type: 'button', 'aria-pressed': String(estado.filtro === k), onclick: () => { estado.filtro = k; pintar(); } }, n));

  const alertas = d?.alertas || [];

  pintarEn(app, 
    cabecera(true, tabs),
    h('section', { class: 'hero' }, sol(),
      h('div', { class: 'txt' },
        h('span', { class: 'fecha' }, new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })),
        h('h1', {}, titulo), h('p', {}, texto)),
      h('div', { class: 'stats' }, stats.map(([v, l]) => h('div', { class: 'stat' }, h('b', {}, v), h('span', {}, l))))),
    h('div', { class: 'cols' },
      h('section', { class: 'main' },
        h('div', { class: 'head' }, h('h2', {}, 'Tus webs y bots'),
          esAdmin && h('button', { class: 'btn', type: 'button', onclick: dialogoAnadir }, '+ Añadir web o bot')),
        objetivos.length ? h('div', { class: 'grid' }, objetivos.map((o) => tarjeta(o, esAdmin))) : h('p', { class: 'vacio' }, 'Aquí no hay nada todavía.')),
      h('aside', { class: 'side' },
        h('h2', {}, 'Qué ha pasado'),
        alertas.length
          ? h('div', { class: 'ev' }, alertas.map((a) => h('div', { class: 'it' },
              h('div', { class: 'dot ' + (a.prioridad || 'normal'), 'aria-hidden': 'true' }),
              h('div', {}, h('b', {}, a.titulo), a.detalle && h('div', { class: 'd' }, a.detalle), h('div', { class: 't' }, hace(a.creada_en))))))
          : h('p', { class: 'vacio' }, 'Sin novedades. Cuando algo cambie, lo verás aquí.'),
        h('div', { class: 'aviso' }, h('b', {}, 'Avisos al móvil activados'),
          h('span', {}, 'Las caídas te llegan por Telegram al momento. Lo demás lo ves aquí.')))),
    estado.fuentes.length ? h('section', { class: 'main' },
      h('div', { class: 'head' }, h('h2', {}, 'Búsquedas y visitas')),
      h('div', { class: 'grid' }, estado.fuentes.map(tarjetaFuente))) : null);
}

/* ---------- administración (solo administrador de la plataforma) ---------- */
const TIPO_USO = {
  entrada: 'Entró al panel', objetivo_anadido: 'Añadió', objetivo_quitado: 'Quitó',
  error_carga: 'Error al cargar', vista_admin: 'Abrió Administración',
  abrir_diagnostico: 'Abrió un diagnóstico', abrir_seccion: 'Abrió una sección', revisar: 'Lanzó una revisión',
  anadir_web: 'Añadió', solicitar_arreglo: 'Pidió un arreglo', ver_ayuda: 'Abrió la ayuda', verificar_web: 'Verificó una web',
  aceptar_legal: 'Aceptó las condiciones', verificar: 'Comprobó la verificación',
};
const NOMBRE_SEC_CORTO = { web: 'Web y conexión', correo: 'Correo y dominio', privacidad: 'Privacidad', cumplimiento: 'Cumplimiento legal', seo: 'SEO', aeo: 'AEO' };
const NOMBRE_DISP = { movil: 'Móvil', tableta: 'Tableta', ordenador: 'Ordenador' };
function nombrePais(c) {
  if (!/^[A-Z]{2}$/.test(c)) return c;
  try { return new Intl.DisplayNames(['es'], { type: 'region' }).of(c) || c; } catch (_) { return c; }
}
// Lista con barras: [{ v, n }] ya ordenada de más a menos.
function barras(titulo, lista, nombre) {
  const max = Math.max(1, ...lista.map((x) => x.n));
  return h('article', { class: 'card barras' }, h('h3', {}, titulo),
    lista.length
      ? lista.slice(0, 8).map((x) => h('div', { class: 'barra' },
          h('span', { class: 'bn' }, nombre ? nombre(x.v) : x.v), h('span', { class: 'bt', 'aria-hidden': 'true' }, h('i', { style: `width:${Math.round((x.n / max) * 100)}%` })), h('b', {}, String(x.n))))
      : h('p', { class: 'vacio' }, 'Sin datos todavía.'));
}
function seccionEstadisticas() {
  const e = estado.estadisticas;
  if (!e) return null;
  const g = e.grupos || {};
  const dias = e.por_dia || [];
  const maxDia = Math.max(1, ...dias.map((d) => d.n));
  return h('section', { class: 'main' }, h('h2', {}, `Estadísticas de uso, ${e.dias} días`),
    h('div', { class: 'stats adm-stats' },
      mosaico(String(e.entradas ?? 0), 'entradas al panel'), mosaico(String(e.usuarios ?? 0), 'personas distintas'),
      mosaico(String(e.clientes_activos ?? 0), 'clientes activos'), mosaico(String(e.webs_revisadas ?? 0), 'webs revisadas')),
    h('article', { class: 'card barras' }, h('h3', {}, 'Entradas por día'),
      h('div', { class: 'dias', role: 'img', 'aria-label': `Entradas por día: ${dias.map((d) => d.n).join(', ')}` },
        dias.map((d) => h('i', { style: `height:${Math.max(4, Math.round((d.n / maxDia) * 100))}%`, title: `${d.dia}: ${d.n}` })))),
    h('div', { class: 'grid cli' },
      barras('De qué país entran', g.pais || [], nombrePais),
      barras('Con qué dispositivo', g.dispositivo || [], (v) => NOMBRE_DISP[v] || v),
      barras('Zona horaria', g.zona || []),
      barras('Idioma del navegador', g.idioma || []),
      barras('Secciones más abiertas', g.seccion || [], (v) => NOMBRE_SEC_CORTO[v] || v),
      barras('Fallos más comunes (webs)', (e.fallos_comunes || []).map((x) => ({ v: x.titulo, n: x.n })))),
    h('article', { class: 'card' }, h('h3', { class: 'h3' }, 'Vieron fallos y no han pedido arreglo'),
      (e.sin_pedir_arreglo || []).length
        ? (e.sin_pedir_arreglo || []).map((x) => h('div', { class: 'meta' }, h('span', {}, h('b', {}, x.cliente)), h('span', {}, `${x.fallos} ${x.fallos === 1 ? 'fallo' : 'fallos'} · lo miró ${hace(x.visto).toLowerCase()}`)))
        : h('p', { class: 'vacio' }, 'Nadie por ahora.')),
    h('p', { class: 'letra-chica' }, 'Estadísticas propias: sin cookies ni empresas externas, y sin guardar la IP. Se borran a los 12 meses.'));
}
function seccionSeguridadPanel() {
  const s = estado.adminSeg;
  if (!s) return null;
  const recargar = async () => { await cargarAdmin(); pintarAdmin(); };
  const bloquear = async (ip) => {
    if (!confirm(`¿Bloquear ${ip} durante 30 días? No podrá lanzar revisiones ni añadir webs.`)) return;
    const { error } = await sb.rpc('panel_bloquear_ip', { p_ip: ip, p_motivo: null, p_dias: 30 });
    if (error) alert(error.message || 'No se ha podido bloquear.'); else recargar();
  };
  const desbloquear = async (ip) => {
    const { error } = await sb.rpc('panel_desbloquear_ip', { p_ip: ip });
    if (error) alert(error.message || 'No se ha podido desbloquear.'); else recargar();
  };
  return h('section', { class: 'main' }, h('h2', {}, 'Seguridad del panel'),
    h('div', { class: 'grid cli' },
      h('article', { class: 'card' }, h('h3', { class: 'h3' }, 'IP bloqueadas'),
        s.bloqueadas.length
          ? s.bloqueadas.map((b) => h('div', { class: 'meta' },
              h('span', {}, h('b', {}, b.ip), ' · ', b.motivo, b.automatica ? ' (automático)' : ''),
              h('button', { class: 'link', type: 'button', onclick: () => desbloquear(b.ip) }, 'Desbloquear')))
          : h('p', { class: 'vacio' }, 'Ninguna.')),
      h('article', { class: 'card' }, h('h3', { class: 'h3' }, 'IP con más actividad, 24 h'),
        s.activas.length
          ? s.activas.map((a) => h('div', { class: 'meta' },
              h('span', {}, h('b', {}, a.ip), a.pais ? ` · ${nombrePais(a.pais)}` : '', ` · ${a.n} ${a.n === 1 ? 'petición' : 'peticiones'}`),
              h('button', { class: 'link', type: 'button', onclick: () => bloquear(a.ip) }, 'Bloquear')))
          : h('p', { class: 'vacio' }, 'Sin actividad.'))),
    h('div', { class: 'ev' }, s.recientes.slice(0, 15).map((r) => h('div', { class: 'it' },
      h('div', { class: 'dot ' + (r.permitido ? 'informativo' : 'urgente'), 'aria-hidden': 'true' }),
      h('div', {}, h('b', {}, `${TIPO_USO[r.accion] || r.accion}${r.permitido ? '' : ' (rechazado)'}`),
        h('div', { class: 'd' }, `${r.email || 'Sin usuario'} · ${r.ip || 'sin IP'}${r.pais ? ' · ' + nombrePais(r.pais) : ''}`), h('div', { class: 't' }, hace(r.ts)))))),
    h('p', { class: 'letra-chica' }, 'La IP se guarda 12 meses solo para frenar abusos (RGPD art. 6.1.f). Tope por IP y hora: 30 revisiones; al superarlo se bloquea 24 horas.'));
}
function mosaico(valor, etiqueta, nivel) {
  return h('div', { class: 'stat adm ' + (nivel || '') }, h('b', {}, valor), h('span', {}, etiqueta));
}
function dialogoInvitar(clientes) {
  const email = h('input', { type: 'email', required: true, maxlength: 200, placeholder: 'cliente@ejemplo.com', autocomplete: 'off' });
  const cliente = h('select', {},
    h('option', { value: '' }, 'Cliente nuevo'),
    (clientes || []).map((c) => h('option', { value: c.org_id }, c.nombre)));
  const nombre = h('input', { type: 'text', maxlength: 80, placeholder: 'Nombre del cliente o negocio' });
  const campoNombre = h('label', { class: 'campo' }, 'Nombre del cliente nuevo', nombre);
  const rol = h('select', {},
    h('option', { value: 'owner' }, 'Dueño: ve y gestiona todo'),
    h('option', { value: 'admin' }, 'Administrador: añade y quita webs'),
    h('option', { value: 'viewer' }, 'Solo lectura: solo mira'));
  const maxObj = h('input', { type: 'number', min: 1, max: 500, value: 10 });
  const campoMax = h('label', { class: 'campo' }, 'Webs que puede vigilar', maxObj);
  const err = h('div', { class: 'msg', role: 'alert' });
  const enviar = h('button', { class: 'btn', type: 'submit' }, 'Enviar invitación');
  const alternar = () => {
    const nuevo = cliente.value === '';
    campoNombre.hidden = !nuevo; campoMax.hidden = !nuevo;
    nombre.required = nuevo;
  };
  cliente.addEventListener('change', alternar);
  const dlg = h('dialog', { 'aria-labelledby': 'tit-inv' },
    h('form', {
      method: 'dialog',
      onsubmit: async (e) => {
        e.preventDefault();
        err.className = 'msg'; err.textContent = '';
        enviar.disabled = true;
        const cuerpo = { accion: 'invitar', email: email.value.trim(), rol: rol.value };
        if (cliente.value) cuerpo.org_id = cliente.value;
        else { cuerpo.org_nombre = nombre.value.trim(); cuerpo.max_objetivos = parseInt(maxObj.value, 10); }
        const { data, error } = await sb.functions.invoke('clientes', { body: cuerpo });
        enviar.disabled = false;
        let msg = data && data.error;
        if (error && !msg) {
          try { msg = (await error.context.json()).error; } catch (_) { /* sin detalle */ }
          msg = msg || 'No se ha podido enviar la invitación.';
        }
        if (msg) { err.className = 'msg err'; err.textContent = msg; return; }
        dlg.close(); dlg.remove();
        await cargarAdmin(); pintarAdmin();
        alert(data.invitado ? 'Invitación enviada por correo.' : 'Esa persona ya tenía cuenta: se ha añadido al cliente.');
      },
    },
      h('h2', { id: 'tit-inv' }, 'Invitar a un cliente'),
      h('label', { class: 'campo' }, 'Correo de la persona', email),
      h('label', { class: 'campo' }, 'Cliente', cliente),
      campoNombre, campoMax,
      h('label', { class: 'campo' }, 'Qué puede hacer', rol),
      err,
      h('div', { class: 'acciones' },
        h('button', { class: 'btn sec', type: 'button', onclick: () => { dlg.close(); dlg.remove(); } }, 'Cancelar'),
        enviar)));
  alternar();
  document.body.append(dlg);
  dlg.showModal();
}
function pintarAdmin() {
  const a = estado.admin || {};
  const s = a.sistema || {};
  const pct = s.db_limite_mb ? Math.round((s.db_mb / s.db_limite_mb) * 100) : 0;
  const minSin = s.ultimo_chequeo ? Math.round((Date.now() - new Date(s.ultimo_chequeo).getTime()) / 60000) : null;
  const chequeoNivel = s.objetivos_activos === 0 ? '' : minSin == null || minSin > 10 ? 'mal' : 'bien';
  const sistema = [
    mosaico(s.objetivos_activos === 0 ? 'Sin webs aún' : minSin == null ? 'Sin datos' : hace(s.ultimo_chequeo).replace('Hace ', ''), 'última comprobación', chequeoNivel),
    mosaico(`${s.db_mb ?? 0} de ${s.db_limite_mb ?? 500} MB`, `base de datos (${pct} %)`, pct >= 80 ? 'mal' : 'bien'),
    mosaico(String(s.avisos_sin_enviar ?? 0), 'avisos sin enviar', s.avisos_sin_enviar > 0 ? 'mal' : 'bien'),
    mosaico(String(s.tareas_fallidas_24h ?? 0), 'tareas fallidas, 24 h', s.tareas_fallidas_24h > 0 ? 'mal' : 'bien'),
    mosaico(String(s.peticiones_error_1h ?? 0), 'peticiones con error, 1 h', s.peticiones_error_1h > 0 ? 'mal' : 'bien'),
  ];
  const clientes = a.clientes || [];
  const uso = a.uso || {};
  const recientes = uso.recientes || [];
  const porTipo = Object.entries(uso.por_tipo_7d || {});

  pintarEn(app, 
    cabecera(false),
    h('section', { class: 'hero' }, sol(),
      h('div', { class: 'txt' },
        h('span', { class: 'fecha' }, 'Administración'),
        h('h1', {}, 'Cómo va toda la plataforma'),
        h('p', {}, `${clientes.length} ${clientes.length === 1 ? 'cliente' : 'clientes'}. Solo tú ves esta pantalla.`))),
    h('section', { class: 'main' }, h('h2', {}, 'Estado del sistema'), h('div', { class: 'stats adm-stats' }, sistema)),
    h('section', { class: 'main' },
      h('div', { class: 'head' }, h('h2', {}, 'Clientes'),
        h('button', { class: 'btn', type: 'button', onclick: () => dialogoInvitar(clientes) }, '+ Invitar cliente')),
      clientes.length ? h('div', { class: 'grid cli' }, clientes.map((c) => h('article', { class: 'card' },
        h('div', { class: 'row' }, h('div', { class: 'nom' }, c.nombre),
          h('span', { class: 'chip ' + (c.caidos > 0 ? 'down' : 'ok') }, c.caidos > 0 ? `${c.caidos} sin responder` : 'Todo en línea')),
        h('div', { class: 'meta' },
          h('span', {}, 'Webs ', h('b', {}, `${c.objetivos} de ${c.max_objetivos}`)),
          h('span', {}, 'Comprobaciones 24 h ', h('b', {}, String(c.chequeos_24h)))),
        h('div', { class: 'usuarios' }, (c.usuarios || []).map((u) => h('div', { class: 'meta' },
          h('span', {}, u.email, ' · ', u.rol),
          h('span', {}, u.ultimo_acceso ? hace(u.ultimo_acceso) : 'Nunca entró')))),
        h('div', { class: 'acciones' },
          h('button', { class: 'btn sec', type: 'button', onclick: () => dialogoFuente(c) }, 'Conectar datos')))))
        : h('p', { class: 'vacio' }, 'Todavía no hay clientes.')),
    seccionEstadisticas(),
    seccionSeguridadPanel(),
    h('section', { class: 'main' }, h('h2', {}, 'Uso del panel'),
      porTipo.length ? h('div', { class: 'stats adm-stats' }, porTipo.map(([t, n]) => mosaico(String(n), (TIPO_USO[t] || t) + ', 7 días'))) : null,
      recientes.length
        ? h('div', { class: 'ev' }, recientes.map((e) => h('div', { class: 'it' },
            h('div', { class: 'dot ' + (e.tipo === 'error_carga' ? 'urgente' : 'informativo'), 'aria-hidden': 'true' }),
            h('div', {}, h('b', {}, `${TIPO_USO[e.tipo] || e.tipo}${e.detalle ? ': ' + e.detalle : ''}`),
              h('div', { class: 'd' }, `${e.email || 'Usuario'} · ${e.org || ''}`), h('div', { class: 't' }, hace(e.ts))))))
        : h('p', { class: 'vacio' }, 'Aún no hay actividad registrada.')));
}

/* ---------- ayuda para los usuarios (solo uso, sin detalles internos) ---------- */
function pintarAyuda() {
  const rol = estado.org ? estado.org.rol : 'viewer';
  const puedeEditar = ['owner', 'admin'].includes(rol);
  const bloque = (titulo, ...parrafos) => h('article', { class: 'card ayuda' }, h('h3', {}, titulo), parrafos.flat(2));
  const estadoAyuda = (cls, texto, desc) => h('div', { class: 'meta' }, h('span', { class: 'chip ' + cls }, texto), h('span', {}, desc));
  pintarEn(app, 
    cabecera(false),
    h('section', { class: 'hero' }, sol(),
      h('div', { class: 'txt' },
        h('span', { class: 'fecha' }, 'Ayuda'),
        h('h1', {}, 'Cómo usar tu panel'),
        h('p', {}, 'Aquí ves si tus webs y bots funcionan, y te avisamos al móvil cuando algo falla.'))),
    h('div', { class: 'grid ayuda-grid' },
      bloque('Entrar',
        h('p', {}, 'Escribe tu correo y pulsa para recibir el enlace. Te llega un correo de Zervitecnics con el botón «Entrar al panel». El enlace caduca pronto y sirve una sola vez.'),
        h('p', {}, 'Después la sesión se queda abierta en ese navegador. Para cerrarla, pulsa «Salir».')),
      bloque('La cabecera amarilla',
        h('p', {}, 'Resume cómo va todo. Debajo verás cuántas webs están en línea ahora, la disponibilidad de los últimos 30 días y el tiempo medio de respuesta de hoy.')),
      bloque('Qué significa cada estado',
        estadoAyuda('ok', 'Funciona', 'Responde bien y rápido.'),
        estadoAyuda('slow', 'Va lento', 'Responde, pero tarda más de 1,5 segundos.'),
        estadoAyuda('down', 'No responde', 'Ha fallado dos comprobaciones seguidas.'),
        estadoAyuda('none', 'Sin datos', 'Todavía no se ha comprobado.')),
      bloque('Cada cuánto se comprueba',
        h('p', {}, 'Cada web o bot se comprueba cada 5 minutos, de día y de noche. La línea de cada tarjeta muestra cómo ha respondido en las últimas 24 horas.')),
      bloque('Avisos al móvil',
        h('p', {}, 'Si algo deja de responder, te llega un aviso por Telegram en unos minutos. También lo verás en «Qué ha pasado», junto a cuándo vuelve a funcionar.'),
        h('p', {}, 'Los lunes por la mañana recibes un resumen de la semana.')),
      bloque(puedeEditar ? 'Añadir o quitar webs' : 'Tu acceso',
        puedeEditar
          ? [h('p', {}, 'Pulsa «+ Añadir web o bot», escribe un nombre y la dirección completa (por ejemplo, https://tuweb.com) y elige el tipo.'),
             h('p', {}, 'Para dejar de vigilar algo, pulsa «Dejar de vigilar» en su tarjeta. Tu plan incluye un número máximo de webs.')]
          : h('p', {}, 'Tu acceso es de solo lectura: puedes ver todo, pero no añadir ni quitar webs. Si necesitas cambiar algo, pídeselo a Zervitecnics.')),
      bloque('Búsquedas y visitas',
        h('p', {}, 'Si tu plan lo incluye, verás cuántas veces apareces en Google y Bing, cuántas personas hacen clic y las visitas a tu web, comparado con los 28 días anteriores. Se actualiza una vez al día.')),
      bloque('Claro u oscuro',
        h('p', {}, 'Con los botones «Claro» y «Oscuro» eliges cómo ver el panel. Se recuerda en este navegador.')),
      bloque('Tus datos',
        h('p', {}, 'El panel no usa cookies de seguimiento ni comparte tus datos para publicidad. Guardamos tu dirección IP 12 meses solo para evitar abusos.'),
        h('p', {}, h('a', { href: 'legal.html#privacidad', target: '_blank', rel: 'noopener' }, 'Política de privacidad'), ' · ',
          h('a', { href: 'legal.html#condiciones', target: '_blank', rel: 'noopener' }, 'Condiciones de uso'), ' · ',
          h('a', { href: 'legal.html#aviso', target: '_blank', rel: 'noopener' }, 'Aviso legal'))),
      bloque('¿Necesitas ayuda?',
        h('p', {}, 'Escribe a Zervitecnics: ', h('b', {}, 'info@zervitecnics.es')))));
}

function cabecera(conTabs, tabs) {
  const t = temaActual();
  const selectorOrg = estado.orgs.length > 1 && h('select', {
    class: 'org', 'aria-label': 'Cliente',
    onchange: async (e) => {
      estado.org = estado.orgs.find((o) => o.org_id === e.target.value);
      try { localStorage.setItem('org', estado.org.org_id); } catch (_) { /* nada */ }
      await refrescar();
    },
  }, estado.orgs.map((o) => h('option', { value: o.org_id, selected: estado.org && o.org_id === estado.org.org_id }, o.nombre)));
  return h('header', { class: 'top' },
    h('div', { class: 'brand' }, h('div', { class: 'logo', 'aria-hidden': 'true' }, 'Z'),
      h('div', {}, h('b', {}, estado.org ? estado.org.nombre : 'Zervitecnics'), h('span', {}, 'Panel de monitoreo'))),
    conTabs && h('nav', { class: 'tabs', 'aria-label': 'Filtro' }, tabs),
    h('div', { class: 'tools' }, selectorOrg,
      estado.esAdmin && h('div', { class: 'seg', role: 'group', 'aria-label': 'Vista' },
        [['panel', 'Mi panel'], ['admin', 'Administración']].map(([k, n]) => h('button', {
          type: 'button', 'aria-pressed': String(estado.vista === k), onclick: () => cambiarVista(k),
        }, n))),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Tema' },
        ['claro', 'oscuro'].map((n) => h('button', {
          type: 'button', 'aria-pressed': String(t === n),
          onclick: () => { aplicarTema(n, true); repintar(); },
        }, n === 'claro' ? 'Claro' : 'Oscuro'))),
      h('button', { class: 'link', type: 'button', 'aria-pressed': String(estado.vista === 'ayuda'),
        onclick: () => cambiarVista(estado.vista === 'ayuda' ? 'panel' : 'ayuda') }, estado.vista === 'ayuda' ? 'Volver al panel' : 'Ayuda'),
      h('button', { class: 'link', type: 'button', onclick: async () => { await sb.auth.signOut(); estado.datos = null; estado.vista = 'panel'; estado.esAdmin = false; try { sessionStorage.removeItem('entrada'); } catch (_) { /* nada */ } pantallaLogin(); } }, 'Salir')));
}

/* ---------- aceptación de condiciones y privacidad (antes de usar el panel) ---------- */
function pantallaAceptar(version) {
  clearInterval(estado.timer);
  const casilla = h('input', { type: 'checkbox', required: true });
  const aviso = h('div', { class: 'msg', role: 'status' });
  const enlace = (ancla, texto) => h('a', { href: 'legal.html#' + ancla, target: '_blank', rel: 'noopener' }, texto);
  pintarEn(app, h('form', {
    class: 'login',
    onsubmit: async (e) => {
      e.preventDefault();
      const { error } = await sb.rpc('panel_aceptar_legal', { p_version: version });
      if (error) { aviso.className = 'msg err'; aviso.textContent = error.message || 'No se ha podido guardar. Inténtalo de nuevo.'; return; }
      iniciar();
    },
  },
    h('div', { class: 'brand' }, h('div', { class: 'logo', 'aria-hidden': 'true' }, 'Z'),
      h('div', {}, h('b', {}, 'Zervitecnics'), h('span', {}, 'Panel de monitoreo'))),
    h('h1', {}, 'Antes de empezar'),
    h('p', {}, 'Para usar el panel necesitamos que aceptes cómo funciona y cómo tratamos tus datos. En corto:'),
    h('ul', { class: 'puntos' },
      h('li', {}, 'Revisamos solo las webs, apps y bots que tú añadas, y deben ser tuyos o tener permiso de su titular.'),
      h('li', {}, 'Guardamos tu correo, tus webs y los resultados de las revisiones para darte el servicio.'),
      h('li', {}, 'Guardamos tu dirección IP 12 meses, solo para evitar abusos.'),
      h('li', {}, 'No usamos cookies de seguimiento ni compartimos tus datos para publicidad.')),
    h('label', { class: 'casilla' }, casilla,
      h('span', {}, 'He leído y acepto las ', enlace('condiciones', 'condiciones de uso'), ' y la ', enlace('privacidad', 'política de privacidad'), '.')),
    h('button', { class: 'btn', type: 'submit' }, 'Aceptar y entrar'),
    h('button', { class: 'link', type: 'button', onclick: async () => { await sb.auth.signOut(); pantallaLogin(); } }, 'No acepto: salir'),
    aviso));
}

/* ---------- arranque ---------- */
async function iniciar() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { pantallaLogin(); return; }
  try {
    // Sin aceptar la versión vigente de las condiciones y la privacidad no se carga ningún dato.
    const legal = await sb.rpc('panel_estado_legal');
    if (legal.error) throw legal.error;
    if (!legal.data?.aceptada) { pantallaAceptar(legal.data?.version); return; }
    await cargarOrgs();
    try { const r = await sb.rpc('panel_es_admin'); estado.esAdmin = r.data === true; } catch (_) { estado.esAdmin = false; }
    await cargarTablero();
    pintar();
    let ya = false;
    try { ya = sessionStorage.getItem('entrada') === '1'; sessionStorage.setItem('entrada', '1'); } catch (_) { /* nada */ }
    if (!ya) registrarUso('entrada', null);
    clearInterval(estado.timer);
    estado.timer = setInterval(refrescar, REFRESCO_MS);
  } catch (e) {
    console.error(e);
    registrarUso('error_carga', 'inicio');
    pantallaLogin('No se han podido cargar los datos. Vuelve a entrar.', 'err');
  }
}
sb.auth.onAuthStateChange((evento) => {
  if (evento === 'SIGNED_IN') iniciar();
  if (evento === 'SIGNED_OUT') pantallaLogin();
});
iniciar();
