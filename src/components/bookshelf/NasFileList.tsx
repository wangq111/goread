import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";

import { FileRow } from "../FileRow";
import { Loading } from "../Loading";
import { isSupportedFile } from "../../constants/fileTypes";
import type { NasConnection, NasEntry } from "../../utils/nasConnections";
import { useNasBrowse } from "./hooks/useNasBrowse";
import { useAppNav } from "../../router/useAppNav";
import { nasOpenRemote, formatNasBytes } from "../../services/nasService";
import type { BookshelfTab } from "../../types";

/** 下载进度事件 payload（与后端 DownloadProgress 结构对应） */
type NasDownloadProgress = {
  /** 文件名（后端已清洗） */
  name: string;
  /** 已下载字节数 */
  downloaded: number;
  /** 总字节数（服务器未返回时为 null） */
  total?: number | null;
};

interface NasFileListProps {
  /** 当前页签对应的 NAS 连接配置 */
  connection: NasConnection;
  /** 轻提示回调（如打开失败时的提示文案） */
  onNotify: (msg: string) => void;
}

/**
 * 网络书架文件列表组件
 *
 * 展示指定 NAS 连接的远程 WebDAV 目录内容：顶部面包屑支持层级跳转，
 * 目录行点击进入下一层，文件行点击即打开阅读（透明缓存：命中缓存秒开，
 * 未命中自动下载并显示进度浮层，完成后直接进入阅读器，进度/书签自动保留）。
 * 仅展示目录与受支持的书籍文件，其余文件（如图片、隐藏文件）自动过滤。
 *
 * @param connection 当前页签对应的 NAS 连接
 * @param onNotify 轻提示回调，透传 toast 文案
 */
