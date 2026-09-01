import { JSDOM } from 'jsdom';
import fs from 'node:fs';
const html = fs.readFileSync('public/index.html', 'utf8');
const appjs = fs.readFileSync('public/app.js', 'utf8');
const errors = [];
const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
const { window } = dom;
window.addEventListener('error', (e) => { errors.push((e.message||'') + ' @ line ' + (e.lineno||'')); });
const store = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
Object.defineProperty(window, 'localStorage', { value: store });
Object.defineProperty(window, 'sessionStorage', { value: store });
window.fetch = () => Promise.reject(new Error('no fetch'));
window.matchMedia = () => ({ matches: false, addEventListener: () => {} });
window.scrollTo = () => {};
try {
  window.eval(appjs);
} catch (e) {
  errors.push('EVAL ERROR: ' + e.message);
}
setTimeout(() => {
  console.log('=== 运行时错误 ===');
  console.log(errors.length ? errors.join('\n') : '无错误');
  const loginView = window.document.getElementById('login-view');
  const splash = window.document.getElementById('splash');
  console.log('login-view class:', loginView ? loginView.className : 'null');
  console.log('splash class:', splash ? splash.className : 'null');
}, 500);
