<script lang="ts">
  // SCR-13. Name and phone apply on save; the address does not move until the new one has answered
  // its own confirmation link, so the form says so rather than showing the old value back
  // unexplained (F-01-06).
  import { onMount } from "svelte";

  let { name: initialName, email: initialEmail, phone: initialPhone }: { name: string; email: string; phone: string | null } = $props();

  const id = $props.id();

  let name = $state(initialName);
  let email = $state(initialEmail);
  let phone = $state(initialPhone ?? "");

  let submitting = $state(false);
  let saved = $state(false);
  let pendingEmail = $state<string | null>(null);
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
    saved = false;
    pendingEmail = null;
    formError = "";
    fieldErrors = {};

    try {
      const response = await fetch("/api/v1/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, phone: phone === "" ? undefined : phone }),
      });

      const body = (await response.json().catch(() => null)) as { data?: { pendingEmail: string | null }; message?: string; errors?: Record<string, string[] | undefined> } | null;

      if (response.ok) {
        saved = true;
        pendingEmail = body?.data?.pendingEmail ?? null;
        // Reset to the stored address: until the link is answered, that is still the account's.
        if (pendingEmail) email = initialEmail;
        return;
      }

      if (response.status === 422 && body?.errors) fieldErrors = body.errors;
      // 409 is a usable sentence — the address is already taken, or unchanged.
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

  {#if saved}
    <p role="status" class="border border-rule px-4 py-3 text-sm leading-relaxed text-pretty">
      {#if pendingEmail}
        アカウント情報を保存しました。<strong>{pendingEmail}</strong> に確認メールをお送りしました。リンクを開くまで、メールアドレスはこれまでのままです。
      {:else}
        アカウント情報を保存しました。
      {/if}
    </p>
  {/if}

  <div class="flex flex-col gap-1.5">
    <label for="name-{id}" class="text-sm">お名前</label>
    <input id="name-{id}" bind:value={name} autocomplete="name" required aria-invalid={fieldErrors.name ? "true" : undefined} class="min-h-11 border border-ink-soft bg-paper px-3 py-2" />
    {#if fieldErrors.name}<span class="text-sm text-vermilion">{fieldErrors.name.join(" ")}</span>{/if}
  </div>

  <div class="flex flex-col gap-1.5">
    <label for="email-{id}" class="text-sm">メールアドレス</label>
    <input id="email-{id}" type="email" bind:value={email} autocomplete="email" required aria-describedby="email-hint-{id}" aria-invalid={fieldErrors.email ? "true" : undefined} class="min-h-11 border border-ink-soft bg-paper px-3 py-2" />
    <span id="email-hint-{id}" class="text-xs text-ink-soft">変更する場合、新しいアドレス宛の確認メールのリンクを開くと切り替わります。</span>
    {#if fieldErrors.email}<span class="text-sm text-vermilion">{fieldErrors.email.join(" ")}</span>{/if}
  </div>

  <div class="flex flex-col gap-1.5">
    <label for="phone-{id}" class="text-sm">電話番号</label>
    <input id="phone-{id}" type="tel" bind:value={phone} autocomplete="tel" aria-invalid={fieldErrors.phone ? "true" : undefined} class="min-h-11 border border-ink-soft bg-paper px-3 py-2 font-mono tabular-nums" />
    {#if fieldErrors.phone}<span class="text-sm text-vermilion">{fieldErrors.phone.join(" ")}</span>{/if}
  </div>

  <div>
    <button type="submit" class="btn btn-primary" disabled={!hydrated || submitting}>
      {submitting ? "保存しています…" : "保存する"}
    </button>
  </div>
</form>
