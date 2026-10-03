<script lang="ts">
  import { MESSAGES } from '$lib/messages';
  import Icone from './Icone.svelte';

  let { src, libelle = 'Réécouter' }: { src: string; libelle?: string } = $props();
  let audio = $state<HTMLAudioElement>();
  let enLecture = $state(false);
  let indisponible = $state(false);

  function basculer(): void {
    if (!audio) return;
    if (audio.paused) audio.play().catch(() => { indisponible = true; });
    else audio.pause();
  }
</script>

{#if indisponible}
  <p class="discret">{MESSAGES.audioIndisponible}</p>
{:else}
  <button class="lecture" onclick={basculer} aria-label={enLecture ? 'Pause' : libelle}>
    <Icone nom={enLecture ? 'pause' : 'lecture'} />
  </button>
  <audio
    bind:this={audio}
    {src}
    preload="none"
    onplay={() => (enLecture = true)}
    onpause={() => (enLecture = false)}
    onended={() => (enLecture = false)}
    onerror={() => (indisponible = true)}
  ></audio>
{/if}

<style>
  .lecture {
    width: var(--touch-min); height: var(--touch-min); flex: none; display: grid; place-items: center;
    border: none; border-radius: var(--radius-pill); background: var(--accent-soft); color: var(--accent);
  }
</style>
