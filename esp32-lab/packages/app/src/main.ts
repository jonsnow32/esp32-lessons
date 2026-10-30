import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';
import { startNav } from './lib/nav.svelte';

mount(App, { target: document.getElementById('app')! });
startNav();

if (import.meta.env.DEV) {
  // Debug handle for the browser console
  void import('./lib/lab.svelte').then(({ lab }) => ((window as unknown as { lab: unknown }).lab = lab));
}
