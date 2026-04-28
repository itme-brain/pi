import matter from "gray-matter";

export interface Frontmatter {
  [key: string]: unknown;
}

export interface ParsedSkill {
  frontmatter: Frontmatter;
  body: string;
}

export function parseSkillFile(text: string): ParsedSkill | null {
  let parsed: ReturnType<typeof matter>;
  try {
    parsed = matter(text);
  } catch {
    return null;
  }
  if (!parsed.data || Object.keys(parsed.data).length === 0) return null;
  return { frontmatter: parsed.data as Frontmatter, body: parsed.content.trim() };
}
