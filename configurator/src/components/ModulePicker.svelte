<script>
  import { config, addModule } from '../stores/config.js';
  export let catalog;

  $: presentIds = new Set($config.modules.map((m) => m.moduleId));
</script>

<h2 id="cfg-modules-h">Modules</h2>
<ul class="cfg-module-list" aria-labelledby="cfg-modules-h">
    {#each catalog.modules as mod (mod.id)}
      <li>
        <button
          type="button"
          class="cfg-module-card"
          aria-pressed={presentIds.has(mod.id)}
          on:click={() => addModule(catalog, mod.id)}
        >
          <span class="meta">
            <strong>{mod.name}</strong>
            <small>{mod.category} · {mod.dimensions.form}</small>
          </span>
          <span class="price">+${(mod.basePrice / 1000).toFixed(0)}k</span>
        </button>
      </li>
  {/each}
</ul>
