<script lang="ts">
  // SCR-22's controls only. The lines, the totals and the wholesale prices are rendered by the
  // page and never reach these props — an island's props are serialised into the client HTML
  // (D-021, DEV-06 §7).
  import { onMount } from "svelte";

  interface AddressOption {
    id: string;
    label: string;
  }

  interface PaymentOption {
    id: string;
    label: string;
    description: string;
    // Card payment arrives in S11; offering it now would take an order it cannot charge.
    available: boolean;
  }

  let { addresses, paymentMethods }: { addresses: AddressOption[]; paymentMethods: PaymentOption[] } = $props();

  const id = $props.id();

  let shippingAddressId = $state(addresses[0]?.id ?? "");
  let paymentMethod = $state(paymentMethods.find((method) => method.available)?.id ?? "");
  let notes = $state("");

  let submitting = $state(false);
  let formError = $state("");

  let hydrated = $state(false);
  onMount(() => {
    hydrated = true;
  });

  const ready = $derived(hydrated && !submitting && shippingAddressId !== "" && paymentMethod !== "");

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    if (submitting) return;

    submitting = true;
    formError = "";

    try {
      const response = await fetch("/api/v1/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shippingAddressId, paymentMethod, notes: notes === "" ? undefined : notes }),
      });

      const body = (await response.json().catch(() => null)) as { data?: { orderNumber: string }; message?: string } | null;

      if (response.ok && body?.data) {
        // replace() so Back does not return to a confirmation screen whose cart is now empty.
        window.location.replace(`/checkout/thanks?order=${encodeURIComponent(body.data.orderNumber)}`);
        return;
      }

      // 409 is a usable sentence on its own: below the minimum, an empty cart, a withdrawn product.
      formError = body?.message ?? "ご発注を確定できませんでした。時間をおいて、もう一度お試しください。";
    } catch {
      formError = "サーバーに接続できませんでした。通信環境をご確認ください。";
    } finally {
      submitting = false;
    }
  }
</script>

<form class="mt-10 flex flex-col gap-10" onsubmit={handleSubmit} novalidate>
  {#if formError}
    <p role="alert" class="border border-vermilion px-4 py-3 text-sm leading-relaxed text-pretty text-vermilion">{formError}</p>
  {/if}

  <fieldset class="border-t border-rule pt-8">
    <legend class="font-display text-lg">お届け先</legend>
    {#if addresses.length === 0}
      <p class="mt-4 text-sm leading-relaxed text-ink-soft">
        配送先が登録されていません。<a href="/mypage/addresses/new" class="underline underline-offset-4 hover:text-vermilion">配送先を登録する</a>
      </p>
    {:else}
      <div class="mt-4 flex flex-col gap-3">
        {#each addresses as address (address.id)}
          <label class="flex items-start gap-3 border border-rule px-4 py-3 text-sm leading-relaxed">
            <input type="radio" name="shippingAddressId" value={address.id} bind:group={shippingAddressId} class="mt-1 size-4" />
            <span class="text-pretty">{address.label}</span>
          </label>
        {/each}
      </div>
      <p class="mt-3 text-sm">
        <a href="/mypage/addresses" class="underline underline-offset-4 hover:text-vermilion">配送先を追加・編集する</a>
      </p>
    {/if}
  </fieldset>

  <fieldset class="border-t border-rule pt-8">
    <legend class="font-display text-lg">お支払い方法</legend>
    <div class="mt-4 flex flex-col gap-3">
      {#each paymentMethods as method (method.id)}
        <label class="flex items-start gap-3 border border-rule px-4 py-3 text-sm leading-relaxed" class:opacity-50={!method.available}>
          <input type="radio" name="paymentMethod" value={method.id} bind:group={paymentMethod} disabled={!method.available} class="mt-1 size-4" />
          <span class="text-pretty">
            <span class="font-medium">{method.label}</span>
            <span class="mt-1 block text-ink-soft">{method.available ? method.description : "現在ご利用いただけません。"}</span>
          </span>
        </label>
      {/each}
    </div>
  </fieldset>

  <div class="flex flex-col gap-1.5 border-t border-rule pt-8">
    <label for="notes-{id}" class="font-display text-lg">備考（任意）</label>
    <span class="text-sm text-ink-soft">納品に関するご要望などがあればご記入ください。</span>
    <textarea id="notes-{id}" bind:value={notes} rows="4" maxlength="1000" class="mt-2 border border-ink-soft bg-paper px-3 py-2"></textarea>
  </div>

  <div class="flex flex-wrap items-center gap-4">
    <button type="submit" class="btn btn-primary" disabled={!ready}>
      {submitting ? "発注しています…" : "この内容で発注する"}
    </button>
    <a href="/cart" class="text-sm underline underline-offset-4 hover:text-vermilion">カートへ戻る</a>
  </div>
</form>
