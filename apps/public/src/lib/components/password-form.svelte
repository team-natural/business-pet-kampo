<script lang="ts">
  // Shared by activation (SCR-09) and reset (SCR-11). The two differ only in where they post, what
  // the button says and where they land — the rules around the field are identical, and a second
  // copy is where one of them would quietly lose the confirmation field.
  import { onMount } from "svelte";

  let {
    endpoint,
    token,
    submitLabel,
    submittingLabel,
    redirectTo,
  }: {
    endpoint: string;
    token: string;
    submitLabel: string;
    submittingLabel: string;
    redirectTo: string;
  } = $props();

  const id = $props.id();
  // Mirrors the server's floor (validation/auth.ts). Shown so the rule is known before submitting,
  // not discovered by failing — the server re-checks it regardless (DEV-06 §7).
  const MIN_LENGTH = 12;

  let password = $state("");
  let confirmation = $state("");
  let submitting = $state(false);
  let formError = $state("");
  let fieldErrors = $state<Record<string, string[] | undefined>>({});

  let hydrated = $state(false);
  onMount(() => {
    hydrated = true;
  });

  // Client-side only, and only to save a round trip: the server never sees this field, because
  // "typed the same thing twice" is not something it can verify anyway.
  const mismatch = $derived(confirmation !== "" && password !== confirmation);
  const ready = $derived(hydrated && !submitting && password.length >= MIN_LENGTH && !mismatch && confirmation !== "");

  function messageFor(status: number) {
    // 401 is every way the link can be unusable — wrong, expired, already used. The endpoint does
    // not distinguish them and neither does this.
    if (status === 401) return "このリンクは使用できません。お手数ですが、もう一度お手続きください。";
    if (status === 429) return "試行回数が上限を超えました。しばらく待ってからやり直してください。";
    return "設定できませんでした。時間をおいて、もう一度お試しください。";
  }

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    if (!ready) return;

    submitting = true;
    formError = "";
    fieldErrors = {};

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });

      if (response.ok) {
        // replace() so Back does not return to a form whose token is now spent.
        window.location.replace(redirectTo);
        return;
      }

      const body = (await response.json().catch(() => null)) as { errors?: Record<string, string[] | undefined> } | null;
      if (response.status === 422 && body?.errors) fieldErrors = body.errors;
      else formError = messageFor(response.status);
    } catch {
      formError = "サーバーに接続できませんでした。通信環境をご確認ください。";
    } finally {
      submitting = false;
    }
  }
</script>

<form class="mt-8 flex w-full max-w-sm flex-col gap-5" onsubmit={handleSubmit} novalidate>
  {#if formError}
    <p role="alert" class="border border-vermilion px-4 py-3 text-sm text-vermilion">{formError}</p>
  {/if}

  <div class="flex flex-col gap-1.5">
    <label for="password-{id}" class="text-sm">新しいパスワード</label>
    <input id="password-{id}" type="password" bind:value={password} autocomplete="new-password" required aria-describedby="hint-{id}" aria-invalid={fieldErrors.password ? "true" : undefined} class="min-h-11 border border-ink-soft bg-paper px-3 py-2" />
    <span id="hint-{id}" class="text-xs text-ink-soft">{MIN_LENGTH} 文字以上。長さのほかに制限はありません。</span>
    {#if fieldErrors.password}<span class="text-sm text-vermilion">{fieldErrors.password.join(" ")}</span>{/if}
  </div>

  <div class="flex flex-col gap-1.5">
    <label for="confirm-{id}" class="text-sm">新しいパスワード（確認）</label>
    <input id="confirm-{id}" type="password" bind:value={confirmation} autocomplete="new-password" required aria-invalid={mismatch ? "true" : undefined} class="min-h-11 border border-ink-soft bg-paper px-3 py-2" />
    {#if mismatch}<span role="alert" class="text-sm text-vermilion">入力が一致しません。</span>{/if}
  </div>

  <button type="submit" class="btn btn-primary" disabled={!ready}>
    {submitting ? submittingLabel : submitLabel}
  </button>
</form>
