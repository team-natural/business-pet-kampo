<script lang="ts">
  // SCR-05. Plain markup, not shadcn: shadcn-svelte is admin-only (DEV-01 §1).
  //
  // An island rather than a native form post because the endpoint takes JSON (DEV-04 §5-3), and
  // because field-level errors from a 422 have to land next to the field that caused them. The
  // server re-validates everything — nothing here is a decision (DEV-06 §7).
  import { onMount } from "svelte";

  let {
    termsVersion,
    paymentMethods,
  }: {
    termsVersion: string;
    // Passed in rather than imported so the page owns what reaches the client. No wholesale price
    // is ever among it (D-021).
    paymentMethods: { id: string; label: string }[];
  } = $props();

  const id = $props.id();

  // One object rather than a field per state: the payload is posted as-is, so a field that is not
  // here cannot be sent, and a new column shows up as a missing key rather than a silent drop.
  let form = $state({
    companyName: "",
    corporateNumber: "",
    businessType: "",
    industry: "",
    postalCode: "",
    address: "",
    representativeName: "",
    website: "",
    sns: "",
    hasPhysicalStore: false,
    contactName: "",
    contactDepartment: "",
    phone: "",
    email: "",
    plannedSalesChannels: "",
    desiredProducts: "",
    desiredPaymentMethod: "",
    notes: "",
    agreedToTerms: false,
  });

  let submitting = $state(false);
  // The island renders before its JS runs, and a submit in that window is a native POST that
  // silently loses the input.
  let hydrated = $state(false);
  onMount(() => {
    hydrated = true;
  });

  let fieldErrors = $state<Record<string, string[] | undefined>>({});
  let formError = $state("");

  function messageFor(status: number) {
    // 409 is the one a visitor can act on: the terms changed under a form left open.
    if (status === 409) return "利用規約が更新されています。最新の内容をご確認のうえ、もう一度お申し込みください。";
    if (status === 429) return "送信回数が上限を超えました。しばらく待ってからやり直してください。";
    return "送信できませんでした。時間をおいて、もう一度お試しください。";
  }

  // Empty optional fields are dropped rather than sent as "": the columns are nullable, and an
  // empty string would store as a value that looks answered.
  function payload() {
    const entries = Object.entries(form).filter(([, value]) => value !== "" && value !== false);
    return {
      ...Object.fromEntries(entries),
      hasPhysicalStore: form.hasPhysicalStore ? 1 : 0,
      agreedToTerms: form.agreedToTerms ? 1 : 0,
      agreedTermsVersion: termsVersion,
    };
  }

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    if (submitting) return;

    submitting = true;
    fieldErrors = {};
    formError = "";

    try {
      const response = await fetch("/api/v1/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload()),
      });

      if (response.ok) {
        // replace() so Back does not return to a filled form that would submit twice.
        window.location.replace("/apply/complete");
        return;
      }

      const body = (await response.json().catch(() => null)) as { errors?: Record<string, string[] | undefined> } | null;
      if (response.status === 422 && body?.errors) {
        fieldErrors = body.errors;
        // The summary is what a screen reader reaches first; the per-field messages follow.
        formError = "入力内容をご確認ください。";
      } else {
        formError = messageFor(response.status);
      }
    } catch {
      formError = "サーバーに接続できませんでした。通信環境をご確認ください。";
    } finally {
      submitting = false;
    }
  }
</script>

