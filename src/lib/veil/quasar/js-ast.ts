/**
 * Quasar AST-based JavaScript Rewriter
 * ------------------------------------
 * Rewrites URLs inside JavaScript using a real parser (acorn) instead of
 * regex guesswork. Handles what regex misses:
 *
 *   - absolute http(s) string literals anywhere (fetch args, assignments,
 *     comparisons, config objects)  →  "/p/<blob>/..."
 *   - import("...") dynamic import specifiers (relative ones resolved against
 *     the script URL in module mode — classic scripts defer to runtime hooks)
 *   - import.meta.url  →  the proxied URL of the script itself
 *   - single-quasi template literals containing absolute URLs
 *
 * Deliberate boundaries:
 *   - Relative strings are NOT rewritten (except module import specifiers):
 *     runtime hooks resolve them against the real page URL, which is more
 *     correct than any static guess.
 *   - `location` virtualization is OPT-IN per site (virtLoc flag, v2.0.4):
 *     when enabled, every free `location` / `window.location` /
 *     `document.location` read is renamed to the `__quasar_loc$` shim whose
 *     href/origin/host getters report the real target URL while navigation
 *     (href=, assign/replace) stays inside the tunnel. Assignment targets
 *     (`location = x`, `window.location = x`) are left native — absolute
 *     string literals assigned there are already rewritten, relative ones
 *     resolve in-tunnel, and the service worker backstops anything else.
 *
 * Unparseable code falls back to a conservative regex pass (absolute quoted
 * URLs only), so output is never worse than the pre-AST engine.
 */

import * as acorn from "acorn";
import * as walk from "acorn-walk";
import { proxyPath } from "./codec-server";
import { isDirectMediaHost } from "./site-fixes";

interface Edit {
  start: number;
  end: number;
  text: string;
}

const ABS_URL_RE = /^https?:\/\//i;

/** True when a node must not be edited because it is a name/key position. */
function isNamePosition(ancestors: readonly acorn.Node[], node: acorn.Node): boolean {
  for (let i = ancestors.length - 2; i >= 0; i--) {
    const p = ancestors[i] as unknown as Record<string, unknown>;
    const gp = ancestors[i - 1] as unknown as Record<string, unknown> | undefined;
    // obj.key / obj?.key (non-computed)
    if (
      (p.type === "MemberExpression" || p.type === "OptionalMemberExpression") &&
      p.property === node &&
      !p.computed
    )
      return true;
    // { key: value } non-computed key
    if (
      (p.type === "Property" || p.type === "ExportSpecifier" || p.type === "ImportSpecifier") &&
      p.key === node &&
      !p.computed
    )
      return true;
    // method definitions
    if ((p.type === "MethodDefinition" || p.type === "PropertyDefinition") && p.key === node && !p.computed)
      return true;
    // labels
    if (p.type === "LabeledStatement" && p.label === node) return true;
    if (p.type === "BreakStatement" && p.label === node) return true;
    if (p.type === "ContinueStatement" && p.label === node) return true;
    // import/export binding names ("import x from" / "export { x }")
    if (p.type === "ImportDefaultSpecifier" || p.type === "ImportNamespaceSpecifier") return true;
    if (gp && (gp.type === "ImportDeclaration" || gp.type === "ExportNamedDeclaration")) {
      if (p.type === "Identifier") return true;
    }
  }
  return false;
}

/**
 * Hosts whose http(s) URLs are XML/RDF namespace identifiers — compared by
 * code but never fetched (createElementNS, namespaceURI checks, vocabularies).
 * Rewriting these would break SVG/MathML creation on every modern site.
 */
function isNamespaceHost(host: string): boolean {
  return (
    host === "www.w3.org" ||
    host.endsWith(".w3.org") ||
    host === "purl.org" ||
    host.endsWith(".purl.org") ||
    host === "ogp.me" ||
    host.endsWith(".ogp.me") ||
    host === "schemas.google.com" ||
    host === "gmpg.org" ||
    host.endsWith(".gmpg.org") ||
    host === "xml.apache.org" ||
    host.endsWith(".xml.apache.org")
  );
}

