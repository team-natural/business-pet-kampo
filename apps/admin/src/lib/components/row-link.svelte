<script lang="ts">
  import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";
  import type { Snippet } from "svelte";
  import { cn } from "$lib/utils.js";

  // The one clickable thing in a list row, sitting in a wall of static text. A hover-only underline
  // left it reading as a label, so the underline stands and a chevron marks the drill-in.
  let { href, class: className, children }: { href: string; class?: string; children: Snippet } = $props();
</script>

<a {href} class={cn("group/row-link inline-flex max-w-full items-center gap-1 rounded-sm", className)}>
  <!-- pb/-mb pair: `truncate` clips at the padding edge, and at text-xs the offset-4 underline falls
       outside a 16px line box. The padding lets it through, the negative margin keeps the layout. -->
  <span class="-mb-1 truncate pb-1 font-medium underline decoration-muted-foreground/40 underline-offset-4 group-hover/row-link:decoration-current">
    {@render children()}
  </span>
  <ChevronRightIcon aria-hidden="true" class="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover/row-link:translate-x-0.5" />
</a>
