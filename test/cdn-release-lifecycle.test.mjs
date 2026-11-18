import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import {
  copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { withLocalLock } from "../scripts/cdn/local-lock.mjs";
import { digest, snapshotRelease } from "../scripts/cdn/release-integrity.mjs";
import { rollbackRelease } from "../scripts/cdn/release-transaction.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const version = "2.0.0";

async function pauseChild(t, cwd, args, env = process.env) {
  const child = spawn(process.execPath, args, { cwd, env, windowsHide: true });
  const exited = once(child, "exit");
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); });
  const lines = createInterface({ input: child.stdout });
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  let paused = false;
  for await (const line of lines) {
    if (line === "FIXTURE PAUSED") {
      paused = true;
      break;
    }
  }
  assert.ok(paused, stderr);
  return {
    pid: child.pid,
    exited,
    async interrupt() {
      assert.equal(child.kill("SIGKILL"), true);
      assert.deepEqual(await exited, [null, "SIGKILL"]);
      lines.close();
    },
  };
}

async function fixture(t) {
  const base = await realpath(tmpdir());
  const prefix = "luogusp-cdn-lifecycle-20261115-";
  const cwd = await realpath(await mkdtemp(join(base, prefix)));
  assert.equal(dirname(cwd), base);
  assert.ok(basename(cwd).startsWith(prefix));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const write = async (name, body) => {
    const destination = join(cwd, name);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, body);
  };
  const files = ["baseline-targets.mjs", "scripts/publish.mjs", "scripts/publish-lib.mjs",
    ...(await readdir(join(root, "scripts/cdn"))).map((name) => `scripts/cdn/${name}`)];
  for (const file of files) {
    const destination = join(cwd, file);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(join(root, file), destination);
  }
  const stubs = {
    "package.json": '{"type":"module","version":"1.0.0"}',
    "node_modules/esbuild/package.json": '{"type":"module","exports":"./index.js"}',
    "node_modules/esbuild/index.js": `
      import { resolve } from "node:path";
      export async function build(options) {
        if (process.env.LUOGUSP_TEST_BUILD_FAILURE === "late" && options.splitting)
          throw new Error("Injected late bundle failure");
        const entries = Array.isArray(options.entryPoints)
          ? { fixture: options.entryPoints[0] } : options.entryPoints;
        const outputs = {};
        const outputFiles = Object.entries(entries).map(([name, entryPoint]) => {
          const path = "cdn-build/esm/" + name + ".js";
          outputs[path] = { entryPoint };
          return { path: resolve(options.absWorkingDir, path),
            contents: Buffer.from("// Synthetic bundle for " + entryPoint + "\\n") };
        });
        return { outputFiles, metafile: { outputs } };
      }
    `,
    "scripts/renderer/build-lib.mjs": `
      export async function buildMarkdownRenderer() {
        if (process.env.LUOGUSP_TEST_BUILD_FAILURE === "renderer")
          throw new Error("Injected renderer failure");
        return Buffer.from("// Synthetic renderer\\n");
      }
    `,
    "src/rendering/renderer-dependencies.js": "export const MARKDOWN_RENDERER_API_VERSION = 1; export const rendererStackDependencies = {};",
    "config/cdn.json": JSON.stringify({
      origins: { primary: "https://stage.example", bootstrap: "https://stage.example" },
      projects: { cloudflare: "fixture" }, cli: { wrangler: { minimum: "4.107.0" } },
    }),
    "deploy/cloudflare/wrangler.jsonc": JSON.stringify({
      name: "fixture", main: "worker.js", workers_dev: false, preview_urls: false,
      routes: [{ pattern: "stage.example", custom_domain: true }], assets: { directory: "../../dist/cdn" },
    }),
    "src/userscript.meta.js": "// ==UserScript==\n// @version      1.0.0\n// ==/UserScript==\n",
    "LuoguSP.user.js": "// ==UserScript==\n// @version      1.0.0\n// ==/UserScript==\n(()=>{})();\n",
    "reports/quality-report.json": "{}\n",
    "cdn/channels/canary.json": "{}\n",
    "test/fixture.test.mjs": "",
  };
  for (const name of ["README.md", "README.zh-CN.md", "README.zh-TW.md", "README.ja.md"])
    stubs[name] = "[![Version: 1.0.0](https://img.shields.io/badge/version-1.0.0-blue.svg)](LuoguSP.user.js)\n";
  for (const [name, body] of Object.entries(stubs)) await write(name, body);
  await mkdir(join(cwd, "cdn/releases"));
  for (const args of [
    ["init", "--quiet"],
    ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "--no-gpg-sign", "--quiet", "-m", "Empty immutable tree"],
  ]) {
    const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
  }
  const build = (release = version, failure = "") => spawnSync(process.execPath,
    ["scripts/cdn/build.mjs", "--version", release], {
      cwd, encoding: "utf8", windowsHide: true,
      env: { ...process.env, LUOGUSP_TEST_BUILD_FAILURE: failure },
    });
  const previous = build("1.0.0");
  assert.equal(previous.status, 0, previous.stderr);
  const channelPath = join(cwd, "cdn/channels/canary.json");
  const previousChannel = await readFile(channelPath, "utf8");
  const providerHook = join(cwd, "mock-provider.mjs");
  await writeFile(providerHook, String.raw`
    import cp from "node:child_process";
    import { syncBuiltinESMExports } from "node:module";
    import { appendFileSync, cpSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
    import { dirname, join, resolve } from "node:path";
    const spawn = cp.spawnSync;
    const mode = process.env.LUOGUSP_TEST_PUBLISH_MODE;
    const history = process.env.LUOGUSP_TEST_HISTORY_READINESS;
    if (history) {
      const schedule = globalThis.setTimeout;
      globalThis.setTimeout = (callback, _delay, ...args) => schedule(callback, 0, ...args);
    }
    let deployed;
    globalThis.fetch = async (url, options) => {
      if (url.origin !== "https://stage.example" || url.search || url.hash)
        throw new Error("Unexpected provider fixture URL: " + url.href);
      const name = url.pathname.slice(1);
      if (deployed && process.env.LUOGUSP_TEST_PAUSE_VERIFICATION === "1") {
        writeFileSync("verification.ready", "");
        const deadline = Date.now() + 8000;
        while (!existsSync("verification.continue") && Date.now() < deadline)
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
        if (!existsSync("verification.continue")) throw new Error("Verification fixture was not released");
      }
      const providerAssets = deployed ?? (history && existsSync("provider-assets") ? "provider-assets" : null);
      const historical = name === "releases/1.0.0/manifest.json";
      const published = providerAssets ? join(providerAssets, name) : historical ? join("cdn", name) : null;
      const fault = providerAssets && historical ? history : null;
      const found = published && existsSync(published) && fault !== "missing";
      const status = mode === "provider-preflight" ? 503 : found ? 200 : 404;
      let body = found ? readFileSync(published) : "";
      if (fault === "mismatch") body = Buffer.concat([body, Buffer.from("\n")]);
      const response = new Response(body, { status, headers: {
        "Content-Type": name.endsWith(".json") ? "application/json" : "application/javascript",
        "Cache-Control": name.startsWith("channels/") ? "no-cache" : "immutable",
        "Access-Control-Allow-Origin": "*",
      } });
      return Object.defineProperty(response, "url", {
        value: fault === "wrong-url" ? url.href.replace("/manifest.json", "/another.json") : url.href,
      });
    };
    cp.spawnSync = (executable, args, options) => {
      if (executable === "git") return spawn(executable, args, options);
      const [program, operation, flag, configPath] = process.platform === "win32" ? args.slice(3) : [executable, ...args];
      if (program !== "wrangler") throw new Error("Unexpected provider fixture command");
      if (operation === "--version") return { status: 0, stdout: "4.107.0\n" };
      if (operation !== "deploy" || flag !== "--config") throw new Error("Unexpected provider operation");
      const config = JSON.parse(readFileSync(configPath));
      deployed = resolve(dirname(configPath), config.assets.directory);
      const channel = JSON.parse(readFileSync(join(deployed, "channels/canary.json")));
      appendFileSync("provider.jsonl", JSON.stringify({ channel: channel.release, releases: readdirSync(join(deployed, "releases")) }) + "\n");
      if (history) cpSync(deployed, "provider-assets", { recursive: true });
      return { status: mode === "provider-error" ? 1 : 0 };
    };
    syncBuiltinESMExports();
  `);
  const hook = join(cwd, "mock-publish.mjs");
  await writeFile(hook, String.raw`
    import cp from "node:child_process";
    import { syncBuiltinESMExports } from "node:module";
    import { pathToFileURL } from "node:url";
    import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, appendFileSync, writeSync } from "node:fs";
    const spawn = cp.spawnSync;
    const mode = process.env.LUOGUSP_TEST_PUBLISH_MODE;
    const channelPath = "cdn/channels/canary.json";
    const success = { status: 0, stdout: "", stderr: "" };
    const failure = { status: 1, stdout: "", stderr: "Injected fixture guard failure\n" };
    const pause = (continueFile) => {
      writeSync(1, "FIXTURE PAUSED\n");
      if (continueFile) {
        const deadline = Date.now() + 15000;
        while (!existsSync(continueFile) && Date.now() < deadline)
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
        if (!existsSync(continueFile)) throw new Error("Fixture did not release the pause");
        return;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15000);
      throw new Error("Fixture interruption did not arrive");
    };
    const concurrent = (version) => {
      const result = spawn(process.execPath, ["scripts/cdn/build.mjs", "--version", version],
        { cwd: process.cwd(), encoding: "utf8", windowsHide: true });
      if (result.status !== 0) throw new Error(result.stderr);
      cpSync("cdn/releases/" + version, "foreign-version", { recursive: true });
      writeFileSync("foreign-channel.json", readFileSync(channelPath));
    };
    cp.spawnSync = (executable, args, options) => {
      if (executable !== process.execPath) throw new Error("Unexpected provider command");
      appendFileSync("commands.jsonl", JSON.stringify(args) + "\n");
      const entry = args[0];
      if (entry === "scripts/check-baseline.mjs") {
        if (mode === "production-peer-before") appendFileSync("README.zh-TW.md", "\nPEER EDIT\n");
        if (mode === "baseline-race") { concurrent("2.0.0"); return failure; }
        if (mode === "channel-before-build") concurrent("3.0.0");
        return success;
      }
      if (entry === "scripts/cdn/build.mjs") {
        if (mode === "build-race") concurrent("2.0.0");
        return spawn(executable, args, { ...options, windowsHide: true,
          env: { ...options.env, LUOGUSP_TEST_BUILD_FAILURE: mode === "build-failure" ? "late" : "" } });
      }
      if (entry === "--test") return success;
      if (entry === "scripts/renderer/check.mjs") {
        if (mode === "predeployment-interruption") pause();
        if (mode === "rollback-contention") pause("rollback.continue");
        if (mode === "channel-race") concurrent("3.0.0");
        if (mode === "replacement-race") {
          renameSync("cdn/releases/2.0.0", "superseded-own-version");
          concurrent("2.0.0");
        }
        return ["success", "deploy-failure", "production-peer-before", "production-peer-after",
          "production-unreadable", "promotion-failure", "deployment-interruption"].includes(mode) || mode.startsWith("provider-") ? success : failure;
      }
      if (entry === "scripts/cdn/stage-userscript.mjs") {
        const manifest = JSON.parse(readFileSync("cdn/releases/2.0.0/manifest.json"));
        const requires = [manifest.compat.earlyGate, manifest.compat.runtime].map((file) =>
          "// @require      https://stage.example/" + file.path + "#sha256=" + file.sha256);
        const artifact = ["// ==UserScript==", "// @version      2.0.0", ...requires,
          "// ==/UserScript==", "(()=>{})();", ""].join("\n");
        mkdirSync("dist/staged", { recursive: true });
        writeFileSync("dist/staged/LuoguSP.2.0.0.user.js", artifact);
        return success;
      }
      if (entry === "scripts/cdn/publish.mjs") {
        if (mode.startsWith("provider-"))
          return spawn(executable, ["--import", pathToFileURL("mock-provider.mjs").href, ...args], options);
        if (args.includes("--channel-file")) {
          const channel = JSON.parse(readFileSync(args[args.indexOf("--channel-file") + 1], "utf8"));
          if (channel.release !== "2.0.0") throw new Error("Provider received a different channel");
        }
        const receiptPath = "reports/publish.json";
        const receipt = JSON.parse(readFileSync(receiptPath));
        const succeeded = !["deploy-failure", "deployment-interruption"].includes(mode);
        const outcome = succeeded ? "confirmed" : "outcome-unknown";
        writeFileSync(receiptPath, JSON.stringify({ ...receipt, deploymentStatus: outcome, deploymentAttempt: outcome,
          deploymentStarted: true, deployedOrigins: succeeded ? ["https://stage.example"] : [] }));
        if (mode === "deployment-interruption") pause();
        return mode === "deploy-failure" ? failure : success;
      }
      if (entry === "scripts/quality.mjs") {
        if (mode === "production-peer-after") {
          appendFileSync(process.env.LUOGUSP_TEST_PEER_PATH, "\nPEER EDIT\n");
          return failure;
        }
        if (mode === "promotion-failure") return failure;
        if (mode === "production-unreadable") {
          renameSync("README.md", "replaced-peer-readme.md");
          mkdirSync("README.md");
          return failure;
        }
        const outputIndex = args.indexOf("--report-output");
        if (outputIndex !== -1) writeFileSync(args[outputIndex + 1], '{"fixture":true}\n');
      }
      if (entry === "scripts/cdn/verify-production.mjs" && mode === "provider-post-gate") return failure;
      if (entry === "scripts/cdn/verify-production.mjs" && mode === "provider-history")
        return spawn(executable, ["--import", pathToFileURL("mock-provider.mjs").href, ...args], {
          ...options, env: { ...options.env, LUOGUSP_TEST_HISTORY_READINESS: "missing" },
        });
      if (["scripts/cdn/verify-production.mjs", "scripts/build.mjs", "scripts/quality.mjs"].includes(entry))
        return success;
      throw new Error("Unexpected mock command " + JSON.stringify(args));
    };
    syncBuiltinESMExports();
  `);
  const publishArgs = ["--import", pathToFileURL(hook).href, "scripts/publish.mjs", "--version", version];
  const publish = (mode = "renderer-failure", env = {}) => spawnSync(process.execPath, publishArgs, {
      cwd, encoding: "utf8", windowsHide: true,
      env: { ...process.env, ...env, LUOGUSP_TEST_PUBLISH_MODE: mode },
    });
  const snapshot = (release = version) => snapshotRelease(join(cwd, "cdn/releases"), release);
  const recover = (lock) => spawnSync(process.execPath, ["scripts/cdn/recover-lock.mjs", lock], {
    cwd, encoding: "utf8", windowsHide: true,
  });
  const providerArgs = ["--import", pathToFileURL(providerHook).href, "scripts/cdn/publish.mjs"];
  return { cwd, write, build, publish, publishArgs, providerArgs, recover, snapshot, channelPath, previousChannel };
}

