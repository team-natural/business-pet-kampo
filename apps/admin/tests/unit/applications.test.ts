// ADM-12/13. The approval is the heaviest write in the app — one request creates an organization,
// its first member and the membership joining them — so most of this file is about that one
// transaction holding together (DEV-05 §3, DEV-09 §2-1).
import { env } from "cloudflare:workers";
import { activityLog, adminUsers, applications, members, memberships, organizations } from "@app/schema";
import { createDb } from "@app/schema/client";
import { ulid } from "@app/schema/ulid";
import { ConflictError, InvalidStateTransitionError } from "@app/server-kit/http";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { AdminUser } from "../../src/lib/server/services/admin-users";
import { allowedTransitions, approveApplication, rejectApplication, transitionApplication, updateReview } from "../../src/lib/server/services/applications";

const db = createDb(env.DB);
let admin: AdminUser;

async function arrive(status: "received" | "reviewing" | "needs_confirmation" = "received") {
  const now = new Date().toISOString();
  const [row] = await db
    .insert(applications)
    .values({
      publicId: ulid(),
      companyName: "A 株式会社",
      postalCode: "1000001",
      address: "東京都千代田区…",
      representativeName: "山田 太郎",
      contactName: "佐藤 花子",
      phone: "0312345678",
      email: "sato@example.test",
      agreedToTerms: 1,
      agreedTermsVersion: "2026-09-17",
      status,
      appliedAt: now,
      updatedAt: now,
    })
    .returning();
  return row!;
}

const approval = { orgCode: "ORG-A001", initialMemberName: "佐藤 花子", initialMemberEmail: "sato@example.test" };

beforeEach(async () => {
  // applications and organizations reference each other, so neither can be deleted while the
  // other still points at it — the link is broken first (DEV-07 §5-1).
  await db.delete(activityLog);
  await db.delete(memberships);
  await db.delete(members);
  await db.update(applications).set({ organizationId: null });
  await db.delete(organizations);
  await db.delete(applications);
  await db.delete(adminUsers);

  const [row] = await db
    .insert(adminUsers)
    .values({ publicId: ulid(), name: "Operator", email: `${ulid()}@example.test`, status: "active", updatedAt: new Date().toISOString() })
    .returning();
  admin = row!;
});

describe("transitions", () => {
  it("allows only the moves DEV-09 §2-1-2 declares", async () => {
    expect(allowedTransitions("received")).toEqual(["reviewing", "withdrawn"]);
    expect(allowedTransitions("approved")).toEqual([]);

    const row = await arrive();
    await expect(transitionApplication(db, row.publicId, "needs_confirmation", admin)).rejects.toBeInstanceOf(InvalidStateTransitionError);
    await expect(transitionApplication(db, row.publicId, "reviewing", admin)).resolves.toMatchObject({ status: "reviewing" });
  });

  it("records the reviewer on the first move and keeps them afterwards", async () => {
    const row = await arrive();
    await transitionApplication(db, row.publicId, "reviewing", admin);

    const [taken] = await db.select().from(applications).where(eq(applications.id, row.id));
    expect(taken!.reviewerId).toBe(admin.id);

    // A second operator sending it back does not steal the review.
    const [other] = await db
      .insert(adminUsers)
      .values({ publicId: ulid(), name: "Other", email: `${ulid()}@example.test`, status: "active", updatedAt: new Date().toISOString() })
      .returning();
    await transitionApplication(db, row.publicId, "needs_confirmation", other!);

    const [still] = await db.select().from(applications).where(eq(applications.id, row.id));
    expect(still!.reviewerId).toBe(admin.id);
  });

  it("writes an audit entry in the same transaction as the change", async () => {
    const row = await arrive();
    await transitionApplication(db, row.publicId, "reviewing", admin);

    const [entry] = await db.select().from(activityLog);
    expect(entry).toMatchObject({ event: "application.reviewing", subjectType: "Application", subjectId: row.id, causerId: admin.id });
  });

  it("leaves no audit entry when the transition is rejected", async () => {
    const row = await arrive();
    await transitionApplication(db, row.publicId, "needs_confirmation", admin).catch(() => {});

    expect(await db.select().from(activityLog)).toHaveLength(0);
  });
});

describe("updateReview", () => {
  // The memo belongs to the reviewer; the applicant's own answers are not rewritten here.
  it("saves the memo without touching the status", async () => {
    const row = await arrive("reviewing");
    const updated = await updateReview(db, row.publicId, { reviewMemo: "電話確認済み" }, admin);

    expect(updated.status).toBe("reviewing");
    const [stored] = await db.select().from(applications).where(eq(applications.id, row.id));
    expect(stored!.reviewMemo).toBe("電話確認済み");
  });
});

