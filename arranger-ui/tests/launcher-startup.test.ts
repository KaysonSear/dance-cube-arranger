import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repo = path.resolve(__dirname, "../..");
const csc = "C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe";
const windows = process.platform === "win32" && fs.existsSync(csc);
let sandbox: string;
let launcherExe: string;
const children: ChildProcess[] = [];
const fixtures: string[] = [];
const quotePs = (value: string) => `'${value.replaceAll("'", "''")}'`;

async function until(check: () => boolean, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for launcher fixture");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function launch(root: string) {
  const child = spawn(path.join(root, "launch.exe"), [], { windowsHide: true, stdio: "ignore" });
  children.push(child);
  return child;
}

async function finished(child: ChildProcess) {
  await until(() => child.exitCode !== null);
  return child.exitCode;
}

function lines(root: string, file: string) {
  const name = path.join(root, file);
  return fs.existsSync(name) ? fs.readFileSync(name, "utf8").trim().split(/\r?\n/).filter(Boolean) : [];
}

function fixture(name: string, portable = false) {
  const root = path.join(sandbox, name);
  fixtures.push(root);
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.copyFileSync(launcherExe, path.join(root, "launch.exe"));
  for (const file of ["editor_server.ps1", "editor_server_ports.ps1", "editor_server_processes.ps1", "editor_server_state.ps1"]) {
    fs.copyFileSync(path.join(repo, "scripts", file), path.join(root, "scripts", file === "editor_server.ps1" ? "editor_server_impl.ps1" : file));
  }
  // Intercept only opening the browser. All process creation, locks, HTTP probes and logs are real.
  fs.writeFileSync(path.join(root, "scripts/editor_server.ps1"), `param([string]$Mode, [switch]$NoBrowser)
function global:Start-Process {
  if ($args[0] -match '^http') { Add-Content -LiteralPath ${quotePs(path.join(root, "browser.txt"))} -Value $args[0]; return }
  Microsoft.PowerShell.Management\\Start-Process @args
}
& "$PSScriptRoot/editor_server_impl.ps1" -Mode $Mode -NoBrowser:$NoBrowser
exit $LASTEXITCODE
`.replace("Management\\\\", "Management\\"));
  const serverDir = portable ? path.join(root, "server") : path.join(root, "arranger-ui/node_modules/next/dist/bin");
  fs.mkdirSync(serverDir, { recursive: true });
  const server = `const fs = require('fs'); const http = require('http');
const root = ${JSON.stringify(root)};
fs.appendFileSync(root + '/starts.txt', process.pid + '\\n');
console.log('fixture stdout');
if (fs.existsSync(root + '/fail')) { console.error('fixture startup failed'); process.exit(23); }
const port = Number(process.env.PORT || process.argv[process.argv.indexOf('--port') + 1]);
if (${portable} === false) {
  const devDir = root + '/arranger-ui/.next/dev';
  fs.mkdirSync(devDir, { recursive: true });
  fs.writeFileSync(devDir + '/lock', JSON.stringify({ pid: process.pid, port, hostname: 'localhost', appUrl: 'http://localhost:' + port, startedAt: Date.now() }));
}
const readyAt = Date.now() + 3000;
http.createServer((req, res) => {
  if (Date.now() < readyAt) { req.socket.destroy(); return; }
  if (req.url !== '/api/health') { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ ok: true, pid: process.pid, version: 'test' }));
}).listen(port);
`;
  fs.writeFileSync(path.join(serverDir, portable ? "server.js" : "next"), server);
  if (!portable) {
    // A leftover build must not take precedence over the source-mode delegate.
    fs.mkdirSync(path.join(root, "arranger-ui/.next/standalone/.next/static"), { recursive: true });
    fs.writeFileSync(path.join(root, "arranger-ui/.next/standalone/server.js"), "process.exit(99)");
  }
  return root;
}