test("publication refuses shared-file drift before any provider call", async (t) => {
  const f = await fixture(t);
  const result = f.publish("production-peer-before");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Production file changed/);
  assert.match(await readFile(join(f.cwd, "README.zh-TW.md"), "utf8"), /PEER EDIT/);
  assert.doesNotMatch(await readFile(join(f.cwd, "commands.jsonl"), "utf8"), /scripts\/cdn\/publish.mjs/);
});

for (const file of ["src/userscript.meta.js", "LuoguSP.user.js", "package.json",
  "README.md", "README.zh-CN.md", "README.zh-TW.md", "README.ja.md", "reports/quality-report.json"]) {
  test(`publication rollback preserves a concurrent edit to ${file}`, async (t) => {
    const f = await fixture(t);
    const initialMetadata = await readFile(join(f.cwd, "src/userscript.meta.js"), "utf8");
    const result = f.publish("production-peer-after", { LUOGUSP_TEST_PEER_PATH: file });
    assert.notEqual(result.status, 0);
    assert.match(await readFile(join(f.cwd, file), "utf8"), /PEER EDIT/);
    const report = JSON.parse(await readFile(join(f.cwd, "reports/publish.json")));
    assert.equal(report.productionRestored, false);
    assert.deepEqual(report.productionRetained, [file]);
    if (file !== "src/userscript.meta.js")
      assert.equal(await readFile(join(f.cwd, "src/userscript.meta.js"), "utf8"), initialMetadata);
    assert.equal((await f.snapshot()).manifest.release, version);
  });
}