describe("approveApplication", () => {
  it("creates the organization, the first member and the membership in one go", async () => {
    const row = await arrive("reviewing");
    const result = await approveApplication(db, row.publicId, approval, admin);

    const [organization] = await db.select().from(organizations);
    const [member] = await db.select().from(members);
    const [membership] = await db.select().from(memberships);

    expect(organization).toMatchObject({ orgCode: "ORG-A001", name: "A 株式会社", status: "active", orderEnabled: 1 });
    expect(member).toMatchObject({ email: "sato@example.test", status: "active" });
    // The subqueries that link these inside the batch are the part most likely to break silently.
    expect(membership).toMatchObject({ memberId: member!.id, organizationId: organization!.id, role: "client_user", status: "active" });
    expect(result.orgCode).toBe("ORG-A001");
  });

  it("points the application at the organization it created", async () => {
    const row = await arrive("reviewing");
    await approveApplication(db, row.publicId, approval, admin);

    const [organization] = await db.select().from(organizations);
    const [updated] = await db.select().from(applications).where(eq(applications.id, row.id));
    expect(updated).toMatchObject({ status: "approved", organizationId: organization!.id });
    expect(updated!.reviewedAt).not.toBeNull();
  });

  // The member sets their own password through the activation link (F-01-05). A hash invented here
  // would be a credential nobody chose.
  it("creates the member without a password", async () => {
    const row = await arrive("reviewing");
    await approveApplication(db, row.publicId, approval, admin);

    const [member] = await db.select().from(members);
    expect(member!.passwordHash).toBeNull();
  });

  it("records the audit entry against the new organization", async () => {
    const row = await arrive("reviewing");
    await approveApplication(db, row.publicId, approval, admin);

    const [organization] = await db.select().from(organizations);
    const [entry] = await db.select().from(activityLog);
    expect(entry).toMatchObject({ event: "application.approved", causerId: admin.id, organizationId: organization!.id });
    expect(JSON.parse(entry!.properties!)).toMatchObject({ orgCode: "ORG-A001" });
  });

  // org_code is the key the per-organization price files join on, with no foreign key behind it
  // (D-019). A duplicate would quietly point two partners at one price list.
  it("refuses a duplicate org_code and creates nothing", async () => {
    const first = await arrive("reviewing");
    await approveApplication(db, first.publicId, approval, admin);

    const second = await arrive("reviewing");
    await expect(approveApplication(db, second.publicId, { ...approval, initialMemberEmail: "other@example.test" }, admin)).rejects.toBeInstanceOf(ConflictError);

    expect(await db.select().from(organizations)).toHaveLength(1);
    expect(await db.select().from(members)).toHaveLength(1);
  });

  it("refuses an email that already belongs to a member and creates nothing", async () => {
    const first = await arrive("reviewing");
    await approveApplication(db, first.publicId, approval, admin);

    const second = await arrive("reviewing");
    await expect(approveApplication(db, second.publicId, { ...approval, orgCode: "ORG-A002" }, admin)).rejects.toBeInstanceOf(ConflictError);

    expect(await db.select().from(organizations)).toHaveLength(1);
  });

  it.each(["received", "approved", "rejected", "withdrawn"] as const)("refuses to approve from %s", async (status) => {
    const row = await arrive("reviewing");
    await db.update(applications).set({ status }).where(eq(applications.id, row.id));

    // received is legal in the matrix only via reviewing; approved/rejected/withdrawn are terminal.
    await expect(approveApplication(db, row.publicId, approval, admin)).rejects.toBeInstanceOf(InvalidStateTransitionError);
    expect(await db.select().from(organizations)).toHaveLength(0);
  });

  it("approves from needs_confirmation", async () => {
    const row = await arrive("needs_confirmation");
    await expect(approveApplication(db, row.publicId, approval, admin)).resolves.toMatchObject({ orgCode: "ORG-A001" });
  });
});

describe("rejectApplication", () => {
  it("records the reason in the audit entry, since no column holds it", async () => {
    const row = await arrive("reviewing");
    await rejectApplication(db, row.publicId, { reason: "取扱区分が対象外のため" }, admin);

    const [updated] = await db.select().from(applications).where(eq(applications.id, row.id));
    expect(updated!.status).toBe("rejected");

    const [entry] = await db.select().from(activityLog);
    expect(JSON.parse(entry!.properties!)).toMatchObject({ reason: "取扱区分が対象外のため" });
  });

  it("creates no organization", async () => {
    const row = await arrive("reviewing");
    await rejectApplication(db, row.publicId, { reason: "対象外" }, admin);

    expect(await db.select().from(organizations)).toHaveLength(0);
  });
});