<form class="mt-12 flex flex-col gap-12" onsubmit={handleSubmit} novalidate>
  {#if formError}
    <p role="alert" class="border border-vermilion px-4 py-3 text-sm text-vermilion">{formError}</p>
  {/if}

  <fieldset class="border-t border-rule pt-6">
    <legend class="eyebrow">会社情報</legend>
    <div class="mt-4 grid gap-5 sm:grid-cols-2">
      <label class="flex flex-col gap-1.5 sm:col-span-2">
        <span class="text-sm">会社名 <span class="text-vermilion">必須</span></span>
        <input bind:value={form.companyName} required aria-invalid={fieldErrors.companyName ? "true" : undefined} aria-describedby={fieldErrors.companyName ? `companyName-${id}` : undefined} class="min-h-11 border border-ink-soft bg-paper px-3 py-2" />
        {#if fieldErrors.companyName}<span id="companyName-{id}" class="text-sm text-vermilion">{fieldErrors.companyName.join(" ")}</span>{/if}
      </label>

      <label class="flex flex-col gap-1.5">
        <span class="text-sm">法人番号</span>
        <input bind:value={form.corporateNumber} inputmode="numeric" class="min-h-11 border border-ink-soft bg-paper px-3 py-2 font-mono tabular-nums" />
      </label>

      <label class="flex flex-col gap-1.5">
        <span class="text-sm">業種</span>
        <input bind:value={form.industry} class="min-h-11 border border-ink-soft bg-paper px-3 py-2" />
      </label>

      <label class="flex flex-col gap-1.5">
        <span class="text-sm">事業者種別</span>
        <input bind:value={form.businessType} placeholder="動物病院・ペットショップ 等" class="min-h-11 border border-ink-soft bg-paper px-3 py-2 placeholder:text-ink-soft/70" />
      </label>

      <label class="flex flex-col gap-1.5">
        <span class="text-sm">郵便番号 <span class="text-vermilion">必須</span></span>
        <input bind:value={form.postalCode} required inputmode="numeric" autocomplete="postal-code" aria-invalid={fieldErrors.postalCode ? "true" : undefined} class="min-h-11 border border-ink-soft bg-paper px-3 py-2 font-mono tabular-nums" />
        {#if fieldErrors.postalCode}<span class="text-sm text-vermilion">{fieldErrors.postalCode.join(" ")}</span>{/if}
      </label>

      <label class="flex flex-col gap-1.5 sm:col-span-2">
        <span class="text-sm">住所 <span class="text-vermilion">必須</span></span>
        <input bind:value={form.address} required autocomplete="street-address" aria-invalid={fieldErrors.address ? "true" : undefined} class="min-h-11 border border-ink-soft bg-paper px-3 py-2" />
        {#if fieldErrors.address}<span class="text-sm text-vermilion">{fieldErrors.address.join(" ")}</span>{/if}
      </label>

      <label class="flex flex-col gap-1.5">
        <span class="text-sm">代表者名 <span class="text-vermilion">必須</span></span>
        <input bind:value={form.representativeName} required aria-invalid={fieldErrors.representativeName ? "true" : undefined} class="min-h-11 border border-ink-soft bg-paper px-3 py-2" />
        {#if fieldErrors.representativeName}<span class="text-sm text-vermilion">{fieldErrors.representativeName.join(" ")}</span>{/if}
      </label>

      <label class="flex flex-col gap-1.5">
        <span class="text-sm">Web サイト</span>
        <input bind:value={form.website} type="url" inputmode="url" placeholder="https://" aria-invalid={fieldErrors.website ? "true" : undefined} class="min-h-11 border border-ink-soft bg-paper px-3 py-2 placeholder:text-ink-soft/70" />
        {#if fieldErrors.website}<span class="text-sm text-vermilion">{fieldErrors.website.join(" ")}</span>{/if}
      </label>

      <label class="flex flex-col gap-1.5">
        <span class="text-sm">SNS</span>
        <input bind:value={form.sns} class="min-h-11 border border-ink-soft bg-paper px-3 py-2" />
      </label>

      <label class="flex min-h-11 items-center gap-3 sm:col-span-2">
        <input type="checkbox" bind:checked={form.hasPhysicalStore} class="size-5" />
        <span class="text-sm">実店舗がある</span>
      </label>
    </div>
  </fieldset>

  <fieldset class="border-t border-rule pt-6">
    <legend class="eyebrow">ご担当者情報</legend>
    <div class="mt-4 grid gap-5 sm:grid-cols-2">
      <label class="flex flex-col gap-1.5">
        <span class="text-sm">ご担当者名 <span class="text-vermilion">必須</span></span>
        <input bind:value={form.contactName} required autocomplete="name" aria-invalid={fieldErrors.contactName ? "true" : undefined} class="min-h-11 border border-ink-soft bg-paper px-3 py-2" />
        {#if fieldErrors.contactName}<span class="text-sm text-vermilion">{fieldErrors.contactName.join(" ")}</span>{/if}
      </label>

      <label class="flex flex-col gap-1.5">
        <span class="text-sm">部署</span>
        <input bind:value={form.contactDepartment} class="min-h-11 border border-ink-soft bg-paper px-3 py-2" />
      </label>

      <label class="flex flex-col gap-1.5">
        <span class="text-sm">電話番号 <span class="text-vermilion">必須</span></span>
        <input bind:value={form.phone} type="tel" required autocomplete="tel" aria-invalid={fieldErrors.phone ? "true" : undefined} class="min-h-11 border border-ink-soft bg-paper px-3 py-2 font-mono tabular-nums" />
        {#if fieldErrors.phone}<span class="text-sm text-vermilion">{fieldErrors.phone.join(" ")}</span>{/if}
      </label>

      <label class="flex flex-col gap-1.5">
        <span class="text-sm">メールアドレス <span class="text-vermilion">必須</span></span>
        <input bind:value={form.email} type="email" required autocomplete="email" aria-invalid={fieldErrors.email ? "true" : undefined} aria-describedby={`email-hint-${id}`} class="min-h-11 border border-ink-soft bg-paper px-3 py-2" />
        <span id="email-hint-{id}" class="text-xs text-ink-soft">審査結果とアカウント有効化のご案内をこの宛先にお送りします。</span>
        {#if fieldErrors.email}<span class="text-sm text-vermilion">{fieldErrors.email.join(" ")}</span>{/if}
      </label>
    </div>
  </fieldset>

  <fieldset class="border-t border-rule pt-6">
    <legend class="eyebrow">お取引のご希望</legend>
    <div class="mt-4 grid gap-5 sm:grid-cols-2">
      <label class="flex flex-col gap-1.5">
        <span class="text-sm">販売予定チャネル</span>
        <input bind:value={form.plannedSalesChannels} placeholder="店頭・EC 等" class="min-h-11 border border-ink-soft bg-paper px-3 py-2 placeholder:text-ink-soft/70" />
      </label>

      <label class="flex flex-col gap-1.5">
        <span class="text-sm">ご希望の支払方法</span>
        <select bind:value={form.desiredPaymentMethod} class="min-h-11 border border-ink-soft bg-paper px-3 py-2">
          <option value="">選択してください</option>
          {#each paymentMethods as method (method.id)}
            <option value={method.id}>{method.label}</option>
          {/each}
        </select>
      </label>

      <label class="flex flex-col gap-1.5 sm:col-span-2">
        <span class="text-sm">ご希望の商品</span>
        <input bind:value={form.desiredProducts} class="min-h-11 border border-ink-soft bg-paper px-3 py-2" />
      </label>

      <label class="flex flex-col gap-1.5 sm:col-span-2">
        <span class="text-sm">ご相談内容</span>
        <textarea bind:value={form.notes} rows="5" class="border border-ink-soft bg-paper px-3 py-2"></textarea>
        {#if fieldErrors.notes}<span class="text-sm text-vermilion">{fieldErrors.notes.join(" ")}</span>{/if}
      </label>
    </div>
  </fieldset>

  <fieldset class="border-t border-rule pt-6">
    <legend class="eyebrow">ご同意</legend>
    <label class="mt-4 flex items-start gap-3">
      <input type="checkbox" bind:checked={form.agreedToTerms} required aria-invalid={fieldErrors.agreedToTerms ? "true" : undefined} class="mt-0.5 size-5 shrink-0" />
      <span class="text-sm leading-relaxed">
        <a href="/terms" class="underline underline-offset-4 hover:text-vermilion">利用規約</a>・<a href="/privacy" class="underline underline-offset-4 hover:text-vermilion">プライバシーポリシー</a>に同意します
        <span class="text-vermilion">必須</span>
      </span>
    </label>
    {#if fieldErrors.agreedToTerms}<p class="mt-2 text-sm text-vermilion">{fieldErrors.agreedToTerms.join(" ")}</p>{/if}
  </fieldset>

  <div>
    <button type="submit" class="btn btn-primary w-full sm:w-auto" disabled={!hydrated || submitting}>
      {submitting ? "送信しています…" : "この内容で申し込む"}
    </button>
    <p class="mt-3 text-xs text-ink-soft">送信後、ご入力のメールアドレスに受付確認をお送りします。</p>
  </div>
</form>