test("a busy publication lock prevents all child commands and survives rejection", async (t) => {
  const f = await fixture(t);
  const lock = join(f.cwd, "reports/publish.lock");
  await writeFile(lock, "peer publication");
  assert.notEqual(f.publish("success").status, 0);
  assert.equal(await readFile(lock, "utf8"), "peer publication");
  assert.match(f.recover("publish").stderr, /Cannot establish the owner/);
  assert.equal(await readFile(lock, "utf8"), "peer publication");
  await assert.rejects(readFile(join(f.cwd, "commands.jsonl")), { code: "ENOENT" });
  await rm(lock);
  assert.equal(f.publish("success").status, 0);
  await assert.rejects(readFile(lock), { code: "ENOENT" });
});

test("publication restores owned production bytes after a promotion failure and releases its lock", async (t) => {
  const f = await fixture(t);
  const initial = await readFile(join(f.cwd, "README.zh-TW.md"), "utf8");
  assert.notEqual(f.publish("promotion-failure").status, 0);
  assert.equal(await readFile(join(f.cwd, "README.zh-TW.md"), "utf8"), initial);
  const report = JSON.parse(await readFile(join(f.cwd, "reports/publish.json")));
  assert.equal(report.productionRestored, true);
  await assert.rejects(readFile(join(f.cwd, "reports/publish.lock")), { code: "ENOENT" });
  assert.equal(f.publish("success").status, 0);
});

test("publication records an unreadable path and restores owned files after it", async (t) => {
  const { cwd, publish } = await fixture(t);
  const laterPath = join(cwd, "README.zh-CN.md");
  const initial = await readFile(laterPath);
  const failed = publish("production-unreadable");
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /production rollback retained README\.md/);
  assert.deepEqual(await readdir(join(cwd, "README.md")), []);
  assert.deepEqual(await readFile(laterPath), initial);
  const report = JSON.parse(await readFile(join(cwd, "reports/publish.json")));
  assert.equal(report.status, "blocked");
  assert.equal(report.productionRestored, false);
  assert.deepEqual(report.productionRetained, ["README.md"]);
});

