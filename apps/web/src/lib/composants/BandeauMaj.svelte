<script lang="ts">
  import { onMount } from 'svelte';
  import { majProposee, recharger, suivre, versionProposee } from '$lib/maj.svelte';
  import BandeauMajVue from './BandeauMajVue.svelte';

  /** `cache` : écran de connexion ou d'enregistrement. On ne propose jamais rien pendant une capture. */
  let { cache }: { cache: boolean } = $props();

  onMount(suivre);
</script>

<BandeauMajVue visible={!cache && majProposee()} version={versionProposee()} surRecharger={recharger} />
