<script lang="ts">
  // SCR-16 / SCR-17. One form for both, because the fields are identical and a second copy is
  // where the default-flag rule drifts.
  import { onMount } from "svelte";

  interface Address {
    id: string;
    recipientName: string;
    postalCode: string;
    address: string;
    phone: string;
    isDefault: boolean;
  }

  // Absent means "add"; present means "edit".
  let { address: initial }: { address?: Address } = $props();

  const id = $props.id();

  let recipientName = $state(initial?.recipientName ?? "");
  let postalCode = $state(initial?.postalCode ?? "");
  let address = $state(initial?.address ?? "");
  let phone = $state(initial?.phone ?? "");
  let isDefault = $state(initial?.isDefault ?? false);

  let submitting = $state(false);
  let formError = $state("");
  let fieldErrors = $state<Record<string, string[] | undefined>>({});

  let hydrated = $state(false);
  onMount(() => {
    hydrated = true;
  });

  // Unticking on the current default would leave the organization without one, so the server
  // ignores it — the box is disabled rather than silently having no effect.
  const defaultLocked = $derived(initial?.isDefault === true);

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    if (submitting) return;

    submitting = true;
    formError = "";
    fieldErrors = {};

    try {
      const response = await fetch(initial ? `/api/v1/addresses/${initial.id}` : "/api/v1/addresses", {
        method: initial ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientName, postalCode, address, phone, isDefault: isDefault ? 1 : 0 }),
      });

      if (response.ok) {
        window.location.href = "/mypage/addresses";
        return;
      }

      const body = (await response.json().catch(() => null)) as { message?: string; errors?: Record<string, string[] | undefined> } | null;
      if (response.status === 422 && body?.errors) fieldErrors = body.errors;
      else formError = body?.message ?? "保存できませんでした。時間をおいて、もう一度お試しください。";
    } catch {
      formError = "サーバーに接続できませんでした。通信環境をご確認ください。";
    } finally {
      submitting = false;
    }
  }
</script>

<form class="mt-8 flex w-full max-w-md flex-col gap-5" onsubmit={handleSubmit} novalidate>
  {#if formError}
    <p role="alert" class="border border-vermilion px-4 py-3 text-sm text-vermilion">{formError}</p>
  {/if}

  <div class="flex flex-col gap-1.5">
    <label for="recipient-{id}" class="text-sm">宛名</label>
    <input id="recipient-{id}" bind:value={recipientName} autocomplete="name" required aria-invalid={fieldErrors.recipientName ? "true" : undefined} class="min-h-11 border border-ink-soft bg-paper px-3 py-2" />
    {#if fieldErrors.recipientName}<span class="text-sm text-vermilion">{fieldErrors.recipientName.join(" ")}</span>{/if}
  </div>

  <div class="flex flex-col gap-1.5">
    <label for="postal-{id}" class="text-sm">郵便番号</label>
    <input id="postal-{id}" bind:value={postalCode} inputmode="numeric" autocomplete="postal-code" required aria-invalid={fieldErrors.postalCode ? "true" : undefined} class="min-h-11 border border-ink-soft bg-paper px-3 py-2 font-mono tabular-nums" />
    {#if fieldErrors.postalCode}<span class="text-sm text-vermilion">{fieldErrors.postalCode.join(" ")}</span>{/if}
  </div>

  <div class="flex flex-col gap-1.5">
    <label for="address-{id}" class="text-sm">住所</label>
    <input id="address-{id}" bind:value={address} autocomplete="street-address" required aria-invalid={fieldErrors.address ? "true" : undefined} class="min-h-11 border border-ink-soft bg-paper px-3 py-2" />
    {#if fieldErrors.address}<span class="text-sm text-vermilion">{fieldErrors.address.join(" ")}</span>{/if}
  </div>

  <div class="flex flex-col gap-1.5">
    <label for="phone-{id}" class="text-sm">電話番号</label>
    <input id="phone-{id}" type="tel" bind:value={phone} autocomplete="tel" required aria-invalid={fieldErrors.phone ? "true" : undefined} class="min-h-11 border border-ink-soft bg-paper px-3 py-2 font-mono tabular-nums" />
    {#if fieldErrors.phone}<span class="text-sm text-vermilion">{fieldErrors.phone.join(" ")}</span>{/if}
  </div>

  <div class="flex flex-col gap-1.5">
    <label class="flex items-center gap-2 text-sm">
      <input type="checkbox" bind:checked={isDefault} disabled={defaultLocked} class="size-4" />
      既定の配送先にする
    </label>
    {#if defaultLocked}
      <span class="text-xs text-ink-soft">既定の配送先です。別の配送先を既定にすると切り替わります。</span>
    {/if}
  </div>

  <div class="flex items-center gap-4">
    <button type="submit" class="btn btn-primary" disabled={!hydrated || submitting}>
      {submitting ? "保存しています…" : initial ? "保存する" : "登録する"}
    </button>
    <a href="/mypage/addresses" class="text-sm underline underline-offset-4 hover:text-vermilion">キャンセル</a>
  </div>
</form>
