<script lang="ts">
  // ADM-13's action panel. An island because each action is a POST with a JSON body and the
  // result has to land next to the field that caused it; the surrounding screen stays server
  // rendered (DEV-06 §7).
  //
  // Which buttons exist is decided by the transition map the server sent down. The API refuses an
  // illegal move with 409 regardless — this only keeps the operator from reaching for one.
  import { onMount } from "svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";

  let {
    publicId,
    transitions,
    reviewMemo,
    suggestedMemberName,
    suggestedMemberEmail,
  }: {
    publicId: string;
    transitions: string[];
    reviewMemo: string | null;
    // Prefilled from the application so the reviewer confirms rather than retypes. Both are
    // editable: the contact who applied is not always the one who will log in.
    suggestedMemberName: string;
    suggestedMemberEmail: string;
  } = $props();

  const id = $props.id();

  let memo = $state(reviewMemo ?? "");
  let orgCode = $state("");
  let memberName = $state(suggestedMemberName);
  let memberEmail = $state(suggestedMemberEmail);
  let reason = $state("");

  // Which inline form is open. Approval and rejection both need input, so neither fires from a
  // single click.
  let open = $state<"none" | "approve" | "reject">("none");

  let busy = $state("");
  let error = $state("");
  let fieldErrors = $state<Record<string, string[] | undefined>>({});

  // Every control renders server-side too, so without this a click that lands before the island's
  // JS arrives does nothing at all — and silently. "Enabled" is therefore also the signal the E2E
  // suite uses to prove the client:* directive is there (DEV-03 §3-5).
  let hydrated = $state(false);
  onMount(() => {
    hydrated = true;
  });

  const idle = $derived(hydrated && busy === "");
  const can = (to: string) => transitions.includes(to);

  async function post(path: string, body: unknown, action: string) {
    if (busy) return;
    busy = action;
    error = "";
    fieldErrors = {};

    try {
      const response = await fetch(`/api/v1/applications/${publicId}${path}`, {
        method: path === "" ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        // Reload rather than patch the DOM: the status badge, the transition list and the audit
        // trail all move together, and the server already knows how to render them.
        window.location.reload();
        return;
      }

      const payload = (await response.json().catch(() => null)) as { message?: string; errors?: Record<string, string[] | undefined> } | null;
      if (response.status === 422 && payload?.errors) fieldErrors = payload.errors;
      // 409 carries a usable sentence: a duplicate org_code, or a move the state machine refuses.
      else error = payload?.message ?? "操作を完了できませんでした。時間をおいて、もう一度お試しください。";
    } catch {
      error = "サーバーに接続できませんでした。";
    } finally {
      busy = "";
    }
  }
</script>

<div class="flex flex-col gap-6">
  {#if error}
    <p role="alert" class="rounded-md border border-destructive/50 px-4 py-3 text-sm text-destructive">{error}</p>
  {/if}

  <div class="flex flex-col gap-2">
    <label for="memo-{id}" class="text-xs font-medium text-muted-foreground">審査メモ</label>
    <textarea id="memo-{id}" bind:value={memo} rows="4" class="rounded-md border border-input bg-input/30 px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"></textarea>
    <div>
      <Button variant="outline" size="sm" disabled={!idle} onclick={() => post("", { reviewMemo: memo }, "memo")}>
        {busy === "memo" ? "保存しています…" : "メモを保存"}
      </Button>
    </div>
  </div>

  {#if transitions.length === 0}
    <p class="text-sm text-muted-foreground">この申請は終了しています。これ以上の操作はできません。</p>
  {:else}
    <div class="flex flex-wrap gap-2 border-t pt-6">
      {#if can("reviewing")}
        <Button variant="outline" disabled={!idle} onclick={() => post("/review", {}, "review")}>
          {busy === "review" ? "処理中…" : "審査を開始する"}
        </Button>
      {/if}
      {#if can("needs_confirmation")}
        <Button variant="outline" disabled={!idle} onclick={() => post("/request-confirmation", {}, "confirm")}>
          {busy === "confirm" ? "処理中…" : "確認・差し戻し"}
        </Button>
      {/if}
      {#if can("approved")}
        <Button disabled={!idle} onclick={() => (open = open === "approve" ? "none" : "approve")}>承認する</Button>
      {/if}
      {#if can("rejected")}
        <Button variant="outline" disabled={!idle} onclick={() => (open = open === "reject" ? "none" : "reject")}>否認する</Button>
      {/if}
    </div>
  {/if}

  {#if open === "approve"}
    <div class="flex flex-col gap-4 rounded-md border p-4">
      <div>
        <h3 class="text-sm font-medium">承認して取引先を作成する</h3>
        <!-- org_code has no foreign key behind it; the price files join on this string (D-019). -->
        <p class="mt-1 text-sm text-muted-foreground">取引先コードは<strong>採番後に変更できません</strong>。取引先別卸価格のファイルがこのコードで紐づきます。</p>
      </div>

      <div class="grid gap-4 sm:grid-cols-2">
        <div class="flex flex-col gap-1.5">
          <label for="org-code-{id}" class="text-xs font-medium text-muted-foreground">取引先コード</label>
          <Input id="org-code-{id}" bind:value={orgCode} placeholder="ORG-A001" aria-invalid={fieldErrors.orgCode ? "true" : undefined} />
          {#if fieldErrors.orgCode}<span class="text-sm text-destructive">{fieldErrors.orgCode.join(" ")}</span>{/if}
        </div>
        <div class="flex flex-col gap-1.5">
          <label for="member-name-{id}" class="text-xs font-medium text-muted-foreground">初期ユーザー名</label>
          <Input id="member-name-{id}" bind:value={memberName} aria-invalid={fieldErrors.initialMemberName ? "true" : undefined} />
          {#if fieldErrors.initialMemberName}<span class="text-sm text-destructive">{fieldErrors.initialMemberName.join(" ")}</span>{/if}
        </div>
        <div class="flex flex-col gap-1.5 sm:col-span-2">
          <label for="member-email-{id}" class="text-xs font-medium text-muted-foreground">初期ユーザーのメールアドレス</label>
          <Input id="member-email-{id}" type="email" bind:value={memberEmail} aria-invalid={fieldErrors.initialMemberEmail ? "true" : undefined} />
          <span class="text-xs text-muted-foreground">この宛先にパスワード設定のご案内を送ります。</span>
          {#if fieldErrors.initialMemberEmail}<span class="text-sm text-destructive">{fieldErrors.initialMemberEmail.join(" ")}</span>{/if}
        </div>
      </div>

      <div class="flex gap-2">
        <Button disabled={!idle || orgCode.trim() === ""} onclick={() => post("/approve", { orgCode, initialMemberName: memberName, initialMemberEmail: memberEmail }, "approve")}>
          {busy === "approve" ? "承認しています…" : "この内容で承認する"}
        </Button>
        <Button variant="ghost" disabled={!idle} onclick={() => (open = "none")}>やめる</Button>
      </div>
    </div>
  {/if}

  {#if open === "reject"}
    <div class="flex flex-col gap-4 rounded-md border p-4">
      <div>
        <h3 class="text-sm font-medium">否認する</h3>
        <!-- No column stores it: the reason reaches the applicant by mail and the audit log. -->
        <p class="mt-1 text-sm text-muted-foreground">入力した理由はそのまま申請者へのメールに記載され、監査ログにも残ります。</p>
      </div>

      <div class="flex flex-col gap-1.5">
        <label for="reason-{id}" class="text-xs font-medium text-muted-foreground">否認理由</label>
        <textarea id="reason-{id}" bind:value={reason} rows="3" aria-invalid={fieldErrors.reason ? "true" : undefined} class="rounded-md border border-input bg-input/30 px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"></textarea>
        {#if fieldErrors.reason}<span class="text-sm text-destructive">{fieldErrors.reason.join(" ")}</span>{/if}
      </div>

      <div class="flex gap-2">
        <Button variant="destructive" disabled={!idle || reason.trim() === ""} onclick={() => post("/reject", { reason }, "reject")}>
          {busy === "reject" ? "否認しています…" : "この理由で否認する"}
        </Button>
        <Button variant="ghost" disabled={!idle} onclick={() => (open = "none")}>やめる</Button>
      </div>
    </div>
  {/if}
</div>