export const NasFileList: React.FC<NasFileListProps> = ({
  connection,
  onNotify,
}) => {
  const { t } = useTranslation('bookshelf');
  const nav = useAppNav();
  // 目录浏览状态与动作（连接切换时自动从起始路径重新加载）
  const { entries, loading, error, dirStack, goInto, goToDepth, reload } =
    useNasBrowse(connection);

  // 打开远端书状态：openingPath 标记正在打开的文件（防重复点击）；
  // progress 为事件推送的下载进度；showOverlay 延迟 300ms 再显示浮层，缓存命中秒开时不闪烁
  const [openingPath, setOpeningPath] = useState<string | null>(null);
  const [progress, setProgress] = useState<NasDownloadProgress | null>(null);
  const [showOverlay, setShowOverlay] = useState(false);
  const openingRef = useRef(false);
  const unmountedRef = useRef(false);

  // 监听后端下载进度事件（与「导入-NAS」页共用 goread:nas:download 事件）
  useEffect(() => {
    // React StrictMode（dev）下 effect 会经历 mount→cleanup→re-mount 双执行：
    // cleanup 置 unmountedRef=true 后 re-mount 不会自动复位，必须在此显式重置，
    // 否则该标志永久为 true，后续所有 `!unmountedRef.current` 分支（浮层/跳转/提示）被吞
    unmountedRef.current = false;
    const unlisten = listen<NasDownloadProgress>("goread:nas:download", (e) => {
      if (!unmountedRef.current) setProgress(e.payload);
    });
    return () => {
      unmountedRef.current = true;
      unlisten.then((fn) => fn());
    };
  }, []);

  // 进度百分比（total 未知时进度条走 0，文本展示已下载字节数）
  const percent = progress?.total
    ? Math.min(100, Math.round(((progress.downloaded || 0) / progress.total) * 100))
    : 0;

  /**
   * 点击文件行直接打开远端书籍（透明缓存）
   * 功能描述：调用 nas_open_remote 命令，后端按「连接 id + 远端路径」确定性缓存：
   *          命中缓存直接复用，未命中流式下载（进度经 goread:nas:download 事件推送），
   *          完成后入库并返回书籍 id，跳转阅读器续读。300ms 内完成不显示进度浮层。
   * 参数说明：entry - 被点击的文件条目。
   * 返回值类型及用途：无返回（异步跳转阅读器，失败时经 onNotify 提示）。
   */
  const handleOpenFile = useCallback(async (entry: NasEntry) => {
    if (openingRef.current) return;
    openingRef.current = true;
    setOpeningPath(entry.path);
    setProgress({ name: entry.name, downloaded: 0, total: entry.size ?? null });
    const timer = window.setTimeout(() => {
      if (!unmountedRef.current) setShowOverlay(true);
    }, 300);
    try {
      const result = await nasOpenRemote(connection, entry.path, entry.name);
      if (!unmountedRef.current) {
        // 跳转阅读器（fromTab 记录来源 NAS 页签，返回书架时可定位）
        nav.toReader(result.book_id, { fromTab: `nas:${connection.id}` as BookshelfTab });
      }
    } catch (e) {
      if (!unmountedRef.current) {
        onNotify(`${t("nasOpenFailed")}: ${String(e)}`);
      }
    } finally {
      window.clearTimeout(timer);
      openingRef.current = false;
      if (!unmountedRef.current) {
        setShowOverlay(false);
        setOpeningPath(null);
        setProgress(null);
      }
    }
  }, [connection, nav, onNotify, t]);

  // 过滤出目录与受支持的书籍文件
  const visibleEntries = entries.filter(
    (e) => e.is_dir || isSupportedFile(e.path)
  );

  return (
    <div style={{ paddingBottom: "var(--goread-navbar-h)" }}>
      {/* 面包屑导航：当前层置灰不可点，历史层可跳转 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          fontSize: 13,
          padding: "6px 16px 8px 16px",
        }}
      >
        {dirStack.map((seg, idx) => (
          <React.Fragment key={seg.path + idx}>
            <button
              onClick={() => {
                if (!loading && idx !== dirStack.length - 1) goToDepth(idx);
              }}
              style={{
                background: "none",
                border: "none",
                boxShadow: "none",
                borderRadius: 0,
                padding: 0,
                cursor:
                  idx === dirStack.length - 1 || loading ? "default" : "pointer",
                color: idx === dirStack.length - 1 ? "#999" : "#555",
                maxWidth: 160,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                marginRight: 6,
              }}
              title={seg.path}
              disabled={loading}
            >
              {seg.name}
            </button>
            {idx < dirStack.length - 1 && (
              <span style={{ color: "#999", marginRight: 6 }}>›</span>
            )}
          </React.Fragment>
        ))}
      </div>

      {/* 状态分支：加载中 / 加载失败 / 空目录 / 目录内容 */}
      {loading && entries.length === 0 ? (
        <Loading
          visible
          overlay={false}
          text=""
          showSpinner={false}
          style={{ height: 120 }}
          textStyle={{ color: "#999" }}
        />
      ) : error ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: 300,
            color: "#999",
          }}
        >
          <div style={{ fontSize: "15px", marginBottom: 6 }}>
            {t("nasLoadFailed")}
          </div>
          <div style={{ fontSize: "13px", marginBottom: 16, color: "#bbb" }}>
            {error}
          </div>
          <button
            onClick={reload}
            style={{
              height: 36,
              padding: "0 24px",
              border: "none",
              borderRadius: 18,
              background: "#d15158",
              color: "#fff",
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            {t("retry")}
          </button>
        </div>
      ) : visibleEntries.length === 0 ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: 300,
            color: "#999",
          }}
        >
          <div style={{ fontSize: "15px" }}>{t("nasDirEmpty")}</div>
        </div>
      ) : (
        visibleEntries.map((entry) =>
          entry.is_dir ? (
            <div
              key={entry.path}
              onClick={() => !loading && goInto(entry)}
              style={{
                display: "flex",
                alignItems: "center",
                height: 60,
                padding: "0 16px",
                borderBottom: "1px solid #f0f0f0",
                cursor: loading ? "wait" : "pointer",
                opacity: loading ? 0.6 : 1,
              }}
            >
              <svg
                width={51}
                height={51}
                viewBox="0 0 24 24"
                fill="#f29b00"
                style={{ marginRight: 14, flexShrink: 0 }}
              >
                <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
              </svg>
              <div style={{ flex: 1, overflow: "hidden" }}>
                <div
                  style={{
                    color: "#333",
                    fontSize: 14,
                    whiteSpace: "nowrap",
                    textOverflow: "ellipsis",
                    overflow: "hidden",
                  }}
                >
                  {entry.name}
                </div>
                <div style={{ color: "#888", fontSize: 12 }}>
                  {entry.mtime
                    ? new Date(entry.mtime).toLocaleString()
                    : ""}
                </div>
              </div>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path
                  d="M9 6l6 6-6 6"
                  stroke="#999"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          ) : (
            <FileRow
              key={entry.path}
              name={entry.name}
              path={entry.path}
              size={entry.size ?? undefined}
              mtime={entry.mtime ?? undefined}
              rowHeight={60}
              mode="chevron"
              onClickRow={() => handleOpenFile(entry)}
            />
          )
        )
      )}

      {/* 打开远端书进度浮层：下载中展示文件名与进度；300ms 内完成（缓存命中）则不显示 */}
      {showOverlay && openingPath && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              width: 260,
              padding: "18px 20px",
              borderRadius: 12,
              background: "#fff",
              boxShadow: "0 6px 24px rgba(0,0,0,0.18)",
            }}
          >
            <div
              style={{
                fontSize: 14,
                color: "#333",
                marginBottom: 12,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={progress?.name}
            >
              {progress?.name}
            </div>
            <div
              style={{
                height: 6,
                borderRadius: 3,
                background: "#eee",
                overflow: "hidden",
                marginBottom: 8,
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${percent}%`,
                  borderRadius: 3,
                  background: "#d15158",
                  transition: "width 0.2s ease",
                }}
              />
            </div>
            <div style={{ fontSize: 12, color: "#999", textAlign: "center" }}>
              {progress?.total
                ? `${percent}%`
                : formatNasBytes(progress?.downloaded || 0)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
