<script lang="ts">
  // SCR-03's price panel. The wholesale price is rendered by the page and is deliberately not a
  // prop here — an island's props are serialised into the client HTML, where a cached page would
  // carry one organization's price to the next reader (D-021, DEV-06 §7).
  import { onMount } from "svelte";

  let { productSlug, orderUnit }: { productSlug: string; orderUnit: number } = $props();

  const inputId = $props.id();

  let quantity = $state(orderUnit);
  let submitting = $state(false);
  let added = $state(false);
  let error = $state("");

  let hydrated = $state(false);
  onMount(() => {
    hydrated = true;
  });

  // The server refuses rather than rounds, so mirror the rule here instead of letting the buyer
  // find out on submit (BIZ-03 §3-1).
  const invalid = $derived(quantity <= 0 || quantity % orderUnit !== 0);

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    if (submitting) return;

    submitting = true;
    added = false;
    error = "";

    try {
      const response = await fetch("/api/v1/cart/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productSlug, quantity }),
      });

      if (response.ok) {
        added = true;
        return;
      }

      const body = (await response.json().catch(() => null)) as { message?: string; errors?: Record<string, string[] | undefined> } | null;
      // 403 is a usable sentence on its own — ordering is switched off for this account.
      error = body?.errors?.quantity?.join(" ") ?? body?.message ?? "カートに追加できませんでした。時間をおいて、もう一度お試しください。";
    } catch {
      error = "サーバーに接続できませんでした。通信環境をご確認ください。";
    } finally {
      submitting = false;
    }
  }
</script>

<form class="mt-8 flex flex-col gap-3" onsubmit={handleSubmit} novalidate>
  {#if error}
    <p role="alert" class="border border-vermilion px-4 py-3 text-sm text-vermilion">{error}</p>
  {/if}

  {#if added}
    <p role="status" class="border border-rule px-4 py-3 text-sm leading-relaxed">
      カートに追加しました。<a href="/cart" class="underline underline-offset-4 hover:text-vermilion">カートを見る</a>
    </p>
  {/if}

  <div class="flex flex-col gap-1.5">
    <label for="quantity-{inputId}" class="text-xs text-ink-soft">数量（{orderUnit} の倍数）</label>
    <input id="quantity-{inputId}" type="number" bind:value={quantity} min={orderUnit} step={orderUnit} aria-invalid={invalid ? "true" : undefined} class="min-h-11 border border-ink-soft bg-paper px-3 py-2 text-right font-mono tabular-nums" />
  </div>

  <button type="submit" class="btn btn-primary" disabled={!hydrated || submitting || invalid}>
    {submitting ? "追加しています…" : "カートに追加"}
  </button>
</form>
