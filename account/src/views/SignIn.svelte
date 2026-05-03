<script>
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import { requestMagicLink } from '../lib/api.js';

  const dispatch = createEventDispatcher();
  let email = '';
  let submitting = false;
  let sent = false;
  let error = '';

  // Cloudflare Turnstile site key wired by the Jekyll layout. Empty in dev
  // (the worker also short-circuits the middleware when no secret is set),
  // so the form still works locally; in prod the widget is required and the
  // submit button stays disabled until we receive a token.
  const turnstileSiteKey =
    (typeof window !== 'undefined' && window.AXAL_TURNSTILE_SITE_KEY) || '';

  let turnstileWidgetId = null;
  let turnstileToken = '';
  let turnstileEl;

  onMount(() => { if (turnstileSiteKey) ensureTurnstile(); });
  onDestroy(() => {
    if (turnstileWidgetId !== null && typeof window !== 'undefined' && window.turnstile) {
      try { window.turnstile.remove(turnstileWidgetId); } catch (e) { /* ignore */ }
    }
  });

  function ensureTurnstile() {
    if (typeof window === 'undefined') return;
    const render = () => {
      if (!turnstileEl || turnstileWidgetId !== null) return;
      try {
        turnstileWidgetId = window.turnstile.render(turnstileEl, {
          sitekey: turnstileSiteKey,
          theme: 'light',
          callback: (tok) => { turnstileToken = tok; },
          'error-callback': () => { turnstileToken = ''; },
          'expired-callback': () => { turnstileToken = ''; },
        });
      } catch (e) { /* ignore */ }
    };
    if (window.turnstile) { setTimeout(render, 0); return; }
    if (document.querySelector('script[data-axal-turnstile]')) return;
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.defer = true;
    s.dataset.axalTurnstile = '1';
    s.onload = () => setTimeout(render, 0);
    document.head.appendChild(s);
  }

  async function onSubmit() {
    error = '';
    if (!email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
      error = 'Enter a valid email address.';
      return;
    }
    if (turnstileSiteKey && !turnstileToken) {
      error = 'Please complete the human-verification challenge.';
      return;
    }
    submitting = true;
    try {
      await requestMagicLink(email, '/account/', turnstileToken);
      sent = true;
    } catch (e) {
      error = e.message || 'Could not send magic link.';
      // Reset the widget so the user can retry without a stale token.
      if (turnstileWidgetId !== null && typeof window !== 'undefined' && window.turnstile) {
        try { window.turnstile.reset(turnstileWidgetId); } catch (err) { /* ignore */ }
      }
      turnstileToken = '';
    } finally {
      submitting = false;
    }
  }
</script>

<div class="acc-card" style="max-width:440px;margin:24px auto;">
  {#if sent}
    <h1 class="acc-h1">Check your inbox</h1>
    <p class="acc-muted" style="margin-top:8px;">
      We sent a sign-in link to <strong>{email}</strong>. The link expires in 15 minutes
      and can only be used once. If it doesn't arrive, check spam, or try again with a
      different address.
    </p>
    <div class="acc-row" style="margin-top:16px;">
      <button class="acc-btn" on:click={() => { sent = false; }}>Use a different email</button>
    </div>
  {:else}
    <h1 class="acc-h1">Sign in</h1>
    <p class="acc-muted" style="margin:6px 0 16px;">
      We use passwordless sign-in. Enter your email and we'll send you a one-time link.
    </p>
    {#if error}<div class="acc-banner acc-banner-err">{error}</div>{/if}
    <form on:submit|preventDefault={onSubmit}>
      <label class="acc-label" for="acc-email">Work email</label>
      <input id="acc-email" class="acc-input" type="email" autocomplete="email"
             bind:value={email} required disabled={submitting} />
      {#if turnstileSiteKey}
        <div bind:this={turnstileEl} class="acc-turnstile" aria-label="Human verification"></div>
      {/if}
      <div style="margin-top:14px;">
        <button class="acc-btn acc-btn-primary" type="submit"
                disabled={submitting || (turnstileSiteKey && !turnstileToken)}>
          {submitting ? 'Sending…' : 'Send magic link'}
        </button>
      </div>
    </form>
    <p class="acc-muted" style="margin-top:16px;font-size:0.78rem;">
      By signing in you accept our <a class="acc-link" href="/legal/terms-of-sale/">Terms</a>
      and <a class="acc-link" href="/legal/privacy/">Privacy Policy</a>.
    </p>
  {/if}
</div>

<style>
  .acc-turnstile { margin-top: 14px; min-height: 65px; }
</style>
