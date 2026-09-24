<script lang="ts">
  // ADM-15's edit and trading-status panel. Same shape as review-actions.svelte: an island because
  // each action is a JSON request whose errors belong next to the field that caused them, with the
  // surrounding screen server rendered (DEV-06 §7).
  import { onMount } from "svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";

  let {
    publicId,
    transitions,
    name: initialName,
    billingPostalCode: initialPostalCode,
    billingAddress: initialAddress,
    memo: initialMemo,
    orderEnabled: initialOrderEnabled,
  }: {
    publicId: string;
    transitions: string[];
    name: string;
    billingPostalCode: string | null;
    billingAddress: string | null;
    memo: string | null;
    orderEnabled: boolean;
  } = $props();

  const id = $props.id();

  let name = $state(initialName);
  let billingPostalCode = $state(initialPostalCode ?? "");
  let billingAddress = $state(initialAddress ?? "");
  let memo = $state(initialMemo ?? "");
  let orderEnabled = $state(initialOrderEnabled);

  // Which destructive form is open. Both need a reason, so neither fires from a single click.
  let open = $state<"none" | "suspend" | "terminate">("none");
  let reason = $state("");

  let busy = $state("");
  let error = $state("");
  let fieldErrors = $state<Record<string, string[] | undefined>>({});

  // Every control renders server-side too, so a click landing before the island's JS does nothing
  // at all — and silently. "Enabled" is also the E2E suite's hydration signal (DEV-03 §3-5).
  let hydrated = $state(false);
  onMount(() => {
    hydrated = true;
  });

  const idle = $derived(hydrated && busy === "");
  const can = (to: string) => transitions.includes(to);

  async function send(path: string, method: "PATCH" | "POST", body: unknown, action: string) {
    if (busy) return;
    busy = action;
    error = "";
    fieldErrors = {};

    try {
      const response = await fetch(`/api/v1/organizations/${publicId}${path}`, {
        method,
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
      else error = payload?.message ?? "操作を完了できませんでした。時間をおいて、もう一度お試しください。";
    } catch {
      error = "サーバーに接続できませんでした。";
    } finally {
      busy = "";
    }
  }

  const save = () => send("", "PATCH", { name, billingPostalCode, billingAddress, memo, orderEnabled: orderEnabled ? 1 : 0 }, "save");
</script>

<div class="flex flex-col gap-8">
  {#if error}
    <p role="alert" class="rounded-md border border-destructive/50 px-4 py-3 text-sm text-destructive">{error}</p>
  {/if}

  <div class="grid gap-4 sm:grid-cols-2">
    <div class="flex flex-col gap-1.5 sm:col-span-2">
      <label for="name-{id}" class="text-xs font-medium text-muted-foreground">会社名</label>
      <Input id="name-{id}" bind:value={name} aria-invalid={fieldErrors.name ? "true" : undefined} />
      {#if fieldErrors.name}<span class="text-sm text-destructive">{fieldErrors.name.join(" ")}</span>{/if}
    </div>

    <div class="flex flex-col gap-1.5">
      <label for="postal-{id}" class="text-xs font-medium text-muted-foreground">請求先郵便番号</label>
      <Input id="postal-{id}" bind:value={billingPostalCode} aria-invalid={fieldErrors.billingPostalCode ? "true" : undefined} />
      {#if fieldErrors.billingPostalCode}<span class="text-sm text-destructive">{fieldErrors.billingPostalCode.join(" ")}</span>{/if}
    </div>

    <div class="flex flex-col gap-1.5">
      <label for="address-{id}" class="text-xs font-medium text-muted-foreground">請求先住所</label>
      <Input id="address-{id}" bind:value={billingAddress} aria-invalid={fieldErrors.billingAddress ? "true" : undefined} />
      {#if fieldErrors.billingAddress}<span class="text-sm text-destructive">{fieldErrors.billingAddress.join(" ")}</span>{/if}
    </div>

    <div class="flex flex-col gap-1.5 sm:col-span-2">
      <label for="memo-{id}" class="text-xs font-medium text-muted-foreground">管理メモ</label>
      <textarea id="memo-{id}" bind:value={memo} rows="4" class="rounded-md border border-input bg-input/30 px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"></textarea>
      <span class="text-xs text-muted-foreground">取引先には表示されません。</span>
    </div>

    <label class="flex items-center gap-3 sm:col-span-2">
      <input type="checkbox" bind:checked={orderEnabled} class="size-4" />
      <span class="text-sm">発注を受け付ける</span>
    </label>
    <!-- Named so nobody reads an unchecked box as "suspended": the status is what stops trade. -->
    <p class="-mt-2 text-xs text-muted-foreground sm:col-span-2">取引停止中は自動的に受け付けません。このチェックは稼働中の取引先を一時的に止めるためのものです。</p>
  </div>

  <div>
    <Button variant="outline" disabled={!idle} onclick={save}>
      {busy === "save" ? "保存しています…" : "変更を保存"}
    </Button>
  </div>

  <div class="border-t pt-8">
    <h3 class="text-sm font-medium">取引の状態</h3>

    {#if transitions.length === 0}
      <p class="mt-3 text-sm text-muted-foreground">この取引先は終了しています。再開する場合は新規のお申し込みからやり直します。</p>
    {:else}
      <div class="mt-4 flex flex-wrap gap-2">
        {#if can("active")}
          <Button variant="outline" disabled={!idle} onclick={() => send("/resume", "POST", {}, "resume")}>
            {busy === "resume" ? "処理中…" : "取引を再開する"}
          </Button>
        {/if}
        {#if can("suspended")}
          <Button variant="outline" disabled={!idle} onclick={() => (open = open === "suspend" ? "none" : "suspend")}>取引を停止する</Button>
        {/if}
        {#if can("terminated")}
          <Button variant="outline" disabled={!idle} onclick={() => (open = open === "terminate" ? "none" : "terminate")}>取引を終了する</Button>
        {/if}
      </div>
    {/if}

    {#if open !== "none"}
      <div class="mt-4 flex flex-col gap-4 rounded-md border p-4">
        <div>
          <h4 class="text-sm font-medium">{open === "suspend" ? "取引を停止する" : "取引を終了する"}</h4>
          <p class="mt-1 text-sm text-muted-foreground">
            {#if open === "suspend"}
              停止中もログインと商品閲覧は継続し、ご発注のみ承れなくなります。所属担当者に通知メールを送ります。
            {:else}
              <!-- Terminal in the state machine, so the screen has to say so before the click. -->
              <strong>取り消せません。</strong>所属担当者の所属をすべて停止し、データ保管期限の起点を記録します。再開するには新規のお申し込みが必要です。
            {/if}
          </p>
        </div>

        <div class="flex flex-col gap-1.5">
          <label for="reason-{id}" class="text-xs font-medium text-muted-foreground">理由</label>
          <textarea id="reason-{id}" bind:value={reason} rows="3" aria-invalid={fieldErrors.reason ? "true" : undefined} class="rounded-md border border-input bg-input/30 px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"></textarea>
          <span class="text-xs text-muted-foreground">監査ログに残ります。</span>
          {#if fieldErrors.reason}<span class="text-sm text-destructive">{fieldErrors.reason.join(" ")}</span>{/if}
        </div>

        <div class="flex gap-2">
          <Button variant="destructive" disabled={!idle || reason.trim() === ""} onclick={() => send(open === "suspend" ? "/suspend" : "/terminate", "POST", { reason }, open)}>
            {#if busy === open}
              処理中…
            {:else}
              {open === "suspend" ? "この理由で停止する" : "この理由で終了する"}
            {/if}
          </Button>
          <Button variant="ghost" disabled={!idle} onclick={() => (open = "none")}>やめる</Button>
        </div>
      </div>
    {/if}
  </div>
</div>