describe.skipIf(!windows)("Windows launcher concurrency", () => {
  beforeAll(() => {
    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "arranger-launch-test-"));
    // Stub native browser/dialog UI only, so real launcher control flow can run unattended.
    const source = fs.readFileSync(path.join(repo, "scripts/launcher/Launcher.cs"), "utf8")
      .replaceAll("MessageBox.Show(", "TestUi.Show(");
    const stub = `namespace DanceCubeArrangerLauncher {
      static class TestUi {
        public static void Show(string text, string title, System.Windows.Forms.MessageBoxButtons buttons, System.Windows.Forms.MessageBoxIcon icon) {
          System.IO.File.AppendAllText(System.IO.Path.Combine(System.AppDomain.CurrentDomain.BaseDirectory, "dialogs.txt"), text + "\\n");
        }
      }
    }`;
    fs.writeFileSync(path.join(sandbox, "Launcher.cs"), source + stub);
    launcherExe = path.join(sandbox, "launch.exe");
    execFileSync(csc, ["/nologo", "/target:winexe", `/out:${launcherExe}`, "/reference:System.Windows.Forms.dll,System.dll", path.join(sandbox, "Launcher.cs")], { windowsHide: true });
  });

  afterAll(() => {
    for (const child of children) {
      if (child.exitCode === null && child.pid) {
        try { execFileSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); } catch { /* already exited */ }
      }
    }
    // Kill only PIDs emitted by our fixture servers and the launchers we created.
    for (const root of fixtures) {
      for (const pid of lines(root, "starts.txt")) {
        try { process.kill(Number(pid)); } catch { /* already exited */ }
      }
    }
    const target = path.resolve(sandbox);
    if (path.dirname(target) !== path.resolve(os.tmpdir()) || !path.basename(target).startsWith("arranger-launch-test-")) throw new Error("Unsafe test cleanup path");
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
  });

  it("serializes cold source launches, reuses readiness, and keeps project locks independent", async () => {
    const root = fixture("source");
    const first = launch(root);
    await until(() => lines(root, "starts.txt").length === 1);
    const duplicate = launch(root);
    const otherRoot = fixture("other-source");
    const other = launch(otherRoot);
    expect(await finished(duplicate)).toBe(0);
    expect(await finished(first), lines(root, "artifacts/arranger/editor-server.stderr.log").join("\n")).toBe(0);
    expect(await finished(other)).toBe(0);
    expect(lines(root, "starts.txt")).toHaveLength(1);
    expect(lines(otherRoot, "starts.txt")).toHaveLength(1);
    expect(lines(root, "browser.txt")).toHaveLength(1);
    const stateDir = path.join(root, "artifacts/arranger");
    const logs = fs.readdirSync(stateDir).filter((file) => file.startsWith("editor-launch-"));
    expect(logs).toHaveLength(2);
    expect(logs.map((file) => fs.readFileSync(path.join(stateDir, file), "utf8")).join("\n")).toContain("already in progress");
    expect(await finished(launch(root))).toBe(0);
    expect(lines(root, "starts.txt")).toHaveLength(1);
    expect(lines(root, "browser.txt")).toHaveLength(2);
    expect(lines(root, "dialogs.txt")).toHaveLength(0);

    for (let i = 0; i < 10; i++) {
      fs.writeFileSync(path.join(stateDir, `editor-launch-20000101-000000-000-${i}.log`), "");
    }
    expect(await finished(launch(root))).toBe(0);
    const rotated = fs.readdirSync(stateDir).filter((file) => file.startsWith("editor-launch-"));
    expect(rotated).toHaveLength(10);
    expect(rotated.filter((file) => !file.startsWith("editor-launch-20000101-"))).toHaveLength(4);
  }, 60_000);

  it("reuses a live dev server from Next's lockfile when state files are missing", async () => {
    const root = fixture("recovered-source");
    expect(await finished(launch(root))).toBe(0);
    expect(lines(root, "starts.txt")).toHaveLength(1);
    const stateDir = path.join(root, "artifacts/arranger");
    fs.unlinkSync(path.join(stateDir, "editor-server.pid"));
    fs.unlinkSync(path.join(stateDir, "editor-server.port"));
    expect(await finished(launch(root))).toBe(0);
    expect(lines(root, "starts.txt")).toHaveLength(1);
    expect(lines(root, "browser.txt")).toHaveLength(2);
    expect(lines(root, "dialogs.txt")).toHaveLength(0);
  }, 60_000);

  it("logs actual errors and exit codes, releases the lock, and permits retry", async () => {
    const root = fixture("failed-source");
    fs.writeFileSync(path.join(root, "fail"), "");
    expect(await finished(launch(root))).toBe(1);
    const transcript = fs.readFileSync(path.join(root, "artifacts/arranger/editor-startup.log"), "utf8");
    expect(transcript).toContain("fixture startup failed");
    expect(transcript).toContain("退出码 23");
    expect(lines(root, "dialogs.txt").join("\n")).toContain("editor-launch-");
    fs.unlinkSync(path.join(root, "fail"));
    expect(await finished(launch(root))).toBe(0);
    expect(lines(root, "starts.txt")).toHaveLength(2);
  }, 60_000);

  it("portable native and direct PowerShell launches share the same lock", async () => {
    const root = fixture("portable", true);
    const first = launch(root);
    await until(() => lines(root, "starts.txt").length === 1);
    expect(await finished(launch(root))).toBe(0);
    const duplicate = execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(root, "scripts/editor_server.ps1"), "-Mode", "start"], { windowsHide: true, encoding: "utf8", timeout: 10_000 });
    expect(duplicate).toContain("already in progress");
    expect(await finished(first)).toBe(0);
    expect(await finished(launch(root))).toBe(0);
    expect(lines(root, "starts.txt")).toHaveLength(1);
    expect(lines(root, "browser.txt")).toHaveLength(2);
    expect(lines(root, "dialogs.txt")).toHaveLength(0);
  }, 60_000);
});
