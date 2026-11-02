const isNode = typeof process !== 'undefined' && Boolean(process.versions?.node);

let PDFLib = globalThis.PDFLib;
if (!PDFLib && isNode) {
  try {
    const mod = 'node:module';
    const { createRequire } = await import(mod);
    const require = createRequire(import.meta.url);
    PDFLib = require('./pdf-lib.min.js');
  } catch (_e) {
    PDFLib = globalThis.PDFLib;
  }
}

export const PDFDocument = PDFLib?.PDFDocument;
export const getPDFLib = () => globalThis.PDFLib || PDFLib;
export default PDFLib;
