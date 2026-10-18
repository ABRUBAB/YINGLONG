import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appRoot = path.join(webRoot, "app");
const faqFile = path.join(webRoot, "components", "support", "faq-chat.tsx");
const sourceExtensions = new Set([".js", ".jsx", ".ts", ".tsx", ".mdx"]);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(target);
    return [target];
  }));
  return nested.flat();
}

function routeFromPage(pageFile) {
  const relative = path.relative(appRoot, path.dirname(pageFile));
  const segments = relative === "." ? [] : relative.split(path.sep);
  const visible = segments.filter((segment) => {
    const routeGroup = segment.startsWith("(") && segment.endsWith(")");
    return !routeGroup && !segment.startsWith("@");
  });
  return `/${visible.join("/")}`.replace(/\/$/, "") || "/";
}

function normalizePath(value) {
  const decoded = decodeURIComponent(value);
  if (decoded === "/") return "/";
  return decoded.replace(/\/+$/, "");
}

async function resolveLocalImport(specifier, importer) {
  const base = specifier.startsWith("@/")
    ? path.join(webRoot, specifier.slice(2))
    : specifier.startsWith(".")
      ? path.resolve(path.dirname(importer), specifier)
      : null;
  if (!base) return null;

  const candidates = path.extname(base)
    ? [base]
    : [".ts", ".tsx", ".js", ".jsx", ".mdx"].map((extension) => `${base}${extension}`).concat(
      [".ts", ".tsx", ".js", ".jsx", ".mdx"].map((extension) => path.join(base, `index${extension}`)),
    );
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Keep trying the extensions supported by the app's import resolver.
    }
  }
  return null;
}

async function importedSources(entry, seen = new Set()) {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  let source;
  try {
    source = await readFile(entry, "utf8");
  } catch {
    return seen;
  }
  const importPaths = [...source.matchAll(/(?:\bfrom\s*|\bimport\s*)["']([^"']+)["']/g)].map((match) => match[1]);
  const resolved = await Promise.all(importPaths.map((specifier) => resolveLocalImport(specifier, entry)));
  await Promise.all(resolved.filter(Boolean).map((file) => importedSources(file, seen)));
  return seen;
}

const appFiles = await walk(appRoot);
const pageFiles = appFiles.filter((file) => path.basename(file).startsWith("page."));
const routePages = new Map(pageFiles.map((file) => [normalizePath(routeFromPage(file)), file]));
const routes = new Set(routePages.keys());
const routeSources = new Map();
const faqSource = await readFile(faqFile, "utf8");
const hrefs = [...faqSource.matchAll(/\bhref:\s*["']([^"']+)["']/g)].map((match) => match[1]);
const faqQuestions = [...faqSource.matchAll(/\bquestion:\s*["']([^"']+)["']/g)].map((match) => match[1]);
const questionSet = new Set(faqQuestions);
const questionReferences = [...faqSource.matchAll(/\bfaq\(["']([^"']+)["']\)/g)].map((match) => match[1]);
const errors = [];

if (!hrefs.length) errors.push("No FAQ destinations were found in faq-chat.tsx.");
for (const question of questionReferences) {
  if (!questionSet.has(question)) errors.push(`Suggested question does not exist in the FAQ list: ${question}`);
}
if (new Set(faqQuestions).size !== faqQuestions.length) errors.push("FAQ question labels must be unique.");
const relatedStart = faqSource.indexOf("const related: Record<string, Faq[]> = {");
const relatedEnd = faqSource.indexOf("\n  };", relatedStart);
if (relatedStart >= 0 && relatedEnd > relatedStart) {
  const relatedBlock = faqSource.slice(relatedStart, relatedEnd);
  const relatedQuestions = [...relatedBlock.matchAll(/^\s*["']([^"']+)["']:\s*\[/gm)].map((match) => match[1]);
  const relatedSet = new Set(relatedQuestions);
  for (const question of relatedSet) {
    if (!questionSet.has(question)) errors.push(`Follow-up mapping refers to a missing FAQ: ${question}`);
  }
  for (const question of questionSet) {
    if (!relatedSet.has(question)) errors.push(`FAQ is missing curated follow-up questions: ${question}`);
  }
  if (relatedSet.size !== relatedQuestions.length) errors.push("FAQ follow-up mapping keys must be unique.");
}

for (const href of hrefs) {
  if (/^https?:\/\//i.test(href)) {
    try {
      const url = new URL(href);
      if (!url.hostname) errors.push(`Invalid external FAQ destination: ${href}`);
    } catch {
      errors.push(`Invalid external FAQ destination: ${href}`);
    }
    continue;
  }

  let url;
  try {
    url = new URL(href, "https://faq.local");
  } catch {
    errors.push(`Invalid FAQ destination: ${href}`);
    continue;
  }

  const route = normalizePath(url.pathname);
  if (!routes.has(route)) errors.push(`FAQ destination has no App Router page: ${href} (expected ${route})`);

  if (url.hash) {
    const fragment = decodeURIComponent(url.hash.slice(1));
    const page = routePages.get(route);
    if (!page) continue;
    if (!routeSources.has(route)) routeSources.set(route, await importedSources(page));
    const fragmentPattern = new RegExp(`\\bid\\s*=\\s*["']${fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`);
    const targetFiles = routeSources.get(route);
    const found = await Promise.all([...targetFiles].filter((file) => sourceExtensions.has(path.extname(file))).map(async (file) => fragmentPattern.test(await readFile(file, "utf8"))));
    if (!found.some(Boolean)) errors.push(`FAQ destination has no matching id="${fragment}" on ${route}: ${href}`);
  }
}

if (errors.length) {
  console.error("FAQ link check failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`FAQ link check passed: ${faqQuestions.length} FAQs, ${hrefs.length} destinations, ${routes.size} App Router pages scanned.`);
}
