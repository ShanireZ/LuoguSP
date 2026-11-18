import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";
const origin = "https://stage.example";
const digest = (value) => createHash("sha256").update(value).digest("hex");

async function scratchDirectory(t) {
  const base = await realpath(tmpdir());
  const prefix = "luogusp-cdn-path-20261115-";
  const temporaryRoot = await realpath(await mkdtemp(path.join(base, prefix)));
  assert.equal(path.dirname(temporaryRoot), base);
  assert.ok(path.basename(temporaryRoot).startsWith(prefix));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  return temporaryRoot;
}

function prepare(cwd, output) {
  return spawnSync(
    process.execPath,
    ["scripts/cdn/prepare.mjs", ...(output ? ["--output", output] : [])],
    { cwd, encoding: "utf8" },
  );
}

async function stageFixture(t) {
  const scratch = await scratchDirectory(t);
  const repo = path.join(scratch, "FixtureRepo");
  const release = "1.2.3";
  const source = path.join(repo, "cdn");
  const releases = path.join(source, "releases");
  const artifacts = path.join(releases, release);
  const channels = path.join(source, "channels");
  const scripts = path.join(repo, "scripts", "cdn");
  const config = path.join(repo, "config");
  await Promise.all([artifacts, channels, scripts, config].map((dir) =>
    mkdir(dir, { recursive: true }),
  ));
  const file = `releases/${release}/pinned.js`;
  const body = "// Immutable staging fixture\n";
  const manifest = {
    schemaVersion: 3,
    release,
    origin,
    files: {
      [file]: { path: file, bytes: Buffer.byteLength(body), sha256: digest(body) },
    },
  };
  async function pin(updatedManifest = manifest, { select = true } = {}) {
    const release = updatedManifest.release;
    const directory = path.join(releases, release);
    const manifestBody = JSON.stringify(updatedManifest);
    const manifestSha256 = digest(manifestBody);
    const hashedName = `manifest.${manifestSha256.slice(0, 16)}.json`;
    for (const name of await readdir(directory))
      if (/^manifest\.[a-f0-9]{16}\.json$/.test(name))
        await rm(path.join(directory, name));
    const writes = [
      writeFile(path.join(directory, "manifest.json"), manifestBody),
      writeFile(path.join(directory, hashedName), manifestBody),
    ];
    if (select)
      writes.push(writeFile(path.join(channels, "canary.json"), JSON.stringify({
        schemaVersion: 2,
        channel: "canary",
        release,
        origin,
        manifestPath: `releases/${release}/${hashedName}`,
        manifestSha256,
      })));
    await Promise.all(writes);
  }
  await Promise.all([
    ...(await readdir(path.join(root, "scripts", "cdn"))).map((name) =>
      copyFile(path.join(root, "scripts", "cdn", name), path.join(scripts, name)),
    ),
    writeFile(path.join(config, "cdn.json"), JSON.stringify({ origins: { primary: origin } })),
    writeFile(path.join(source, file), body),
    pin(),
  ]);
  return { scratch, repo, source, file, body, artifacts, channels, manifest, pin };
}

async function refusesToStage({ repo, source, file, body }, output) {
  const result = prepare(repo, output);
  assert.ifError(result.error);
  assert.equal(await readFile(path.join(source, file), "utf8"), body);
  assert.deepEqual((await readdir(source)).sort(), ["channels", "releases"]);
  assert.notEqual(result.status, 0, `should refuse to stage ${output}`);
  assert.match(result.stderr, /Refusing to replace an unexpected deployment directory/);
}

async function linkDirectory(t, target, link) {
  try {
    await symlink(target, link, isWindows ? "junction" : "dir");
    return true;
  } catch (error) {
    if (error.code !== "EPERM" && error.code !== "EACCES") throw error;
    t.skip(`Creating a directory link is unavailable (${error.code})`);
    return false;
  }
}

