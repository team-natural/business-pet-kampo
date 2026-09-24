<script lang="ts">
  // SCR-14. Nothing here takes effect on save: the operator confirms contract data before it
  // moves (F-05-03, D-035), so the form says "申請" and the values shown stay the stored ones.
  import { onMount } from "svelte";

  let { name: storedName, billingPostalCode: storedPostalCode, billingAddress: storedAddress }: { name: string; billingPostalCode: string | null; billingAddress: string | null } = $props();

  const id = $props.id();

  let name = $state(storedName);
  let billingPostalCode = $state(storedPostalCode ?? "");
  let billingAddress = $state(storedAddress ?? "");
  let message = $state("");

  let submitting = $state(false);
  let submitted = $state(false);
  let formError = $state("");
  let fieldErrors = $state<Record<string, string[] | undefined>>({});

  let hydrated = $state(false);
  onMount(() => {
    hydrated = true;
  });

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    if (submitting) return;

    submitting = true;
    submitted = false;
    formError = "";
    fieldErrors = {};

    try {
      const response = await fetch("/api/v1/me/company", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, billingPostalCode, billingAddress, message: message === "" ? undefined : message }),
      });

      const body = (await response.json().catch(() => null)) as { message?: string; errors?: Record<string, string[] | undefined> } | null;

      if (response.ok) {
        submitted = true;
        message = "";
        return;
      }

      if (response.status === 422 && body?.errors) fieldErrors = body.errors;
      else formError = body?.message ?? "申請できませんでした。時間をおいて、もう一度お試しください。";
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

  {#if submitted}
    <p role="status" class="border border-rule px-4 py-3 text-sm leading-relaxed text-pretty">変更のご希望を承りました。担当が内容を確認のうえ反映いたします。反映までは、これまでの内容が表示されます。</p>
  {/if}

  <div class="flex flex-col gap-1.5">
    <label for="company-name-{id}" class="text-sm">会社名</label>
    <input id="company-name-{id}" bind:value={name} autocomplete="organization" required aria-invalid={fieldErrors.name ? "true" : undefined} class="min-h-11 border border-ink-soft bg-paper px-3 py-2" />
    {#if fieldErrors.name}<span class="text-sm text-vermilion">{fieldErrors.name.join(" ")}</span>{/if}
  </div>

  <div class="flex flex-col gap-1.5">
    <label for="billing-postal-{id}" class="text-sm">請求先郵便番号</label>
    <input id="billing-postal-{id}" bind:value={billingPostalCode} inputmode="numeric" autocomplete="postal-code" aria-invalid={fieldErrors.billingPostalCode ? "true" : undefined} class="min-h-11 border border-ink-soft bg-paper px-3 py-2 font-mono tabular-nums" />
    {#if fieldErrors.billingPostalCode}<span class="text-sm text-vermilion">{fieldErrors.billingPostalCode.join(" ")}</span>{/if}
  </div>

  <div class="flex flex-col gap-1.5">
    <label for="billing-address-{id}" class="text-sm">請求先住所</label>
    <input id="billing-address-{id}" bind:value={billingAddress} autocomplete="street-address" aria-invalid={fieldErrors.billingAddress ? "true" : undefined} class="min-h-11 border border-ink-soft bg-paper px-3 py-2" />
    {#if fieldErrors.billingAddress}<span class="text-sm text-vermilion">{fieldErrors.billingAddress.join(" ")}</span>{/if}
  </div>

  <div class="flex flex-col gap-1.5">
    <label for="message-{id}" class="text-sm">担当へのご連絡事項（任意）</label>
    <textarea id="message-{id}" bind:value={message} rows="4" aria-invalid={fieldErrors.message ? "true" : undefined} class="border border-ink-soft bg-paper px-3 py-2"></textarea>
    {#if fieldErrors.message}<span class="text-sm text-vermilion">{fieldErrors.message.join(" ")}</span>{/if}
  </div>

  <div>
    <button type="submit" class="btn btn-primary" disabled={!hydrated || submitting}>
      {submitting ? "送信しています…" : "変更を申請する"}
    </button>
  </div>
</form>
