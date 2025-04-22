// src/types/html2pdf.d.ts
// Type declaration for html2pdf.js module
declare module 'html2pdf.js' {
  /**
   * html2pdf.js exports a function that accepts an element or HTML string and options,
   * returning a promise or performs PDF generation.
   * We declare it as any for simplicity.
   */
  const html2pdf: any;
  export default html2pdf;
}