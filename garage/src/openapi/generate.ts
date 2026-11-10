import { readFile, writeFile } from "node:fs/promises";
import { openApiContract } from "./contract.js";

const path = new URL("../../openapi/v1.json", import.meta.url);
const generated = `${JSON.stringify(openApiContract(), null, 2)}\n`;
if (process.argv.includes("--check")) {
  const current = await readFile(path, "utf8").catch(() => "");
  if (current !== generated) {
    process.stderr.write(
      "OpenAPI contract drift: run npm run openapi:generate\n",
    );
    process.exitCode = 1;
  }
} else {
  await writeFile(path, generated);
}
