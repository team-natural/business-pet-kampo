<script lang="ts">
  // Plain markup, not shadcn: shadcn-svelte is admin-only, and a public site's design is
  // rebuilt per project anyway. This is the working skeleton to restyle.
  import { onMount } from "svelte";

  const LANDING_ROUTE = "/mypage";

  const id = $props.id();

  let email = $state("");
  let password = $state("");
  let submitting = $state(false);
  // The island renders before its JS runs, and a submit in that window is a native POST that
  // silently loses the input.
  let hydrated = $state(false);
  onMount(() => {
    hydrated = true;
  });
  let fieldErrors = $state<Record<string, string[] | undefined>>({});
  let formError = $state("");

  // Mapped by status rather than shown from the response body: the wording stays this screen's
  // own. None of these distinguish "no such account" from "wrong password".
  function messageFor(status: number) {
    if (status === 401) return "メールアドレスまたはパスワードが正しくありません。";
    if (status === 429) return "試行回数が上限を超えました。しばらく待ってからやり直してください。";
    return "ログインできませんでした。時間をおいて、もう一度お試しください。";
  }

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    if (submitting) return;

    submitting = true;
    fieldErrors = {};
    formError = "";

    try {
      const response = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (response.ok) {
        // replace() so Back doesn't return to an already-authenticated login form.
        window.location.replace(LANDING_ROUTE);
        return;
      }

      const body = (await response.json().catch(() => null)) as { errors?: Record<string, string[] | undefined> } | null;
      if (response.status === 422 && body?.errors) {
        fieldErrors = body.errors;
      } else {
        formError = messageFor(response.status);
      }
    } catch {
      formError = "サーバーに接続できませんでした。通信環境をご確認ください。";
    } finally {
      // Unreached on success (navigating away) — re-enabling first would allow a double submit.
      submitting = false;
    }
  }
</script>

<form class="mt-8 flex w-full flex-col gap-5" onsubmit={handleSubmit}>
  {#if formError}
    <p role="alert" class="border border-vermilion px-4 py-3 text-sm text-vermilion">{formError}</p>
  {/if}

  <div class="flex flex-col gap-1.5">
    <label for="email-{id}" class="text-sm">メールアドレス</label>
    <input id="email-{id}" class="min-h-11 border border-ink-soft bg-paper px-3 py-2" type="email" autocomplete="username" bind:value={email} required aria-invalid={fieldErrors.email ? "true" : undefined} />
    {#if fieldErrors.email}
      <p role="alert" class="text-sm text-vermilion">{fieldErrors.email.join(" ")}</p>
    {/if}
  </div>

  <div class="flex flex-col gap-1.5">
    <label for="password-{id}" class="text-sm">パスワード</label>
    <input id="password-{id}" class="min-h-11 border border-ink-soft bg-paper px-3 py-2" type="password" autocomplete="current-password" bind:value={password} required aria-invalid={fieldErrors.password ? "true" : undefined} />
    {#if fieldErrors.password}
      <p role="alert" class="text-sm text-vermilion">{fieldErrors.password.join(" ")}</p>
    {/if}
  </div>

  <div>
    <button type="submit" class="btn btn-primary" disabled={!hydrated || submitting}>
      {submitting ? "ログインしています…" : "ログイン"}
    </button>
  </div>
</form>