test("CDN staging keeps only the current canary release", async (t) => {
  const output = path.join(await scratchDirectory(t), "cdn");

  const result = prepare(root, output);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

  const channel = JSON.parse(
    await readFile(path.join(root, "cdn/channels/canary.json"), "utf8"),
  );
  const stagedReleases = await readdir(path.join(output, "releases"));
  const stagedCanaries = stagedReleases.filter((release) =>
    release.includes("-canary."),
  );

  const channelIsCanary = channel.release.includes("-canary.");
  assert.deepEqual(stagedCanaries, channelIsCanary ? [channel.release] : []);
  // Existing installs still pin older stable releases.
  assert.equal(stagedReleases.includes("2.13.10"), true);
  assert.equal(stagedReleases.includes(channel.release), true);
  const stagedManifestBody = await readFile(path.join(output, channel.manifestPath));
  assert.equal(digest(stagedManifestBody), channel.manifestSha256);
  for (const [name, record] of Object.entries(JSON.parse(stagedManifestBody).files))
    assert.equal(digest(await readFile(path.join(output, name))), record.sha256, name);
});

// Run destructive regression probes only against a disposable source tree.
test("CDN staging refuses to overwrite its source tree", async (t) => {
  const fixture = await stageFixture(t);
  for (const target of ["cdn", fixture.source, "cdn/releases/../"]) {
    await refusesToStage(fixture, target);
  }
});

test("CDN staging rejects a Windows case alias of its source tree", {
  skip: !isWindows,
}, async (t) => {
  const fixture = await stageFixture(t);
  const alias = path.join(fixture.scratch, "fixturerepo", "cdn");
  assert.equal(await realpath(alias), await realpath(fixture.source));
  await refusesToStage(fixture, alias);
});

test("CDN staging rejects an intermediate directory link to its source tree", async (t) => {
  const fixture = await stageFixture(t);
  const alias = path.join(fixture.scratch, "repo-link");
  if (!await linkDirectory(t, fixture.repo, alias)) return;
  await refusesToStage(fixture, path.join(alias, "cdn"));
});

test("CDN staging rejects a missing output nested under a source alias", async (t) => {
  const fixture = await stageFixture(t);
  const alias = path.join(fixture.scratch, "repo-link");
  if (!await linkDirectory(t, fixture.repo, alias)) return;
  await refusesToStage(fixture, path.join(alias, "cdn", "not-yet", "nested", "cdn"));
});

test("CDN staging rejects an output link to a source ancestor", async (t) => {
  const fixture = await stageFixture(t);
  const alias = path.join(fixture.scratch, "cdn");
  if (!await linkDirectory(t, fixture.repo, alias)) return;
  await refusesToStage(fixture, alias);
  assert.equal((await lstat(alias)).isSymbolicLink(), true);
});

test("CDN staging accepts the default and a separate scratch directory", async (t) => {
  const { repo, file, body, scratch } = await stageFixture(t);
  const output = path.join(scratch, "outside", "nested", "cdn");
  for (const target of [undefined, output]) {
    const result = prepare(repo, target);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const stagedFile = path.join(target || path.join(repo, "dist", "cdn"), file);
    assert.equal(await readFile(stagedFile, "utf8"), body);
  }
  await writeFile(path.join(output, "stale"), "left by a previous stage");
  const result = prepare(repo, output);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  await assert.rejects(lstat(path.join(output, "stale")), { code: "ENOENT" });
});

for (const directory of ["release", "channel"]) {
  test(`CDN staging rejects unlisted data in the ${directory} tree`, async (t) => {
    const { repo, artifacts, channels, scratch } = await stageFixture(t);
    const output = path.join(scratch, "cdn");
    await mkdir(output);
    await writeFile(path.join(output, "existing"), "stage must survive preflight failure");
    await writeFile(path.join(directory === "release" ? artifacts : channels, "private.txt"), "synthetic private data");
    const result = prepare(repo, output);
    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /unlisted/i);
    assert.deepEqual(await readdir(output), ["existing"]);
  });
}

for (const unsafe of ["../../secret.js", "nested\\file.js", "%2e%2e/secret.js", "nested/../secret.js", "file.js:stream", "file.js."]) {
  test(`CDN staging rejects an escaping or aliased manifest path: ${unsafe}`, async (t) => {
    const { repo, source, scratch, manifest, pin, file, body } = await stageFixture(t);
    const unsafePath = `releases/${manifest.release}/${unsafe}`;
    await pin({ ...manifest, files: {
      ...manifest.files,
      [unsafePath]: { path: unsafePath, bytes: Buffer.byteLength(body), sha256: digest(body) },
    } });
    // The escape resolves to an existing file in the old implementation.
    await writeFile(path.join(source, "secret.js"), body);
    const result = prepare(repo, path.join(scratch, "cdn"));
    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /unsafe pinned path/i, result.stderr);
    assert.equal(await readFile(path.join(source, file), "utf8"), body);
  });
}

