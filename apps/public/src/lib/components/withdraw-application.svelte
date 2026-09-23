<script lang="ts">
  // SCR-36. The endpoint answers 204 for every outcome — valid, expired, forged, unknown — so this
  // shows one confirmation regardless (DEV-04 §5-3). Telling the visitor whether it "worked" is
  // exactly the leak the endpoint avoids.
  import { onMount } from "svelte";

  let { applicationId, token }: { applicationId: string; token: string } = $props();

  let submitting = $state(false);
  let done = $state(false);
  let error = $state("");

  let hydrated = $state(false);
  onMount(() => {
    hydrated = true;
  });

  async function handleWithdraw() {
    if (submitting) return;
    submitting = true;
    error = "";

    try {
      const response = await fetch(`/api/v1/applications/${applicationId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });

      // Only a transport or server fault is worth reporting. A 204 says the request was handled,
      // not that an application was found.
      if (response.ok) done = true;
      else error = "手続きを完了できませんでした。時間をおいて、もう一度お試しください。";
    } catch {
      error = "サーバーに接続できませんでした。通信環境をご確認ください。";
    } finally {
      submitting = false;
    }
  }
</script>

{#if done}
  <div class="mt-8">
    <p role="status" class="border border-rule px-4 py-3 leading-relaxed text-pretty">お申し込みの取消を受け付けました。審査前のお申し込みであれば取り消されます。</p>
    <a href="/" class="btn btn-quiet mt-8">トップへ戻る</a>
  </div>
{:else}
  <div class="mt-8">
    {#if error}
      <p role="alert" class="mb-6 border border-vermilion px-4 py-3 text-sm text-vermilion">{error}</p>
    {/if}

    <p class="leading-loose text-pretty text-ink-soft">お申し込みを取り消します。取り消すと審査は行われません。もう一度お取引をご希望の場合は、あらためてお申し込みください。</p>

    <div class="mt-8 flex flex-wrap gap-3">
      <button type="button" class="btn btn-primary" disabled={!hydrated || submitting} onclick={handleWithdraw}>
        {submitting ? "手続きしています…" : "お申し込みを取り消す"}
      </button>
      <a href="/" class="btn btn-quiet">取り消さずに戻る</a>
    </div>
  </div>
{/if}
