import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");
const workflow = readFileSync(resolve(ROOT, ".github/workflows/ci.yml"), "utf8");

const PINS = new Set([
  "actions/checkout@11d5960a326750d5838078e36cf38b85af677262",
  "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
  "pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1",
]);

describe("cadena de suministro del CI", () => {
  it("fija todas las Actions a commits inmutables aprobados", () => {
    const uses = [...workflow.matchAll(/^\s*-\s+uses:\s+([^\s#]+)/gm)].map((match) => match[1]);
    expect(uses.length).toBeGreaterThan(0);
    for (const ref of uses) {
      expect(ref).toMatch(/^[^@]+@[0-9a-f]{40}$/);
      expect(PINS.has(ref)).toBe(true);
    }
    expect(workflow).not.toMatch(/uses:\s+[^\s#]+@v\d+/);
  });

  it("verifica el SHA-256 antes de extraer gitleaks", () => {
    expect(workflow).toContain('GITLEAKS_SHA256: "a65b5253807a68ac0cafa4414031fd740aeb55f54fb7e55f386acb52e6a840eb"');
    const checksum = workflow.indexOf('sha256sum -c -');
    const extract = workflow.indexOf('tar -xzf /tmp/gitleaks.tar.gz');
    expect(checksum).toBeGreaterThan(-1);
    expect(extract).toBeGreaterThan(checksum);
  });
});
