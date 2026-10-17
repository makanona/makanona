/* مكاننا: حفظ الصفحة ومكتباتها على الهاتف (Service Worker).
   - الصفحة وملفات اللغات ومكتبتا الخرائط وFirebase والخط تُحفظ كلها من أول فتحة، وتُقدَّم من ذاكرة الهاتف فوراً
     وتُحدَّث في الخلفية، فيصل أي تعديل منشور في الفتح التالي، وتفتح الصفحة بلا إنترنت.
   - صور الخريطة التي شوهدت تُحفظ (حتى نحو 2000 صورة) ويُحذف الأقدم تلقائياً. لا تحميل مسبق لمناطق.
   - لا يلمس قاعدة البيانات ولا تسجيل الدخول ولا أي صفحة أخرى.
   - للإيقاف الطارئ: استبدل محتوى هذا الملف بسطر واحد:
     self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(self.registration.unregister()));
*/
const V = 'mk-v29';
const TILES = 'mk-tiles';                 // لا يُحذف مع تغيّر الإصدار
const TILE_MAX = 2000, TILE_AGE = 30 * 864e5;
const CORE = ['./index.html', './i18n.en.js', './i18n.de.js', './i18n.tr.js', './i18n.ru.js', './i18n.nl.js', './i18n.fr.js'];
const LIBS = [
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js',
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap'
];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(V).then(c => Promise.all([
    ...CORE.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => {})),
    ...LIBS.map(u => c.add(new Request(u, { mode: 'cors' })).catch(() => {}))
  ])));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const old = (await caches.keys()).filter(k => k !== V && k !== TILES && k.startsWith('mk-'));
    if (old.length) {                                                    // ننقل ما حُفظ في الإصدار السابق حتى لا يضيع إن فشل تنزيله الآن
      const c = await caches.open(V);
      for (const k of old) {
        try { const o = await caches.open(k); for (const req of await o.keys()) if (!(await c.match(req))) { const r = await o.match(req); if (r) await c.put(req, r); } } catch {}
        await caches.delete(k);
      }
    }
    await self.clients.claim();
  })());
});

const scopePath = new URL(self.registration.scope).pathname;          // مثل /makanona/
function kind(u) {
  if (u.origin === location.origin) {
    const p = u.pathname;
    if (p === scopePath || p === scopePath + 'index.html') return 'page';
    if (/\/i18n\.[a-z]{2}\.js$/.test(p)) return 'own';
    return null;
  }
  if (u.host === 'cdnjs.cloudflare.com' && u.pathname.includes('/leaflet/')) return 'lib';
  if (u.host === 'www.gstatic.com' && u.pathname.startsWith('/firebasejs/')) return 'lib';
  if (u.host === 'fonts.googleapis.com' || u.host === 'fonts.gstatic.com') return 'lib';
  if (u.host === 'tile.openstreetmap.org' || (u.host === 'server.arcgisonline.com' && u.pathname.includes('/tile/'))) return 'tile';
  return null;
}

let tilePuts = 0;
async function trimTiles(c) {
  const keys = await c.keys();                                           // بترتيب الإضافة: الأقدم أولاً
  for (let i = 0; i < keys.length - TILE_MAX; i++) await c.delete(keys[i]);
}
function tileFetch(e, c, r) {
  return fetch(r).then(res => {
    if (res && res.ok && res.type !== 'opaque') {                        // صور CORS فقط (تُحسب بحجمها الحقيقي)
      e.waitUntil(c.put(r.url, res.clone()).then(() => { if (++tilePuts % 50 === 0) return trimTiles(c); }).catch(() => {}));
    }
    return res;
  });
}

self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url), k = kind(u);
  if (!k) return;
  if (k === 'tile') {
    e.respondWith((async () => {
      const c = await caches.open(TILES);
      const hit = await c.match(r.url);
      if (hit) {
        const d = Date.parse(hit.headers.get('date') || '');
        if (!(d > 0) || Date.now() - d > TILE_AGE) e.waitUntil(tileFetch(e, c, r).catch(() => {}));   // قديمة: تحديث في الخلفية
        return hit;
      }
      return tileFetch(e, c, r);
    })());
    return;
  }
  const key = k === 'page' ? location.origin + scopePath + 'index.html' : (k === 'own' ? location.origin + u.pathname : r.url);
  e.respondWith((async () => {
    const c = await caches.open(V);
    const hit = await c.match(key);
    const net = fetch(r).then(res => {
      if (res && res.ok) c.put(key, res.clone()).catch(() => {});
      return res;
    });
    if (hit) { e.waitUntil(net.catch(() => {})); return hit; }      // من الذاكرة فوراً، والتحديث في الخلفية
    try { return await net; }
    catch (err) { const any = await c.match(key); if (any) return any; throw err; }
  })());
});
