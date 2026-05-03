import App from './App.svelte';
import './styles.css';

function mount() {
  const target = document.getElementById('axal-configurator');
  if (!target) {
    console.warn('[axal-configurator] mount target #axal-configurator not found');
    return;
  }
  // eslint-disable-next-line no-new
  new App({ target });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount, { once: true });
} else {
  mount();
}
