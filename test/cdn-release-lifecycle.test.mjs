import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import {
  copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { snapshotRelease } from "../scripts/cdn/release-integrity.mjs";
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
  const files = ["scripts/publish.mjs", "scripts/publish-lib.mjs",
    ...(await readdir(join(root, "scripts/cdn"))).map((name) => `scripts/cdn/${name}`)];
  for (const file of files) {
    const destination = join(cwd, file);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(join(root, file), destination);
  }
  const stubs = {
    "package.json": '{"type":"module","version":"1.0.0"}',
    "baseline-targets.mjs": "export const ESBUILD_BASELINE_TARGETS = [];",
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
    "config/cdn.json": '{"origins":{"primary":"https://stage.example","bootstrap":"https://stage.example"}}',
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
  const hook = join(cwd, "mock-publish.mjs");
  await writeFile(hook, String.raw`
    import cp from "node:child_process";
    import { syncBuiltinESMExports } from "node:module";
    import { cpSync, mkdirSync, readFileSync, renameSync, writeFileSync, appendFileSync, writeSync } from "node:fs";
    const spawn = cp.spawnSync;
    const mode = process.env.LUOGUSP_TEST_PUBLISH_MODE;
    const channelPath = "cdn/channels/canary.json";
    const success = { status: 0, stdout: "", stderr: "" };
    const failure = { status: 1, stdout: "", stderr: "Injected fixture guard failure\n" };
    const pause = () => {
      writeSync(1, "FIXTURE PAUSED\n");
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
        if (mode === "channel-race") concurrent("3.0.0");
        if (mode === "replacement-race") {
          renameSync("cdn/releases/2.0.0", "superseded-own-version");
          concurrent("2.0.0");
        }
        return ["success", "deploy-failure", "production-peer-before", "production-peer-after",
          "production-unreadable", "promotion-failure", "deployment-interruption"].includes(mode) ? success : failure;
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
        if (mode === "deployment-interruption") pause();
        if (args.includes("--channel-file")) {
          const channel = JSON.parse(readFileSync(args[args.indexOf("--channel-file") + 1], "utf8"));
          if (channel.release !== "2.0.0") throw new Error("Provider received a different channel");
        }
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
  return { cwd, write, build, publish, publishArgs, recover, snapshot, channelPath, previousChannel };
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

test("overlapping rollbacks retain a valid current channel when its predecessor was removed", async (t) => {
  const { cwd, build, snapshot, channelPath } = await fixture(t);
  const first = build();
  assert.equal(first.status, 0, first.stderr);
  const second = build("3.0.0");
  assert.equal(second.status, 0, second.stderr);
  const releasesRoot = join(cwd, "cdn/releases");
  const rolledBack = await rollbackRelease({ releasesRoot, version, channelPath,
    transaction: JSON.parse(first.stdout).transaction });
  assert.equal(rolledBack.removed, true);
  const retained = await rollbackRelease({ releasesRoot, version: "3.0.0", channelPath,
    transaction: JSON.parse(second.stdout).transaction });
  assert.deepEqual(retained, { removed: false, channelRestored: false });
  const current = JSON.parse(await readFile(channelPath));
  assert.equal(current.release, "3.0.0");
  assert.equal((await snapshot(current.release)).sha256, current.manifestSha256);
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
  assert.notEqual(publish("deploy-failure").status, 0);
  const manifest = (await snapshot()).sha256;
  const channel = await readFile(channelPath);
  const report = JSON.parse(await readFile(join(cwd, "reports/publish.json")));
  assert.equal(report.resumeAllowed, true);
  assert.equal(report.deploymentStarted, true);
  const intervening = build("3.0.0");
  assert.equal(intervening.status, 0, intervening.stderr);
  const otherChannel = await readFile(channelPath);
  assert.notDeepEqual(otherChannel, channel);
  const resumed = publish("success");
  assert.equal(resumed.status, 0, resumed.stderr);
  assert.equal((await snapshot()).sha256, manifest);
  assert.deepEqual(await readFile(channelPath), otherChannel);
  assert.equal(JSON.parse(await readFile(join(cwd, "reports/publish.json"))).channel, channel.toString("utf8"));
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
