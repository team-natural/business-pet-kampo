// Keyword search, which is the one part of a listing that reaches SQL operators rather than a
// plain equality. LIKE has wildcards; the search box is user input; the two must not meet.
import { env } from "cloudflare:workers";
import { organizations } from "@app/schema";
import { createDb } from "@app/schema/client";
import { ulid } from "@app/schema/ulid";
import { beforeEach, describe, expect, it } from "vitest";
import { listOrganizations } from "../../src/lib/server/services/organizations";

const db = createDb(env.DB);

// A counter, not a slice of a ULID: the leading characters are the timestamp, so two codes minted
// in the same millisecond would collide on org_code's unique index.
let sequence = 0;

async function register(name: string) {
  const [row] = await db
    .insert(organizations)
    .values({ publicId: ulid(), orgCode: `ORG-${String(++sequence).padStart(4, "0")}`, name, status: "active", updatedAt: new Date().toISOString() })
    .returning();
  return row!;
}

const names = async (keyword: string) => (await listOrganizations(db, { keyword })).items.map((item) => item.name);

beforeEach(async () => {
  await db.delete(organizations);
});

describe("listOrganizations keyword", () => {
  it("matches on a substring", async () => {
    await register("ペットショップ甲");
    await register("動物病院乙");

    expect(await names("ショップ")).toEqual(["ペットショップ甲"]);
  });

  it("treats % as a literal, not as a wildcard", async () => {
    await register("10%オフ商店");
    await register("動物病院乙");

    // Without an ESCAPE clause this returns both rows, and the operator sees a filter that
    // silently did nothing.
    expect(await names("%")).toEqual(["10%オフ商店"]);
  });

  it("treats _ as a literal, not as a single-character wildcard", async () => {
    await register("pet_shop");
    await register("petXshop");

    expect(await names("pet_shop")).toEqual(["pet_shop"]);
  });

  it("treats a backslash as a literal", async () => {
    await register("a\\b");
    await register("動物病院乙");

    expect(await names("a\\b")).toEqual(["a\\b"]);
  });
});
