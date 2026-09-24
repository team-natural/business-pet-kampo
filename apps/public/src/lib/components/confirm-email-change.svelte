<script lang="ts">
  // The confirmation step for an address change (F-01-06). A button rather than an automatic POST
  // on page load: mail scanners and link prefetchers open links, and a GET that changes the
  // account would let them do it on the member's behalf.
  import { onMount } from "svelte";

  let { token }: { token: string } = $props();

  let submitting = $state(false);
  let confirmedEmail = $state<string | null>(null);
  let error = $state("");

  let hydrated = $state(false);
  onMount(() => {
    hydrated = true;
  });

  async function handleConfirm() {
    if (submitting) return;
    submitting = true;
    error = "";

    try {
      const response = await fetch("/api/v1/me/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });

      const body = (await response.json().catch(() => null)) as { data?: { email: string }; message?: string } | null;
      if (response.ok) confirmedEmail = body?.data?.email ?? null;
      // 401 covers every unusable link and 409 means the address was claimed in the meantime;
      // both arrive with a sentence worth showing.
      else error = body?.message ?? "確認できませんでした。時間をおいて、もう一度お試しください。";
    } catch {
      error = "サーバーに接続できませんでした。通信環境をご確認ください。";
    } finally {
      submitting = false;
    }
  }
</script>

{#if confirmedEmail}
  <div class="mt-8">
    <p role="status" class="border border-rule px-4 py-3 leading-relaxed text-pretty">メールアドレスを <strong>{confirmedEmail}</strong> に変更しました。次回のログインからは新しいアドレスをお使いください。</p>
    <a href="/mypage/profile" class="btn btn-quiet mt-8">アカウント情報へ</a>
  </div>
{:else}
  <div class="mt-8">
    {#if error}
      <p role="alert" class="mb-6 border border-vermilion px-4 py-3 text-sm text-vermilion">{error}</p>
    {/if}

    <p class="leading-loose text-pretty text-ink-soft">下のボタンを押すと、このメールアドレスがアカウントの連絡先として登録されます。</p>

    <div class="mt-8 flex flex-wrap gap-3">
      <button type="button" class="btn btn-primary" disabled={!hydrated || submitting} onclick={handleConfirm}>
        {submitting ? "確認しています…" : "このアドレスを登録する"}
      </button>
      <a href="/mypage/profile" class="btn btn-quiet">やめる</a>
    </div>
  </div>
{/if}
