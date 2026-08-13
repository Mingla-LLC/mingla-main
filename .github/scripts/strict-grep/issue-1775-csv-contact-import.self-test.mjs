if (!process.argv.includes("--self-test")) {
  throw new Error("#1775 self-test wrapper requires --self-test");
}
await import("./issue-1775-csv-contact-import.mjs");
