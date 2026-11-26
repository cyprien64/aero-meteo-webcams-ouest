/* Thème clair (Apple) ou sombre : choix enregistré par le bouton 🌓, sinon réglage de l'appareil. Chargé dans <head> pour éviter un flash. */
(function () {
  const root = document.documentElement, mq = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : { matches: true };
  const saved = () => { try { return localStorage.getItem('aww.theme'); } catch (e) { return null; } };
  const apply = () => { root.dataset.theme = saved() || (mq.matches ? 'dark' : 'light'); };
  apply();
  if (mq.addEventListener) mq.addEventListener('change', apply);
  window.AWW_theme = { toggle() { const n = root.dataset.theme === 'dark' ? 'light' : 'dark'; try { localStorage.setItem('aww.theme', n); } catch (e) { /* stockage bloqué */ } root.dataset.theme = n; } };
})();
