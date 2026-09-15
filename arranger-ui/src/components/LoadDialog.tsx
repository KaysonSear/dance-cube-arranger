"use client";

/**
 * 打开工程对话框(羊皮纸对话框):显示源文件信息;「将现有列视为占位(未指派)」开关
 * 默认开。源文件 sha1 与已存状态不符时给出警告分支:继续用已存状态 / 重新播种。
 */

import { useState } from "react";

export interface LoadDialogProps {
  sourcePath: string;
  noteCount: number;
  onsetCount: number;
  bpm: number;
  offsetMs: number | null;
  shaMismatch: boolean;
  /** 「视为占位」初值:已排键的源谱面应默认取消勾选 */
  defaultPlaceholder?: boolean;
  onStart(placeholder: boolean): void;
  onResume?: () => void;
}

export default function LoadDialog(props: LoadDialogProps) {
  const [placeholder, setPlaceholder] = useState(props.defaultPlaceholder ?? true);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25">
      <div className="w-[26rem] rounded-2xl bg-ivory p-5 text-sm text-olive shadow-whisper">
        <h2 className="font-serif text-base font-medium text-ink">加载谱面</h2>
        <dl className="mt-3 space-y-1 font-mono text-xs">
          <div className="flex justify-between">
            <dt>源文件</dt>
            <dd className="text-ink">{props.sourcePath}</dd>
          </div>
          <div className="flex justify-between">
            <dt>音符 / 采音点</dt>
            <dd className="text-ink">
              {props.noteCount} / {props.onsetCount}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt>BPM · offset</dt>
            <dd className="text-ink">
              {props.bpm} · {props.offsetMs === null ? "缺失" : `${props.offsetMs}ms`}
            </dd>
          </div>
        </dl>

        {props.shaMismatch && (
          <div className="mt-3 rounded-lg bg-warn-wash p-2 text-xs text-warn-ink">
            ⚠ 源 .mc 文件与上次保存的工作状态不一致(文件被修改过)。可继续使用已存指派,
            或重新开始。
          </div>
        )}

        <label className="mt-4 flex items-start gap-2 text-xs">
          <input
            type="checkbox"
            checked={placeholder}
            onChange={(e) => setPlaceholder(e.target.checked)}
            className="mt-0.5 accent-clay"
          />
          <span className="text-ink">
            将现有列视为占位(未指派)
            <span className="block font-normal text-stone">
              采音骨架谱面的列通常只是占位(如全部停在同一列);勾选后全部视为未排键,
              取消勾选则按源列显示并在其上修改。
            </span>
          </span>
        </label>

        <div className="mt-5 flex justify-end gap-2">
          {props.shaMismatch && props.onResume && (
            <button
              onClick={props.onResume}
              className="rounded-lg bg-sand px-3 py-1.5 text-xs text-charcoal shadow-ring hover:bg-sand-deep"
            >
              继续用已存状态
            </button>
          )}
          <button
            onClick={() => props.onStart(placeholder)}
            className="rounded-xl bg-clay px-4 py-1.5 text-xs font-semibold text-white hover:bg-coral"
          >
            {props.shaMismatch ? "重新开始排键" : "开始排键"}
          </button>
        </div>
      </div>
    </div>
  );
}