test("CDN staging rejects a junction at a pinned artifact's parent", async (t) => {
  const { repo, scratch, artifacts, manifest, pin, body } = await stageFixture(t);
  const outside = path.join(scratch, "outside");
  await mkdir(outside);
  await writeFile(path.join(outside, "linked.js"), body);
  if (!await linkDirectory(t, outside, path.join(artifacts, "feature"))) return;
  const file = `releases/${manifest.release}/feature/linked.js`;
  await pin({ ...manifest, files: {
    ...manifest.files,
    [file]: { path: file, bytes: Buffer.byteLength(body), sha256: digest(body) },
  } });
  const result = prepare(repo, path.join(scratch, "cdn"));
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /not a regular directory/i, result.stderr);
});

async function publishFixture(t, { committed = true, additionalReleases = [], localReleases = [] } = {}) {
  const fixture = await stageFixture(t);
  const { repo, scratch, manifest, source, file, body, pin } = fixture;
  const deploy = path.join(repo, "deploy", "cloudflare");
  const configPath = path.join(repo, "config", "cdn.json");
  const wranglerPath = path.join(deploy, "wrangler.jsonc");
  const recorder = path.join(scratch, "record.mjs");
  const recording = path.join(scratch, "deploy-record.jsonl");
  async function addRelease(release) {
    const filename = `releases/${release}/pinned.js`;
    await mkdir(path.join(source, "releases", release));
    await writeFile(path.join(source, filename), body);
    await pin({ ...manifest, release, files: {
      [filename]: { ...manifest.files[file], path: filename },
    } }, { select: false });
  }
  await mkdir(deploy, { recursive: true });
  await mkdir(path.join(repo, "reports"));
  await writeFile(configPath, JSON.stringify({
    origins: { primary: origin },
    projects: { cloudflare: "test-stage" },
    cli: { wrangler: { minimum: "4.107.0" } },
  }));
  await writeFile(wranglerPath, JSON.stringify({
    name: "test-stage",
    main: "worker.js",
    routes: [{ pattern: new URL(origin).hostname, custom_domain: true }],
    workers_dev: false,
    preview_urls: false,
    assets: { directory: "../../dist/cdn" },
  }));
  await writeFile(recorder, `
    import cp from "node:child_process";
    import { syncBuiltinESMExports } from "node:module";
    import assert from "node:assert/strict";
    import { appendFileSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
    import { dirname, join, resolve, sep } from "node:path";
    const spawn = cp.spawnSync;
    const record = (entry) => appendFileSync(${JSON.stringify(recording)}, JSON.stringify(entry) + "\\n");
    let deployed;
    const wrongVerificationUrl = process.env.CDN_TEST_WRONG_VERIFY_URL === "1";
    if (wrongVerificationUrl) {
      const setTimeout = globalThis.setTimeout;
      globalThis.setTimeout = (callback, _delay, ...args) => setTimeout(callback, 0, ...args);
    }
    globalThis.fetch = async (url, options) => {
      if (deployed) {
        record(["verify", url.pathname]);
        const response = new Response(deployed.get(url.pathname.slice(1)), { headers: {
          "Content-Type": url.pathname.endsWith(".json") ? "application/json" : "application/javascript",
          "Cache-Control": url.pathname.startsWith("/channels/") ? "no-cache" : "immutable",
          "Access-Control-Allow-Origin": "*",
        } });
        const finalUrl = wrongVerificationUrl ? new URL(url.pathname, "https://other.example").href : url.href;
        return Object.defineProperty(response, "url", { value: finalUrl });
      }
      record(["fetch", url.href, {
        credentials: options.credentials,
        redirect: options.redirect,
        cache: options.cache,
        cacheControl: options.headers["Cache-Control"],
        timeout: options.signal instanceof AbortSignal,
      }]);
      const release = /^\\/releases\\/([^/]+)\\/manifest\\.json$/.exec(url.pathname)?.[1];
      if (!release || url.origin !== ${JSON.stringify(origin)} || url.search || url.hash)
        throw new Error("unexpected remote manifest URL");
      const remote = JSON.parse(process.env.CDN_TEST_REMOTE);
      const outcome = typeof remote === "string" ? remote : remote[release];
      if (outcome === "redirect") throw new TypeError("redirect blocked");
      if (!outcome) throw new Error("unexpected remote manifest preflight");
      const status = { new: 404, "wrong-url": 404, unavailable: 503 }[outcome] ?? 200;
      let body = outcome === "published" ? ${JSON.stringify(JSON.stringify(manifest))} : "{}";
      if (outcome === "resume" || outcome === "extra-byte") {
        const bytes = readFileSync(join("cdn", "releases", release, "manifest.json"));
        body = new ReadableStream({
          start(controller) {
            const middle = Math.floor(bytes.length / 2);
            controller.enqueue(bytes.subarray(0, middle));
            controller.enqueue(bytes.subarray(middle));
            if (outcome === "extra-byte") controller.enqueue(Buffer.from("\\n"));
            controller.close();
          },
        });
      }
      const response = new Response(body, { status });
      Object.defineProperty(response, "url", {
        value: outcome === "wrong-url" ? new URL("/not-found", url).href : url.href,
      });
      return response;
    };
    cp.spawnSync = (executable, args, options) => {
      if (executable === "git") return spawn(executable, args, options);
      const command = executable === process.execPath
        ? ["node", ...args]
        : process.platform === "win32" ? args.slice(3) : [executable, ...args];
      const [program, operation] = command;
      record(command);
      if (program === "node" && operation === "scripts/cdn/prepare.mjs")
        return spawn(executable, args, options);
      if (program === "wrangler" && operation === "--version" && process.env.CDN_TEST_TAMPER) {
        const stage = readdirSync(".npm-cache").find((name) => name.startsWith("luogusp-cdn-deploy-"));
        writeFileSync(stage ? join(".npm-cache", stage, "cdn/channels/canary.json") : "dist/cdn/channels/canary.json", "{}");
      }
      if (program === "wrangler" && operation === "deploy") {
        const configPath = resolve(command[3]);
        const config = JSON.parse(readFileSync(configPath));
        assert.equal(resolve(dirname(configPath), config.main), resolve("deploy/cloudflare/worker.js"));
        const stage = resolve(dirname(configPath), config.assets.directory);
        const inventory = () => new Map(readdirSync(stage, { recursive: true, withFileTypes: true })
          .filter((entry) => entry.isFile())
          .map((entry) => {
            const file = join(entry.parentPath, entry.name);
            return [file.slice(stage.length + 1).split(sep).join("/"), readFileSync(file)];
          }));
        const initial = inventory();
        record(["inventory", ...initial.keys()]);
        if (process.env.CDN_TEST_SECOND_CHANNEL) {
          writeFileSync("cdn/channels/canary.json", process.env.CDN_TEST_SECOND_CHANNEL);
          const prep = spawn(process.execPath, ["scripts/cdn/prepare.mjs"], options);
          assert.equal(prep.status, 0, prep.stderr);
          assert.equal(JSON.parse(readFileSync("dist/cdn/channels/canary.json")).release,
            JSON.parse(process.env.CDN_TEST_SECOND_CHANNEL).release);
          assert.deepEqual(inventory(), initial);
        }
        deployed = inventory();
      }
      return { status: 0, stdout: program === "wrangler" ? "4.107.0\\n" : "" };
    };
    syncBuiltinESMExports();
  `);
  function git(...args) {
    const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
    assert.equal(result.status, 0, result.error?.message || result.stderr);
  }
  git("init", "--quiet");
  const recordCommit = ({ includeCdn = true } = {}) => {
    if (includeCdn) git("add", "cdn");
    git("-c", "user.name=Test", "-c", "user.email=fixture@example.invalid",
      "commit", "--quiet", "--allow-empty", "--no-gpg-sign", "-m", "Pinned release fixture");
  };
  for (const release of additionalReleases) await addRelease(release);
  recordCommit({ includeCdn: committed });
  for (const release of localReleases) await addRelease(release);
  fixture.publish = async (args, { tamper = false, remote = "resume", secondChannel = "", wrongVerificationUrl = false } = {}) => {
    const result = spawnSync(
      process.execPath, ["--import", pathToFileURL(recorder).href, "scripts/cdn/publish.mjs", ...args],
      { cwd: repo, encoding: "utf8", env: {
        ...process.env, CDN_TEST_TAMPER: tamper ? "1" : "", CDN_TEST_REMOTE: JSON.stringify(remote),
        CDN_TEST_SECOND_CHANNEL: secondChannel,
        CDN_TEST_WRONG_VERIFY_URL: wrongVerificationUrl ? "1" : "0",
      } },
    );
    assert.ifError(result.error);
    const recorded = await readFile(recording, "utf8").catch((error) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
    const commands = recorded.trim().split("\n").filter(Boolean).map(JSON.parse);
    return { ...result, commands };
  };
  return { ...fixture, recordCommit, wranglerPath };
}

test("low-level publish validates an origin override before any build or provider command", async (t) => {
  const { publish, manifest } = await publishFixture(t);
  const result = await publish(["--version", manifest.release, "--origin", "https://wrong.example"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /origin override must match/);
  assert.deepEqual(result.commands, []);
});

test("skip-build publish rejects a requested version that differs from the channel", async (t) => {
  const { publish } = await publishFixture(t);
  const result = await publish(["--version", "9.9.9", "--skip-build"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /channel release .* does not match requested release 9\.9\.9/i);
  assert.deepEqual(result.commands, []);
});

for (const change of [
  { manifestPath: "releases/1.2.3/manifest.json" },
  { manifestSha256: "0".repeat(64) },
  { origin: "https://wrong.example" },
]) {
  test(`low-level publish rejects channel ${Object.keys(change)[0]} drift before Wrangler`, async (t) => {
    const { publish, manifest, channels } = await publishFixture(t);
    const target = path.join(channels, "canary.json");
    const channel = JSON.parse(await readFile(target, "utf8"));
    await writeFile(target, JSON.stringify({ ...channel, ...change }));
    const result = await publish(["--version", manifest.release, "--skip-build"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /canary channel.*configured CDN origin/i);
    assert.deepEqual(result.commands, []);
  });
}

test("low-level publish rejects a locally rewritten committed version", async (t) => {
  const { publish, manifest, pin, source, file } = await publishFixture(t);
  const body = "// Rewritten material under the existing release ID\n";
  await writeFile(path.join(source, file), body);
  await pin({ ...manifest, files: {
    [file]: { path: file, bytes: Buffer.byteLength(body), sha256: digest(body) },
  } });
  const result = await publish(["--version", manifest.release, "--skip-build"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /committed immutable CDN release/i);
  assert.deepEqual(result.commands, []);
});

test("low-level publish refuses changed immutable bytes even when rewritten assets are committed", async (t) => {
  const { publish, manifest, pin, source, file, recordCommit } = await publishFixture(t);
  const body = "// Locally committed replacement for an already published asset\n";
  await writeFile(path.join(source, file), body);
  await pin({ ...manifest, files: {
    [file]: { path: file, bytes: Buffer.byteLength(body), sha256: digest(body) },
  } });
  recordCommit();

  const result = await publish(["--version", manifest.release, "--skip-build"], { remote: "published" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /published immutable manifest differs/);
  assert.deepEqual(result.commands.map(([program, url]) => [program, url]), [
    ["fetch", `${origin}/releases/${manifest.release}/manifest.json`],
  ]);
});

test("low-level publish checks all staged versions and rejects an older committed collision", async (t) => {
  const older = "1.2.2";
  const { publish, manifest } = await publishFixture(t, {
    additionalReleases: [older, "1.2.0-canary.1"],
  });
  const result = await publish(["--version", manifest.release, "--skip-build"], {
    remote: { [older]: "collision", [manifest.release]: "resume" },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /release 1\.2\.2: published immutable manifest differs/);
  assert.deepEqual(result.commands.map(([program, url]) => [program, url]).sort(), [
    ["fetch", `${origin}/releases/${older}/manifest.json`],
    ["fetch", `${origin}/releases/${manifest.release}/manifest.json`],
  ]);
});

test("low-level publish checks that Wrangler targets the configured origin and staging root", async (t) => {
  const { publish, manifest, wranglerPath } = await publishFixture(t);
  const config = JSON.parse(await readFile(wranglerPath, "utf8"));
  config.assets.directory = "../../cdn";
  await writeFile(wranglerPath, JSON.stringify(config));
  const result = await publish(["--version", manifest.release, "--skip-build"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Wrangler .*configured origin and staged CDN root/i);
  assert.deepEqual(result.commands, []);
});

test("a captured deployment retains published stable history and excludes an unrelated fresh stable build", async (t) => {
  const older = "1.2.2";
  const publishedOutsideGit = "1.2.1";
  const fresh = "3.0.0";
  const { publish, manifest, source, channels, repo } = await publishFixture(t, {
    additionalReleases: [older],
    localReleases: [publishedOutsideGit, fresh],
  });
  const channelPath = path.join(channels, "canary.json");
  const candidateChannel = await readFile(channelPath);
  await writeFile(path.join(repo, "captured-channel.json"), candidateChannel);
  const freshManifestPath = path.join(source, "releases", fresh, "manifest.json");
  const freshManifest = await readFile(freshManifestPath);
  const freshChannel = JSON.stringify({
    ...JSON.parse(candidateChannel),
    release: fresh,
    manifestPath: `releases/${fresh}/manifest.${digest(freshManifest).slice(0, 16)}.json`,
    manifestSha256: digest(freshManifest),
  });
  await writeFile(channelPath, freshChannel);
  const result = await publish(["--version", manifest.release, "--skip-build", "--channel-file", "captured-channel.json"], {
    remote: { [manifest.release]: "new", [older]: "resume", [publishedOutsideGit]: "resume", [fresh]: "new" },
  });
  assert.equal(result.status, 0, result.stderr);
  const inventory = result.commands.find(([kind]) => kind === "inventory").slice(1);
  assert.deepEqual(new Set(inventory.flatMap((name) => /^releases\/([^/]+)\//.exec(name)?.[1] ?? [])),
    new Set([manifest.release, older, publishedOutsideGit]));
  assert.deepEqual(await readFile(freshManifestPath), freshManifest);
  assert.equal(await readFile(channelPath, "utf8"), freshChannel);
});

test("a committed version missing its public manifest blocks deployment", async (t) => {
  const older = "1.2.2";
  const { publish, manifest } = await publishFixture(t, { additionalReleases: [older] });
  const result = await publish(["--version", manifest.release, "--skip-build"], {
    remote: { [manifest.release]: "new", [older]: "new" },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /committed release has no published manifest/);
  assert.equal(result.commands.some(([program]) => program === "wrangler"), false);
});

test("low-level publish rejects staged bytes changed during the CLI check", async (t) => {
  const { publish, manifest } = await publishFixture(t);
  const result = await publish(["--version", manifest.release, "--skip-build"], { tamper: true });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /staged CDN.*changed/i);
  assert.deepEqual(result.commands.filter(([program]) => program === "wrangler"), [["wrangler", "--version"]]);
});

for (const [remote, failure] of [
  ["new", null],
  ["resume", null],
  ["collision", /published immutable manifest differs/],
  ["extra-byte", /published immutable manifest differs/],
  ["unavailable", /unexpected manifest status 503/],
  ["redirect", /redirect blocked/],
  ["wrong-url", /manifest response did not come from its exact URL/],
]) {
  test(`low-level publish guards uncommitted releases against the configured origin: ${remote}`, async (t) => {
    const { publish, manifest } = await publishFixture(t, { committed: false });
    const result = await publish(["--version", manifest.release, "--skip-build"], { remote });
    assert.deepEqual(result.commands.filter(([program]) => program === "fetch"), [
      ["fetch", `${origin}/releases/${manifest.release}/manifest.json`, {
        credentials: "omit", redirect: "error", cache: "no-store", cacheControl: "no-cache", timeout: true,
      }],
    ]);
    if (failure) {
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, failure);
      assert.equal(result.commands.some(([program]) => program === "wrangler"), false);
    } else {
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.commands.some(([program, action]) => program === "wrangler" && action === "deploy"), true);
    }
  });
}

test("a deployment retains its exact snapshot and verification pins during another normal CDN prep", async (t) => {
  const otherVersion = "1.2.4-canary.1";
  const { publish, manifest, repo, channels, source } = await publishFixture(t, {
    additionalReleases: [otherVersion],
  });
  const otherManifest = await readFile(path.join(source, "releases", otherVersion, "manifest.json"));
  const secondChannel = JSON.stringify({
    schemaVersion: 2, channel: "canary", release: otherVersion, origin,
    manifestPath: `releases/${otherVersion}/manifest.${digest(otherManifest).slice(0, 16)}.json`,
    manifestSha256: digest(otherManifest),
  });
  const selected = JSON.parse(await readFile(path.join(channels, "canary.json")));
  const result = await publish(["--version", manifest.release, "--skip-build", "--origin", origin], { secondChannel });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.commands.filter(([kind]) => kind !== "inventory"), [
    ["fetch", `${origin}/releases/${manifest.release}/manifest.json`, {
      credentials: "omit", redirect: "error", cache: "no-store", cacheControl: "no-cache", timeout: true,
    }],
    ["wrangler", "--version"],
    ["wrangler", "deploy", "--config", result.commands[2][3]],
    ["verify", `/${selected.manifestPath}`],
    ["verify", `/releases/${manifest.release}/manifest.json`],
    ...Object.keys(manifest.files).map((file) => ["verify", `/${file}`]),
    ["verify", "/channels/canary.json"],
  ]);
  const report = JSON.parse(await readFile(path.join(repo, "reports", "cdn-publish.json"), "utf8"));
  assert.equal(report.release, manifest.release);
  assert.equal(report.origin, origin);
  const verified = JSON.parse(await readFile(path.join(repo, "reports", "cdn-deployment.json")));
  assert.equal(verified.status, "ready");
  assert.equal(verified.release, manifest.release);
  assert.equal(verified.manifestSha256, selected.manifestSha256);
  assert.equal(await readFile(path.join(channels, "canary.json"), "utf8"), secondChannel);
  assert.notEqual(path.resolve(repo, result.commands[2][3]), path.join(repo, "deploy", "cloudflare", "wrangler.jsonc"));
  await assert.rejects(lstat(path.resolve(repo, result.commands[2][3])), { code: "ENOENT" });
});

test("a deployment reports blocked verification when matching bytes come from another URL", async (t) => {
  const { publish, repo, manifest } = await publishFixture(t);
  const result = await publish(["--version", manifest.release, "--skip-build"], { wrongVerificationUrl: true });
  assert.notEqual(result.status, 0);
  const report = JSON.parse(await readFile(path.join(repo, "reports", "cdn-deployment.json"), "utf8"));
  assert.equal(report.release, manifest.release);
  assert.equal(report.status, "blocked");
  assert.equal(report.failure.lastResult.status, 200);
  assert.equal(report.failure.lastResult.bytes, 0);
  assert.match(report.failure.lastResult.error, /exact URL/);
});

async function stubBuildImports(repo) {
  await copyFile(path.join(root, "baseline-targets.mjs"), path.join(repo, "baseline-targets.mjs"));
  const buildStubs = {
    "node_modules/esbuild/package.json": '{"exports":"./index.mjs"}',
    "node_modules/esbuild/index.mjs": "export function build() { throw new Error('Build was reached'); }",
    "scripts/renderer/build-lib.mjs": "export function buildMarkdownRenderer() { throw new Error('Build was reached'); }",
    "src/rendering/renderer-dependencies.js": "export const MARKDOWN_RENDERER_API_VERSION = 1; export const rendererStackDependencies = {};",
    "package.json": '{"type":"module"}',
  };
  for (const [name, stub] of Object.entries(buildStubs)) {
    const target = path.join(repo, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, stub);
  }
}

test("cdn:build --overwrite refuses to mutate an existing release directory", async (t) => {
  const { repo, manifest, source, file, body } = await stageFixture(t);
  await stubBuildImports(repo);
  const result = spawnSync(process.execPath, [
    "scripts/cdn/build.mjs", "--version", manifest.release, "--overwrite",
  ], { cwd: repo, encoding: "utf8" });
  assert.ifError(result.error);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /immutable/i);
  assert.equal(await readFile(path.join(source, file), "utf8"), body);
});

test("cdn:build refuses to recreate a committed release missing from the working tree", async (t) => {
  const { repo, manifest, artifacts, source } = await publishFixture(t);
  await stubBuildImports(repo);
  assert.equal(await realpath(artifacts), path.join(source, "releases", manifest.release));
  await rm(artifacts, { recursive: true });
  const result = spawnSync(process.execPath, [
    "scripts/cdn/build.mjs", "--version", manifest.release,
  ], { cwd: repo, encoding: "utf8" });
  assert.ifError(result.error);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /immutable/i);
  await assert.rejects(lstat(artifacts), { code: "ENOENT" });
});
