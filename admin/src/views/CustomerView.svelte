<script>
  import { onMount } from 'svelte';
  import { fetchCustomer, addCustomerNote, deleteCustomerNote, createTask, patchTask } from '../lib/api.js';
  import { fmtDate, fmtDateTime, fmtMoney, statusPill } from '../lib/format.js';
  import { navigate } from '../lib/router.js';
  import { createEventDispatcher } from 'svelte';

  export let id;
  const dispatch = createEventDispatcher();
  let view = null;
  let loading = true;
  let err = '';
  let noteBody = '';
  let newTaskTitle = '';
  let newTaskDue = '';

  async function load() {
    loading = true; err = '';
    try {
      const r = await fetchCustomer(id);
      view = r.data;
    } catch (e) {
      err = e.message;
    } finally {
      loading = false;
    }
  }

  async function postNote() {
    if (!noteBody.trim()) return;
    try {
      await addCustomerNote(view.customer.id, noteBody.trim());
      noteBody = '';
      await load();
      dispatch('flash', 'Note added');
    } catch (e) {
      dispatch('flash', 'Note failed: ' + e.message);
    }
  }

  async function rmNote(noteId) {
    if (!confirm('Delete this note?')) return;
    try {
      await deleteCustomerNote(noteId);
      await load();
    } catch (e) { dispatch('flash', 'Delete failed: ' + e.message); }
  }

  async function addTask() {
    if (!newTaskTitle.trim()) return;
    const dueAt = newTaskDue ? new Date(newTaskDue).getTime() : null;
    try {
      await createTask({ title: newTaskTitle.trim(), customerId: view.customer.id, dueAt });
      newTaskTitle = ''; newTaskDue = '';
      await load();
      dispatch('flash', 'Task created');
    } catch (e) { dispatch('flash', 'Task failed: ' + e.message); }
  }

  async function toggleTask(t) {
    try {
      await patchTask(t.id, { completed: !t.completedAt });
      await load();
    } catch (e) { dispatch('flash', 'Update failed: ' + e.message); }
  }

  $: id, load();
</script>

<div class="adm-row" style="margin-bottom: 8px;">
  <a class="adm-link" on:click={() => navigate('/customers')}>← All customers</a>
</div>

{#if err}
  <div class="adm-banner-err">{err}</div>
{:else if loading || !view}
  <p class="adm-muted">Loading…</p>
{:else}
  <h1 class="adm-h1">{view.customer.name || view.customer.email}</h1>
  <div class="adm-muted" style="margin-bottom: 12px;">
    {view.customer.email}{view.customer.company ? ' · ' + view.customer.company : ''}
    {view.customer.region ? ' · ' + view.customer.region : ''}
    · joined {fmtDate(view.customer.created_at)}
  </div>

  <div class="adm-card">
    <h2 class="adm-h2">Orders ({view.orders.length})</h2>
    <table class="adm-table">
      <thead><tr><th>ID</th><th>Status</th><th>Total</th><th>Created</th></tr></thead>
      <tbody>
        {#each view.orders as o (o.id)}
          <tr>
            <td><a class="adm-link" on:click={() => navigate('/orders/' + o.id)}>{o.id}</a></td>
            <td><span class="adm-pill adm-pill-{statusPill(o.status)}">{o.status}</span></td>
            <td>{fmtMoney(o.total_cents, o.currency)}</td>
            <td>{fmtDate(o.created_at)}</td>
          </tr>
        {:else}<tr><td colspan="4" class="adm-muted">No orders.</td></tr>{/each}
      </tbody>
    </table>
  </div>

  <div class="adm-card">
    <h2 class="adm-h2">Quotes ({view.quotes.length})</h2>
    <table class="adm-table">
      <thead><tr><th>ID</th><th>Status</th><th>Total</th><th>Expires</th></tr></thead>
      <tbody>
        {#each view.quotes as q (q.id)}
          <tr>
            <td>{q.id}</td>
            <td><span class="adm-pill adm-pill-{statusPill(q.status)}">{q.status}</span></td>
            <td>{fmtMoney(q.total_cents, q.currency)}</td>
            <td>{fmtDate(q.expires_at)}</td>
          </tr>
        {:else}<tr><td colspan="4" class="adm-muted">No quotes.</td></tr>{/each}
      </tbody>
    </table>
  </div>

  <div class="adm-card">
    <h2 class="adm-h2">Configurations ({view.configurations.length})</h2>
    {#if view.configurations.length}
      <ul style="margin: 0; padding-left: 18px;">
        {#each view.configurations as c}
          <li><code>{c.id}</code> — {c.source} · {c.region} · {fmtDate(c.created_at)}</li>
        {/each}
      </ul>
    {:else}<p class="adm-muted">None.</p>{/if}
  </div>

  <div class="adm-card">
    <h2 class="adm-h2">Tasks</h2>
    <form on:submit|preventDefault={addTask} class="adm-row">
      <input class="adm-input" placeholder="New task…" bind:value={newTaskTitle} style="flex: 1; min-width: 240px;" />
      <input class="adm-input" type="date" bind:value={newTaskDue} style="width: auto;" />
      <button class="adm-btn adm-btn-primary" type="submit">Add</button>
    </form>
    <table class="adm-table" style="margin-top: 10px;">
      <thead><tr><th></th><th>Task</th><th>Due</th></tr></thead>
      <tbody>
        {#each view.tasks as t (t.id)}
          <tr>
            <td><input type="checkbox" checked={!!t.completedAt} on:change={() => toggleTask(t)} /></td>
            <td style:text-decoration={t.completedAt ? 'line-through' : 'none'}>{t.title}</td>
            <td class:adm-overdue={t.dueAt && !t.completedAt && t.dueAt < Date.now()}>{fmtDate(t.dueAt)}</td>
          </tr>
        {:else}<tr><td colspan="3" class="adm-muted">No tasks.</td></tr>{/each}
      </tbody>
    </table>
  </div>

  <div class="adm-card">
    <h2 class="adm-h2">Notes</h2>
    <form on:submit|preventDefault={postNote}>
      <textarea class="adm-textarea" rows="3" placeholder="Add a timestamped note…" bind:value={noteBody}></textarea>
      <button class="adm-btn adm-btn-primary" type="submit" style="margin-top: 8px;">Post note</button>
    </form>
    <ul style="list-style: none; padding: 0; margin-top: 12px;">
      {#each view.notes as n (n.id)}
        <li style="border-bottom: 1px solid var(--axal-gray-100); padding: 10px 0;">
          <div class="adm-muted" style="font-size: 0.75rem;">
            {fmtDateTime(n.created_at)} · {n.author_id}
            <button class="adm-btn adm-btn-ghost adm-btn-danger" style="float: right; padding: 2px 8px;"
                    on:click={() => rmNote(n.id)}>delete</button>
          </div>
          <div style="white-space: pre-wrap; margin-top: 4px;">{n.body}</div>
        </li>
      {:else}<li class="adm-muted">No notes yet.</li>{/each}
    </ul>
  </div>

  <div class="adm-card">
    <h2 class="adm-h2">Activity</h2>
    <div class="adm-tl">
      {#each view.events.slice(0, 50) as e}
        <div class="adm-tl-item">
          <span class="ts">{fmtDateTime(e.ts)}</span>
          <span><strong>{e.type}</strong> <span class="adm-muted">{e.subject_kind || ''} {e.subject_id || ''}</span></span>
        </div>
      {:else}<p class="adm-muted">No events.</p>{/each}
    </div>
  </div>
{/if}
