<script lang="ts">
  // SCR-15. The page passes the rows in already loaded, so the list reads without JavaScript;
  // promoting and deleting are what need the island.
  import { onMount } from "svelte";

  interface Address {
    id: string;
    recipientName: string;
    postalCode: string;
    address: string;
    phone: string;
    isDefault: boolean;
  }

  let { addresses: initial }: { addresses: Address[] } = $props();

  let addresses = $state(initial);
  // The id currently being acted on, so only that row's buttons go quiet.
  let busy = $state("");
  let confirming = $state("");
  let error = $state("");

  let hydrated = $state(false);
  onMount(() => {
    hydrated = true;
  });

  const idle = $derived(hydrated && busy === "");

  async function reload() {
    const response = await fetch("/api/v1/addresses");
    if (!response.ok) return;
    const body = (await response.json()) as { data: Address[] };
    addresses = body.data;
  }

  async function makeDefault(target: Address) {
    if (busy) return;
    busy = target.id;
    error = "";

    try {
      // The whole address goes back: PATCH validates the full shape, so a partial body would be
      // rejected as a missing field rather than understood as "only change the flag".
      const response = await fetch(`/api/v1/addresses/${target.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientName: target.recipientName, postalCode: target.postalCode, address: target.address, phone: target.phone, isDefault: 1 }),
      });

      if (response.ok) await reload();
      else error = "既定の配送先を変更できませんでした。時間をおいて、もう一度お試しください。";
    } catch {
      error = "サーバーに接続できませんでした。通信環境をご確認ください。";
    } finally {
      busy = "";
    }
  }

  async function remove(target: Address) {
    if (busy) return;
    busy = target.id;
    error = "";

    try {
      const response = await fetch(`/api/v1/addresses/${target.id}`, { method: "DELETE" });
      if (response.ok) {
        confirming = "";
        await reload();
      } else {
        error = "配送先を削除できませんでした。時間をおいて、もう一度お試しください。";
      }
    } catch {
      error = "サーバーに接続できませんでした。通信環境をご確認ください。";
    } finally {
      busy = "";
    }
  }
</script>

{#if error}
  <p role="alert" class="mt-6 border border-vermilion px-4 py-3 text-sm text-vermilion">{error}</p>
{/if}

{#if addresses.length === 0}
  <p class="mt-8 text-sm leading-relaxed text-ink-soft">登録済みの配送先はありません。</p>
{:else}
  <ul class="mt-8 flex flex-col gap-4">
    {#each addresses as address (address.id)}
      <li class="border border-rule p-5" data-testid="address-row">
        <div class="flex flex-wrap items-baseline gap-3">
          <span class="font-medium">{address.recipientName}</span>
          {#if address.isDefault}<span class="border border-rule px-2 py-0.5 text-xs text-ink-soft">既定</span>{/if}
        </div>
        <p class="mt-2 text-sm leading-relaxed text-ink-soft">
          <span class="font-mono tabular-nums">〒{address.postalCode}</span>
          {address.address}
        </p>
        <p class="mt-1 font-mono text-sm text-ink-soft tabular-nums">{address.phone}</p>

        {#if confirming === address.id}
          <p class="mt-4 text-sm leading-relaxed text-pretty">この配送先を削除します。過去のご注文の配送先は変わりません。</p>
          <div class="mt-4 flex flex-wrap items-center gap-3">
            <button type="button" class="btn btn-primary" disabled={!idle} onclick={() => remove(address)}>削除する</button>
            <button type="button" class="text-sm underline underline-offset-4 hover:text-vermilion" disabled={!idle} onclick={() => (confirming = "")}>やめる</button>
          </div>
        {:else}
          <div class="mt-4 flex flex-wrap items-center gap-4 text-sm">
            <a href={`/mypage/addresses/${address.id}/edit`} class="underline underline-offset-4 hover:text-vermilion">編集</a>
            {#if !address.isDefault}
              <button type="button" class="underline underline-offset-4 hover:text-vermilion" disabled={!idle} onclick={() => makeDefault(address)}>既定にする</button>
            {/if}
            <button type="button" class="underline underline-offset-4 hover:text-vermilion" disabled={!idle} onclick={() => (confirming = address.id)}>削除</button>
          </div>
        {/if}
      </li>
    {/each}
  </ul>
{/if}
