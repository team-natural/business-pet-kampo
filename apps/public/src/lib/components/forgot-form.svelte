<script lang="ts">
  // SCR-10. The endpoint answers 204 whether or not the address has an account, and so does this:
  // one confirmation panel, no branch on the result (DEV-02 §7).
  import { onMount } from "svelte";

  const id = $props.id();

  let email = $state("");
  let submitting = $state(false);
  let sent = $state(false);
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
    formError = "";
    fieldErrors = {};

    try {
      const response = await fetch("/api/v1/auth/password/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (response.ok) {
        sent = true;
        return;
      }

      const body = (await response.json().catch(() => null)) as { errors?: Record<string, string[] | undefined> } | null;
      if (response.status === 422 && body?.errors) fieldErrors = body.errors;
      // The rate limit is a property of the connection, not of the address, so saying so reveals
      // nothing about who has an account.
      else if (response.status === 429) formError = "試行回数が上限を超えました。しばらく待ってからやり直してください。";
      else formError = "送信できませんでした。時間をおいて、もう一度お試しください。";
    } catch {
      formError = "サーバーに接続できませんでした。通信環境をご確認ください。";
    } finally {
      submitting = false;
    }
  }
</script>

{#if sent}
  <!-- Worded so it is true either way: something was received, and a mail follows only if there
       was an account to send one to. -->
  <div class="mt-8 max-w-prose">
    <p role="status" class="border border-rule px-4 py-3 leading-relaxed text-pretty">ご入力のメールアドレスにアカウントが登録されている場合、再設定用のリンクをお送りしました。数分経っても届かない場合は、迷惑メールフォルダをご確認ください。</p>
    <a href="/login" class="btn btn-quiet mt-8">ログインへ戻る</a>
  </div>
{:else}
  <form class="mt-8 flex w-full max-w-sm flex-col gap-5" onsubmit={handleSubmit} novalidate>
    {#if formError}
      <p role="alert" class="border border-vermilion px-4 py-3 text-sm text-vermilion">{formError}</p>
    {/if}

    <div class="flex flex-col gap-1.5">
      <label for="email-{id}" class="text-sm">メールアドレス</label>
      <input id="email-{id}" type="email" bind:value={email} autocomplete="email" required aria-invalid={fieldErrors.email ? "true" : undefined} class="min-h-11 border border-ink-soft bg-paper px-3 py-2" />
      {#if fieldErrors.email}<span class="text-sm text-vermilion">{fieldErrors.email.join(" ")}</span>{/if}
    </div>

    <button type="submit" class="btn btn-primary" disabled={!hydrated || submitting || email === ""}>
      {submitting ? "送信しています…" : "再設定メールを送る"}
    </button>
  </form>
{/if}