test("both readiness commands require the exact unhashed manifest bytes", async (t) => {
  const origin = "https://stage.example";
  const { cwd, write, build, snapshot, channelPath } = await fixture(t);
  const built = build();
  assert.equal(built.status, 0, built.stderr);
  const release = await snapshot();
  await write("reports/cdn-publish.json", JSON.stringify({
    release: version, origin, deploymentStatus: "confirmed",
    manifestPath: release.path, manifestSha256: release.sha256,
    channelSha256: digest(await readFile(channelPath)),
  }));
  const requires = [release.manifest.compat.earlyGate, release.manifest.compat.runtime]
    .map(({ path, sha256 }) => `// @require      ${origin}/${path}#sha256=${sha256}`);
  await write(`dist/staged/LuoguSP.${version}.user.js`, [
    "// ==UserScript==", `// @version      ${version}`, ...requires, "// ==/UserScript==", "(()=>{})();",
  ].join("\n"));
  const hook = "mock-readiness.mjs";
  await write(hook, String.raw`
    import { readFile } from "node:fs/promises";
    const schedule = globalThis.setTimeout;
    globalThis.setTimeout = (callback, _delay, ...args) => schedule(callback, 0, ...args);
    globalThis.fetch = async (url) => {
      if (url.origin !== "https://stage.example" || url.search || url.hash)
        throw new Error("Unexpected readiness URL: " + url.href);
      const path = url.pathname.slice(1);
      const failure = path === process.env.LUOGUSP_TEST_READINESS_PATH ? process.env.LUOGUSP_TEST_READINESS_FAILURE : "";
      const original = failure === "missing" ? "" : await readFile("cdn/" + path);
      const body = failure === "mismatch" ? Buffer.concat([original, Buffer.from("\n")]) : original;
      const response = new Response(body, { status: failure === "missing" ? 404 : 200, headers: {
        "Content-Type": path.endsWith(".json") ? "application/json" : "application/javascript",
        "Cache-Control": path.startsWith("channels/") ? "no-cache" : "immutable",
        "Access-Control-Allow-Origin": "*",
      } });
      return Object.defineProperty(response, "url", { value: url.href });
    };
  `);
  const manifestCopy = `releases/${version}/manifest.json`;
  const asset = release.manifest.compat.runtime.path;
  for (const [command, options, report, channel] of [
    ["verify", ["--origin", origin], "cdn-deployment", "channels/canary.json"],
    ["verify-production", ["--version", version, "--manifest-sha256", release.sha256], "cdn-production-readiness"],
  ]) {
    for (const [path, failure] of [
      ["", "ready"], [manifestCopy, "missing"], [manifestCopy, "mismatch"],
      [release.path, "mismatch"], [asset, "mismatch"], ...(channel ? [[channel, "mismatch"]] : []),
    ]) {
      await t.test(`${command} ${failure} ${path}`.trimEnd(), async () => {
        const result = spawnSync(process.execPath, ["--import", pathToFileURL(join(cwd, hook)).href,
          `scripts/cdn/${command}.mjs`, ...options], {
          cwd, encoding: "utf8", windowsHide: true,
          env: { ...process.env, LUOGUSP_TEST_READINESS_PATH: path, LUOGUSP_TEST_READINESS_FAILURE: failure },
        });
        const receipt = JSON.parse(await readFile(join(cwd, `reports/${report}.json`), "utf8"));
        if (failure === "ready") {
          assert.equal(result.status, 0, result.stderr);
          assert.equal(receipt.status, "ready");
          assert.equal(receipt.files, release.files.size);
          assert.equal(receipt.retainedManifestCount, null);
          assert.deepEqual(new Set(receipt.results.map(({ path }) => path)),
            new Set([...release.files.keys(), ...(channel ? [channel] : [])]));
          assert.equal(receipt.results.find(({ path }) => path === manifestCopy).sha256, release.sha256);
        } else {
          assert.equal(result.status, 1, result.stderr);
          assert.equal(receipt.status, "blocked");
          const rejected = receipt.results.find((item) => item.path === path);
          assert.equal(rejected.ok, false);
          assert.equal(rejected.lastResult.status, failure === "missing" ? 404 : 200);
          if (path === manifestCopy && failure === "mismatch")
            assert.notEqual(rejected.lastResult.sha256, release.sha256);
        }
      });
    }
  }
});

test("readiness verifies fixed manifest aliases from the provider's retained release inventory", async (t) => {
  const origin = "https://stage.example";
  const retained = "1.0.0";
  const retainedAlias = `releases/${retained}/manifest.json`;
  const { cwd, write, build, snapshot, providerArgs } = await fixture(t);
  for (const args of [
    ["add", `cdn/releases/${retained}`],
    ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
      "commit", "--quiet", "--no-gpg-sign", "-m", "Published release fixture"],
  ]) {
    const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
  }
  for (const release of ["3.0.0", version]) {
    const result = build(release);
    assert.equal(result.status, 0, result.stderr);
  }
  const candidate = await snapshot();
  const history = await snapshot(retained);
  await write(`dist/staged/LuoguSP.${version}.user.js`, [
    "// ==UserScript==", `// @version      ${version}`,
    ...[candidate.manifest.compat.earlyGate, candidate.manifest.compat.runtime]
      .map(({ path, sha256 }) => `// @require      ${origin}/${path}#sha256=${sha256}`),
    "// ==/UserScript==", "(()=>{})();",
  ].join("\n"));
  const run = (args, outcome) => spawnSync(process.execPath, args, {
    cwd, encoding: "utf8", windowsHide: true,
    env: { ...process.env, LUOGUSP_TEST_HISTORY_READINESS: outcome },
  });
  const report = async (name) => JSON.parse(await readFile(join(cwd, `reports/${name}.json`)));
  const deploy = run([...providerArgs, "--version", version, "--skip-build"], "missing");
  const provider = await report("cdn-publish");
  assert.equal(provider.deploymentStatus, "confirmed");
  assert.deepEqual(provider.retainedManifests, { [retained]: history.sha256 });
  assert.deepEqual(JSON.parse(await readFile(join(cwd, "provider.jsonl"), "utf8")), {
    channel: version, releases: [retained, version],
  });

  await t.test("deployment readback blocks after provider confirmation", async () => {
    const readiness = await report("cdn-deployment");
    assert.equal(deploy.status, 1, deploy.stderr);
    assert.equal(readiness.status, "blocked");
    assert.equal(readiness.failure.path, retainedAlias);
    assert.equal(readiness.failure.lastResult.status, 404);
  });

  for (const [command, options, readiness] of [
    ["verify", ["--origin", origin], "cdn-deployment"],
    ["verify-production", ["--version", version, "--manifest-sha256", candidate.sha256], "cdn-production-readiness"],
  ]) {
    for (const outcome of ["missing", "mismatch", "wrong-url", "ready"]) {
      await t.test(`${command} ${outcome} retained alias`, async () => {
        const result = run([...providerArgs.slice(0, -1), `scripts/cdn/${command}.mjs`, ...options], outcome);
        const receipt = await report(readiness);
        const alias = receipt.results.find(({ path }) => path === retainedAlias);
        assert.equal(receipt.results.some(({ path }) => path.startsWith("releases/3.0.0/")), false);
        if (outcome === "ready") {
          assert.equal(result.status, 0, result.stderr);
          assert.equal(receipt.status, "ready");
          assert.equal(receipt.files, candidate.files.size + 1);
          assert.equal(receipt.retainedManifestCount, 1);
          assert.equal(alias.sha256, history.sha256);
        } else {
          assert.equal(result.status, 1, result.stderr);
          assert.equal(receipt.status, "blocked");
          assert.equal(alias.ok, false);
          if (outcome === "missing") assert.equal(alias.lastResult.status, 404);
          else if (outcome === "mismatch") assert.notEqual(alias.lastResult.sha256, history.sha256);
          else assert.match(alias.lastResult.error, /exact URL/);
        }
      });
    }
  }

  await t.test("production gate rejects a receipt for another provider attempt", async () => {
    const result = run([...providerArgs.slice(0, -1), "scripts/cdn/verify-production.mjs",
      "--version", version, "--manifest-sha256", candidate.sha256,
      "--deployment-started-at", "2026-11-18T00:00:00.000Z"], "ready");
    assert.equal(result.status, 1, result.stderr);
    const readiness = await report("cdn-production-readiness");
    assert.equal(readiness.status, "blocked");
    assert.match(readiness.failures.join("\n"), /does not pin the requested deployment/);
  });
});

