<script lang="ts">
  // SCR-20. Two steps on purpose: closing the account ends the whole company's trading, and
  // `terminated` has no way back — reopening means a fresh application (DEV-09 §2-2-2). A single
  // click is the wrong shape for that.
  import { onMount } from "svelte";

  let { organizationName }: { organizationName: string } = $props();

  const id = $props.id();

  let reason = $state("");
  let confirming = $state(false);
  let submitting = $state(false);
  let submitted = $state(false);
  let formError = $state("");

  let hydrated = $state(false);
  onMount(() => {
    hydrated = true;
  });

  async function submit() {
    if (submitting) return;
    submitting = true;
    formError = "";

    try {
      const response = await fetch("/api/v1/me/withdrawal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason === "" ? undefined : reason }),
      });

      if (response.ok) {
        submitted = true;
        return;
      }

      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      formError = body?.message ?? "お申し出を送信できませんでした。時間をおいて、もう一度お試しください。";
    } catch {
      formError = "サーバーに接続できませんでした。通信環境をご確認ください。";
    } finally {
      submitting = false;
    }
  }
</script>

{#if submitted}
  <div class="mt-8">
    <p role="status" class="border border-rule px-4 py-3 leading-relaxed text-pretty">お申し出を承りました。担当が内容を確認のうえ、あらためてご連絡いたします。手続きが完了するまでは、これまでどおりご利用いただけます。</p>
    <a href="/mypage" class="btn btn-quiet mt-8">マイページへ戻る</a>
  </div>
{:else}
  <div class="mt-8">
    {#if formError}
      <p role="alert" class="mb-6 border border-vermilion px-4 py-3 text-sm text-vermilion">{formError}</p>
    {/if}

    <div class="flex flex-col gap-1.5">
      <label for="reason-{id}" class="text-sm">お申し出の理由（任意）</label>
      <span id="reason-hint-{id}" class="text-xs text-ink-soft">今後の改善のため、差し支えなければお聞かせください。</span>
      <textarea id="reason-{id}" bind:value={reason} rows="4" maxlength="1000" aria-describedby="reason-hint-{id}" disabled={confirming} class="mt-1 border border-ink-soft bg-paper px-3 py-2"></textarea>
    </div>

    {#if confirming}
      <p role="alert" class="mt-8 border border-vermilion px-4 py-3 text-sm leading-relaxed text-pretty">
        <strong>{organizationName}</strong> のお取引終了を申し出ます。お取引が終了すると、御社のすべてのご担当者がログインできなくなります。再開をご希望の場合は、あらためて新規のお申し込みが必要です。
      </p>
      <div class="mt-6 flex flex-wrap items-center gap-4">
        <button type="button" class="btn btn-primary" disabled={!hydrated || submitting} onclick={submit}>
          {submitting ? "送信しています…" : "この内容で申し出る"}
        </button>
        <button type="button" class="text-sm underline underline-offset-4 hover:text-vermilion" disabled={submitting} onclick={() => (confirming = false)}>やめる</button>
      </div>
    {:else}
      <div class="mt-8">
        <button type="button" class="btn btn-quiet" disabled={!hydrated} onclick={() => (confirming = true)}>退会・取引終了を申し出る</button>
      </div>
    {/if}
  </div>
{/if}
