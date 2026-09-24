import { expect, test } from "@playwright/test";
import { E2E_BLOCKING_ORDER, E2E_ORGANIZATIONS } from "./global-setup";

// FG-12's operator half. The rules are pinned in tests/unit/withdrawal.test.ts; what only a
// browser shows is that the operator is told *before* pressing the button which orders are in the
// way, and that pressing it anyway is refused rather than half-applied (F-12-02).
const BLOCKED = E2E_ORGANIZATIONS.blockedByOrder;

test.describe("terminating a partner with outstanding orders", () => {
  test("the detail screen names the orders that are in the way", async ({ page }) => {
    await page.goto(`/organizations/${BLOCKED.publicId}`);

    await expect(page.getByText("取引終了を保留している発注")).toBeVisible();
    await expect(page.getByText(E2E_BLOCKING_ORDER)).toBeVisible();
    // Which of the two obligations it is, so the operator knows whether to chase a shipment or an
    // invoice.
    await expect(page.getByText("発注が進行中")).toBeVisible();
  });

  test("the endpoint refuses with 409 and names the order", async ({ request, baseURL }) => {
    const response = await request.post(`/api/v1/organizations/${BLOCKED.publicId}/terminate`, { headers: { Origin: baseURL! }, data: { reason: "取引先からの申し出" } });

    expect(response.status()).toBe(409);
    const body = await response.json();
    expect(body.error_code).toBe("CONFLICT");
    // Naming it is the point: "there are outstanding orders" leaves nothing to chase.
    expect(body.message).toContain(E2E_BLOCKING_ORDER);
  });

  test("nothing moved: the partner is still active and its members still are", async ({ request }) => {
    const organization = await (await request.get(`/api/v1/organizations/${BLOCKED.publicId}`)).json();
    expect(organization.data.status).toBe("active");
    expect(organization.data.orderEnabled).toBe(true);

    const members = await (await request.get(`/api/v1/organizations/${BLOCKED.publicId}/members`)).json();
    expect(members.data[0].membershipStatus).toBe("active");
  });

  // Suspension is not terminal, and it is the lever the operator actually has while an order is
  // being chased — so it must stay available exactly when termination is refused.
  test("suspension is still available", async ({ request, baseURL }) => {
    const response = await request.post(`/api/v1/organizations/${BLOCKED.publicId}/suspend`, { headers: { Origin: baseURL! }, data: { reason: "未入金のため" } });
    expect(response.status()).toBe(200);
    expect((await response.json()).data.status).toBe("suspended");
  });
});