test("production promotion blocks when retained history is lost after deployment verification", async (t) => {
  const { cwd, publish } = await fixture(t);
  const result = publish("provider-history", { LUOGUSP_TEST_HISTORY_READINESS: "ready" });
  assert.equal(result.status, 1, result.stderr);
  const report = async (name) => JSON.parse(await readFile(join(cwd, `reports/${name}.json`)));
  const deployment = await report("cdn-deployment");
  const production = await report("cdn-production-readiness");
  const receipt = await report("publish");
  assert.equal(deployment.status, "ready");
  assert.equal(production.status, "blocked");
  assert.match(production.failures.join("\n"), /releases\/1\.0\.0\/manifest\.json/);
  assert.equal(receipt.phase, "production CDN gate");
  assert.equal(receipt.deploymentStatus, "confirmed");
  assert.equal(receipt.deploymentAttempt, "confirmed");
  assert.equal(receipt.resumeAllowed, true);
  assert.match(await readFile(join(cwd, "LuoguSP.user.js"), "utf8"), /@version\s+1\.0\.0/);
});

for (const failure of ["renderer", "late"]) {
  test(`standalone CDN ${failure} failure leaves no version and permits an exact retry`, async (t) => {
    const { cwd, build, snapshot, channelPath, previousChannel } = await fixture(t);
    const result = build(version, failure);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Injected .* failure/);
    assert.deepEqual(await readdir(join(cwd, "cdn/releases")), ["1.0.0"]);
    assert.equal(await readFile(channelPath, "utf8"), previousChannel);
    const retry = build();
    assert.equal(retry.status, 0, retry.stderr);
    assert.equal((await snapshot()).manifest.release, version);
    const prepared = spawnSync(process.execPath, ["scripts/cdn/prepare.mjs"],
      { cwd, encoding: "utf8", windowsHide: true });
    assert.equal(prepared.status, 0, prepared.stderr);
  });
}

for (const failure of ["file", "channel"]) {
  test(`standalone CDN cleans up an injected ${failure} write failure`, async (t) => {
    const { cwd, write, build, snapshot, channelPath, previousChannel } = await fixture(t);
    const hook = join(cwd, "mock-write-failure.mjs");
    await write("mock-write-failure.mjs", `
      import fs from "node:fs/promises";
      import { syncBuiltinESMExports } from "node:module";
      import { normalize } from "node:path";
      const write = fs.writeFile;
      const rename = fs.rename;
      const release = normalize("cdn/releases/2.0.0/");
      fs.writeFile = (...args) => {
        if (${JSON.stringify(failure)} === "file" && String(args[0]).includes(release))
          throw new Error("Injected file write failure");
        return write(...args);
      };
      fs.rename = (...args) => {
        if (${JSON.stringify(failure)} === "channel" && String(args[1]).endsWith(normalize("cdn/channels/canary.json")))
          throw new Error("Injected channel write failure");
        return rename(...args);
      };
      syncBuiltinESMExports();
    `);
    const result = spawnSync(process.execPath, ["--import", pathToFileURL(hook).href,
      "scripts/cdn/build.mjs", "--version", version], { cwd, encoding: "utf8", windowsHide: true });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Injected .* write failure/);
    assert.deepEqual(await readdir(join(cwd, "cdn/releases")), ["1.0.0"]);
    assert.deepEqual(await readdir(dirname(channelPath)), ["canary.json"]);
    assert.equal(await readFile(channelPath, "utf8"), previousChannel);
    const retry = build();
    assert.equal(retry.status, 0, retry.stderr);
    assert.equal((await snapshot()).manifest.release, version);
  });
}

test("a busy channel leaves the lock owner untouched and cleans up the rejected build", async (t) => {
  const { cwd, build, channelPath, previousChannel } = await fixture(t);
  const lock = `${channelPath}.lock`;
  await writeFile(lock, "another writer");
  const result = build();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /EEXIST/);
  assert.equal(await readFile(lock, "utf8"), "another writer");
  assert.equal(await readFile(channelPath, "utf8"), previousChannel);
  assert.deepEqual(await readdir(join(cwd, "cdn/releases")), ["1.0.0"]);
  await rm(lock);
  const retry = build();
  assert.equal(retry.status, 0, retry.stderr);
  assert.deepEqual(await readdir(dirname(channelPath)), ["canary.json"]);
});

