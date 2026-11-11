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

const estado = { orgs: [], org: null, datos: null, filtro: 'todo', timer: null, esAdmin: false, vista: 'panel', admin: null, fuentes: [], seguridad: null };

/* ---------- utilidades de DOM (nunca se inserta texto como HTML) ---------- */
// Como replaceChildren, pero ignora los huecos (null/false) igual que h(): si no, se pintaría el texto «null».
function pintarEn(el, ...hijos) { el.replaceChildren(...hijos.flat().filter((c) => c != null && c !== false)); }
function h(tag, attrs, ...hijos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
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
function registrarUso(tipo, detalle) {
  if (!estado.org) return;
  sb.rpc('panel_registrar_uso', { p_org: estado.org.org_id, p_tipo: tipo, p_detalle: detalle || null })
    .then(() => {}, () => {});
}
async function cambiarVista(v) {
  estado.vista = v;
  if (v === 'ayuda') { pintarAyuda(); window.scrollTo(0, 0); return; }
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
  const dlg = h('dialog', { 'aria-labelledby': 'tit-dlg' },
    h('form', {
      method: 'dialog',
      onsubmit: async (e) => {
        e.preventDefault();
        err.className = 'msg'; err.textContent = '';
        const { data, error } = await sb.rpc('panel_crear_objetivo', {
          p_org: estado.org.org_id, p_nombre: nombre.value.trim(), p_url: url.value.trim(), p_tipo: tipo.value,
        });
        if (error) { err.className = 'msg err'; err.textContent = error.message || 'No se ha podido añadir.'; return; }
        dlg.close(); dlg.remove(); refrescar();
        // Primera revisión de seguridad: queda como punto de partida. Si falla, la web se añade igual.
        lanzarRevision(data, 'alta').then(() => refrescar(), () => {});
      },
    },
      h('h2', { id: 'tit-dlg' }, 'Añadir web o bot'),
      h('label', { class: 'campo' }, 'Nombre', nombre),
      h('label', { class: 'campo' }, 'Dirección (URL)', url),
      h('label', { class: 'campo' }, 'Tipo', tipo),
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

function lineaSeguridad(o) {
  if (!estado.seguridad) return null;
  const d = diagnosticoDe(o);
  const fallos = d ? d.hallazgos.filter((x) => x.estado === 'fallo').length : 0;
  return h('button', { class: 'seg-linea', type: 'button', onclick: () => dialogoSeguridad(o) },
    h('span', {}, 'Seguridad'),
    d ? h('span', { class: 'chip ' + claseNota(d.nota) }, fmtNota(d.nota) + ' / 10') : h('span', { class: 'chip none' }, 'Sin revisar'),
    h('span', { class: 'seg-mas' }, d ? (fallos ? (fallos === 1 ? '1 cosa que mejorar' : fallos + ' cosas que mejorar') : 'Todo bien') : 'Revisar'));
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
  const cls = x.estado === 'ok' ? 'ok' : x.estado === 'fallo' ? (x.gravedad === 'grave' ? 'down' : 'slow') : 'none';
  const etiqueta = x.estado === 'ok' ? 'Bien' : x.estado === 'fallo' ? GRAVEDAD_TXT[x.gravedad] : 'Sin comprobar';
  return h('li', { class: 'hall ' + (fallo ? 'fallo' : '') },
    h('div', { class: 'row' }, h('b', {}, x.titulo), h('span', { class: 'chip ' + cls }, etiqueta)),
    fallo && h('p', {}, x.explicacion),
    fallo && x.dato && h('p', { class: 'dato' }, 'Detectado: ', x.dato),
    x.estado === 'no_revisado' && x.codigo === 'SEG-09' && h('p', { class: 'dato' }, 'Se comprueba cuando demuestres que la web es tuya.'),
    fallo && (x.arreglo
      ? h('div', { class: 'arreglo' }, h('b', {}, 'Cómo arreglarlo'), h('span', {}, x.arreglo))
      : !veArreglos && h('div', { class: 'arreglo bloq' }, h('b', {}, 'Cómo arreglarlo'), h('span', {}, 'Disponible en el plan Pro.'))));
}

function dialogoSeguridad(o) {
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
      await cargarTablero(); cerrar(); pintar(); dialogoSeguridad(o);
    } catch (e) {
      msg.className = 'msg err'; msg.textContent = e.message;
      revisar.disabled = false; revisar.textContent = 'Revisar ahora';
    }
  };

  const pedirArreglo = h('button', { class: 'btn sec', type: 'button' }, 'Quiero que me lo arreglen');
  pedirArreglo.onclick = async () => {
    pedirArreglo.disabled = true;
    const { error } = await sb.rpc('panel_solicitar_arreglo', { p_org: estado.org.org_id, p_objetivo: o.id, p_nota: null });
    if (error) { msg.className = 'msg err'; msg.textContent = error.message || 'No se ha podido enviar.'; pedirArreglo.disabled = false; return; }
    msg.className = 'msg okk'; msg.textContent = 'Recibido. Te contactamos para arreglarlo.';
    pedirArreglo.textContent = 'Solicitud enviada';
    registrarUso('solicitar_arreglo', o.nombre);
  };

  const fallos = d ? d.hallazgos.filter((x) => x.estado === 'fallo').length : 0;
  const dlg = h('dialog', { class: 'dlg-seg', 'aria-labelledby': 'tit-seg' },
    h('div', { class: 'cuerpo' },
      h('div', { class: 'seg-cab' },
        h('div', {}, h('h2', { id: 'tit-seg', tabindex: '-1', autofocus: true }, 'Seguridad de ', o.nombre), h('div', { class: 'url' }, o.url)),
        d && h('div', { class: 'nota ' + claseNota(d.nota) }, h('b', {}, fmtNota(d.nota)), h('span', {}, 'de 10'))),
      d
        ? h('p', { class: 'resumen' }, fallos ? `Hemos encontrado ${fallos === 1 ? 'una cosa' : fallos + ' cosas'} que mejorar. ` : 'No hemos encontrado nada que mejorar. ',
            h('span', { class: 't' }, 'Revisado ' + hace(d.ts).replace(/^./, (c) => c.toLowerCase()) + '.'))
        : h('p', { class: 'resumen' }, 'Esta web todavía no tiene ninguna revisión de seguridad.'),
      d && h('ul', { class: 'halls' }, d.hallazgos.map((x) => hallazgo(x, g.ve_arreglos))),
      d && !g.ve_arreglos && fallos > 0 && h('div', { class: 'aviso' }, h('b', {}, 'Plan Pro'),
        h('span', {}, 'Con el plan Pro ves cómo arreglar cada punto y puedes lanzar análisis más completos de tu web, app o bot.')),
      msg,
      h('div', { class: 'acciones' },
        h('button', { class: 'btn sec', type: 'button', onclick: cerrar }, 'Cerrar'),
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
};
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

/* ---------- arranque ---------- */
async function iniciar() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { pantallaLogin(); return; }
  try {
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
