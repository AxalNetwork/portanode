<script>
  import { onMount, onDestroy } from 'svelte';
  import { config } from '../stores/config.js';
  export let catalog;
  export let onSelectModule = () => {};

  let container;
  let three = null;
  let scene, camera, renderer, raycaster, pointer;
  let resizeObs = null;
  let frame = 0;
  let supportsWebGL = true;
  let useFallback = false;
  let moduleMeshes = [];

  const MOD_COLORS = {
    core: 0x6B21A8,
    volt: 0xA855F7,
    flow: 0x60a5fa,
    grow: 0x22c55e,
    shell: 0xC084FC,
    cycle: 0xf97316,
    care: 0xef4444,
    learn: 0xeab308
  };

  function detectLowEnd() {
    if (typeof navigator === 'undefined') return false;
    const mem = navigator.deviceMemory;
    const cores = navigator.hardwareConcurrency;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    return reduce || (mem && mem < 2) || (cores && cores < 2);
  }
  function checkWebGL() {
    try {
      const c = document.createElement('canvas');
      return !!(c.getContext('webgl2') || c.getContext('webgl'));
    } catch (e) { return false; }
  }

  async function init() {
    if (!container) return;
    if (detectLowEnd() || !checkWebGL()) {
      useFallback = true;
      return;
    }
    try {
      three = await import('three');
    } catch (e) {
      console.warn('[axal-configurator] three.js failed to load, using fallback', e);
      useFallback = true;
      return;
    }
    const w = container.clientWidth || 600;
    const h = container.clientHeight || 420;
    scene = new three.Scene();
    scene.background = null;
    camera = new three.PerspectiveCamera(38, w / h, 0.1, 200);
    camera.position.set(18, 14, 22);
    camera.lookAt(0, 1, 0);
    renderer = new three.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h, false);
    container.appendChild(renderer.domElement);

    const ambient = new three.AmbientLight(0xffffff, 0.7);
    scene.add(ambient);
    const dir = new three.DirectionalLight(0xffffff, 0.8);
    dir.position.set(10, 20, 10);
    scene.add(dir);

    // ground
    const grid = new three.GridHelper(40, 20, 0x6B7280, 0x3A3A40);
    grid.material.opacity = 0.25;
    grid.material.transparent = true;
    scene.add(grid);

    raycaster = new three.Raycaster();
    pointer = new three.Vector2();

    renderer.domElement.addEventListener('click', onClick);
    renderer.domElement.style.cursor = 'pointer';

    rebuildMeshes();
    animate();

    if ('ResizeObserver' in window) {
      resizeObs = new ResizeObserver(() => onResize());
      resizeObs.observe(container);
    } else {
      window.addEventListener('resize', onResize);
      windowResizeBound = true;
    }
  }
  let windowResizeBound = false;

  function onResize() {
    if (!renderer || !camera) return;
    const w = container.clientWidth || 600;
    const h = container.clientHeight || 420;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }

  function moduleSize(mod) {
    const ft2u = 0.30; // 1 ft -> 0.30 unit
    return {
      x: (mod.dimensions.lengthFt || 20) * ft2u,
      y: (mod.dimensions.heightFt || 8.5) * ft2u,
      z: (mod.dimensions.widthFt || 8) * ft2u
    };
  }

  function rebuildMeshes() {
    if (!scene || !three) return;
    for (const m of moduleMeshes) {
      scene.remove(m);
      m.geometry?.dispose();
      m.material?.dispose();
    }
    moduleMeshes = [];

    let cursor = 0;
    const gap = 0.4;
    for (const entry of $config.modules) {
      const mod = catalog.modules.find((m) => m.id === entry.moduleId);
      if (!mod) continue;
      const sz = moduleSize(mod);
      for (let q = 0; q < (entry.qty || 1); q++) {
        const geom = new three.BoxGeometry(sz.x, sz.y, sz.z);
        const mat = new three.MeshStandardMaterial({
          color: MOD_COLORS[mod.id] || 0x6B7280,
          metalness: 0.15,
          roughness: 0.6
        });
        const mesh = new three.Mesh(geom, mat);
        mesh.position.set(cursor + sz.x / 2, sz.y / 2, 0);
        mesh.userData = { moduleId: mod.id };
        scene.add(mesh);
        moduleMeshes.push(mesh);

        // edges for snap visual
        const edges = new three.LineSegments(
          new three.EdgesGeometry(geom),
          new three.LineBasicMaterial({ color: 0xffffff, opacity: 0.35, transparent: true })
        );
        edges.position.copy(mesh.position);
        scene.add(edges);
        moduleMeshes.push(edges);

        cursor += sz.x + gap;
      }
    }
    // Recenter camera target
    const cx = cursor / 2 - 0.5;
    if (camera) {
      camera.position.x = cx + 14;
      camera.lookAt(cx, 1, 0);
    }
  }

  function onClick(e) {
    if (!raycaster || !three) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(moduleMeshes.filter((m) => m.userData?.moduleId), false)[0];
    if (hit && hit.object.userData?.moduleId) {
      onSelectModule(hit.object.userData.moduleId);
    }
  }

  function animate() {
    if (!renderer) return;
    frame = requestAnimationFrame(animate);
    // gentle rotation when idle
    if (scene) scene.rotation.y += 0.0015;
    renderer.render(scene, camera);
  }

  onMount(() => { init(); });

  onDestroy(() => {
    cancelAnimationFrame(frame);
    if (resizeObs) resizeObs.disconnect();
    if (windowResizeBound) window.removeEventListener('resize', onResize);
    if (renderer) {
      renderer.domElement.removeEventListener('click', onClick);
      renderer.dispose?.();
      if (container && renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    }
  });

  // Rebuild on config change
  $: if (scene && three) {
    void $config; // dependency
    rebuildMeshes();
  }
</script>

<div class="cfg-canvas-wrap" bind:this={container} role="img" aria-label="3D preview of module stack">
  {#if useFallback}
    <div class="cfg-isometric">
      <svg viewBox="0 0 400 240" width="100%" height="100%" aria-hidden="true">
        <defs>
          <linearGradient id="g" x1="0" x2="1">
            <stop offset="0" stop-color="#6B21A8" />
            <stop offset="1" stop-color="#A855F7" />
          </linearGradient>
        </defs>
        {#each $config.modules as entry, i}
          <g transform="translate({40 + i * 56},{120 - i * 6})">
            <polygon points="0,40 40,20 80,40 40,60" fill="url(#g)" opacity="0.85" />
            <polygon points="0,40 0,80 40,100 40,60" fill="#6B21A8" opacity="0.9" />
            <polygon points="40,60 80,40 80,80 40,100" fill="#A855F7" opacity="0.95" />
            <text x="40" y="76" text-anchor="middle" fill="#fff" font-size="10" font-family="monospace">
              {entry.moduleId.toUpperCase()}
            </text>
          </g>
        {/each}
        {#if $config.modules.length === 0}
          <text x="200" y="120" text-anchor="middle" fill="#C9C9C2" font-size="11" font-family="monospace">
            Add modules to start
          </text>
        {/if}
      </svg>
    </div>
  {:else if $config.modules.length === 0}
    <div class="cfg-canvas-empty">Add a module from the left rail to begin</div>
  {/if}
</div>
