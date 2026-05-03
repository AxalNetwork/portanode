<script>
  import { onMount } from 'svelte';
  import { route, navigate } from './lib/router.js';
  import { adminMe, adminLogout } from './lib/api.js';
  import SignIn from './views/SignIn.svelte';
  import Dashboard from './views/Dashboard.svelte';
  import Inbox from './views/Inbox.svelte';
  import Pipeline from './views/Pipeline.svelte';
  import Customers from './views/Customers.svelte';
  import CustomerView from './views/CustomerView.svelte';
  import OrderDetail from './views/OrderDetail.svelte';
  import Tasks from './views/Tasks.svelte';
  import Pricing from './views/Pricing.svelte';
  import Exports from './views/Exports.svelte';

  let booted = false;
  let signedIn = false;
  let toast = '';
  let toastTimer;

  function flash(msg) {
    toast = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = ''), 2400);
  }

  async function refresh() {
    try {
      await adminMe();
      signedIn = true;
    } catch (e) {
      signedIn = false;
    } finally {
      booted = true;
    }
  }

  onMount(refresh);

  async function onSignOut() {
    try { await adminLogout(); } catch (e) {}
    signedIn = false;
    navigate('/');
    flash('Signed out');
  }

  $: section = $route.segments[0] || 'dashboard';
  $: subId = $route.segments[1] || null;
</script>

<div class="adm-root">
  {#if !booted}
    <p class="adm-muted">Loading admin…</p>
  {:else if !signedIn}
    <SignIn on:signedIn={() => { signedIn = true; flash('Signed in'); }} />
  {:else}
    <div class="adm-shell">
      <aside>
        <div style="margin-bottom:14px;">
          <div style="font-weight:600;">AXAL Ops</div>
          <div class="adm-muted">Admin console</div>
        </div>
        <nav class="adm-nav" aria-label="Admin sections">
          <button aria-current={section === 'dashboard' || section === '' ? 'page' : null}
                  on:click={() => navigate('/dashboard')}>Dashboard</button>
          <button aria-current={section === 'inbox' ? 'page' : null}
                  on:click={() => navigate('/inbox')}>Inbox</button>
          <button aria-current={section === 'pipeline' ? 'page' : null}
                  on:click={() => navigate('/pipeline')}>Pipeline</button>
          <button aria-current={section === 'customers' ? 'page' : null}
                  on:click={() => navigate('/customers')}>Customers</button>
          <button aria-current={section === 'orders' ? 'page' : null}
                  on:click={() => navigate('/orders')}>Orders</button>
          <button aria-current={section === 'tasks' ? 'page' : null}
                  on:click={() => navigate('/tasks')}>Tasks</button>
          <button aria-current={section === 'pricing' ? 'page' : null}
                  on:click={() => navigate('/pricing')}>Pricing review</button>
          <button aria-current={section === 'exports' ? 'page' : null}
                  on:click={() => navigate('/exports')}>Exports</button>
          <div class="adm-divider"></div>
          <button on:click={onSignOut}>Sign out</button>
        </nav>
      </aside>

      <section>
        {#if section === 'inbox'}
          <Inbox on:flash={(e) => flash(e.detail)} />
        {:else if section === 'pipeline'}
          <Pipeline on:flash={(e) => flash(e.detail)} />
        {:else if section === 'customers' && subId}
          <CustomerView id={subId} on:flash={(e) => flash(e.detail)} />
        {:else if section === 'customers'}
          <Customers on:flash={(e) => flash(e.detail)} />
        {:else if section === 'orders' && subId}
          <OrderDetail id={subId} on:flash={(e) => flash(e.detail)} />
        {:else if section === 'orders'}
          <Pipeline on:flash={(e) => flash(e.detail)} />
        {:else if section === 'tasks'}
          <Tasks on:flash={(e) => flash(e.detail)} />
        {:else if section === 'pricing'}
          <Pricing on:flash={(e) => flash(e.detail)} />
        {:else if section === 'exports'}
          <Exports on:flash={(e) => flash(e.detail)} />
        {:else}
          <Dashboard on:flash={(e) => flash(e.detail)} />
        {/if}
      </section>
    </div>
  {/if}

  {#if toast}<div class="adm-toast" role="status">{toast}</div>{/if}
</div>
