"use client";

/** 历史快照面板:列出 / 新建(可命名)/ 恢复(确认后应用,恢复本身可用 Z 回退)。按工程隔离。 */

import { useCallback, useEffect, useState } from "react";

import type { Snapshot, SnapshotMeta, WorkingStateV1 } from "@/lib/persist-types";
import { srcQuery } from "@/lib/projects";

export interface SnapshotsPanelProps {
  open: boolean;
  src: string;
  onRestore(state: WorkingStateV1): void;
  onToast(msg: string): void;
}

export default function SnapshotsPanel({ open, src, onRestore, onToast }: SnapshotsPanelProps) {
  const [list, setList] = useState<SnapshotMeta[]>([]);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/snapshots${srcQuery(src)}`);
      const data = (await res.json()) as { snapshots: SnapshotMeta[] };
      setList(data.snapshots ?? []);
    } catch {
      setList([]);
    }
  }, [src]);

  useEffect(() => {
    // Opening the panel hydrates its list from the server.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) void refresh();
  }, [open, refresh]);

  if (!open) return null;

  const create = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/snapshots${srcQuery(src)}`, {
        method: "POST",
        body: JSON.stringify({ label: label || undefined }),
      });
      if (res.ok) {
        setLabel("");
        onToast("快照已创建");
        await refresh();
      } else {
        onToast(`快照失败:${(await res.json()).error ?? res.status}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const restore = async (meta: SnapshotMeta) => {
    if (
      !window.confirm(`恢复快照「${meta.label ?? meta.createdAt}」?当前指派将被替换(可用 Z 回退)。`)
    ) {
      return;
    }
    const res = await fetch(`/api/snapshots/${meta.id}${srcQuery(src)}`);
    if (!res.ok) {
      onToast("快照读取失败");
      return;
    }
    const snap = (await res.json()) as Snapshot;
    onRestore(snap.state);
  };

  return (
    <div className="border-t border-cream p-3 text-xs">
      <div className="mb-2 flex items-center gap-1.5">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="快照备注(可空)"
          className="min-w-0 flex-1 rounded-lg bg-white px-2 py-1 text-ink shadow-ring focus:shadow-ring-focus focus:outline-none"
        />
        <button
          disabled={busy}
          onClick={() => void create()}
          className="rounded-lg bg-sand px-2 py-1 text-charcoal shadow-ring hover:bg-sand-deep disabled:opacity-40"
        >
          ＋ 新建
        </button>
      </div>
      {list.length === 0 ? (
        <div className="text-stone">暂无快照(每 5 分钟自动快照一次;保留最新 50 份)</div>
      ) : (
        <ul className="max-h-48 space-y-1 overflow-y-auto">
          {list.map((m) => (
            <li key={m.id} className="flex items-center gap-2 rounded-lg bg-cream/70 px-2 py-1 text-olive">
              <span className="truncate">
                {m.label ?? "（未命名）"}
                <span className="ml-1.5 font-mono text-[10px] text-stone">
                  {new Date(m.createdAt).toLocaleString()} · {m.assignedCount}点
                </span>
              </span>
              <button
                className="ml-auto shrink-0 text-clay hover:text-coral"
                onClick={() => void restore(m)}
              >
                恢复
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
