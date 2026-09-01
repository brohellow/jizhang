import { JSDOM } from 'jsdom';
import fs from 'node:fs';
const html = fs.readFileSync('public/index.html', 'utf8');
const appjs = fs.readFileSync('public/app.js', 'utf8');
const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
const { window } = dom;
const store = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
Object.defineProperty(window, 'localStorage', { value: store });
Object.defineProperty(window, 'sessionStorage', { value: store });
window.fetch = () => Promise.reject(new Error('no fetch'));
window.matchMedia = () => ({ matches: false, addEventListener: () => {} });
window.scrollTo = () => {};
window.eval(appjs);
setTimeout(() => {
  const splash = window.document.getElementById('splash');
  const loginView = window.document.getElementById('login-view');
  console.log('splash class:', splash ? splash.className : 'null');
  console.log('login-view class:', loginView ? loginView.className : 'null');
}, 500);
