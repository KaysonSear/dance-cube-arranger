/** Confirm the server's current file list, then submit that exact deletion. */
export async function changeProjectEntry(scope: "project" | "chart", target: string, action: "hide" | "unhide" | "purge") {
  const post = async (operation: string, token?: string) => {
    const response = await fetch("/api/projects/entry", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope, target, action: operation, token }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(String(result.error ?? "工程操作失败"));
    return result;
  };
  let token: string | undefined;
  if (action === "purge") {
    const plan = await post("preview-purge");
    const title = scope === "chart" && plan.wholeProject ? "这是最后一张谱面，将彻底删除整个工程。"
      : plan.wholeProject ? "彻底删除整个工程？" : "彻底删除这张谱面？";
    if (!window.confirm([title, "此操作不可恢复。", ...plan.paths].join("\n"))) return false;
    token = plan.token;
  }
  await post(action, token);
  return true;
}
