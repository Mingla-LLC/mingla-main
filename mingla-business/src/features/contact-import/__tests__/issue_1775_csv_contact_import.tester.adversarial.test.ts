import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../../../../..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const flow = read(
  "mingla-business/src/features/contact-import/ContactImportFlow.tsx",
);
const service = read("mingla-business/src/services/contactImportService.ts");
const hook = read("mingla-business/src/hooks/useContactImport.ts");

describe("#1775 adversarial recovery and disclosure contract", () => {
  it("authorizes multipart metadata before transmitting contact bytes", () => {
    expect(service).toMatch(/headers[\s\S]*(brand|Brand)[\s\S]*(action|Action)/);
  });

  it("recovers uncertain execute outcomes by status before retry", () => {
    expect(`${flow}\n${hook}`).toMatch(/Checking import status/);
    expect(`${flow}\n${hook}`).toMatch(/idempotencyKey[\s\S]{0,1200}(status|Status)/);
    expect(`${flow}\n${hook}`).toMatch(/useShareNetworkState|NetInfo|onlineManager/);
    expect(`${flow}\n${hook}`).toMatch(/getContactImportStatus|api\.status/);
    expect(`${flow}\n${hook}`).toMatch(/(offline|online|reconnect)/i);
    expect(`${flow}\n${hook}`).toMatch(/(expired|expiry|expiresAt)/);
  });

  it("clears permission and downstream tokens on authority changes", () => {
    expect(flow).toMatch(/brandId[\s\S]{0,800}setAccepted\(false\)/);
    expect(flow).toMatch(/(permission.loss|FORBIDDEN|access.*changed)/i);
    expect(flow).toMatch(/Your import is still running/);
  });

  it("does not silently hide durable preview rows beyond the first 20", () => {
    expect(flow).not.toMatch(/preview\.rows\.slice\(0,\s*20\)/);
    expect(flow).toMatch(/(Show all|Load more|showing|pagination|virtualized)/i);
  });

  it("models the complete execute and status result contract", () => {
    expect(service).toMatch(/resultRows/);
    expect(service).toMatch(/resultPage[\s\S]*total/);
    expect(service).toMatch(/reviewHref/);
  });

  it("discloses and retrieves durable result rows beyond the first page", () => {
    expect(flow).toMatch(/result\.resultPage\.total/);
    expect(`${flow}\n${service}\n${hook}`).toMatch(/(Load more|Show more|next page)/i);
    expect(`${flow}\n${service}\n${hook}`).toMatch(
      /(getContactImportStatus|api\.status)[\s\S]{0,1000}(page|pageSize)/,
    );
  });
});
