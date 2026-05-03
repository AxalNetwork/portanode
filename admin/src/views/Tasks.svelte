<script>
  import { onMount } from 'svelte';
  import { fetchTasks, createTask, patchTask, deleteTask } from '../lib/api.js';
  import { fmtDate } from '../lib/format.js';
  import { navigate } from '../lib/router.js';
  import { createEventDispatcher } from 'svelte';

  const dispatch = createEventDispatcher();
  let tasks = [];
  let status = 'open';
  let loading = true;
  let err = '';
  let title = '';
  let due = '';
  let customerId = '';
  let orderId = '';

  async function load() {
    loading = true; err = '';
    try {
      const r = await fetchTasks(status);
      tasks = r.data;
    } catch (e) { err = e.message; }
    loading = false;
  }

  async function add() {
    if (!title.trim()) return;
    try {
      await createTask({
        title: title.trim(),
        customerId: customerId || null,
        orderId: orderId || null,
        dueAt: due ? new Date(due).getTime() : null,
      });
      title = ''; due = ''; customerId = ''; orderId = '';
      await load();
      dispatch('flash', 'Task created');
    } catch (e) { dispatch('flash', 'Failed: ' + e.message); }
  }

  async function toggle(t) {
    try {
      await patchTask(t.id, { completed: !t.completedAt });
      await load();
    } catch (e) { dispatch('flash', 'Failed: ' + e.message); }
  }

  async function rm(t) {
    if (!confirm('Delete task?')) return;
    try {
      await deleteTask(t.id);
      await load();
    } catch (e) { dispatch('flash', 'Failed: ' + e.message); }
  }

  onMount(load);
</script>

<h1 class="adm-h1">Tasks</h1>

<div class="adm-card">
  <h2 class="adm-h2">New task</h2>
  <form on:submit|preventDefault={add}>
    <div class="adm-grid-4">
      <div style="grid-column: span 2;">
        <label class="adm-label">Title</label>
        <input class="adm-input" bind:value={title} required />
      </div>
      <div>
        <label class="adm-label">Due date</label>
        <input class="adm-input" type="date" bind:value={due} />
      </div>
      <div>
        <label class="adm-label">Customer ID</label>
        <input class="adm-input" bind:value={customerId} />
      </div>
    </div>
    <div class="adm-row" style="margin-top: 10px;">
      <input class="adm-input" placeholder="Order ID (optional)" bind:value={orderId} style="max-width: 240px;" />
      <button class="adm-btn adm-btn-primary" type="submit">Create</button>
    </div>
  </form>
</div>

<div class="adm-card">
  <div class="adm-row">
    <select class="adm-select" style="width: auto;" bind:value={status} on:change={load}>
      <option value="open">Open</option>
      <option value="overdue">Overdue</option>
      <option value="completed">Completed</option>
      <option value="all">All</option>
    </select>
    <button class="adm-btn adm-btn-ghost" on:click={load}>Refresh</button>
  </div>

  {#if err}<div class="adm-banner-err" style="margin-top: 8px;">{err}</div>{/if}
  {#if loading}
    <p class="adm-muted">Loading…</p>
  {:else}
    <table class="adm-table" style="margin-top: 10px;">
      <thead><tr><th></th><th>Title</th><th>Customer</th><th>Order</th><th>Due</th><th></th></tr></thead>
      <tbody>
        {#each tasks as t (t.id)}
          <tr>
            <td><input type="checkbox" checked={!!t.completedAt} on:change={() => toggle(t)} /></td>
            <td style:text-decoration={t.completedAt ? 'line-through' : 'none'}>{t.title}</td>
            <td>{#if t.customerId}<a class="adm-link" on:click={() => navigate('/customers/' + t.customerId)}>{t.customerId}</a>{/if}</td>
            <td>{#if t.orderId}<a class="adm-link" on:click={() => navigate('/orders/' + t.orderId)}>{t.orderId}</a>{/if}</td>
            <td class:adm-overdue={t.dueAt && !t.completedAt && t.dueAt < Date.now()}>{fmtDate(t.dueAt)}</td>
            <td><button class="adm-btn adm-btn-ghost adm-btn-danger" on:click={() => rm(t)}>×</button></td>
          </tr>
        {:else}<tr><td colspan="6" class="adm-muted" style="text-align:center;">No tasks match.</td></tr>{/each}
      </tbody>
    </table>
  {/if}
</div>
