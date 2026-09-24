// Local synthetic visual QA only. No database, credentials, portal or build.
require('./register-typescript-tests.cjs');
const fs = require('node:fs');
const path = require('node:path');
const { createFiscalReportPdf } = require('../app/utils/fiscal-report-pdf.ts');
const { makeReport } = require('../tests/fixtures/fiscal-report.cjs');
const directory = path.resolve(__dirname, '../tmp/pdfs/fiscal-report');
fs.mkdirSync(directory, { recursive: true });
for (const [environment, count] of [['PRODUCAO', 65], ['HOMOLOGACAO', 16], ['LEGADO', 0]]) {
  const pdf = createFiscalReportPdf(makeReport(environment, count));
  const target = path.join(directory, environment + '.pdf');
  fs.writeFileSync(target, Buffer.from(pdf.output('arraybuffer')));
  console.log(`${environment}: ${pdf.getNumberOfPages()} página(s) | ${target}`);
}