for (const mode of ["baseline-race", "build-race", "replacement-race"]) {
  test(`publish rollback preserves another build's version and channel at ${mode}`, async (t) => {
    const { cwd, publish, snapshot, channelPath } = await fixture(t);
    const result = publish(mode);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, mode === "build-race" ? /immutable/ : /Injected fixture guard failure/);
    const expected = await readFile(join(cwd, "foreign-version/manifest.json"));
    assert.deepEqual((await snapshot()).files.get(`releases/${version}/manifest.json`), expected);
    assert.deepEqual(await readFile(channelPath), await readFile(join(cwd, "foreign-channel.json")));
  });
}

test("publish rollback removes only its own version and preserves a newer channel", async (t) => {
  const { cwd, publish, snapshot, channelPath } = await fixture(t);
  const result = publish("channel-race");
  assert.notEqual(result.status, 0);
  await assert.rejects(snapshot(), /missing/);
  assert.equal((await snapshot("3.0.0")).manifest.release, "3.0.0");
  assert.deepEqual(await readFile(channelPath), await readFile(join(cwd, "foreign-channel.json")));
});

test("publish rollback restores the channel present at its own build, including a concurrent update", async (t) => {
  const { cwd, publish, snapshot, channelPath } = await fixture(t);
  assert.notEqual(publish("channel-before-build").status, 0);
  await assert.rejects(snapshot(), /missing/);
  assert.equal((await snapshot("3.0.0")).manifest.release, "3.0.0");
  assert.deepEqual(await readFile(channelPath), await readFile(join(cwd, "foreign-channel.json")));
});

test("publish rollback restores its own channel change and allows a fresh retry", async (t) => {
  const { cwd, publish, snapshot, channelPath, previousChannel } = await fixture(t);
  assert.notEqual(publish().status, 0);
  await assert.rejects(snapshot(), /missing/);
  assert.equal(await readFile(channelPath, "utf8"), previousChannel);
  const retried = publish("success");
  assert.equal(retried.status, 0, retried.stderr);
  assert.equal((await snapshot()).manifest.release, version);
  const report = JSON.parse(await readFile(join(cwd, "reports/publish.json")));
  assert.equal(report.status, "ready-for-browser-qa");
});

test("a pre-provider rollback blocked by the channel lock can resume the verified transaction", async (t) => {
  const { cwd, write, build, publish, publishArgs, snapshot, channelPath } = await fixture(t);
  const child = await pauseChild(t, cwd, publishArgs, { ...process.env, LUOGUSP_TEST_PUBLISH_MODE: "rollback-contention" });
  const channelLock = `${channelPath}.lock`;
  const prior = await snapshot();
  const capturedChannel = await readFile(channelPath, "utf8");
  await withLocalLock(channelLock, async () => {
    const owner = await readFile(channelLock);
    await write("rollback.continue", "");
    assert.deepEqual(await child.exited, [1, null]);
    assert.deepEqual(await readFile(channelLock), owner);
  });

  const receiptPath = join(cwd, "reports/publish.json");
  const checkpoint = await readFile(receiptPath);
  const report = JSON.parse(checkpoint);
  assert.equal(report.status, "blocked");
  assert.equal(report.deploymentStatus, "not-attempted");
  assert.match(report.rollbackError, /canary\.json\.lock is busy/);
  assert.equal(report.channel, capturedChannel);
  assert.equal(report.resumeAllowed, true);
  assert.equal(JSON.parse(report.channel).manifestSha256, prior.sha256);
  assert.deepEqual((await snapshot()).files, prior.files);
  await assert.rejects(readFile(join(cwd, "provider.jsonl")), { code: "ENOENT" });

  const other = build("3.0.0");
  assert.equal(other.status, 0, other.stderr);
  const otherChannel = await readFile(channelPath);
  const otherFiles = (await snapshot("3.0.0")).files;
  const differentVersion = spawnSync(process.execPath, [...publishArgs.slice(0, -1), "3.0.0"], { cwd, encoding: "utf8" });
  assert.notEqual(differentVersion.status, 0);
  assert.match(differentVersion.stderr, /pending release 2\.0\.0/);
  assert.deepEqual(await readFile(receiptPath), checkpoint);

  const releasePath = join(cwd, "cdn/releases", version);
  const savedRelease = join(cwd, "owned-version");
  await rename(releasePath, savedRelease);
  for (const [name, bytes] of prior.files) await write(join("cdn", name), bytes);
  assert.deepEqual((await snapshot()).files, prior.files);
  const replacement = publish("provider-success");
  assert.notEqual(replacement.status, 0);
  assert.match(replacement.stderr, /release directory ownership changed/);
  assert.deepEqual((await snapshot()).files, prior.files);
  await assert.rejects(readFile(join(cwd, "provider.jsonl")), { code: "ENOENT" });
  await rename(releasePath, join(cwd, "replacement-version"));
  await rename(savedRelease, releasePath);

  const runtimePath = prior.manifest.compat.runtime.path;
  await write(join("cdn", runtimePath), "Changed fixture bundle");
  const drift = publish("provider-success");
  assert.notEqual(drift.status, 0);
  assert.match(drift.stderr, /content drifted from the manifest/);
  await assert.rejects(readFile(join(cwd, "provider.jsonl")), { code: "ENOENT" });
  await write(join("cdn", runtimePath), prior.files.get(runtimePath));

  const retry = publish("provider-success");
  assert.equal(retry.status, 0, retry.stderr);
  assert.deepEqual((await snapshot()).files, prior.files);
  assert.deepEqual((await snapshot("3.0.0")).files, otherFiles);
  assert.deepEqual(await readFile(channelPath), otherChannel);
  const provider = JSON.parse(await readFile(join(cwd, "provider.jsonl"), "utf8"));
  assert.deepEqual(provider, { channel: version, releases: ["1.0.0", version] });
  const finalReport = JSON.parse(await readFile(receiptPath));
  assert.equal(finalReport.status, "ready-for-browser-qa");
  assert.equal(finalReport.resumed, true);
  assert.equal(finalReport.channel, capturedChannel);
});

test("publish leaves build-failure cleanup to the failed child and can retry", async (t) => {
  const { publish, snapshot, channelPath, previousChannel } = await fixture(t);
  const result = publish("build-failure");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Injected late bundle failure/);
  await assert.rejects(snapshot(), /missing/);
  assert.equal(await readFile(channelPath, "utf8"), previousChannel);
  const retry = publish("success");
  assert.equal(retry.status, 0, retry.stderr);
});

