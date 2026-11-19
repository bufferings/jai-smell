import { expect, test } from "bun:test";
import { escapeGlob, globToRegExp } from "../src/glob.ts";

const matches = (pattern: string, path: string) => globToRegExp(pattern).test(path);

test("* はディレクトリの区切りをまたがず、** はまたぐ", () => {
  expect(matches("/repo/*.md", "/repo/a.md")).toBe(true);
  expect(matches("/repo/*.md", "/repo/docs/a.md")).toBe(false);
  expect(matches("/repo/**", "/repo/docs/a.md")).toBe(true);
  expect(matches("/repo/**/*.md", "/repo/a.md")).toBe(true);
  expect(matches("/repo/**/*.md", "/repo/docs/sub/a.md")).toBe(true);
  expect(matches("/**/*.md", "/home/me/.config/notes.md")).toBe(true);
  expect(matches("/repo/**", "/repository/a.md")).toBe(false);
});

test("文字の集合と選択に一致する", () => {
  expect(matches("/repo/[ab].md", "/repo/a.md")).toBe(true);
  expect(matches("/repo/[!ab].md", "/repo/a.md")).toBe(false);
  expect(matches("/repo/*.{md,txt}", "/repo/a.txt")).toBe(true);
  expect(matches("/repo/?.md", "/repo/ab.md")).toBe(false);
});

test("エスケープした記号は、リテラルとして扱う", () => {
  expect(matches(`${escapeGlob("/repo/[v1]*")}/*.md`, "/repo/[v1]*/a.md")).toBe(true);
  expect(matches(`${escapeGlob("/repo/[v1]*")}/*.md`, "/repo/v/a.md")).toBe(false);
});

test("不正な glob はエラーにする", () => {
  expect(() => globToRegExp("/repo/a/[b")).toThrow();
  expect(() => globToRegExp("/repo/{a,b")).toThrow();
  expect(() => globToRegExp("/repo/a**")).toThrow();
});
