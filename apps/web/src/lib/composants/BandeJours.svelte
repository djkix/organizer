<script lang="ts">
  import type { JourBande } from '$lib/vues';

  let { jours }: { jours: JourBande[] } = $props();
</script>

<!-- Repère de la semaine : toucher un jour qui a des actions fait défiler jusqu'à son groupe. -->
<nav class="bande" aria-label="Jours">
  {#each jours as j (j.jour)}
    {#if j.ancre}
      <a class="jour plein" class:courant={j.courant} href="#{j.ancre}" aria-current={j.courant ? 'date' : undefined}>
        <span class="abrege">{j.abrege}</span><span class="numero">{j.numero}</span>
      </a>
    {:else}
      <span class="jour" class:courant={j.courant} aria-current={j.courant ? 'date' : undefined}>
        <span class="abrege">{j.abrege}</span><span class="numero">{j.numero}</span>
      </span>
    {/if}
  {/each}
</nav>

<style>
  .bande { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px; margin: 0 20px 6px; }
  .jour {
    min-height: 64px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
    border-radius: 12px; color: var(--muted); text-decoration: none;
  }
  .plein { background: var(--surface); border: 1px solid var(--line); color: var(--text); }
  .plein .abrege { color: var(--muted); }
  .courant { background: var(--accent); border-color: var(--accent); color: var(--bg); }
  .courant .abrege { color: var(--bg); }
  .abrege { font-size: var(--font-meta); font-weight: 500; }
  .numero { font-size: 18px; font-weight: 700; }
</style>
