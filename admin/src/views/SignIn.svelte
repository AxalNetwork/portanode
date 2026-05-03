<script>
  import { createEventDispatcher } from 'svelte';
  import { adminLogin } from '../lib/api.js';

  const dispatch = createEventDispatcher();
  let token = '';
  let busy = false;
  let err = '';

  async function submit() {
    busy = true; err = '';
    try {
      await adminLogin(token);
      token = '';
      dispatch('signedIn');
    } catch (e) {
      err = e?.message || 'Sign-in failed';
    } finally {
      busy = false;
    }
  }
</script>

<div class="adm-card" style="max-width: 480px; margin: 60px auto;">
  <h1 class="adm-h1">AXAL admin</h1>
  <p class="adm-muted" style="margin-bottom: 16px;">
    The Cloudflare edge basic-auth gate already filtered this page. Paste the
    <code>ADMIN_API_TOKEN</code> to issue a session cookie for this browser.
  </p>
  <form on:submit|preventDefault={submit}>
    <label class="adm-label" for="adm-token">Admin API token</label>
    <input id="adm-token" class="adm-input" type="password" autocomplete="off"
           bind:value={token} placeholder="axal_admin_…" required />
    {#if err}<div class="adm-banner-err" style="margin-top: 10px;">{err}</div>{/if}
    <button class="adm-btn adm-btn-primary" type="submit" disabled={busy} style="margin-top: 14px;">
      {busy ? 'Signing in…' : 'Sign in'}
    </button>
  </form>
</div>
