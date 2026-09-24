import { expect, test } from "@playwright/test";
import { E2E_ORGANIZATIONS } from "./global-setup";

// ADM-14/15. The state machine and the termination batch are pinned in
// tests/unit/organizations.test.ts; here it is the screen — that the panel hydrates, offers only
// the legal moves, and that the endpoints agree with the buttons.
test.describe("organization admin", () => {
  test("the listing links through to the detail screen", async ({ page }) => {
    await page.goto("/organizations");
    await expect(page.getByRole("link", { name: /E2E 取引先/ }).first()).toBeVisible();
  });

  test("the panel hydrates and an active partner can be suspended or terminated", async ({ page }) => {
    await page.goto(`/organizations/${E2E_ORGANIZATIONS.toSuspend.publicId}`);

    const save = page.getByRole("button", { name: "変更を保存" });
    // Disabled until onMount runs, so "enabled" is what proves the client:* directive is there.
    await expect(save).toBeEnabled();

    await expect(page.getByRole("button", { name: "取引を停止する" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "取引を終了する" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "取引を再開する" })).toHaveCount(0);
  });

  test("a suspended partner can be resumed, not suspended again", async ({ page }) => {
    await page.goto(`/organizations/${E2E_ORGANIZATIONS.toResume.publicId}`);

    await expect(page.getByRole("button", { name: "取引を再開する" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "取引を停止する" })).toHaveCount(0);
  });

  test("suspending needs a reason before the button enables", async ({ page }) => {
    await page.goto(`/organizations/${E2E_ORGANIZATIONS.toSuspend.publicId}`);
    await page.getByRole("button", { name: "取引を停止する" }).click();

    const confirm = page.getByRole("button", { name: "この理由で停止する" });
    await expect(confirm).toBeDisabled();

    await page.getByLabel("理由").fill("未入金のため");
    await expect(confirm).toBeEnabled();
  });

  test("terminating suspends the memberships with the partner", async ({ request, baseURL }) => {
    const headers = { Origin: baseURL! };
    const { publicId } = E2E_ORGANIZATIONS.toTerminate;

    const response = await request.post(`/api/v1/organizations/${publicId}/terminate`, { headers, data: { reason: "取引終了のご依頼により" } });
    expect(response.status()).toBe(200);
    expect((await response.json()).data.status).toBe("terminated");

    // ADM-16 reads the same membership rows the transition just suspended.
    const members = await (await request.get(`/api/v1/organizations/${publicId}/members`, { headers })).json();
    expect(members.data).toHaveLength(1);
    expect(members.data[0].membershipStatus).toBe("suspended");
  });

  test("an illegal move answers 409 rather than doing something else", async ({ request, baseURL }) => {
    // terminated is terminal (DEV-09 §2-2-2) — this runs after the termination above.
    const response = await request.post(`/api/v1/organizations/${E2E_ORGANIZATIONS.toTerminate.publicId}/resume`, { headers: { Origin: baseURL! }, data: {} });

    expect(response.status()).toBe(409);
    expect((await response.json()).error_code).toBe("INVALID_STATE_TRANSITION");
  });

  test("suspending without a reason answers 422", async ({ request, baseURL }) => {
    const response = await request.post(`/api/v1/organizations/${E2E_ORGANIZATIONS.toSuspend.publicId}/suspend`, { headers: { Origin: baseURL! }, data: { reason: "" } });
    expect(response.status()).toBe(422);
  });

  // org_code is the price files' join key with no foreign key behind it (D-019), so the edit
  // endpoint must not accept one however it is sent.
  test("the edit endpoint ignores a posted org_code and status", async ({ request, baseURL }) => {
    const headers = { Origin: baseURL! };
    const { publicId, orgCode } = E2E_ORGANIZATIONS.toSuspend;

    const response = await request.patch(`/api/v1/organizations/${publicId}`, { headers, data: { memo: "確認済み", orgCode: "ORG-HIJACK", status: "terminated" } });
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.data.orgCode).toBe(orgCode);
    expect(body.data.status).toBe("active");
  });
});
