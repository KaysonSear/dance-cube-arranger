using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace DanceCubeArrangerLauncher
{
    static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            try
            {
                string appDir = AppDomain.CurrentDomain.BaseDirectory;
                string stateDir = Path.Combine(appDir, @"artifacts\arranger");
                string pidFile = Path.Combine(stateDir, "editor-server.pid");
                string portFile = Path.Combine(stateDir, "editor-server.port");

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
                            Process.Start(string.Format("http://localhost:{0}/?resume=1", runningPort));
                            return;
                        }
                    }
                }

                // 2. 扫描可用端口
                int selectedPort = FindAvailablePort();
                if (selectedPort == 0)
                {
                    MessageBox.Show(
                        "无法找到可用的排键器端口（已探测 3000 及 3210-3299）。\n请检查是否有其它程序占用了端口。",
                        "舞立方谱面编辑器 - 端口冲突",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error
                    );
                    return;
                }

                // 3. 寻找服务端入口 server.js 或源码工程目录
                string serverJs = FindServerJs(appDir);
                string uiDir = Path.Combine(appDir, "arranger-ui");
                string editorServerScript = Path.Combine(appDir, @"scripts\editor_server.ps1");

                // 如果未找到编译后的 server.js，检查是否在源码工程目录下
                if (string.IsNullOrEmpty(serverJs))
                {
                    if (Directory.Exists(uiDir) && File.Exists(editorServerScript))
                    {
                        // 源码工程模式：委托 scripts\editor_server.ps1 启动开发服务
                        ProcessStartInfo psiDev = new ProcessStartInfo();
                        psiDev.FileName = "powershell.exe";
                        psiDev.Arguments = string.Format("-NoProfile -ExecutionPolicy Bypass -File \"{0}\" -Mode start", editorServerScript);
                        psiDev.WorkingDirectory = appDir;
                        psiDev.UseShellExecute = false;
                        psiDev.CreateNoWindow = true;
                        psiDev.WindowStyle = ProcessWindowStyle.Hidden;

                        Process devProc = Process.Start(psiDev);
                        if (devProc != null)
                        {
                            devProc.WaitForExit();
                            if (devProc.ExitCode == 0)
                            {
                                return;
                            }
                        }

                        MessageBox.Show(
                            "开发服务启动失败，请在终端执行下列命令查看输出：\n\npowershell -File scripts\\editor_server.ps1 -Mode start",
                            "舞立方谱面编辑器 - 源码模式启动失败",
                            MessageBoxButtons.OK,
                            MessageBoxIcon.Error
                        );
                        return;
                    }

                    MessageBox.Show(
                        "未找到服务端入口 server.js 或源码工程目录 arranger-ui。\n\n请检查：\n1. 如果是绿色便携版，请完整解压压缩包，确保 server 文件夹与本程序在同级目录；\n2. 如果是快捷方式，请检查快捷方式的【起始位置】是否设置为安装目录。\n\n当前目录：\n" + appDir,
                        "舞立方谱面编辑器 - 启动失败",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error
                    );
                    return;
                }

                // 4. Standalone 模式：寻找 Node.js 运行时
                string nodeExe = FindNodeExecutable(appDir);
                if (string.IsNullOrEmpty(nodeExe))
                {
                    MessageBox.Show(
                        "未找到 Node.js 运行环境。\n\n请确保：\n1. 系统中已安装 Node.js (v18.18+) 并加入 PATH；\n2. 或在发布包 bin 目录下放置 node.exe 便携版。",
                        "舞立方谱面编辑器 - 缺少 Node 运行时",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error
                    );
                    return;
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
                psi.EnvironmentVariables["HOSTNAME"] = "0.0.0.0";
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

                // 重定向日志到 artifacts\arranger
                string stdoutLog = Path.Combine(stateDir, "editor-server.stdout.log");
                string stderrLog = Path.Combine(stateDir, "editor-server.stderr.log");

                Process proc = Process.Start(psi);
                if (proc == null || proc.HasExited)
                {
                    MessageBox.Show("Node.js 服务启动失败，请检查运行日志。", "舞立方谱面编辑器", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return;
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
                        MessageBox.Show("Node.js 服务异常退出，请查看日志文件。", "舞立方谱面编辑器", MessageBoxButtons.OK, MessageBoxIcon.Error);
                        return;
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
                    Process.Start(targetUrl);
                }
                else
                {
                    // 即使未完全探活，也尝试打开浏览器
                    Process.Start(targetUrl);
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show("启动时发生未知错误：\n" + ex.Message, "舞立方谱面编辑器", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
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
                if (File.Exists(path)) return path;
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
