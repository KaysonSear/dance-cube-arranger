using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

namespace DanceCubeArrangerStopper
{
    static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            bool silent = args != null && Array.Exists(args, delegate(string a) {
                return a.Equals("/silent", StringComparison.OrdinalIgnoreCase) || a.Equals("/q", StringComparison.OrdinalIgnoreCase);
            });

            try
            {
                string appDir = AppDomain.CurrentDomain.BaseDirectory;
                string stateDir = Path.Combine(appDir, @"artifacts\arranger");
                string pidFile = Path.Combine(stateDir, "editor-server.pid");
                string portFile = Path.Combine(stateDir, "editor-server.port");

                if (!File.Exists(pidFile))
                {
                    if (!silent) MessageBox.Show("当前没有正在运行的舞立方排键器服务。", "舞立方谱面编辑器", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return;
                }

                int pid = 0;
                if (!int.TryParse(File.ReadAllText(pidFile).Trim(), out pid))
                {
                    TryDelete(pidFile);
                    TryDelete(portFile);
                    if (!silent) MessageBox.Show("记录的进程 PID 无效，已清理状态文件。", "舞立方谱面编辑器", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    return;
                }

                bool killed = false;
                try
                {
                    Process p = Process.GetProcessById(pid);
                    if (p != null && !p.HasExited)
                    {
                        p.Kill();
                        p.WaitForExit(3000);
                        killed = true;
                    }
                }
                catch
                {
                    // 进程已不在
                }

                TryDelete(pidFile);
                TryDelete(portFile);

                if (killed)
                {
                    if (!silent) MessageBox.Show(string.Format("舞立方排键器后台服务 (PID {0}) 已安全停止。", pid), "舞立方谱面编辑器", MessageBoxButtons.OK, MessageBoxIcon.Information);
                }
                else
                {
                    if (!silent) MessageBox.Show("排键器服务未在运行，已清理残留状态。", "舞立方谱面编辑器", MessageBoxButtons.OK, MessageBoxIcon.Information);
                }
            }
            catch (Exception ex)
            {
                if (!silent) MessageBox.Show("停止服务时出错：\n" + ex.Message, "舞立方谱面编辑器", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        static void TryDelete(string path)
        {
            try
            {
                if (File.Exists(path)) File.Delete(path);
            }
            catch { }
        }
    }
}
