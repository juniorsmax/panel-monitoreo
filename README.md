# Panel de monitoreo · Zervitecnics

Panel multicliente para vigilar webs, bots y apps, con avisos urgentes por Telegram.

- Pantalla estática (sin servidor): `index.html`, `styles.css`, `app.js`. Se publica con GitHub Pages.
- Datos y acceso: Supabase (proyecto `panel-monitoreo`), con reglas de acceso (RLS) por cliente.
- En este repositorio no hay secretos: la URL y la clave `publishable` de Supabase son públicas por diseño.
