<script lang="ts">
  // SCR-21, one row's quantity and removal. Deliberately narrow: the price, the line subtotal and
  // the totals are rendered by the page and never reach these props, because an island's props are
  // serialised into the client HTML (D-021, DEV-06 §7). After a change the page reloads, so the
  // server recomputes every figure rather than this component guessing at them.
  import { onMount } from "svelte";

  let { id, quantity: initialQuantity, orderUnit, productName }: { id: number; quantity: number; orderUnit: number; productName: string } = $props();

  const inputId = $props.id();

  let quantity = $state(initialQuantity);
  let busy = $state("");
  let error = $state("");

  let hydrated = $state(false);
  onMount(() => {
    hydrated = true;
  });

  const idle = $derived(hydrated && busy === "");
  // The server refuses a quantity that is not a multiple rather than rounding it, so say so here
  // instead of letting the buyer find out on submit (BIZ-03 §3-1).
  const invalid = $derived(quantity <= 0 || quantity % orderUnit !== 0);

  async function send(action: string, request: () => Promise<Response>) {
    if (busy) return;
    busy = action;
    error = "";

    try {
      const response = await request();
      if (response.ok) {
        window.location.reload();
        return;
      }

      const body = (await response.json().catch(() => null)) as { message?: string; errors?: Record<string, string[] | undefined> } | null;
      error = body?.errors?.quantity?.join(" ") ?? body?.message ?? "変更できませんでした。時間をおいて、もう一度お試しください。";
    } catch {
      error = "サーバーに接続できませんでした。通信環境をご確認ください。";
    } finally {
      busy = "";
    }
  }

  const update = () => send("update", () => fetch(`/api/v1/cart/items/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quantity }) }));
  const remove = () => send("remove", () => fetch(`/api/v1/cart/items/${id}`, { method: "DELETE" }));
</script>

<div class="mt-4 flex flex-wrap items-end gap-4">
  <div class="flex flex-col gap-1.5">
    <label for="quantity-{inputId}" class="text-xs text-ink-soft">数量（{orderUnit} の倍数）</label>
    <input id="quantity-{inputId}" type="number" bind:value={quantity} min={orderUnit} step={orderUnit} aria-invalid={invalid ? "true" : undefined} class="min-h-11 w-28 border border-ink-soft bg-paper px-3 py-2 text-right font-mono tabular-nums" />
  </div>

  <button type="button" class="btn btn-quiet" disabled={!idle || invalid || quantity === initialQuantity} onclick={update}>
    {busy === "update" ? "更新しています…" : "数量を更新"}
  </button>

  <button type="button" class="text-sm underline underline-offset-4 hover:text-vermilion" disabled={!idle} onclick={remove}>
    {busy === "remove" ? "削除しています…" : "削除"}
    <span class="sr-only">（{productName}）</span>
  </button>
</div>

{#if error}
  <p role="alert" class="mt-3 text-sm text-vermilion">{error}</p>
{/if}
