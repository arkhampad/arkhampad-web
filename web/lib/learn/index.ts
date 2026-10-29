import type { Post } from "./types";
import { part1 } from "./part1";
import { part2 } from "./part2";
import { part3 } from "./part3";
import { part4 } from "./part4";

export * from "./types";
export const POSTS: Post[] = [...part1, ...part2, ...part3, ...part4];
export const postBySlug = (s: string) => POSTS.find((p) => p.slug === s);
/** Day the articles were published / last reviewed (shown on pages and in the sitemap). */
export const LEARN_DATE = "2026-10-30";
