<script lang="ts">
  import CircleAlertIcon from "@lucide/svelte/icons/circle-alert";
  import CircleCheckIcon from "@lucide/svelte/icons/circle-check";
  import ClockIcon from "@lucide/svelte/icons/clock";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { statusMeta, type StatusDomain } from "$lib/status";

  let { domain, value }: { domain: StatusDomain; value: string } = $props();

  const meta = $derived(statusMeta(domain, value));

  // State is never carried by colour alone. The label always differs, and the three tones an
  // operator has to act on get an icon as well.
  const VARIANTS = { neutral: "outline", info: "secondary", positive: "default", warning: "secondary", danger: "destructive" } as const;

  // Badge ships no warning variant, and `secondary` alone is near-white — on a striped row the
  // pill disappears. Tinted here, not in ui/badge.svelte, which `shadcn-svelte update` rewrites.
  const TONE_CLASS = { neutral: "", info: "", positive: "", warning: "bg-warning/10 text-warning dark:bg-warning/20", danger: "" } as const;
</script>

<Badge variant={VARIANTS[meta.tone]} class={TONE_CLASS[meta.tone]}>
  {#if meta.tone === "positive"}
    <CircleCheckIcon data-icon="inline-start" />
  {:else if meta.tone === "danger"}
    <CircleAlertIcon data-icon="inline-start" />
  {:else if meta.tone === "warning"}
    <ClockIcon data-icon="inline-start" />
  {/if}
  {meta.label}
</Badge>
