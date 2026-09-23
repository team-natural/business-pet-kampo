// The visitor-facing half of FG-02. These cover what E2E cannot see: that the stored consent
// version is the server's own, and that every unusable withdrawal token leaves the row untouched
// without saying so.
import { env } from "cloudflare:workers";
import { applications } from "@app/schema";
import { createDb } from "@app/schema/client";
import { ulid } from "@app/schema/ulid";
import { signToken } from "@app/server-kit/auth";
import { ConflictError } from "@app/server-kit/http";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createApplication, withdrawApplication } from "../../src/lib/server/services/applications";
import { CURRENT_TERMS_VERSION } from "../../src/lib/terms-version";

const db = createDb(env.DB);
const SECRET = "test-signing-key";
const DAY = 60 * 60 * 24;

const input = {
  companyName: "A 株式会社",
  postalCode: "1000001",
  address: "東京都千代田区…",
  representativeName: "山田 太郎",
  contactName: "佐藤 花子",
  phone: "0312345678",
  email: "sato@example.test",
  agreedToTerms: 1 as const,
  agreedTermsVersion: CURRENT_TERMS_VERSION,
};

const statusOf = async (publicId: string) => (await db.select().from(applications).where(eq(applications.publicId, publicId)).limit(1))[0]!.status;

beforeEach(async () => {
  await db.delete(applications);
});

describe("createApplication", () => {
  it("stores the application as received, whatever the form said", async () => {
    const row = await createApplication(db, input);

    expect(row.status).toBe("received");
    expect(row.publicId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  // The column is the only record of which wording was agreed to, because the terms are a page
  // (DEV-07 §5-1).
  it("records the server's current terms version", async () => {
    const row = await createApplication(db, input);
    expect(row.agreedTermsVersion).toBe(CURRENT_TERMS_VERSION);
  });

  it("refuses a stale terms version with 409 rather than storing it", async () => {
    await expect(createApplication(db, { ...input, agreedTermsVersion: "2020-01-01" })).rejects.toBeInstanceOf(ConflictError);
    expect(await db.select().from(applications)).toHaveLength(0);
  });

  it("stores omitted optional fields as null, not as empty strings", async () => {
    const row = await createApplication(db, input);
    expect(row.corporateNumber).toBeNull();
    expect(row.notes).toBeNull();
  });
});

describe("withdrawApplication", () => {
  const tokenFor = (publicId: string) => signToken(SECRET, "application-withdrawal", publicId, DAY);

  it("withdraws a received application", async () => {
    const row = await createApplication(db, input);
    await withdrawApplication(db, SECRET, row.publicId, await tokenFor(row.publicId));

    expect(await statusOf(row.publicId)).toBe("withdrawn");
  });

  it("stamps reviewed_at so the withdrawal has a time without an audit row", async () => {
    const row = await createApplication(db, input);
    await withdrawApplication(db, SECRET, row.publicId, await tokenFor(row.publicId));

    const [updated] = await db.select().from(applications).where(eq(applications.publicId, row.publicId));
    expect(updated!.reviewedAt).not.toBeNull();
  });

  // The applicant must not be able to undo a decision that has already been made (DEV-09 §2-1-2).
  it.each(["approved", "rejected", "withdrawn"] as const)("leaves a %s application alone", async (status) => {
    const row = await createApplication(db, input);
    await db.update(applications).set({ status }).where(eq(applications.id, row.id));

    await withdrawApplication(db, SECRET, row.publicId, await tokenFor(row.publicId));
    expect(await statusOf(row.publicId)).toBe(status);
  });

  it("withdraws from reviewing and needs_confirmation", async () => {
    for (const status of ["reviewing", "needs_confirmation"] as const) {
      await db.delete(applications);
      const row = await createApplication(db, input);
      await db.update(applications).set({ status }).where(eq(applications.id, row.id));

      await withdrawApplication(db, SECRET, row.publicId, await tokenFor(row.publicId));
      expect(await statusOf(row.publicId), status).toBe("withdrawn");
    }
  });

  // Each of these returns exactly like a success. The row is the only place the difference shows.
  it("ignores a token minted for another application", async () => {
    const row = await createApplication(db, input);
    const other = await tokenFor(ulid());

    await expect(withdrawApplication(db, SECRET, row.publicId, other)).resolves.toBeUndefined();
    expect(await statusOf(row.publicId)).toBe("received");
  });

  it("ignores a token signed with another key", async () => {
    const row = await createApplication(db, input);
    const forged = await signToken("another-key", "application-withdrawal", row.publicId, DAY);

    await withdrawApplication(db, SECRET, row.publicId, forged);
    expect(await statusOf(row.publicId)).toBe("received");
  });

  it("ignores a garbage token without throwing", async () => {
    const row = await createApplication(db, input);

    await expect(withdrawApplication(db, SECRET, row.publicId, "not-a-token")).resolves.toBeUndefined();
    expect(await statusOf(row.publicId)).toBe("received");
  });
});
