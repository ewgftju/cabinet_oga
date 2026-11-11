import {
  cp,
  mkdir,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import {
  brotliDecompressSync
} from "node:zlib";
import {
  cases,
  profiles
} from "../demo/scenarios.mjs";

const output = new URL("../dist/", import.meta.url);
await rm(output, {
  recursive: true,
  force: true
});
await cp(new URL("../web/", import.meta.url), output, {
  recursive: true
});
await mkdir(new URL("prints/", output));
const prints = JSON.parse(brotliDecompressSync(await readFile(new URL("../demo/prints.br", import.meta
.url))));
for (const item of cases) {
  for (const doc of item.documents) {
    const pdf = Buffer.from(prints[doc.id] || "", "base64");
    if (pdf.toString("ascii", 0, 5) !== "%PDF-") throw Error("Missing PDF: " + doc.id);
    await writeFile(new URL("prints/" + doc.id + ".pdf", output), pdf);
  }
}
await writeFile(new URL("runtime.json", output), JSON.stringify({
  mode: "demo"
}));
await writeFile(new URL("demo.json", output), JSON.stringify({
  profiles,
  cases
}));
console.log(profiles.length + " profiles, " + cases.length + " inspections, " + Object.keys(prints).length +
  " PDF files");
