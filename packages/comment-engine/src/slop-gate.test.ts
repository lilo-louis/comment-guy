import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_CONFIG } from "./config.ts";
import { deterministicSlopCheck } from "./slop-gate.ts";

const cfg = DEFAULT_CONFIG;
const fails = (t: string) => deterministicSlopCheck(t, cfg).failures;

test("a good reply passes the free checks", () => {
  assert.deepEqual(
    fails("Size charts move returns more than any support macro does. Cheapest fix on the list."),
    [],
  );
});

test("rejects links — a link would also cost 13x more to post", () => {
  assert.ok(fails("Worth reading https://example.com/returns").includes("CONTAINS_LINK"));
  assert.ok(fails("see www.example.com for the data").includes("CONTAINS_LINK"));
});

test("rejects any mention of the product", () => {
  assert.ok(fails("We built ShopGeist for exactly this").includes("MENTIONS_SHOPGEIST"));
  assert.ok(fails("shopgeist handles that").includes("MENTIONS_SHOPGEIST"));
});

test("rejects banned opener phrases", () => {
  assert.ok(fails("Great post. Returns are underrated.").includes("BANNED_PHRASE"));
  assert.ok(fails("couldn't agree more, this is the real issue").includes("BANNED_PHRASE"));
});

test("rejects the 'not X, but Y' construction", () => {
  assert.ok(
    fails("It's not a support problem, but a merchandising one.").includes("CORPORATE_TONE"),
  );
});

test("rejects over-length replies", () => {
  assert.ok(fails("a".repeat(cfg.drafting.maxReplyChars + 1)).includes("TOO_LONG"));
});

test("rejects empty drafts and reports nothing else", () => {
  assert.deepEqual(fails("   "), ["EMPTY"]);
});

test("does not penalise short, lowercase, blunt replies — those are correct", () => {
  assert.deepEqual(fails("size chart. every time."), []);
});
