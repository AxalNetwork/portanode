<script>
  import { onMount } from 'svelte';
  import { route, navigate } from './lib/router.js';
  import { fetchMe, logout } from './lib/api.js';
  import SignIn from './views/SignIn.svelte';
  import Dashboard from './views/Dashboard.svelte';
  import OrderDetail from './views/OrderDetail.svelte';
  import Quotes from './views/Quotes.svelte';
  import Configurations from './views/Configurations.svelte';
  import Profile from './views/Profile.svelte';
  import Privacy from './views/Privacy.svelte';

  let customer = null;
  let booting = true;
  let toast = '';
  let toastTimer;

  function flash(msg) {
    toast = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = ''), 2400);
  }

  async function refresh() {
    try {
      customer = await fetchMe();
    } catch (e) {
      customer = null;
    } finally {
      booting = false;
    }
  }

  onMount(refresh);

  async function onSignOut() {
    try { await logout(); } catch (e) {}
    customer = null;
    navigate('/');
    flash('Signed out');
  }

  $: section = $route.segments[0] || 'dashboard';
  $: orderId = $route.segments[0] === 'orders' ? $route.segments[1] : null;
</script>

<div class="acc-root">
  {#if booting}
    <p class="acc-muted">Loading your account…</p>
  {:else if !customer}
    <SignIn on:signedIn={refresh} />
  {:else}
    <div class="acc-shell">
      <aside>
        <div style="margin-bottom:14px;">
          <div style="font-weight:600;">{customer.name || customer.email}</div>
          {#if customer.company}<div class="acc-muted">{customer.company}</div>{/if}
        </div>
        <nav class="acc-nav" aria-label="Account sections">
          <button aria-current={section === 'dashboard' || section === '' ? 'page' : null}
                  on:click={() => navigate('/dashboard')}>Dashboard</button>
          <button aria-current={section === 'orders' ? 'page' : null}
                  on:click={() => navigate('/orders')}>Orders</button>
          <button aria-current={section === 'quotes' ? 'page' : null}
                  on:click={() => navigate('/quotes')}>Quotes</button>
          <button aria-current={section === 'configurations' ? 'page' : null}
                  on:click={() => navigate('/configurations')}>Configurations</button>
          <button aria-current={section === 'profile' ? 'page' : null}
                  on:click={() => navigate('/profile')}>Profile</button>
          <button aria-current={section === 'privacy' ? 'page' : null}
                  on:click={() => navigate('/privacy')}>Privacy</button>
          <div class="acc-divider"></div>
          <button on:click={onSignOut}>Sign out</button>
        </nav>
      </aside>

      <section>
        {#if section === 'orders' && orderId}
          <OrderDetail id={orderId} on:flash={(e) => flash(e.detail)} />
        {:else if section === 'orders'}
          <Dashboard view="orders" on:flash={(e) => flash(e.detail)} />
        {:else if section === 'quotes'}
          <Quotes on:flash={(e) => flash(e.detail)} />
        {:else if section === 'configurations'}
          <Configurations on:flash={(e) => flash(e.detail)} />
        {:else if section === 'profile'}
          <Profile {customer} on:flash={(e) => flash(e.detail)} on:updated={refresh} />
        {:else if section === 'privacy'}
          <Privacy on:flash={(e) => flash(e.detail)} on:signedOut={refresh} />
        {:else}
          <Dashboard on:flash={(e) => flash(e.detail)} />
        {/if}
      </section>
    </div>
  {/if}

  {#if toast}<div class="acc-toast" role="status">{toast}</div>{/if}
</div>
