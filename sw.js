/* مكاننا: حفظ الصفحة ومكتباتها على الهاتف (Service Worker).
   - الصفحة وملفات اللغات ومكتبتا الخرائط وFirebase تُقدَّم من ذاكرة الهاتف فوراً، وتُحدَّث في الخلفية،
     فيصل أي تعديل منشور في الفتح التالي.
   - لا يلمس قاعدة البيانات ولا تسجيل الدخول ولا الخرائط ولا أي صفحة أخرى.
   - للإيقاف الطارئ: استبدل محتوى هذا الملف بسطر واحد:
     self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(self.registration.unregister()));
*/
const V = 'mk-v27';
const CORE = ['./index.html', './i18n.en.js', './i18n.de.js', './i18n.tr.js', './i18n.ru.js', './i18n.nl.js', './i18n.fr.js'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(V).then(c => Promise.all(CORE.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => {})))));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== V) await caches.delete(k);
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
  return null;
}

self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url), k = kind(u);
  if (!k) return;
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
