// Özellik modüllerinin kendi arayüzlerini eklemesi için küçük DOM yardımcıları.
export const $ = (sel) => document.querySelector(sel);
export function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}
// Aynı id ile ikinci kez eklenmez
export function injectCSS(id, css) {
  if (document.getElementById(`css-${id}`)) return;
  const s = document.createElement('style');
  s.id = `css-${id}`;
  s.textContent = css;
  document.head.appendChild(s);
}
// Özellik arayüzleri için kapsayıcılar (index.html'de tanımlı)
export const featureLayer = () => document.getElementById('feature-ui');   // serbest konumlu paneller
export const topExtra = () => document.getElementById('hud-extra');        // üst bara ek göstergeler