function proxiedLiteral(url: string): string | null {
  try {
    const abs = new URL(url);
    if (abs.protocol !== "http:" && abs.protocol !== "https:") return null;
    if (isNamespaceHost(abs.hostname)) return null;
    // v2.0.4 direct-media hosts (googlevideo.com) are fetched by the browser
    // itself (real Chrome TLS + real client IP) — they must stay untouched.
    if (isDirectMediaHost(abs)) return null;
    return JSON.stringify(proxyPath(abs.href));
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* v2.0.4 — virtual location layer (opt-in via virtLoc site flag)      */
/* ------------------------------------------------------------------ */

/** Client-side shim installed by the hook bundle when virtLoc is enabled. */
const VIRT_LOC_VAR = "__quasar_loc$";

/** Globals whose `.location` member is the same document location. */
const LOC_GLOBALS: Record<string, boolean> = {
  window: true,
  document: true,
  self: true,
  top: true,
  parent: true,
  globalThis: true,
};

/** True when an enclosing scope binds the name `location` (param, var, fn, catch). */
function isShadowedLocation(ancestors: readonly acorn.Node[]): boolean {
  for (let i = ancestors.length - 2; i >= 0; i--) {
    const p = ancestors[i] as unknown as Record<string, unknown>;
    const t = p.type as string;
    if (t === "VariableDeclarator" || t === "FunctionDeclaration" || t === "FunctionExpression" || t === "ClassDeclaration" || t === "ClassExpression") {
      const id = p.id as { type?: string; name?: string } | undefined;
      if (id?.type === "Identifier" && id.name === "location") return true;
    }
    if (t === "FunctionDeclaration" || t === "FunctionExpression" || t === "ArrowFunctionExpression") {
      const params = (p.params ?? []) as Array<{
        type?: string;
        name?: string;
        left?: { name?: string };
        argument?: { name?: string };
      }>;
      for (const pa of params) {
        if (!pa) continue;
        if (pa.type === "Identifier" && pa.name === "location") return true;
        if (pa.type === "AssignmentPattern" && pa.left?.name === "location") return true;
        if (pa.type === "RestElement" && pa.argument?.name === "location") return true;
      }
    }
    if (t === "CatchClause") {
      const param = p.param as { type?: string; name?: string } | undefined;
      if (param?.type === "Identifier" && param.name === "location") return true;
    }
  }
  return false;
}

/** True when the node is written to (assignment/destructure target) — native
 *  assignment keeps working there, and renaming it would clobber our shim. */
function isWriteTarget(ancestors: readonly acorn.Node[], node: acorn.Node): boolean {
  const p = ancestors[ancestors.length - 2] as unknown as Record<string, unknown> | undefined;
  if (!p) return false;
  if (p.type === "AssignmentExpression" || p.type === "AssignmentPattern") return p.left === node;
  if (p.type === "UpdateExpression") return p.argument === node;
  if (p.type === "UnaryExpression" && p.operator === "delete") return p.argument === node;
  if (p.type === "ForOfStatement" || p.type === "ForInStatement") return p.left === node;
  return false;
}

function applyEdits(code: string, edits: Edit[]): string {
  edits.sort((a, b) => b.start - a.start);
  let minStart = Infinity;
  let out = code;
  for (const e of edits) {
    if (e.end > minStart) continue; // overlaps an already-applied edit
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
    minStart = e.start;
  }
  return out;
}

export interface AstResult {
  code: string;
  changed: boolean;
  mode: "ast" | "regex";
}

export interface RewriteJsOpts {
  /** v2.0.4 — rename location reads to the __quasar_loc$ shim (per-site flag). */
  virtLoc?: boolean;
}

/** Rewrite a JavaScript source string. Never throws. */
export function rewriteJs(
  code: string,
  scriptUrl: string,
  isModuleHint = false,
  opts: RewriteJsOpts = {}
): AstResult {
  let ast: acorn.Node | null = null;
  let parsedAsModule = false;

  const baseOpts: acorn.Options = {
    ecmaVersion: "latest",
    allowHashBang: true,
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true,
    allowSuperOutsideMethod: true,
  };
  try {
    ast = acorn.parse(code, { ...baseOpts, sourceType: isModuleHint ? "module" : "script" });
    parsedAsModule = isModuleHint;
  } catch {
    /* try the other flavor */
  }
  if (!ast) {
    try {
      ast = acorn.parse(code, { ...baseOpts, sourceType: "module" });
      parsedAsModule = true;
    } catch {
      return { code: rewriteJsRegex(code), changed: true, mode: "regex" };
    }
  }

  const edits: Edit[] = [];
  const push = (node: acorn.Node, text: string) => edits.push({ start: node.start, end: node.end, text });

  const visitLiteral = (node: acorn.Literal, ancestors: readonly acorn.Node[]) => {
    if (typeof node.value !== "string" || !ABS_URL_RE.test(node.value)) return;
    if (isNamePosition(ancestors, node)) return;
    const text = proxiedLiteral(node.value);
    if (text) push(node, text);
  };

  const visitTemplate = (node: acorn.TemplateLiteral, ancestors: readonly acorn.Node[]) => {
    if (node.expressions.length !== 0 || node.quasis.length !== 1) return;
    const cooked = node.quasis[0].value.cooked;
    if (!cooked || !ABS_URL_RE.test(cooked)) return;
    if (isNamePosition(ancestors, node)) return;
    const text = proxiedLiteral(cooked);
    if (text) push(node, text);
  };

  const visitMeta = (node: acorn.Node, ancestors: readonly acorn.Node[]) => {
    // import.meta.url — the MetaProperty is "import.meta"; ".url" is the
    // enclosing MemberExpression, so the WHOLE expression gets replaced.
    const n = node as unknown as { meta?: { name?: string }; property?: { name?: string } };
    if (n.meta?.name !== "import" || n.property?.name !== "meta") return;
    const parent = ancestors[ancestors.length - 2] as unknown as
      | { type?: string; property?: { name?: string }; computed?: boolean }
      | undefined;
    if (
      parent &&
      parent.type === "MemberExpression" &&
      !parent.computed &&
      parent.property?.name === "url"
    ) {
      try {
        push(parent as unknown as acorn.Node, JSON.stringify(proxyPath(scriptUrl)));
      } catch {
        /* ignore */
      }
    }
  };

  const visitCall = (node: acorn.CallExpression, ancestors: readonly acorn.Node[]) => {
    // dynamic import("...")
    const callee = node.callee as unknown as { type: string };
    if (callee.type !== "Import" || !node.arguments.length) return;
    const arg = node.arguments[0];
    if (arg.type !== "Literal" || typeof arg.value !== "string") return;
    const v = arg.value.trim();
    if (!v || v.startsWith("#")) return;
    if (ABS_URL_RE.test(v)) {
      const text = proxiedLiteral(v);
      if (text && !isNamePosition(ancestors, arg)) push(arg, text);
      return;
    }
    // Relative module specifiers resolve against the script URL — only safe
    // when we know it's a module (classic-script import() resolves against the
    // document base, which the engine cannot know statically).
    if (parsedAsModule && /^(\.{1,2}\/|\/)/.test(v)) {
      try {
        const abs = new URL(v, scriptUrl);
        if (abs.protocol === "http:" || abs.protocol === "https:") {
          push(arg, JSON.stringify(proxyPath(abs.href)));
        }
      } catch {
        /* ignore */
      }
    }
  };

  // v2.0.4 virtual-location handlers (registered only for opted-in sites).
  // `var`/function declarations named `location` hoist across the whole file,
  // so their bare presence conservatively disables bare-identifier renaming
  // (window.location member reads are unaffected — they never resolve to the
  // local binding).
  let hoistedLocationBinding = false;
  if (opts.virtLoc) {
    try {
      walk.simple(ast as never, {
        VariableDeclarator: (n: acorn.Node) => {
          const id = (n as unknown as { id?: { type?: string; name?: string } }).id;
          if (id?.type === "Identifier" && id.name === "location") hoistedLocationBinding = true;
        },
        FunctionDeclaration: (n: acorn.Node) => {
          const id = (n as unknown as { id?: { type?: string; name?: string } }).id;
          if (id?.type === "Identifier" && id.name === "location") hoistedLocationBinding = true;
        },
        ClassDeclaration: (n: acorn.Node) => {
          const id = (n as unknown as { id?: { type?: string; name?: string } }).id;
          if (id?.type === "Identifier" && id.name === "location") hoistedLocationBinding = true;
        },
        ImportSpecifier: (n: acorn.Node) => {
          const local = (n as unknown as { local?: { type?: string; name?: string } }).local;
          if (local?.type === "Identifier" && local.name === "location") hoistedLocationBinding = true;
        },
      } as never);
    } catch {
      hoistedLocationBinding = true;
    }
  }

  const visitLocationIdent = (node: acorn.Identifier, ancestors: readonly acorn.Node[]) => {
    if (node.name !== "location") return;
    if (hoistedLocationBinding) return;
    if (isNamePosition(ancestors, node)) return;
    if (isWriteTarget(ancestors, node)) return;
    if (isShadowedLocation(ancestors)) return;
    push(node, VIRT_LOC_VAR);
  };
  const visitLocationMember = (node: acorn.Node, ancestors: readonly acorn.Node[]) => {
    const m = node as unknown as {
      computed?: boolean;
      object?: { type?: string; name?: string };
      property?: { type?: string; name?: string };
    };
    if (m.computed) return;
    const obj = m.object;
    const prop = m.property;
    if (!obj || obj.type !== "Identifier" || !(obj.name in LOC_GLOBALS)) return;
    if (!prop || prop.type !== "Identifier" || prop.name !== "location") return;
    if (isNamePosition(ancestors, node)) return;
    if (isWriteTarget(ancestors, node)) return;
    if (isShadowedLocation(ancestors)) return;
    push(node, VIRT_LOC_VAR);
  };

  const visitors: Record<string, unknown> = {
    Literal: (node: acorn.Literal, _s: unknown, ancestors: readonly acorn.Node[]) =>
      visitLiteral(node, ancestors),
    TemplateLiteral: (node: acorn.TemplateLiteral, _s: unknown, ancestors: readonly acorn.Node[]) =>
      visitTemplate(node, ancestors),
    MetaProperty: (node: acorn.Node, _s: unknown, ancestors: readonly acorn.Node[]) =>
      visitMeta(node, ancestors),
    CallExpression: (node: acorn.CallExpression, _s: unknown, ancestors: readonly acorn.Node[]) =>
      visitCall(node, ancestors),
  };
  if (opts.virtLoc) {
    visitors.Identifier = visitLocationIdent;
    visitors.MemberExpression = visitLocationMember;
    visitors.OptionalMemberExpression = visitLocationMember;
  }

  try {
    walk.ancestor(ast as never, visitors as never);
  } catch {
    return { code: rewriteJsRegex(code), changed: true, mode: "regex" };
  }

  if (!edits.length) return { code, changed: false, mode: "ast" };
  return { code: applyEdits(code, edits), changed: true, mode: "ast" };
}

/**
 * Conservative regex fallback: rewrite only quoted absolute http(s) URLs.
 * Covers the same ground as the legacy engine — no structural knowledge.
 */
export function rewriteJsRegex(code: string): string {
  return code.replace(/(['"])https?:\/\/[^'"\s\\]+\1/g, (match) => {
    const url = match.slice(1, -1);
    const text = proxiedLiteral(url);
    return text ?? match;
  });
}