test("pre-provider rollback can resume a verified release when its previous channel target was removed", async (t) => {
  const { cwd, write, build, publish, publishArgs, snapshot, channelPath } = await fixture(t);
  const previous = "1.1.0";
  const first = build(previous);
  assert.equal(first.status, 0, first.stderr);
  const child = await pauseChild(t, cwd, publishArgs, {
    ...process.env, LUOGUSP_TEST_PUBLISH_MODE: "rollback-contention",
  });
  const channel = await readFile(channelPath, "utf8");
  const candidate = await snapshot();
  const releasesRoot = join(cwd, "cdn/releases");
  const rolledBack = await rollbackRelease({ releasesRoot, version: previous, channelPath,
    transaction: JSON.parse(first.stdout).transaction });
  assert.equal(rolledBack.removed, true);
  await write("rollback.continue", "");
  assert.deepEqual(await child.exited, [1, null]);

  const receiptPath = join(cwd, "reports/publish.json");
  const checkpoint = await readFile(receiptPath);
  const receipt = JSON.parse(checkpoint);
  assert.equal(receipt.status, "blocked");
  assert.equal(receipt.deploymentStatus, "not-attempted");
  assert.equal(receipt.deploymentAttempt, "not-attempted");
  assert.equal(receipt.releaseRollback.removed, false);
  assert.equal(receipt.releaseRollback.channelRestored, false);
  assert.equal(receipt.rollbackError, null);
  assert.equal(receipt.channel, channel);
  assert.equal(JSON.parse(receipt.channel).manifestSha256, candidate.sha256);
  assert.deepEqual((await snapshot()).files, candidate.files);
  assert.equal(await readFile(channelPath, "utf8"), channel);
  await assert.rejects(readFile(join(cwd, "provider.jsonl")), { code: "ENOENT" });
  assert.equal(receipt.resumeAllowed, true);
  assert.equal(typeof receipt.rollbackDirectoryIdentity, "string");

  const sibling = "3.0.0";
  const built = build(sibling);
  assert.equal(built.status, 0, built.stderr);
  const siblingChannel = await readFile(channelPath);
  const siblingFiles = (await snapshot(sibling)).files;
  const unrelated = spawnSync(process.execPath, [...publishArgs.slice(0, -1), sibling], { cwd, encoding: "utf8" });
  assert.notEqual(unrelated.status, 0);
  assert.match(unrelated.stderr, /pending release 2\.0\.0/);
  assert.deepEqual(await readFile(receiptPath), checkpoint);

  const retried = publish("provider-success");
  assert.equal(retried.status, 0, retried.stderr);
  assert.deepEqual(JSON.parse(await readFile(join(cwd, "provider.jsonl"), "utf8")), {
    channel: version, releases: ["1.0.0", version],
  });
  assert.deepEqual((await snapshot()).files, candidate.files);
  assert.deepEqual(await readFile(channelPath), siblingChannel);
  assert.deepEqual((await snapshot(sibling)).files, siblingFiles);
});

for (const change of ["asset", "extra-file", "same-release-channel"]) {
  test(`publish rollback retains output changed after its build: ${change}`, async (t) => {
    const { cwd, build, snapshot, channelPath } = await fixture(t);
    const result = build();
    assert.equal(result.status, 0, result.stderr);
    const original = await snapshot();
    const directory = join(cwd, "cdn/releases", version);
    let changedFile;
    if (change === "same-release-channel") {
      const channel = JSON.parse(await readFile(channelPath));
      channel.updatedAt = "2026-11-15T12:00:00Z";
      await writeFile(channelPath, JSON.stringify(channel));
      changedFile = join(directory, "manifest.json");
    } else {
      changedFile = change === "asset"
        ? join(cwd, "cdn", original.manifest.compat.runtime.path)
        : join(directory, "other-writer.txt");
      await writeFile(changedFile, "Other writer's bytes");
    }
    const bytes = await readFile(changedFile);
    const channel = await readFile(channelPath);
    const retained = await rollbackRelease({ releasesRoot: dirname(directory), version, channelPath,
      transaction: JSON.parse(result.stdout).transaction });
    assert.deepEqual(retained, { removed: false, channelRestored: false });
    assert.deepEqual(await readFile(changedFile), bytes);
    assert.deepEqual(await readFile(channelPath), channel);
  });
}

