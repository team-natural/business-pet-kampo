// Reference resource tests. They pin the conventions a new resource is copied from, not the
// business meaning of an inquiry.
import { env } from "cloudflare:workers";
import { activityLog, adminUsers, inquiries } from "@app/schema";
import { createDb } from "@app/schema/client";
import { ulid } from "@app/schema/ulid";
import { InvalidStateTransitionError, NotFoundError } from "@app/server-kit/http";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { AdminUser } from "../../src/lib/server/services/admin-users";
import { allowedTransitions, deleteInquiry, getInquiryByPublicId, listInquiries, transitionInquiry } from "../../src/lib/server/services/inquiries";

const db = createDb(env.DB);
let admin: AdminUser;

// apps/public creates these; the admin side only ever reads and handles them.
async function arrive(n = 1) {
  const [row] = await db
    .insert(inquiries)
    .values({ publicId: ulid(), inquiryType: "general", name: `Visitor ${n}`, email: `v${n}@example.com`, content: "…", status: "new", updatedAt: new Date().toISOString() })
    .returning();
  return row!;
}

beforeEach(async () => {
  await db.delete(activityLog);
  await db.delete(inquiries);
  await db.delete(adminUsers);

  const [row] = await db
    .insert(adminUsers)
    .values({ publicId: ulid(), name: "Operator", email: `${ulid()}@example.com`, status: "active", updatedAt: new Date().toISOString() })
    .returning();
  admin = row!;
});

describe("the public shape", () => {
  it("exposes public_id as `id` and hides every internal integer", async () => {
    const row = await arrive();
    const inquiry = await getInquiryByPublicId(db, row.publicId);

    expect(inquiry.id).toBe(row.publicId);
    // assigneeId is another table's row id; leaking it hands out admin_users identifiers.
    expect(inquiry).not.toHaveProperty("assigneeId");
    expect(Object.values(inquiry).every((value) => typeof value !== "number")).toBe(true);
  });
});

describe("listInquiries", () => {
  it("returns newest first and pages by keyset", async () => {
    for (let n = 1; n <= 3; n++) await arrive(n);

    const first = await listInquiries(db, { perPage: 2 });
    expect(first.items.map((i) => i.name)).toEqual(["Visitor 3", "Visitor 2"]);
    expect(first.nextId).not.toBeNull();

    const second = await listInquiries(db, { perPage: 2, beforeId: first.nextId });
    expect(second.items.map((i) => i.name)).toEqual(["Visitor 1"]);
    expect(second.nextId).toBeNull();
  });

  it("clamps per_page, so a client cannot ask for the whole table", async () => {
    await arrive();
    expect((await listInquiries(db, { perPage: 10_000 })).perPage).toBe(100);
    expect((await listInquiries(db, { perPage: 0 })).perPage).toBe(1);
  });
});

describe("transitions", () => {
  it("allows only the moves the state machine declares", async () => {
    expect(allowedTransitions("new")).toEqual(["in_progress"]);
    const row = await arrive();

    await expect(transitionInquiry(db, row.publicId, "resolved", admin)).rejects.toBeInstanceOf(InvalidStateTransitionError);
    await expect(transitionInquiry(db, row.publicId, "in_progress", admin)).resolves.toMatchObject({ status: "in_progress" });
  });

  it("assigns the handler on start and releases it on unassign", async () => {
    const row = await arrive();

    await transitionInquiry(db, row.publicId, "in_progress", admin);
    const [taken] = await db.select().from(inquiries).where(eq(inquiries.id, row.id));
    expect(taken!.assigneeId).toBe(admin.id);

    await transitionInquiry(db, row.publicId, "new", admin);
    const [released] = await db.select().from(inquiries).where(eq(inquiries.id, row.id));
    expect(released!.assigneeId).toBeNull();
  });

  // The route for this landed on `new` at one point, which made the move below unreachable: from
  // `resolved` it answered 409 and nothing else pointed at `in_progress` (D-030).
  it("reopens a resolved inquiry back into in_progress", async () => {
    const row = await arrive();
    await transitionInquiry(db, row.publicId, "in_progress", admin);
    await transitionInquiry(db, row.publicId, "resolved", admin);

    expect(allowedTransitions("resolved")).toEqual(["in_progress"]);
    await expect(transitionInquiry(db, row.publicId, "new", admin)).rejects.toBeInstanceOf(InvalidStateTransitionError);
    await expect(transitionInquiry(db, row.publicId, "in_progress", admin)).resolves.toMatchObject({ status: "in_progress" });
  });

  it("keeps the handler when resolving", async () => {
    const row = await arrive();
    await transitionInquiry(db, row.publicId, "in_progress", admin);
    await transitionInquiry(db, row.publicId, "resolved", admin);

    const [resolved] = await db.select().from(inquiries).where(eq(inquiries.id, row.id));
    expect(resolved!.assigneeId).toBe(admin.id);
  });

  it("writes an audit entry in the same transaction as the change", async () => {
    const row = await arrive();
    await transitionInquiry(db, row.publicId, "in_progress", admin);

    const [entry] = await db.select().from(activityLog);
    expect(entry).toMatchObject({ event: "inquiry.in_progress", subjectType: "Inquiry", causerType: "AdminUser", causerId: admin.id });
    expect(JSON.parse(entry!.properties!)).toEqual({ from: "new", to: "in_progress" });
  });

  it("leaves no audit entry when the transition is rejected", async () => {
    const row = await arrive();
    await transitionInquiry(db, row.publicId, "resolved", admin).catch(() => {});

    expect(await db.select().from(activityLog)).toHaveLength(0);
  });
});

describe("deleteInquiry", () => {
  it("records what it destroyed", async () => {
    const row = await arrive();
    await deleteInquiry(db, row.publicId, admin);

    expect(await db.select().from(inquiries)).toHaveLength(0);
    const [entry] = await db.select().from(activityLog);
    expect(entry).toMatchObject({ event: "inquiry.deleted", subjectId: row.id, causerId: admin.id });
    // The subject row is gone, so the entry has to carry enough to identify it afterwards.
    expect(JSON.parse(entry!.properties!)).toMatchObject({ publicId: row.publicId, email: row.email });
  });
});

describe("missing rows", () => {
  it("throws NotFoundError rather than returning undefined", async () => {
    for (const call of [getInquiryByPublicId(db, "nope"), deleteInquiry(db, "nope", admin), transitionInquiry(db, "nope", "in_progress", admin)]) {
      await expect(call).rejects.toBeInstanceOf(NotFoundError);
    }
  });
});
