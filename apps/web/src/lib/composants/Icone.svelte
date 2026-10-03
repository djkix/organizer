<script lang="ts">
  import { TRACES, type NomIcone } from './icones';

  let { nom, taille = 24, etiquette }: { nom: NomIcone; taille?: number; etiquette?: string } = $props();
</script>

<svg
  width={taille}
  height={taille}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  role={etiquette ? 'img' : undefined}
  aria-label={etiquette}
  aria-hidden={etiquette ? undefined : 'true'}
  focusable="false"
>
  {#each TRACES[nom] as d (d)}<path {d} />{/each}
</svg>
