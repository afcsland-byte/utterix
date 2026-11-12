/* Utterix service worker: offline app shell + streak reminders.
   No push server: reminders fire when the app is opened/visible, or via
   Periodic Background Sync where the browser supports it (installed Chrome on Android). */
const APP_CACHE = "utterix-app-v3";
const META_CACHE = "utterix-meta";
const SHELL = ["./", "./manifest.webmanifest", "./icon-192.png", "./badge-72.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(APP_CACHE).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== APP_CACHE && k !== META_CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === "navigate") {
    /* Network first so new deploys show up straight away; cached copy when offline. */
    e.respondWith(fetch(req).then((res) => {
      if (res && res.ok) { const copy = res.clone(); caches.open(APP_CACHE).then((c) => c.put("./", copy)).catch(() => {}); }
      return res;
    }).catch(() => caches.match("./").then((r) => r || caches.match(req))));
    return;
  }
  if (/\.(png|webmanifest)$/.test(url.pathname)) {
    e.respondWith(caches.match(req).then((r) => r || fetch(req)));
  }
});

const COPY = {
  morning: [
    { title: "🔥 Keep your streak alive", body: "¡Buenos días! Today's Spanish lesson takes about 5 minutes." },
    { title: "☀️ Start your day in Spanish", body: "One quick lesson before the day gets busy. Maya is ready." },
    { title: "🔥 {n}-day streak on the line", body: "Morning! Do today's lesson now and the rest of the day is yours." }
  ],
  midday: [
    { title: "⏰ Your streak is getting nervous", body: "You haven't done today's lesson yet. Squeeze it in now." },
    { title: "🥪 Lunch break = lesson break?", body: "Today's Spanish lesson is waiting. It only takes a few minutes." },
    { title: "🔥 Don't lose your {n}-day streak", body: "Half the day is gone. Keep the flame going with today's lesson." }
  ]
};
function ymd(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
function scoped(p) { return new URL(p, self.registration.scope).href; }
async function maybeRemind() {
  const meta = await caches.open(META_CACHE);
  const r = await meta.match(scoped("meta/state.json"));
  if (!r) return;
  const s = await r.json();
  if (!s.enabled) return;
  const sr = await meta.match(scoped("meta/sent.json"));
  const sent = sr ? await sr.json() : {};
  const now = new Date();
  const today = ymd(now);
  if (s.lastActiveDate === today) return;
  const h = now.getHours();
  let slot = null;
  if (h >= 13 && h < 22 && sent.lastMidday !== today && s.lastMidday !== today) slot = "midday";
  else if (h >= 8 && h < 13 && sent.lastMorning !== today && s.lastMorning !== today) slot = "morning";
  if (!slot) return;
  const list = COPY[slot];
  let c = list[(now.getDate() + (slot === "midday" ? 1 : 0)) % list.length];
  const n = Math.max(1, s.streak || 0);
  if (!(s.streak > 0) && c.title.indexOf("{n}") >= 0) c = list[0];
  await self.registration.showNotification(c.title.replace("{n}", n), {
    body: c.body.replace("{n}", n), icon: "icon-192.png", badge: "badge-72.png", tag: "utterix-streak", renotify: true,
    vibrate: [60, 40, 60], data: { url: "./?from=reminder" }, actions: [{ action: "start", title: "Start lesson" }]
  });
  sent.lastMorning = today;
  if (slot === "midday") sent.lastMidday = today;
  await meta.put(scoped("meta/sent.json"), new Response(JSON.stringify(sent), { headers: { "Content-Type": "application/json" } }));
}
self.addEventListener("periodicsync", (e) => { if (e.tag === "utterix-streak") e.waitUntil(maybeRemind().catch(() => {})); });
self.addEventListener("message", (e) => { if (e.data && e.data.type === "check-reminder") e.waitUntil(maybeRemind().catch(() => {})); });
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || "./", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) { if (c.url.indexOf(self.registration.scope) === 0 && "focus" in c) return c.focus(); }
    return self.clients.openWindow ? self.clients.openWindow(target) : null;
  }));
});
