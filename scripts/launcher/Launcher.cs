using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Text;
using System.Security.Cryptography;
using System.Threading;
using System.Windows.Forms;

namespace DanceCubeArrangerLauncher
{
    static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            Mutex startupMutex = null;
            bool ownsStartupMutex = false;
            string startupLog = null;
            try
            {
                string appDir = AppDomain.CurrentDomain.BaseDirectory;
                string stateDir = Path.Combine(appDir, @"artifacts\arranger");
                string pidFile = Path.Combine(stateDir, "editor-server.pid");
                string portFile = Path.Combine(stateDir, "editor-server.port");

                string uiDir = Path.Combine(appDir, "arranger-ui");
                string editorServerScript = Path.Combine(appDir, @"scripts\editor_server.ps1");
                // Source mode always delegates ownership and readiness checks to PowerShell.
                // Do not hold the native mutex while waiting for that child process.
                if (Directory.Exists(uiDir) && File.Exists(editorServerScript))
                {
                    LaunchSourceMode(appDir, stateDir, editorServerScript);
                    return;
                }

                startupMutex = new Mutex(false, GetStartupMutexName(appDir));
                try { ownsStartupMutex = startupMutex.WaitOne(0); }
                catch (AbandonedMutexException) { ownsStartupMutex = true; }
                if (!ownsStartupMutex) return;
                Directory.CreateDirectory(stateDir);
                startupLog = Path.Combine(stateDir, "editor-startup.log");
                File.WriteAllText(startupLog, "Starting portable editor at " + DateTime.Now.ToString("O") + Environment.NewLine, Encoding.UTF8);

                // 1. 检查是否已有运行中的实例
                if (File.Exists(pidFile) && File.Exists(portFile))
                {
                    int runningPid = 0;
                    int runningPort = 0;
                    if (int.TryParse(File.ReadAllText(pidFile).Trim(), out runningPid) &&
                        int.TryParse(File.ReadAllText(portFile).Trim(), out runningPort))
                    {
                        if (IsProcessRunning(runningPid) && IsPortListening(runningPort))
                        {
                            // 已经运行，直接在默认浏览器中激活
                            OpenBrowser(string.Format("http://localhost:{0}/?resume=1", runningPort), startupLog);
                            File.AppendAllText(startupLog, "Reused existing service. Exit code: 0" + Environment.NewLine);
                            return;
                        }
                    }
                }

                // 2. 扫描可用端口
                int selectedPort = FindAvailablePort();
                if (selectedPort == 0)
                {
                    throw new InvalidOperationException("无法找到可用端口（3000 及 3210-3299）。");
                }

                // 3. 寻找服务端入口 server.js 或源码工程目录
                string serverJs = FindServerJs(appDir);
                if (string.IsNullOrEmpty(serverJs))
                    throw new FileNotFoundException("未找到服务端入口 server.js，请完整解压便携版。", appDir);

                // 4. Standalone 模式：寻找 Node.js 运行时
                string nodeExe = FindNodeExecutable(appDir);
                if (string.IsNullOrEmpty(nodeExe))
                {
                    throw new FileNotFoundException("未找到 Node.js，请安装并加入 PATH，或在便携版 bin 目录中提供 node.exe。");
                }

                if (!Directory.Exists(stateDir))
                {
                    Directory.CreateDirectory(stateDir);
                }

                // 5. 启动后台静默 Node 进程
                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = nodeExe;
                psi.Arguments = string.Format("\"{0}\"", serverJs);
                psi.WorkingDirectory = Path.GetDirectoryName(serverJs);
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.WindowStyle = ProcessWindowStyle.Hidden;

                // 设置环境变量
                psi.EnvironmentVariables["PORT"] = selectedPort.ToString();
                psi.EnvironmentVariables["HOSTNAME"] = "127.0.0.1";
                psi.EnvironmentVariables["NODE_ENV"] = "production";

                // 注入便携运行环境 PATH 与 PYTHON_EXECUTABLE (支持 100% 零依赖开箱即用)
                string binDir = Path.Combine(appDir, "bin");
                string pyDir = Path.Combine(binDir, "python");
                string pyExe = Path.Combine(pyDir, "python.exe");
                if (!File.Exists(pyExe))
                {
                    pyExe = Path.Combine(binDir, "python.exe");
                }
                if (File.Exists(pyExe))
                {
                    psi.EnvironmentVariables["PYTHON_EXECUTABLE"] = pyExe;
                }

                string currentPath = Environment.GetEnvironmentVariable("PATH") ?? "";
                string extraPaths = "";
                if (Directory.Exists(binDir)) extraPaths += binDir + ";";
                if (Directory.Exists(pyDir)) extraPaths += pyDir + ";";
                if (!string.IsNullOrEmpty(extraPaths))
                {
                    psi.EnvironmentVariables["PATH"] = extraPaths + currentPath;
                }

                File.AppendAllText(startupLog, "Server: " + serverJs + "; port: " + selectedPort + Environment.NewLine);

                Process proc = Process.Start(psi);
                if (proc == null || proc.HasExited)
                {
                    throw new InvalidOperationException("Node.js 服务启动失败。" + (proc == null ? "" : " 退出码: " + proc.ExitCode));
                }

                // 写入 PID 和端口
                File.WriteAllText(pidFile, proc.Id.ToString(), Encoding.UTF8);
                File.WriteAllText(portFile, selectedPort.ToString(), Encoding.UTF8);

                // 6. 等待 HTTP 探活并打开浏览器
                string targetUrl = string.Format("http://localhost:{0}/?resume=1", selectedPort);
                bool ready = false;
                for (int i = 0; i < 100; i++)
                {
                    if (proc.HasExited)
                    {
                        throw new InvalidOperationException("Node.js 服务异常退出，退出码: " + proc.ExitCode);
                    }

                    if (ProbeHttp(selectedPort))
                    {
                        ready = true;
                        break;
                    }
                    Thread.Sleep(150);
                }

                if (ready)
                {
                    OpenBrowser(targetUrl, startupLog);
                }
                else
                {
                    // 即使未完全探活，也尝试打开浏览器
                    OpenBrowser(targetUrl, startupLog);
                }
                File.AppendAllText(startupLog, "Editor startup exit code: 0" + Environment.NewLine);
            }
            catch (Exception ex)
            {
                Environment.ExitCode = 1;
                if (startupLog != null)
                {
                    try { File.AppendAllText(startupLog, ex.ToString() + Environment.NewLine + "Editor startup exit code: 1" + Environment.NewLine); }
                    catch { }
                }
                MessageBox.Show("启动失败：\n" + ex.Message + (startupLog == null ? "" : "\n\n启动日志：\n" + startupLog), "舞立方谱面编辑器", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            finally
            {
                if (ownsStartupMutex) startupMutex.ReleaseMutex();
                if (startupMutex != null) startupMutex.Dispose();
            }
        }

        static string GetStartupMutexName(string appDir)
        {
            string canonical = Path.GetFullPath(appDir).TrimEnd('\\', '/').ToLowerInvariant();
            using (SHA256 sha = SHA256.Create())
            {
                return @"Local\DanceCubeArranger.Start." + BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(canonical))).Replace("-", "").ToLowerInvariant();
            }
        }

        static void OpenBrowser(string url, string logPath)
        {
            try { Process.Start(url); }
            catch (Exception ex)
            {
                // The server is healthy even when the default browser cannot be opened.
                File.AppendAllText(logPath, "Open the editor manually: " + url + Environment.NewLine + ex.Message + Environment.NewLine);
            }
        }

        static void LaunchSourceMode(string appDir, string stateDir, string script)
        {
            Directory.CreateDirectory(stateDir);
            PruneLaunchLogs(stateDir, KeptLaunchLogs - 1);
            string logPath = Path.Combine(stateDir, "editor-launch-" + DateTime.UtcNow.ToString("yyyyMMdd-HHmmss-fff") + "-" + Process.GetCurrentProcess().Id + ".log");
            StringBuilder output = new StringBuilder();
            ProcessStartInfo info = new ProcessStartInfo("powershell.exe");
            info.Arguments = string.Format("-NoProfile -ExecutionPolicy Bypass -File \"{0}\" -Mode start", script);
            info.WorkingDirectory = appDir;
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            info.WindowStyle = ProcessWindowStyle.Hidden;
            info.RedirectStandardOutput = true;
            info.RedirectStandardError = true;
            info.StandardOutputEncoding = Encoding.UTF8;
            info.StandardErrorEncoding = Encoding.UTF8;
            int exitCode = 1;
            try
            {
                using (Process process = new Process())
                {
                    process.StartInfo = info;
                    process.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e) { if (e.Data != null) lock (output) { output.AppendLine(e.Data); } };
                    process.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) { if (e.Data != null) lock (output) { output.AppendLine(e.Data); } };
                    process.Start();
                    process.BeginOutputReadLine();
                    process.BeginErrorReadLine();
                    // WaitForExit() without a timeout also waits for the redirected
                    // pipe to close; the detached dev server inherits that pipe, so
                    // poll the process handle instead.
                    Stopwatch wait = Stopwatch.StartNew();
                    while (!process.HasExited && wait.ElapsedMilliseconds < 30 * 60 * 1000) Thread.Sleep(100);
                    if (!process.HasExited)
                    {
                        try { process.Kill(); } catch { }
                    }
                    Thread.Sleep(100);
                    exitCode = process.ExitCode;
                }
            }
            catch (Exception ex) { output.AppendLine(ex.ToString()); }
            output.AppendLine("Launcher exit code: " + exitCode);
            File.WriteAllText(logPath, output.ToString(), Encoding.UTF8);
            Environment.ExitCode = exitCode;
            if (exitCode != 0)
            {
                string detail = output.ToString();
                if (detail.Length > 1500) detail = detail.Substring(detail.Length - 1500);
                MessageBox.Show("开发服务启动失败：\n\n" + detail + "\n启动日志：\n" + logPath,
                    "舞立方谱面编辑器 - 源码模式启动失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        const int KeptLaunchLogs = 10;

        // Each source-mode launch writes its own log into the live user-data directory;
        // keep only the newest ones so repeated launches do not accumulate files forever.
        static void PruneLaunchLogs(string stateDir, int keep)
        {
            try
            {
                string[] logs = Directory.GetFiles(stateDir, "editor-launch-*.log", SearchOption.TopDirectoryOnly);
                // Names embed a sortable UTC timestamp, so ordinal order is chronological.
                Array.Sort(logs, StringComparer.Ordinal);
                for (int i = 0; i < logs.Length - keep; i++)
                {
                    try { File.Delete(logs[i]); } catch { }
                }
            }
            catch { }
        }

        static bool IsProcessRunning(int pid)
        {
            try
            {
                Process p = Process.GetProcessById(pid);
                return p != null && !p.HasExited;
            }
            catch
            {
                return false;
            }
        }

        static bool IsPortListening(int port)
        {
            try
            {
                using (TcpClient client = new TcpClient())
                {
                    IAsyncResult ar = client.BeginConnect("127.0.0.1", port, null, null);
                    bool success = ar.AsyncWaitHandle.WaitOne(200);
                    return success && client.Connected;
                }
            }
            catch
            {
                return false;
            }
        }

        static int FindAvailablePort()
        {
            int[] candidates = new int[] { 3000 };
            foreach (int p in candidates)
            {
                if (TestPortAvailable(p)) return p;
            }

            for (int p = 3210; p <= 3299; p++)
            {
                if (TestPortAvailable(p)) return p;
            }

            return 0;
        }

        static bool TestPortAvailable(int port)
        {
            try
            {
                System.Net.NetworkInformation.IPGlobalProperties properties =
                    System.Net.NetworkInformation.IPGlobalProperties.GetIPGlobalProperties();
                foreach (IPEndPoint endpoint in properties.GetActiveTcpListeners())
                {
                    if (endpoint.Port == port) return false;
                }
                // Node 26 listeners are absent from GetActiveTcpListeners() and show
                // up as Unknown connections with no remote port.
                foreach (TcpConnectionInformation connection in properties.GetActiveTcpConnections())
                {
                    if (connection.LocalEndPoint.Port != port) continue;
                    if (connection.State == TcpState.Listen ||
                        (connection.State == TcpState.Unknown && connection.RemoteEndPoint.Port == 0))
                    {
                        return false;
                    }
                }
            }
            catch { }

            TcpListener listener = null;
            try
            {
                listener = new TcpListener(IPAddress.Any, port);
                listener.Start();
                return true;
            }
            catch
            {
                return false;
            }
            finally
            {
                if (listener != null)
                {
                    try { listener.Stop(); } catch { }
                }
            }
        }

        static string FindNodeExecutable(string appDir)
        {
            // 1. 本地 bin\node.exe
            string localBin = Path.Combine(appDir, @"bin\node.exe");
            if (File.Exists(localBin)) return localBin;

            // 2. 检查 PATH 中的 node.exe
            string pathEnv = Environment.GetEnvironmentVariable("PATH") ?? "";
            foreach (string part in pathEnv.Split(';'))
            {
                if (string.IsNullOrEmpty(part)) continue;
                try
                {
                    string candidate = Path.Combine(part.Trim(), "node.exe");
                    if (File.Exists(candidate)) return candidate;
                }
                catch { }
            }

            return null;
        }

        static string FindServerJs(string appDir)
        {
            // 候选路径（根据打包目录与源码目录自适应）
            string[] candidates = new string[]
            {
                Path.Combine(appDir, @"server\server.js"),
                Path.Combine(appDir, @"server.js"),
                Path.Combine(appDir, @"standalone\server.js"),
                Path.Combine(appDir, @"arranger-ui\.next\standalone\server.js"),
                Path.Combine(appDir, @"arranger-ui\.next\standalone\arranger-ui\server.js")
            };

            foreach (string path in candidates)
            {
                if (File.Exists(path))
                {
                    // 确保如果使用 standalone 目录，其静态资源 .next\static 必须存在，否则会导致前端无法加载静态 JS 白屏
                    string serverDir = Path.GetDirectoryName(path);
                    string staticDir = Path.Combine(serverDir, @".next\static");
                    if (path.Contains("standalone") && !Directory.Exists(staticDir))
                    {
                        continue;
                    }
                    return path;
                }
            }

            return null;
        }

        static bool ProbeHttp(int port)
        {
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(string.Format("http://127.0.0.1:{0}/", port));
                req.Timeout = 500;
                req.Method = "GET";
                using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                {
                    return true;
                }
            }
            catch (WebException ex)
            {
                if (ex.Response != null) return true; // 有任何 HTTP 状态响应说明服务已经活着
                return false;
            }
            catch
            {
                return false;
            }
        }
    }
}
