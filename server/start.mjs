import {
  createServer
} from "node:http";
import {
  mkdirSync,
  readFileSync
} from "node:fs";
import {
  dirname,
  resolve
} from "node:path";
import {
  fileURLToPath
} from "node:url";
import {
  handler,
  settings
} from "./http.mjs";
import {
  Registry
} from "./store.mjs";

const demo = process.argv.includes("--demo");
const root = fileURLToPath(new URL(demo ? "../dist" : "../web", import.meta.url));
let config, registry;
if (!demo) {
  const env = process.env;
  if (!env.OGA_DIRECTORY || !env.OGA_PUBLIC_KEY) throw Error(
    "Configure OGA_DIRECTORY and OGA_PUBLIC_KEY (see README).");
  config = settings(env, JSON.parse(readFileSync(env.OGA_DIRECTORY, "utf8")), readFileSync(env
    .OGA_PUBLIC_KEY));
  const file = resolve(env.OGA_DB || "var/cabinet.sqlite");
  mkdirSync(dirname(file), {
    recursive: true
  });
  registry = new Registry(file);
}
const port = Number(process.env.PORT || 4173);
createServer(handler({
  registry,
  config,
  root,
  demo
})).listen(port, process.env.HOST || "127.0.0.1", () => console.log("Cabinet listening on port " + port + (
  demo ? " (demo)" : "")));
