// #2829 W7b — registers hooks.mjs (pass with `node --import`).
import { register } from "node:module";
register("./hooks.mjs", import.meta.url);
