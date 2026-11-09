'use strict';
// Panel de monitoreo · Zervitecnics
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

const estado = { orgs: [], org: null, datos: null, filtro: 'todo', timer: null };

/* ---------- utilidades de DOM (nunca se inserta texto como HTML) ---------- */
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
  app.replaceChildren(form);
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
}
async function refrescar() {
  try { await cargarTablero(); pintar(); } catch (e) { console.error(e); }
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
        const { error } = await sb.rpc('panel_crear_objetivo', {
          p_org: estado.org.org_id, p_nombre: nombre.value.trim(), p_url: url.value.trim(), p_tipo: tipo.value,
        });
        if (error) { err.className = 'msg err'; err.textContent = error.message || 'No se ha podido añadir.'; return; }
        dlg.close(); dlg.remove(); refrescar();
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

function pintar() {
  const d = estado.datos;
  if (!estado.org) {
    app.replaceChildren(cabecera(false), h('p', { class: 'vacio' }, 'Tu cuenta todavía no tiene acceso a ningún cliente. Pídele acceso a Junior.'));
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

  app.replaceChildren(
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
          h('span', {}, 'Las caídas te llegan por Telegram al momento. Lo demás lo ves aquí.')))));
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
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Tema' },
        ['claro', 'oscuro'].map((n) => h('button', {
          type: 'button', 'aria-pressed': String(t === n),
          onclick: () => { aplicarTema(n, true); pintar(); },
        }, n === 'claro' ? 'Claro' : 'Oscuro'))),
      h('button', { class: 'link', type: 'button', onclick: async () => { await sb.auth.signOut(); estado.datos = null; pantallaLogin(); } }, 'Salir')));
}

/* ---------- arranque ---------- */
async function iniciar() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { pantallaLogin(); return; }
  try {
    await cargarOrgs();
    await cargarTablero();
    pintar();
    clearInterval(estado.timer);
    estado.timer = setInterval(refrescar, REFRESCO_MS);
  } catch (e) {
    console.error(e);
    pantallaLogin('No se han podido cargar los datos. Vuelve a entrar.', 'err');
  }
}
sb.auth.onAuthStateChange((evento) => {
  if (evento === 'SIGNED_IN') iniciar();
  if (evento === 'SIGNED_OUT') pantallaLogin();
});
iniciar();
