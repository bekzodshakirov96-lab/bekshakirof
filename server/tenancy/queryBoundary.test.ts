import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, it, expect } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const schemaHelpers = new Set([
  "cashDebtRepaymentSchema.ts",
  "cashJournalDebtSchema.ts",
  "cashMatrixLayoutSchema.ts",
  "cashTransferLinkSchema.ts",
]);
function files(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory()
      ? files(path.join(folder, entry.name))
      : [path.join(folder, entry.name)]
  );
}
describe("business query boundary regression", () => {
  it("keeps raw connections, schema access and scope exemptions outside business routers/helpers", () => {
    const violations: string[] = [];
    for (const file of files(root).filter(
      file =>
        file.endsWith(".ts") &&
        !file.endsWith(".test.ts") &&
        !file.endsWith(".spec.ts")
    )) {
      const relative = path.relative(root, file).replaceAll("\\", "/");
      const trusted =
        relative === "db.ts" ||
        relative.startsWith("platform/") ||
        relative.startsWith("tenancy/") ||
        schemaHelpers.has(relative);
      if (trusted) continue;
      const tree = ts.createSourceFile(
        file,
        readFileSync(file, "utf8"),
        ts.ScriptTarget.Latest,
        true
      );
      const fail = (kind: string) => violations.push(`${relative}: ${kind}`);
      const visit = (node: ts.Node) => {
        if (ts.isImportDeclaration(node)) {
          const from = (node.moduleSpecifier as ts.StringLiteral).text;
          const text = node.getText(tree);
          if (
            /^(mysql2|drizzle-orm\/mysql2)/.test(from) ||
            /requireSchemaDb|markTenantSql/.test(text)
          )
            fail("raw database/scope exemption import");
        }
        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          ["execute", "raw"].includes(node.expression.name.text)
        )
          fail("raw SQL execution");
        if (
          ts.isTaggedTemplateExpression(node) &&
          /^(sql|numberSql)$/.test(node.tag.getText(tree))
        ) {
          const text = ts.isNoSubstitutionTemplateLiteral(node.template)
            ? node.template.text
            : node.template.head.text +
              node.template.templateSpans
                .map(span => span.literal.text)
                .join(" ");
          if (/\b(select|from|join|union)\b/i.test(text))
            fail("embedded SELECT without tenant scalar helper");
        }
        ts.forEachChild(node, visit);
      };
      visit(tree);
    }
    expect(violations).toEqual([]);
  });
});
