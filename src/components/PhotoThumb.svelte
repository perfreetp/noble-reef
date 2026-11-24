<script>
  import { onMount } from 'svelte';
  import { store } from '../lib/store.svelte.js';

  let { img } = $props();
  let url = $state('');

  onMount(async () => {
    url = await store.imageDataUrl(img.id);
  });
</script>

<div class="photo-thumb" draggable="true" title={img.name} role="img" aria-label={img.name}
  ondragstart={(e) => {
    e.dataTransfer.setData('text/x-image-id', img.id);
    e.dataTransfer.effectAllowed = 'copy';
  }}>
  {#if url}
    <img src={url} alt={img.name} />
  {:else}
    <div class="ph">…</div>
  {/if}
  <span class="name">{img.name}</span>
</div>

<style>
  .photo-thumb {
    position: relative;
    border: 1px solid var(--line);
    border-radius: 6px;
    overflow: hidden;
    background: var(--panel-2);
    cursor: grab;
    aspect-ratio: 1;
  }
  .photo-thumb:hover { border-color: var(--accent); }
  .photo-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .ph { display: grid; place-items: center; height: 100%; color: var(--ink-2); }
  .name {
    position: absolute;
    left: 0; right: 0; bottom: 0;
    font-size: 9px;
    color: #fff;
    background: rgba(40, 30, 20, .55);
    padding: 2px 4px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
