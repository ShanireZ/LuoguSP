import { fileURLToPath } from "node:url";
import { recoverLocalLock } from "./local-lock.mjs";

const locks = new Map([
  ["publish", "reports/publish.lock"],
  ["channel", "cdn/channels/canary.json.lock"],
]);
const name = locks.get(process.argv[2]);
if (!name || process.argv.length !== 3)
  throw new Error("Pass publish or channel after checking that the interrupted transaction and its child processes have stopped");
const path = fileURLToPath(new URL(`../../${name}`, import.meta.url));
console.log(await recoverLocalLock(path) ? `Recovered ${name}` : `No ${name} lock found`);