test("publish retains immutable output after deployment starts and can resume", async (t) => {
  const { cwd, build, publish, snapshot, channelPath } = await fixture(t);
  assert.notEqual(publish("provider-error").status, 0);
  const manifest = (await snapshot()).sha256;
  const channel = await readFile(channelPath);
  const report = JSON.parse(await readFile(join(cwd, "reports/publish.json")));
  assert.equal(report.resumeAllowed, true);
  assert.equal(report.deploymentStarted, true);
  const intervening = build("3.0.0");
  assert.equal(intervening.status, 0, intervening.stderr);
  const otherChannel = await readFile(channelPath);
  const otherManifest = (await snapshot("3.0.0")).sha256;
  assert.notDeepEqual(otherChannel, channel);
  const resumed = publish("provider-success");
  assert.equal(resumed.status, 0, resumed.stderr);
  assert.equal((await snapshot()).sha256, manifest);
  assert.deepEqual(await readFile(channelPath), otherChannel);
  assert.equal((await snapshot("3.0.0")).sha256, otherManifest);
  const invocations = (await readFile(join(cwd, "provider.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
  assert.deepEqual(invocations, [
    { channel: version, releases: ["1.0.0", version] },
    { channel: version, releases: ["1.0.0", version] },
  ]);
  assert.equal(JSON.parse(await readFile(join(cwd, "reports/publish.json"))).channel, channel.toString("utf8"));
});

test("a different release cannot displace an unresolved publication checkpoint", async (t) => {
  const { cwd, publish, publishArgs } = await fixture(t);
  assert.notEqual(publish("provider-error").status, 0);
  const receiptPath = join(cwd, "reports/publish.json");
  const checkpoint = await readFile(receiptPath);
  const args = [...publishArgs.slice(0, -1), "3.0.0"];
  const plan = spawnSync(process.execPath, [...args, "--plan"], { cwd, encoding: "utf8" });
  assert.equal(plan.status, 0, plan.stderr);
  assert.equal(JSON.parse(plan.stdout).wouldPublish, false);
  assert.equal(JSON.parse(plan.stdout).pendingRelease, version);
  const result = spawnSync(process.execPath, args, { cwd, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /pending release 2\.0\.0/i);
  assert.deepEqual(await readFile(receiptPath), checkpoint);
  assert.equal(publish("success").status, 0);
});

for (const [mode, deploymentStatus, resumable] of [
  ["provider-preflight", "not-attempted", false],
  ["provider-error", "outcome-unknown", true],
  ["provider-post-gate", "confirmed", true],
]) {
  test(`publication reports ${deploymentStatus} after ${mode}`, async (t) => {
    const { cwd, publish } = await fixture(t);
    const result = publish(mode);
    assert.notEqual(result.status, 0);
    const report = JSON.parse(await readFile(join(cwd, "reports/publish.json")));
    assert.equal(report.deploymentStatus, deploymentStatus, JSON.stringify(report));
    assert.equal(report.deploymentAttempt, deploymentStatus);
    assert.equal(report.resumeAllowed, resumable);
    assert.deepEqual(report.deployedOrigins, deploymentStatus === "confirmed" ? ["https://stage.example"] : []);
    if (resumable) assert.equal((await snapshotRelease(join(cwd, "cdn/releases"), version)).manifest.release, version);
    else assert.equal(report.releaseRollback.removed, true);
  });
}

test("a resumed preflight rejection preserves earlier provider confirmation", async (t) => {
  const { cwd, publish } = await fixture(t);
  assert.notEqual(publish("provider-post-gate").status, 0);
  assert.notEqual(publish("provider-preflight").status, 0);
  const report = JSON.parse(await readFile(join(cwd, "reports/publish.json")));
  assert.equal(report.deploymentStatus, "confirmed");
  assert.equal(report.deploymentAttempt, "not-attempted");
  assert.equal(report.resumeAllowed, true);
  assert.deepEqual(report.deployedOrigins, ["https://stage.example"]);
});

test("a standalone publisher cannot deploy while the high-level publisher verifies the provider result", async (t) => {
  const { cwd, write, publishArgs, providerArgs, snapshot, build } = await fixture(t);
  const child = spawn(process.execPath, publishArgs, { cwd, windowsHide: true, env: {
    ...process.env, LUOGUSP_TEST_PUBLISH_MODE: "provider-success", LUOGUSP_TEST_PAUSE_VERIFICATION: "1",
  } });
  const exited = once(child, "exit");
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  child.stdout.resume();
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); });
  try {
    const deadline = Date.now() + 6000;
    for (;;) {
      const ready = await readFile(join(cwd, "verification.ready")).catch((error) => {
        if (error.code !== "ENOENT") throw error;
        return null;
      });
      if (ready) break;
      assert.ok(Date.now() < deadline && child.exitCode === null, `Provider did not start verification: ${stderr}`);
      await delay(20);
    }
    const other = build("3.0.0");
    assert.equal(other.status, 0, other.stderr);
    const channelPath = join(cwd, "cdn/channels/canary.json");
    const otherChannel = await readFile(channelPath);
    const olderManifest = (await snapshot()).sha256;
    const second = spawnSync(process.execPath, [...providerArgs, "--version", "3.0.0", "--skip-build"], {
      cwd, encoding: "utf8", windowsHide: true,
    });
    assert.notEqual(second.status, 0, second.stdout);
    assert.match(second.stderr, /publish\.lock is busy/);
    assert.deepEqual(await readFile(channelPath), otherChannel);
    assert.equal((await snapshot()).sha256, olderManifest);
    const invocations = (await readFile(join(cwd, "provider.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
    assert.deepEqual(invocations, [{ channel: version, releases: ["1.0.0", version] }]);
  } finally {
    await write("verification.continue", "");
    const [exitCode] = await exited;
    assert.equal(exitCode, 0, stderr);
  }
});

for (const mode of ["predeployment-interruption", "deployment-interruption"]) {
  test(`publisher lock recovery preserves its live owner and resumes ${mode}`, async (t) => {
    const { cwd, publish, publishArgs, recover, snapshot } = await fixture(t);
    const child = await pauseChild(t, cwd, publishArgs, { ...process.env, LUOGUSP_TEST_PUBLISH_MODE: mode });
    const lock = join(cwd, "reports/publish.lock");
    const owner = await readFile(lock);
    const checkpoint = JSON.parse(await readFile(join(cwd, "reports/publish.json")));
    assert.equal(checkpoint.status, "in-progress");
    assert.equal(checkpoint.deploymentStarted, mode === "deployment-interruption");
    assert.equal(JSON.parse(owner).pid, child.pid);
    const active = recover("publish");
    assert.notEqual(active.status, 0);
    assert.match(active.stderr, /active process/);
    assert.deepEqual(await readFile(lock), owner);
    await child.interrupt();
    assert.notEqual(publish("success").status, 0);
    const recovered = recover("publish");
    assert.equal(recovered.status, 0, recovered.stderr);
    const before = await snapshot();
    const resumed = publish("success");
    assert.equal(resumed.status, 0, resumed.stderr);
    assert.equal((await snapshot()).sha256, before.sha256);
  });
}

test("channel lock recovery preserves its live owner and the interrupted build can be verified", async (t) => {
  const { cwd, write, build, recover, channelPath } = await fixture(t);
  const hook = "interrupt-channel.mjs";
  await write(hook, String.raw`
    import fs from "node:fs/promises";
    import { writeSync } from "node:fs";
    import { syncBuiltinESMExports } from "node:module";
    import { basename } from "node:path";
    const rename = fs.rename;
    fs.rename = async (from, to) => {
      await rename(from, to);
      if (basename(to) === "canary.json") {
        writeSync(1, "FIXTURE PAUSED\n");
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15000);
        throw new Error("Fixture interruption did not arrive");
      }
    };
    syncBuiltinESMExports();
  `);
  const child = await pauseChild(t, cwd, ["--import", pathToFileURL(join(cwd, hook)).href,
    "scripts/cdn/build.mjs", "--version", version]);
  const lock = `${channelPath}.lock`;
  const owner = await readFile(lock);
  assert.equal(JSON.parse(owner).pid, child.pid);
  assert.match(recover("channel").stderr, /active process/);
  assert.deepEqual(await readFile(lock), owner);
  await child.interrupt();
  assert.match(build("3.0.0").stderr, /EEXIST/);
  const recovered = recover("channel");
  assert.equal(recovered.status, 0, recovered.stderr);
  const verified = spawnSync(process.execPath, ["scripts/cdn/build.mjs", "--verify-existing", "--version", version],
    { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(verified.status, 0, verified.stderr);
  const retry = build("3.0.0");
  assert.equal(retry.status, 0, retry.stderr);
});
